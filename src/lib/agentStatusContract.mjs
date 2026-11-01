export const AGENT_STATUS_NAMES = ['Alex', 'Aria', 'Astyria', 'Aurelius'];
export const AGENT_STATUS_STALE_AFTER_MS = 45_000;
export const AGENT_STATUS_LABELS = {
  active: 'Aktywny',
  waiting: 'Oczekuje',
  blocked: 'Zablokowany',
  error: 'Błąd',
  unverified: 'Niezweryfikowany',
};

export function isAgentStatusResponse(result) {
  return Boolean(result
    && result.success === true
    && result.schemaVersion === 1
    && Number.isFinite(Date.parse(result.observedAt))
    && result.agents
    && AGENT_STATUS_NAMES.every((name) => {
      const agent = result.agents[name];
      return agent
        && Object.hasOwn(AGENT_STATUS_LABELS, agent.status)
        && (agent.status !== 'active'
          || (Number.isFinite(Date.parse(agent.lastEventAt || ''))
            && typeof agent.evidence?.source === 'string'
            && typeof agent.evidence?.taskId === 'string'));
    }));
}

export function isAgentStatusFresh(snapshot, now = Date.now()) {
  const observedAt = Date.parse(snapshot?.observedAt);
  const age = now - observedAt;
  const maxAge = Number.isFinite(snapshot?.staleAfterMs) && snapshot.staleAfterMs > 0
    ? snapshot.staleAfterMs
    : AGENT_STATUS_STALE_AFTER_MS;
  return Number.isFinite(observedAt) && age >= 0 && age <= maxAge;
}

export function getDisplayedAgentStatus(agent, snapshot, now = Date.now()) {
  if (!isAgentStatusFresh(snapshot, now) || !agent || !Object.hasOwn(AGENT_STATUS_LABELS, agent.status)) {
    return 'unverified';
  }
  return agent.status;
}
