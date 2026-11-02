export const AGENT_PROFILES = Object.freeze([
  { id: 'aria', name: 'Aria', role: 'Modele i transport AI' },
  { id: 'astyria', name: 'Astyria', role: 'Interfejs i ergonomia' },
  { id: 'aurelius', name: 'Aurelius', role: 'Bezpieczeństwo i testy' },
  { id: 'alex', name: 'Alex', role: 'Architektura i integracja' },
]);

export function getInitialAgentStatuses() {
  return AGENT_PROFILES.map((agent) => ({
    ...agent,
    status: 'unknown',
    statusLabel: 'Niepodłączony',
  }));
}

export function getUnavailableActionMessage(kind) {
  if (kind === 'chat') {
    return 'Runtime niepodłączony — wiadomość nie została wysłana.';
  }
  if (kind === 'terminal') {
    return 'Runtime niepodłączony — polecenie nie zostało wykonane.';
  }
  return 'Runtime niepodłączony — akcja nie została wykonana.';
}

function renderAgentProfiles(list) {
  if (!list) return;
  const fragment = document.createDocumentFragment();
  for (const agent of getInitialAgentStatuses()) {
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
    const state = document.createElement('p');
    state.className = 'agent-state';
    state.textContent = agent.statusLabel;

    item.append(nameRow, role, state);
    fragment.append(item);
  }
  list.replaceChildren(fragment);
}

function bindUnavailableForm(formId, feedbackId, kind) {
  const form = document.getElementById(formId);
  const feedback = document.getElementById(feedbackId);
  if (!form || !feedback) return;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    feedback.textContent = getUnavailableActionMessage(kind);
  });
}

if (typeof document !== 'undefined') {
  renderAgentProfiles(document.getElementById('agent-list'));
  bindUnavailableForm('chat-form', 'chat-feedback', 'chat');
  bindUnavailableForm('terminal-form', 'terminal-feedback', 'terminal');
}
