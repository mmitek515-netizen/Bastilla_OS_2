import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  AGENT_PROFILES,
  ApiError,
  createApiClient,
  getInitialAgentStatuses,
} from './app.mjs';

const uiDirectory = new URL('./', import.meta.url);
const readUiFile = (name) => readFile(new URL(name, uiDirectory), 'utf8');

async function startTestDouble(t) {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    let payload;
    let status = 200;
    requests.push({ method: request.method, path, body: body ? JSON.parse(body) : null });

    if (request.method === 'GET' && path === '/api/v1/status') {
      payload = {
        api_version: 'v1',
        application: { status: 'running', product: 'Debian 13 user-space demo' },
        operating_system: {
          target: 'Debian 13',
          runtime: {
            distribution: 'TEST-DOUBLE OS',
            debian_13_boot_verified: false,
          },
        },
        model: { provider: 'ollama', status: 'not_configured', model: null, inference: 'not_verified' },
        task_state: 'in-memory; cleared on restart',
      };
    } else if (request.method === 'GET' && path === '/api/v1/agents') {
      payload = {
        agents: AGENT_PROFILES.map(({ id, name, role }) => ({
          id, name, role, status: 'profile_configured', worker: 'not_running',
        })),
      };
    } else if (request.method === 'GET' && path === '/api/v1/tasks') {
      payload = { tasks: [] };
    } else if (request.method === 'POST' && path === '/api/v1/chat') {
      if (request.headers['content-type'] !== 'application/json') {
        status = 400;
        payload = { error: 'Wymagany Content-Type: application/json.' };
      } else if (JSON.parse(body).message === '/help') {
        payload = {
          reply: 'TEST-DOUBLE: Obsługiwane lokalne polecenia: /help, /status, /terminal pwd.',
          source: 'local_command',
          agent: JSON.parse(body).agent,
          task: { id: 'test-help-task', status: 'completed' },
        };
      } else {
        status = 503;
        payload = {
          error: 'TEST-DOUBLE: Brak skonfigurowanego modelu.',
          task: { id: 'test-model-task', status: 'failed' },
        };
      }
    } else if (request.method === 'POST' && path === '/api/v1/terminal') {
      const { command } = JSON.parse(body);
      if (command === 'pwd') {
        payload = {
          output: '.',
          source: 'restricted_terminal',
          task: { id: 'test-pwd-task', status: 'completed' },
        };
      } else {
        status = 400;
        payload = {
          error: 'TEST-DOUBLE: Dozwolone są wyłącznie pwd, ls oraz cat <plik-tekstowy>.',
          task: { id: 'test-denied-task', status: 'failed' },
        };
      }
    } else {
      status = 404;
      payload = { error: 'TEST-DOUBLE: Nieznany endpoint.' };
    }

    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Debian13-Test-Double': 'true',
    });
    response.end(JSON.stringify(payload));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return {
    api: createApiClient({ baseUrl: `http://127.0.0.1:${server.address().port}` }),
    requests,
  };
}

test('exposes four configured profiles without claiming their workers are running', () => {
  const statuses = getInitialAgentStatuses();
  assert.deepEqual(statuses.map(({ id }) => id), ['aria', 'astyria', 'aurelius', 'alex']);
  assert.equal(new Set(statuses.map(({ name }) => name)).size, 4);
  assert.ok(statuses.every(({ status, worker }) => status === 'unknown' && worker === 'unknown'));
});

test('uses the v1 GET status, agents, and tasks HTTP endpoints', async (t) => {
  const { api, requests } = await startTestDouble(t);
  const [status, agents, tasks] = await Promise.all([
    api.getStatus(),
    api.getAgents(),
    api.getTasks(),
  ]);
  assert.equal(status.model.status, 'not_configured');
  assert.equal(status.model.inference, 'not_verified');
  assert.equal(status.operating_system.runtime.debian_13_boot_verified, false);
  assert.equal(agents.agents.length, 4);
  assert.ok(agents.agents.every(({ status: profile, worker }) =>
    profile === 'profile_configured' && worker === 'not_running'));
  assert.deepEqual(tasks, { tasks: [] });
  assert.deepEqual(requests.map(({ method, path }) => `${method} ${path}`).sort(), [
    'GET /api/v1/agents',
    'GET /api/v1/status',
    'GET /api/v1/tasks',
  ]);
});

test('posts /help to the HTTP test-double and shows the response is mocked', async (t) => {
  const { api, requests } = await startTestDouble(t);
  const help = await api.chat('/help', 'aria');
  assert.equal(help.source, 'local_command');
  assert.match(help.reply, /^TEST-DOUBLE:/);
  assert.deepEqual(requests[0], {
    method: 'POST',
    path: '/api/v1/chat',
    body: { message: '/help', agent: 'aria' },
  });
});

test('posts allowed pwd and denied shell command to the HTTP test-double', async (t) => {
  const { api, requests } = await startTestDouble(t);
  const pwd = await api.terminal('pwd');
  assert.equal(pwd.output, '.');
  await assert.rejects(api.terminal('id'), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 400);
    assert.match(error.message, /TEST-DOUBLE/);
    return true;
  });
  assert.deepEqual(requests.map(({ body }) => body.command), ['pwd', 'id']);
});

test('surfaces HTTP 503 when the test-double has no model, without a fake reply', async (t) => {
  const { api } = await startTestDouble(t);
  await assert.rejects(api.chat('Napisz odpowiedź', 'aria'), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 503);
    assert.match(error.message, /Brak skonfigurowanego modelu/);
    return true;
  });
});

test('provides responsive UI with independent loading and API error states', async () => {
  const [html, css, app] = await Promise.all([
    readUiFile('index.html'),
    readUiFile('styles.css'),
    readUiFile('app.mjs'),
  ]);
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1"/);
  assert.match(html, /id="runtime-details"/);
  assert.match(html, /id="agent-list"/);
  assert.match(html, /id="task-list"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(css, /@media \(max-width: 860px\)/);
  assert.match(css, /@media \(max-width: 520px\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /:focus-visible/);
  for (const endpoint of ['status', 'agents', 'tasks', 'chat', 'terminal']) {
    assert.ok(app.includes(`'${endpoint}'`), `expected API endpoint ${endpoint}`);
  }
  assert.match(app, /error\.status === 503/);
  assert.doesNotMatch(app, /\.innerHTML\s*=/);
});
