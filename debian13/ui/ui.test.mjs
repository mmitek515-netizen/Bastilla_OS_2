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
const TEST_SESSION_ID = '123e4567-e89b-42d3-a456-426614174000';
const TEST_TASK_ID = '123e4567-e89b-42d3-a456-426614174001';

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
    } else if (request.method === 'GET' && path === `/api/v1/tasks/${TEST_TASK_ID}`) {
      payload = { task: { id: TEST_TASK_ID, kind: 'chat', agent: 'aria', status: 'running' } };
    } else if (request.method === 'POST' && path === `/api/v1/tasks/${TEST_TASK_ID}/cancel`) {
      payload = { task: { id: TEST_TASK_ID, kind: 'chat', agent: 'aria', status: 'cancel_requested' } };
    } else if (request.method === 'GET' && path === '/api/v1/events') {
      payload = {
        events: [{
          at: '2026-11-02T13:00:00+00:00',
          type: 'task.completed',
          agent: 'aria',
          task_id: 'test-event-task',
        }],
      };
    } else if (request.method === 'GET' && path === `/api/v1/sessions/${TEST_SESSION_ID}/messages`) {
      payload = {
        session_id: TEST_SESSION_ID,
        messages: [{ role: 'user', content: 'TEST-DOUBLE: wcześniejsza wiadomość', agent: 'aria', source: 'ollama' }],
      };
    } else if (request.method === 'POST' && path === '/api/v1/chat/stream') {
      if (request.headers['content-type'] !== 'application/json') {
        status = 400;
        payload = { error: 'Wymagany Content-Type: application/json.' };
      } else if (JSON.parse(body).message === '/help') {
        response.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'X-Debian13-Test-Double': 'true',
        });
        response.write(`event: meta\ndata: ${JSON.stringify({ session_id: TEST_SESSION_ID, task_id: 'test-help-task' })}\n\n`);
        response.write(`event: delta\ndata: ${JSON.stringify({ text: 'TEST-DOUBLE: odpowiedź ' })}\n\n`);
        response.write(`event: delta\ndata: ${JSON.stringify({ text: 'lokalna.' })}\n\n`);
        response.write(`event: done\ndata: ${JSON.stringify({ session_id: TEST_SESSION_ID, source: 'local_command', agent: JSON.parse(body).agent, task: { id: 'test-help-task', status: 'completed' } })}\n\n`);
        response.end();
        return;
      } else if (JSON.parse(body).message === '/cancel') {
        response.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'X-Debian13-Test-Double': 'true',
        });
        response.write(`event: meta\ndata: ${JSON.stringify({ session_id: TEST_SESSION_ID, task_id: TEST_TASK_ID })}\n\n`);
        response.end(`event: cancelled\ndata: ${JSON.stringify({ error: 'request_cancelled', task: { id: TEST_TASK_ID, status: 'cancelled' } })}\n\n`);
        return;
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
  const [status, agents, tasks, events] = await Promise.all([
    api.getStatus(),
    api.getAgents(),
    api.getTasks(),
    api.getEvents(),
  ]);
  assert.equal(status.model.status, 'not_configured');
  assert.equal(status.model.inference, 'not_verified');
  assert.equal(status.operating_system.runtime.debian_13_boot_verified, false);
  assert.equal(agents.agents.length, 4);
  assert.ok(agents.agents.every(({ status: profile, worker }) =>
    profile === 'profile_configured' && worker === 'not_running'));
  assert.deepEqual(tasks, { tasks: [] });
  assert.equal(events.events[0].type, 'task.completed');
  assert.deepEqual(requests.map(({ method, path }) => `${method} ${path}`).sort(), [
    'GET /api/v1/agents',
    'GET /api/v1/events',
    'GET /api/v1/status',
    'GET /api/v1/tasks',
  ]);
});

test('streams /help from the HTTP test-double and labels the response as mocked', async (t) => {
  const { api, requests } = await startTestDouble(t);
  const events = [];
  await api.chatStream('/help', 'aria', '', (event) => events.push(event));
  assert.equal(events.at(-1).payload.source, 'local_command');
  assert.match(events.filter(({ event }) => event === 'delta').map(({ payload }) => payload.text).join(''), /^TEST-DOUBLE:/);
  assert.deepEqual(requests[0], {
    method: 'POST',
    path: '/api/v1/chat/stream',
    body: { message: '/help', agent: 'aria' },
  });
});

