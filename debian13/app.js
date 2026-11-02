const api = '/api/v1';
const sessionStorageKey = 'debian13.session.v1';
let sessionId = sessionStorage.getItem(sessionStorageKey) || '';

async function request(path, options = {}) {
  const response = await fetch(`${api}${path}`, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

async function streamChat(payload, onMeta, onDelta) {
  const response = await fetch(`${api}/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.json();
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  if (!response.body) throw new Error('Przeglądarka nie obsługuje strumienia odpowiedzi.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = null;
  const dispatch = (block) => {
    let event = 'message';
    const data = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      if (line.startsWith('data:')) data.push(line.slice(5).trim());
    }
    if (!data.length) return;
    const value = JSON.parse(data.join('\n'));
    if (event === 'meta') onMeta(value);
    if (event === 'delta') onDelta(value.text);
    if (event === 'error') throw new Error(value.error || 'Strumień czatu zakończył się błędem.');
    if (event === 'done') completed = value;
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    buffer = buffer.replace(/\r\n/g, '\n');
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      dispatch(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');
    }
    if (done) break;
  }
  if (buffer.trim()) dispatch(buffer);
  if (!completed) throw new Error('Strumień czatu zakończył się przed odpowiedzią końcową.');
  return completed;
}

function addAgent(profile) {
  const item = document.createElement('li');
  const name = document.createElement('strong');
  const role = document.createElement('span');
  const state = document.createElement('span');
  name.textContent = profile.name;
  role.textContent = profile.role;
  state.textContent = `Profil: ${profile.status}; worker: ${profile.worker}`;
  item.append(name, role, state);
  return item;
}

function addMessage(message) {
  const item = document.createElement('li');
  const role = document.createElement('strong');
  const content = document.createElement('div');
  item.className = 'chat-message';
  role.textContent = `${message.role === 'user' ? 'Ty' : message.agent} · ${message.role}`;
  content.textContent = message.content;
  item.append(role, content);
  return item;
}

async function refreshChatHistory() {
  const list = document.querySelector('#chat-history');
  if (!sessionId) {
    list.replaceChildren();
    return;
  }
  try {
    const data = await request(`/sessions/${encodeURIComponent(sessionId)}/messages`);
    list.replaceChildren(...data.messages.map(addMessage));
    list.scrollTop = list.scrollHeight;
  } catch (error) {
    if (error.message.includes('Sesja nie istnieje')) {
      sessionId = '';
      sessionStorage.removeItem(sessionStorageKey);
      list.replaceChildren();
      return;
    }
    list.replaceChildren(Object.assign(document.createElement('li'), {
      textContent: `Historia niedostępna: ${error.message}`,
    }));
  }
}

function addTask(task) {
  const item = document.createElement('li');
  const row = document.createElement('div');
  const state = document.createElement('span');
  const meta = document.createElement('div');
  row.className = 'task-row';
  state.className = 'task-state';
  meta.className = 'task-meta';
  row.textContent = `${task.kind} · ${task.agent}`;
  state.textContent = task.status;
  meta.textContent = `${task.id} · ${task.updated_at}`;
  item.append(row, state, meta);
  return item;
}

async function refreshDiagnostics() {
  const output = document.querySelector('#diagnostics-result');
  const button = document.querySelector('#refresh-diagnostics');
  button.disabled = true;
  output.textContent = 'Odczyt rzeczywistego stanu runtime…';
  try {
    const data = await request('/diagnostics');
    output.textContent = JSON.stringify(data, null, 2);
  } catch (error) {
    output.textContent = `Diagnostyka niedostępna: ${error.message}`;
  } finally {
    button.disabled = false;
  }
}

async function refreshStatus() {
  const systemStatus = document.querySelector('#system-status');
  try {
    const data = await request('/status');
    systemStatus.textContent = `Aplikacja: ${data.application.status}`;
    document.querySelector('#runtime-details').textContent =
      `Model: ${data.model.status}; inference: ${data.model.inference}.`;
    document.querySelector('#os-details').textContent =
      `Cel: ${data.operating_system.target}; runtime: ${data.operating_system.runtime.distribution}; boot Debian 13 zweryfikowany: ${data.operating_system.runtime.debian_13_boot_verified ? 'tak' : 'nie'}.`;
    const agents = await request('/agents');
    const list = document.querySelector('#agents');
    list.replaceChildren(...agents.agents.map(addAgent));
  } catch (error) {
    systemStatus.textContent = `API niedostępne: ${error.message}`;
  }
}

async function refreshTasks() {
  const list = document.querySelector('#tasks');
  try {
    const data = await request('/tasks');
    list.replaceChildren(...(data.tasks.length ? data.tasks.map(addTask) : [Object.assign(document.createElement('li'), { textContent: 'Brak zadań.' })]));
  } catch (error) {
    list.replaceChildren(Object.assign(document.createElement('li'), { textContent: `Nie udało się pobrać zadań: ${error.message}` }));
  }
}

document.querySelector('#chat-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  const newSessionButton = document.querySelector('#new-session');
  const output = document.querySelector('#chat-result');
  button.disabled = true;
  newSessionButton.disabled = true;
  output.textContent = 'Przetwarzanie…';
  const message = document.querySelector('#message').value;
  const agent = document.querySelector('#agent').value;
  let reply = '';
  try {
    const payload = { message, agent };
    if (sessionId) payload.session_id = sessionId;
    const data = await streamChat(payload, (meta) => {
      sessionId = meta.session_id;
      sessionStorage.setItem(sessionStorageKey, sessionId);
    }, (text) => {
      reply += text;
      output.textContent = `${agent} · ${reply}`;
    });
    sessionId = data.session_id;
    sessionStorage.setItem(sessionStorageKey, sessionId);
    output.textContent = `${data.source} · ${data.agent} · zadanie ${data.task.status}\n${reply}`;
    await refreshChatHistory();
    form.reset();
  } catch (error) {
    output.textContent = error.message;
    if (error.message.includes('Sesja nie istnieje')) {
      sessionId = '';
      sessionStorage.removeItem(sessionStorageKey);
      document.querySelector('#chat-history').replaceChildren();
    }
  } finally {
    button.disabled = false;
    newSessionButton.disabled = false;
    await refreshTasks();
  }
});

document.querySelector('#new-session').addEventListener('click', () => {
  sessionId = '';
  sessionStorage.removeItem(sessionStorageKey);
  document.querySelector('#chat-history').replaceChildren();
  document.querySelector('#chat-result').textContent = 'Nowa sesja czatu.';
});

document.querySelector('#terminal-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  const output = document.querySelector('#terminal-result');
  button.disabled = true;
  output.textContent = 'Wykonywanie…';
  try {
    const data = await request('/terminal', {
      method: 'POST',
      body: JSON.stringify({ command: document.querySelector('#command').value }),
    });
    output.textContent = `${data.source} · zadanie ${data.task.status}\n${data.output}`;
    form.reset();
  } catch (error) {
    output.textContent = error.message;
  } finally {
    button.disabled = false;
    await refreshTasks();
  }
});

document.querySelector('#refresh-tasks').addEventListener('click', refreshTasks);
document.querySelector('#refresh-diagnostics').addEventListener('click', refreshDiagnostics);
void refreshStatus();
void refreshTasks();
void refreshDiagnostics();
void refreshChatHistory();
