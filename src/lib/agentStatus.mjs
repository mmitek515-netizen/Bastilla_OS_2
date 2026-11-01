import { createHash, timingSafeEqual } from 'node:crypto';
import { AGENT_STATUS_NAMES, AGENT_STATUS_STALE_AFTER_MS } from './agentStatusContract.mjs';

const HISTORICAL_EVIDENCE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const hash = (value) => createHash('sha256').update(value).digest();

function getLastEventAt(task) {
  for (const log of [...(Array.isArray(task.logs) ? task.logs : [])].reverse()) {
    const match = typeof log === 'string' ? log.match(/^\[([^\]]+)\]/) : null;
    if (match && Number.isFinite(Date.parse(match[1]))) return new Date(match[1]).toISOString();
  }
  const timestamp = task.completedAt || task.startedAt || task.createdAt;
  return Number.isFinite(Date.parse(timestamp)) ? new Date(timestamp).toISOString() : null;
}

function newestFirst(left, right) {
  return (Date.parse(getLastEventAt(right)) || 0) - (Date.parse(getLastEventAt(left)) || 0);
}

export function createAgentStatusSnapshot(registry, now = new Date()) {
  const observedAt = now.toISOString();
  const nowMs = now.getTime();
  const tasks = registry.getAll();
  const agents = Object.fromEntries(AGENT_STATUS_NAMES.map((name) => {
    const agentTasks = tasks.filter((task) => task.agent === name);
    const activeTask = agentTasks
      .filter((task) => task.status === 'running' && registry.isExecutorRunning(task.id))
      .sort(newestFirst)[0];

    if (activeTask) {
      return [name, {
        status: 'active',
        lastEventAt: getLastEventAt(activeTask),
        observedAt,
        evidence: {
          source: 'agent-task-registry',
          taskId: activeTask.id,
          taskStatus: 'running',
          runtime: 'in-process executor active',
        },
      }];
    }

    const latestTask = agentTasks.sort(newestFirst)[0];
    const lastEventAt = latestTask ? getLastEventAt(latestTask) : null;
    const recent = lastEventAt && nowMs - Date.parse(lastEventAt) <= HISTORICAL_EVIDENCE_MAX_AGE_MS;
    const evidence = latestTask ? {
      source: 'agent-task-registry',
      taskId: latestTask.id,
      taskStatus: latestTask.status,
    } : null;

    return [name, {
      status: recent && latestTask.status === 'failed' ? 'error' : 'unverified',
      lastEventAt,
      observedAt,
      evidence,
    }];
  }));

  return {
    schemaVersion: 1,
    observedAt,
    staleAfterMs: AGENT_STATUS_STALE_AFTER_MS,
    agents,
    note: 'Aktywny oznacza potwierdzony executor zadania w bieżącym procesie. Profile, przypisania i zapisane stany nie potwierdzają działania.',
  };
}

export function registerAgentStatus(app, { registry, env = process.env, now = () => new Date() }) {
  const token = (env.BASTILLA_AGENT_STATUS_TOKEN || '').trim();
  app.get('/api/agents/status', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (token.length < 32) {
      return res.status(503).json({ success: false, error: 'Ustaw BASTILLA_AGENT_STATUS_TOKEN (minimum 32 znaki), aby włączyć odczyt statusu agentów.' });
    }

    const supplied = req.get('authorization') || '';
    const authorized = timingSafeEqual(hash(supplied), hash('Bearer ' + token));
    if (!authorized) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      return res.status(401).json({ success: false, error: 'Brak poprawnego tokenu odczytu statusu agentów.' });
    }

    return res.json({ success: true, ...createAgentStatusSnapshot(registry, now()) });
  });
}
