import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_STATUS_NAMES,
  AGENT_STATUS_LABELS,
  createAgentStatusSnapshot,
  registerAgentStatus,
} from '../src/lib/agentStatus.mjs';

const token = 'agent-status-test-token-0123456789';

function harness({ env = { BASTILLA_AGENT_STATUS_TOKEN: token }, tasks = [], activeIds = [], now = new Date('2026-11-01T12:00:00.000Z') } = {}) {
  const routes = new Map();
  const app = { get: (path, handler) => routes.set(path, handler) };
  const registry = {
    getAll: () => tasks,
    isExecutorRunning: (id) => activeIds.includes(id),
  };
  registerAgentStatus(app, { registry, env, now: () => now });
  return {
    request: (authorization = '') => {
      const res = {
        code: 200,
        headers: {},
        setHeader(key, value) { this.headers[key] = value; },
        status(code) { this.code = code; return this; },
        json(body) { this.body = body; return this; },
      };
      routes.get('/api/agents/status')({ get: () => authorization }, res);
      return res;
    },
  };
}

test('agent status contract reports only live executors as active with source and timestamps', () => {
  const snapshot = createAgentStatusSnapshot({
    getAll: () => [
      { id: 'live-aria', agent: 'Aria', status: 'running', startedAt: '2026-11-01T11:59:00Z', logs: ['[2026-11-01T11:59:00Z] started'] },
      { id: 'stale-alex', agent: 'Alex', status: 'running', startedAt: '2026-11-01T11:59:00Z', logs: [] },
      { id: 'failed-aurelius', agent: 'Aurelius', status: 'failed', completedAt: '2026-11-01T11:58:00Z', logs: [] },
      { id: 'done-astyria', agent: 'Astyria', status: 'completed', completedAt: '2026-11-01T11:58:00Z', logs: [] },
    ],
    isExecutorRunning: (id) => id === 'live-aria',
  }, new Date('2026-11-01T12:00:00.000Z'));

  assert.deepEqual(Object.keys(snapshot.agents).sort(), [...AGENT_STATUS_NAMES].sort());
  assert.equal(snapshot.agents.Aria.status, 'active');
  assert.equal(snapshot.agents.Aria.lastEventAt, '2026-11-01T11:59:00.000Z');
  assert.equal(snapshot.agents.Aria.evidence.runtime, 'in-process executor active');
  assert.equal(snapshot.agents.Alex.status, 'unverified');
  assert.equal(snapshot.agents.Aurelius.status, 'error');
  assert.equal(snapshot.agents.Astyria.status, 'unverified');
  assert.equal(snapshot.observedAt, '2026-11-01T12:00:00.000Z');
  assert.deepEqual(Object.keys(AGENT_STATUS_LABELS).sort(), ['active', 'blocked', 'error', 'unverified', 'waiting']);
  assert.equal(AGENT_STATUS_LABELS.active, 'Aktywny');
  assert.equal(AGENT_STATUS_LABELS.unverified, 'Niezweryfikowany');
});

test('old records and persisted running labels remain unverified', () => {
  const snapshot = createAgentStatusSnapshot({
    getAll: () => [
      { id: 'old-failure', agent: 'Aria', status: 'failed', completedAt: '2026-10-30T12:00:00Z' },
      { id: 'old-running', agent: 'Alex', status: 'running', startedAt: '2026-10-30T12:00:00Z' },
      { id: 'old-queued', agent: 'Astyria', status: 'queued', createdAt: '2026-10-30T12:00:00Z' },
    ],
    isExecutorRunning: () => false,
  }, new Date('2026-11-01T12:00:00.000Z'));

  assert.equal(snapshot.agents.Aria.status, 'unverified');
  assert.equal(snapshot.agents.Alex.status, 'unverified');
  assert.equal(snapshot.agents.Astyria.status, 'unverified');
  assert.equal(snapshot.agents.Aurelius.status, 'unverified');
  assert.equal(snapshot.agents.Aria.evidence.taskStatus, 'failed');
});

test('agent status endpoint fails closed without a configured token or valid bearer', () => {
  const disabled = harness({ env: {} }).request('Bearer ' + token);
  assert.equal(disabled.code, 503);
  assert.equal(disabled.headers['Cache-Control'], 'no-store');

  const endpoint = harness();
  const invalidBearer = 'Bearer ' + 'invalid-token';
  for (const auth of ['', 'Basic invalid', invalidBearer]) {
    const response = endpoint.request(auth);
    assert.equal(response.code, 401);
    assert.equal(response.headers['WWW-Authenticate'], 'Bearer');
    assert.ok(!JSON.stringify(response.body).includes(token));
  }
});

test('authorized agent status response is read-only, uncached, and contains no task content', () => {
  const endpoint = harness({
    tasks: [{
      id: 'active-task-1', agent: 'Alex', status: 'running',
      title: 'private title', description: 'private description',
      logs: ['[2026-11-01T11:59:00Z] private log'],
    }],
    activeIds: ['active-task-1'],
  });
  const response = endpoint.request('Bearer ' + token);
  assert.equal(response.code, 200);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.equal(response.body.success, true);
  assert.equal(response.body.agents.Alex.status, 'active');
  assert.equal(response.body.agents.Alex.evidence.taskId, 'active-task-1');
  assert.ok(!JSON.stringify(response.body).includes('private title'));
  assert.ok(!JSON.stringify(response.body).includes('private description'));
  assert.ok(!JSON.stringify(response.body).includes(token));
});
