const api = '/api/v1';

async function request(path, options = {}) {
  const response = await fetch(`${api}${path}`, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
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
  const output = document.querySelector('#chat-result');
  button.disabled = true;
  output.textContent = 'Przetwarzanie…';
  const message = document.querySelector('#message').value;
  const agent = document.querySelector('#agent').value;
  try {
    const data = await request('/chat', {
      method: 'POST',
      body: JSON.stringify({ message, agent }),
    });
    output.textContent = `${data.source} · ${data.agent} · zadanie ${data.task.status}\n${data.reply}`;
    form.reset();
  } catch (error) {
    output.textContent = error.message;
  } finally {
    button.disabled = false;
    await refreshTasks();
  }
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
void refreshStatus();
void refreshTasks();
