export const AGENT_PROFILES = Object.freeze([
  { id: 'aria', name: 'Aria', role: 'Modele i transport AI' },
  { id: 'astyria', name: 'Astyria', role: 'Interfejs i ergonomia' },
  { id: 'aurelius', name: 'Aurelius', role: 'Bezpieczeństwo i testy' },
  { id: 'alex', name: 'Alex', role: 'Architektura i integracja' },
]);

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function createApiClient({ fetchImpl = globalThis.fetch, baseUrl = '' } = {}) {
  async function request(path, options) {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}/api/v1/${path}`, options);
    } catch {
      throw new ApiError('Runtime nieosiągalny — sprawdź połączenie z API.');
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new ApiError('Runtime zwrócił nieprawidłową odpowiedź.', response.status);
    }
    if (!response.ok) {
      throw new ApiError(
        typeof payload.error === 'string' ? payload.error : `Żądanie nie powiodło się (HTTP ${response.status}).`,
        response.status,
      );
    }
    return payload;
  }

  function post(path, body) {
    return request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  return Object.freeze({
    getStatus: () => request('status'),
    getAgents: () => request('agents'),
    getTasks: () => request('tasks'),
    chat: (message, agent) => post('chat', { message, agent }),
    terminal: (command) => post('terminal', { command }),
  });
}

export function getInitialAgentStatuses() {
  return AGENT_PROFILES.map((agent) => ({
    ...agent,
    status: 'unknown',
    worker: 'unknown',
  }));
}

function agentStatusLabel(agent) {
  const profile = agent.status === 'profile_configured'
    ? 'Profil skonfigurowany'
    : 'Profil: stan nieznany';
  const worker = agent.worker === 'not_running'
    ? 'Worker nieuruchomiony'
    : agent.worker === 'running'
      ? 'Worker uruchomiony'
      : 'Worker: stan nieznany';
  return { profile, worker };
}

function renderAgentProfiles(list, agents = getInitialAgentStatuses()) {
  if (!list) return;
  const fragment = document.createDocumentFragment();
  for (const agent of agents) {
    const item = document.createElement('li');
    item.className = 'agent-card';
    item.dataset.agent = agent.id;

    const nameRow = document.createElement('div');
    nameRow.className = 'agent-name-row';
    const dot = document.createElement('span');
    dot.className = 'agent-state-dot';
    dot.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.textContent = agent.name;
    nameRow.append(dot, name);

    const role = document.createElement('p');
    role.className = 'agent-role';
    role.textContent = agent.role;
    const labels = agentStatusLabel(agent);
    const profile = document.createElement('p');
    profile.className = 'agent-state';
    profile.textContent = labels.profile;
    const worker = document.createElement('p');
    worker.className = 'worker-state';
    worker.textContent = labels.worker;

    item.append(nameRow, role, profile, worker);
    fragment.append(item);
  }
  list.replaceChildren(fragment);
}

function setText(id, text) {
  const element = document.getElementById(id);
  if (element) element.textContent = text;
}

function connectionState(state, label) {
  const element = document.getElementById('connection-status');
  if (!element) return;
  element.dataset.state = state;
  const text = element.querySelector('span:last-child');
  if (text) text.textContent = label;
}

function modelStatusLabel(model) {
  const statusLabels = {
    not_configured: 'Brak skonfigurowanego modelu',
    unavailable: 'Ollama niedostępna',
    model_missing: 'Model niedostępny',
    model_available: 'Model dostępny lokalnie',
  };
  const label = statusLabels[model?.status] ?? 'Stan modelu nieznany';
  const inference = model?.inference === 'verified'
    ? 'inferencja zweryfikowana'
    : 'inferencja niezweryfikowana';
  return `${label} · ${inference}`;
}

function renderRuntimeStatus(status) {
  const application = status.application?.status === 'running'
    ? `${status.application.product ?? 'Aplikacja'} działa`
    : 'Aplikacja niedostępna';
  const osRuntime = status.operating_system?.runtime;
  const distribution = osRuntime?.distribution ?? 'dystrybucja nieznana';
  const boot = osRuntime?.debian_13_boot_verified === true
    ? 'boot Debian 13 potwierdzony'
    : 'boot Debian 13 niepotwierdzony';
  setText('application-status', application);
  setText('os-status', `${distribution} · ${boot}`);
  setText('model-status', modelStatusLabel(status.model));
  setText('task-storage-status', status.task_state ?? 'Stan pamięci zadań nieznany');
  setText('status-error', '');
  connectionState('connected', 'API dostępne');
}

function appendTranscript(kind, title, content) {
  const transcript = document.getElementById('chat-transcript');
  if (!transcript) return;
  transcript.querySelector('.empty-state')?.remove();
  const entry = document.createElement('article');
  entry.className = `transcript-entry transcript-${kind}`;
  const heading = document.createElement('p');
  heading.className = 'transcript-heading';
  heading.textContent = title;
  const text = document.createElement('p');
  text.className = 'transcript-text';
  text.textContent = content;
  entry.append(heading, text);
  transcript.append(entry);
  transcript.scrollTop = transcript.scrollHeight;
}

function renderTerminal(command, output, isError = false) {
  const terminal = document.getElementById('terminal-output');
  if (!terminal) return;
  terminal.querySelector('.terminal-hint')?.remove();
  const entry = document.createElement('p');
  const prompt = document.createElement('span');
  prompt.className = 'prompt-mark';
  prompt.setAttribute('aria-hidden', 'true');
  prompt.textContent = isError ? '!' : '$';
  const commandText = document.createElement('span');
  commandText.textContent = ` ${command}`;
  entry.append(prompt, commandText);
  const result = document.createElement('pre');
  result.className = isError ? 'terminal-error' : 'terminal-result';
  result.textContent = output;
  terminal.append(entry, result);
  terminal.scrollTop = terminal.scrollHeight;
}

function renderTasks(tasks) {
  const list = document.getElementById('task-list');
  if (!list) return;
  const fragment = document.createDocumentFragment();
  for (const task of tasks) {
    const item = document.createElement('li');
    item.className = 'task-item';
    const detail = document.createElement('span');
    detail.textContent = `${task.kind} · ${task.agent} · ${task.id}`;
    const status = document.createElement('span');
    status.className = `task-state task-${task.status}`;
    status.textContent = task.status;
    item.append(detail, status);
    fragment.append(item);
  }
  if (!tasks.length) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = 'Brak zadań w bieżącym procesie.';
    fragment.append(empty);
  }
  list.replaceChildren(fragment);
  setText('tasks-count', `${tasks.length} zadań · pamięć procesu`);
  setText('tasks-error', '');
}

const api = createApiClient();

async function loadStatus() {
  connectionState('loading', 'Ładowanie statusu…');
  setText('status-error', '');
  for (const id of ['application-status', 'os-status', 'model-status', 'task-storage-status']) {
    setText(id, 'Ładowanie…');
  }
  try {
    renderRuntimeStatus(await api.getStatus());
  } catch (error) {
    connectionState('error', 'Runtime niedostępny');
    for (const id of ['application-status', 'os-status', 'model-status', 'task-storage-status']) {
      setText(id, 'Niedostępny');
    }
    setText('status-error', error.message);
  }
}

async function loadAgents() {
  setText('agent-count', 'Ładowanie profili…');
  setText('agent-error', '');
  renderAgentProfiles(document.getElementById('agent-list'));
  try {
    const payload = await api.getAgents();
    if (!Array.isArray(payload.agents)) throw new ApiError('Nieprawidłowy format listy profili.');
    const agents = payload.agents;
    renderAgentProfiles(document.getElementById('agent-list'), agents);
    const workers = agents.filter(({ worker }) => worker === 'running').length;
    setText('agent-count', `${agents.length} profili · ${workers} workerów uruchomionych`);
  } catch (error) {
    setText('agent-count', 'Profile niedostępne');
    setText('agent-error', error.message);
    renderAgentProfiles(document.getElementById('agent-list'));
  }
}

async function loadTasks() {
  setText('tasks-count', 'Ładowanie…');
  setText('tasks-error', '');
  try {
    const payload = await api.getTasks();
    if (!Array.isArray(payload.tasks)) throw new ApiError('Nieprawidłowy format listy zadań.');
    renderTasks(payload.tasks);
  } catch (error) {
    setText('tasks-count', 'Zadania niedostępne');
    setText('tasks-error', error.message);
    const list = document.getElementById('task-list');
    if (list) list.replaceChildren();
  }
}

async function refreshDashboard() {
  await Promise.all([loadStatus(), loadAgents(), loadTasks()]);
}

function bindChatForm() {
  const form = document.getElementById('chat-form');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = document.getElementById('chat-message');
    const agent = document.getElementById('chat-agent');
    const submit = document.getElementById('chat-submit');
    const feedback = document.getElementById('chat-feedback');
    const text = message?.value.trim();
    if (!text || !agent || !feedback) return;
    submit.disabled = true;
    feedback.textContent = 'Wysyłanie do API…';
    appendTranscript('user', `Ty · ${agent.value}`, text);
    try {
      const result = await api.chat(text, agent.value);
      if (typeof result.reply !== 'string') throw new ApiError('API nie zwróciło odpowiedzi tekstowej.');
      appendTranscript('assistant', `${result.agent} · ${result.source}`, result.reply);
      message.value = '';
      feedback.textContent = result.source === 'ollama'
        ? 'Odpowiedź modelu lokalnego.'
        : 'Odpowiedź z lokalnej obsługi polecenia.';
    } catch (error) {
      appendTranscript('error', `Błąd API${error.status ? ` · HTTP ${error.status}` : ''}`, error.message);
      feedback.textContent = error.status === 503
        ? 'Model niedostępny — API nie wygenerowało odpowiedzi.'
        : error.message;
    } finally {
      submit.disabled = false;
      await loadTasks();
    }
  });
}

function bindTerminalForm() {
  const form = document.getElementById('terminal-form');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const commandInput = document.getElementById('terminal-command');
    const submit = document.getElementById('terminal-submit');
    const feedback = document.getElementById('terminal-feedback');
    const command = commandInput?.value.trim();
    if (!command || !feedback) return;
    submit.disabled = true;
    feedback.textContent = 'Wysyłanie do ograniczonego API terminala…';
    try {
      const result = await api.terminal(command);
      if (typeof result.output !== 'string') throw new ApiError('API nie zwróciło wyniku tekstowego.');
      renderTerminal(command, result.output);
      commandInput.value = '';
      feedback.textContent = 'Polecenie obsłużone bez uruchamiania powłoki.';
    } catch (error) {
      renderTerminal(command, error.message, true);
      feedback.textContent = error.message;
    } finally {
      submit.disabled = false;
      await loadTasks();
    }
  });
}

if (typeof document !== 'undefined') {
  renderAgentProfiles(document.getElementById('agent-list'));
  bindChatForm();
  bindTerminalForm();
  document.getElementById('refresh-status')?.addEventListener('click', refreshDashboard);
  void refreshDashboard();
}