test('streams v1 SSE events and loads history from the requested session', async (t) => {
  const { api, requests } = await startTestDouble(t);
  const events = [];
  await api.chatStream('/help', 'aria', '', (event) => events.push(event));
  const history = await api.getMessages(TEST_SESSION_ID);

  assert.deepEqual(events.map(({ event, payload }) => [
    event,
    event === 'done' ? payload.source : payload.text ?? payload.session_id,
  ]), [
    ['meta', TEST_SESSION_ID],
    ['delta', 'TEST-DOUBLE: odpowiedź '],
    ['delta', 'lokalna.'],
    ['done', 'local_command'],
  ]);
  assert.equal(history.messages[0].content, 'TEST-DOUBLE: wcześniejsza wiadomość');
  assert.deepEqual(requests.map(({ method, path }) => `${method} ${path}`), [
    'POST /api/v1/chat/stream',
    `GET /api/v1/sessions/${TEST_SESSION_ID}/messages`,
  ]);
  assert.deepEqual(requests[0].body, { message: '/help', agent: 'aria' });
});

test('retrieves a persisted task after reconnect and sends an empty cancellation request', async (t) => {
  const { api, requests } = await startTestDouble(t);
  const task = await api.getTask(TEST_TASK_ID);
  const cancelled = await api.cancelTask(TEST_TASK_ID);

  assert.equal(task.task.id, TEST_TASK_ID);
  assert.equal(task.task.status, 'running');
  assert.equal(cancelled.task.status, 'cancel_requested');
  assert.deepEqual(requests.map(({ method, path, body }) => ({ method, path, body })), [
    { method: 'GET', path: `/api/v1/tasks/${TEST_TASK_ID}`, body: null },
    { method: 'POST', path: `/api/v1/tasks/${TEST_TASK_ID}/cancel`, body: null },
  ]);
});

test('recognizes explicit SSE cancellation without treating it as a fake completed reply', async (t) => {
  const { api } = await startTestDouble(t);
  const events = [];
  await api.chatStream('/cancel', 'aria', '', (event) => events.push(event));
  assert.deepEqual(events.map(({ event }) => event), ['meta', 'cancelled']);
  assert.equal(events.at(-1).payload.task.status, 'cancelled');
});

test('maps HTTP auth failures to server-side operator configuration guidance', async () => {
  const api = createApiClient({
    fetchImpl: async () => new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }),
  });
  await assert.rejects(api.getTasks(), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 401);
    assert.match(error.message, /DEBIAN13_API_TOKEN.*proxy/);
    assert.doesNotMatch(error.message, /Bearer\s+\S+/i);
    return true;
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
  await assert.rejects(api.chatStream('Napisz odpowiedź', 'aria', '', () => {}), (error) => {
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
  assert.match(html, /id="sidebar-collapse"/);
  assert.match(html, /id="mobile-menu"/);
  assert.match(html, /id="chat-history"/);
  assert.match(html, /data-view="work"/);
  assert.match(html, /id="event-list"/);
  assert.match(html, /nie jest to strumień na żywo ani systemowy dziennik Debiana/);
  assert.match(html, /id="chat-stop"/);
  assert.match(html, /id="work-connection-state"/);
  assert.match(html, /Ponów połączenie/);
  assert.match(html, /API v1 nie obsługuje czatu grupowego/);
  assert.match(html, /nie udostępnia[\s\S]*planów wieloetapowych/);
  assert.match(html, /aria-live="polite"/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /@media \(max-width: 420px\)/);
  assert.match(css, /position: sticky/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /:focus-visible/);
  for (const endpoint of ["'status'", "'agents'", "'tasks'", "'events'", "'chat/stream'", "'terminal'", 'tasks/${encodeURIComponent', 'sessions/${encodeURIComponent']) {
    assert.ok(app.includes(endpoint), `expected API endpoint ${endpoint}`);
  }
  assert.match(app, /error\.status === 503/);
  assert.match(app, /streamEvent === 'cancelled'/);
  assert.match(app, /error\.status === 401/);
  assert.match(app, /api\.cancelTask\(taskId\)/);
  assert.doesNotMatch(app, /\.innerHTML\s*=/);
});
