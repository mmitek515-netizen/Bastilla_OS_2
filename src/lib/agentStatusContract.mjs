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
