import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApiServer } from './api-server.mjs';
import { JsonStateStore } from './state-store.mjs';

const token = 'api-test-operator-token-0123456789abcdef';
const authorization = ['Bear', 'er ', token].join('');

class TestModel {
  constructor() {
    this.contexts = [];
  }

  async chat(messages) {
    this.contexts.push(structuredClone(messages));
    return JSON.stringify({ reply: `answer-${this.contexts.length}`, operation: null });
  }
}

class DelayedModel {
  constructor() {
    this.calls = 0;
    this.started = new Promise((resolve) => {
      this.resolveStarted = resolve;
    });
    this.completed = new Promise((resolve) => {
      this.resolveCompleted = resolve;
    });
  }

  async chat() {
    this.calls += 1;
    this.resolveStarted();
    await this.completed;
    return JSON.stringify({ reply: 'delayed answer', operation: null });
  }

  release() {
    this.resolveCompleted();
  }
}

class CancellableModel {
  constructor() {
    this.started = new Promise((resolve) => {
      this.resolveStarted = resolve;
    });
    this.cancelled = new Promise((resolve) => {
      this.resolveCancelled = resolve;
    });
  }

  async chat(_messages, { signal } = {}) {
    this.signal = signal;
    this.resolveStarted();
    return new Promise((_, reject) => {
      const cancel = () => {
        this.resolveCancelled();
        const error = new Error('request_cancelled');
        error.code = 'request_cancelled';
        reject(error);
      };
      if (signal.aborted) {
        cancel();
        return;
      }
      signal.addEventListener('abort', cancel, { once: true });
    });
  }
}

class VerifyingModel extends TestModel {
  modelName = 'local-test';
  inferenceVerified = false;

  async chat(messages) {
    const result = await super.chat(messages);
    this.inferenceVerified = true;
    return result;
  }
}

async function startServer(
  path,
  model = new TestModel(),
  workspace = join(path, '..', 'workspace'),
) {
  const store = new JsonStateStore(path);
  const server = createApiServer({
    token,
    store,
    model,
    workspace,
    port: 0,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    server,
    model,
    store,
    base: `http://127.0.0.1:${server.address().port}`,
  };
}

async function stopServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function request(base, path, { method = 'GET', body, token: bearer = authorization } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(bearer ? { Authorization: bearer } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

function sseData(stream, eventName) {
  const frame = stream.split('\n\n').find((item) =>
    item.split('\n').includes(`event: ${eventName}`));
  assert.ok(frame, `missing SSE event: ${eventName}`);
  const data = frame.split('\n').find((line) => line.startsWith('data: '));
  assert.ok(data, `missing SSE data: ${eventName}`);
  return JSON.parse(data.slice('data: '.length));
}

test('every API v1 route denies missing or invalid operator authorization', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'debian13-chat-api-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { server, base, store } = await startServer(join(directory, 'state.json'));
  t.after(() => stopServer(server));

  const sessionId = '00000000-0000-4000-8000-000000000001';
  const taskId = '00000000-0000-4000-8000-000000000002';
  const routes = [
    { path: '/api/v1/status' },
    { path: '/api/v1/agents' },
    { path: '/api/v1/tasks' },
    { path: `/api/v1/tasks/${taskId}` },
    { path: '/api/v1/events' },
    { path: '/api/v1/operations' },
    { path: '/api/v1/operations/audit' },
    { path: `/api/v1/sessions/${sessionId}/messages` },
    {
      path: '/api/v1/chat',
      method: 'POST',
      body: { message: 'hello', agent: 'astyria' },
    },
    {
      path: '/api/v1/chat/stream',
      method: 'POST',
      body: { message: 'hello', agent: 'astyria' },
    },
    {
      path: '/api/v1/terminal',
      method: 'POST',
      body: { command: 'pwd' },
    },
    {
      path: `/api/v1/operations/${taskId}/decision`,
      method: 'POST',
      body: { decision: 'approve', expected_version: 1 },
    },
    { path: `/api/v1/tasks/${taskId}/cancel`, method: 'POST' },
  ];
  const initialState = store.read();

  for (const route of routes) {
    for (const bearer of ['', ['Bear', 'er invalid'].join('')]) {
      const response = await request(base, route.path, {
        ...route,
        token: bearer,
      });
      assert.equal(response.status, 401, `${route.method || 'GET'} ${route.path}`);
      assert.deepEqual(response.body, { error: 'unauthorized' });
    }
  }
  assert.deepEqual(store.read(), initialState);
});

test('API server listen enforces a loopback TCP bind', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'debian13-chat-api-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const server = createApiServer({
    token,
    store: new JsonStateStore(join(directory, 'state.json')),
    workspace: join(directory, 'workspace'),
  });
  assert.throws(() => server.listen(0, '0.0.0.0'), /loopback_bind_required/);
  assert.throws(() => server.listen(join(directory, 'socket')), /loopback_tcp_only/);

  await new Promise((resolve) => server.listen(0, resolve));
  assert.equal(server.address().address, '127.0.0.1');
  await stopServer(server);
});

test('operator decisions require authorization, persist, and never execute proposals', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'debian13-chat-api-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'state.json');
  let running = await startServer(path);
  t.after(() => stopServer(running.server));

  const proposed = await request(running.base, '/api/v1/chat', {
    method: 'POST',
    body: { message: 'Restart service cron', agent: 'astyria' },
  });
  assert.equal(proposed.status, 200);
  assert.equal(proposed.body.operation.status, 'pending_approval');
  const id = proposed.body.operation.id;
  assert.deepEqual(Object.keys(proposed.body.operation).sort(), [
    'createdAt',
    'expiresAt',
    'id',
    'operation',
    'risk',
    'status',
    'version',
  ]);
  for (const body of [
    { decision: 'approve' },
    { decision: 'approve', expected_version: 1, unexpected: true },
  ]) {
    const invalid = await request(running.base, `/api/v1/operations/${id}/decision`, {
      method: 'POST',
      body,
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error, 'invalid_decision_request');
  }
  const decisionBody = { decision: 'approve', expected_version: 1 };

  const denied = await request(running.base, `/api/v1/operations/${id}/decision`, {
    method: 'POST',
    body: decisionBody,
    token: '',
  });
  assert.equal(denied.status, 401);
  assert.equal((await request(running.base, '/api/v1/operations')).body.operations.length, 1);

  const approved = await request(running.base, `/api/v1/operations/${id}/decision`, {
    method: 'POST',
    body: decisionBody,
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.operation.status, 'approved');
  assert.equal(approved.body.operation.version, 2);
  assert.deepEqual(Object.keys(approved.body.operation).sort(), [
    'createdAt',
    'decidedAt',
    'expiresAt',
    'id',
    'operation',
    'risk',
    'status',
    'version',
  ]);

  await stopServer(running.server);
  running = await startServer(path);
  const repeated = await request(running.base, `/api/v1/operations/${id}/decision`, {
    method: 'POST',
    body: decisionBody,
  });
  assert.equal(repeated.status, 409);
  assert.equal(repeated.body.error, 'already_decided');
  assert.deepEqual((await request(running.base, '/api/v1/operations')).body.operations, []);
  const audit = await request(running.base, '/api/v1/operations/audit');
  assert.deepEqual(audit.body.events.map(({ type }) => type), [
    'operation.proposed',
    'operation.approved',
  ]);
  assert.ok(audit.body.events.every((event) =>
    Object.keys(event).sort().join(',') === 'at,operation_id,type'));
  assert.equal(JSON.stringify(audit.body).includes(token), false);
});

test('v1 session history and model context survive API process reconnection', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'debian13-chat-api-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'state.json');
  let running = await startServer(path);
  t.after(() => stopServer(running.server));

  const local = await request(running.base, '/api/v1/chat', {
    method: 'POST',
    body: { message: '/help', agent: 'aria' },
  });
  assert.equal(local.body.source, 'local_command');
  const first = await request(running.base, '/api/v1/chat', {
    method: 'POST',
    body: {
      message: 'first message',
      agent: 'aria',
      session_id: local.body.session_id,
    },
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.source, 'ollama');
  const sessionId = local.body.session_id;
  assert.equal(first.body.session_id, sessionId);
  await stopServer(running.server);

  running = await startServer(path);
  const history = await request(running.base, `/api/v1/sessions/${sessionId}/messages`);
  assert.equal(history.status, 200);
  assert.deepEqual(history.body.messages.map(({ role }) => role), [
    'user',
    'assistant',
    'user',
    'assistant',
  ]);
  assert.equal(history.body.messages[1].source, 'local_command');

  const continued = await request(running.base, '/api/v1/chat', {
    method: 'POST',
    body: { message: 'second message', agent: 'aria', session_id: sessionId },
  });
  assert.equal(continued.status, 200);
  assert.equal(continued.body.session_id, sessionId);
  assert.equal(continued.body.source, 'ollama');
  assert.deepEqual(
    running.model.contexts[0].slice(1, 3).map(({ content }) => content),
    ['first message', 'answer-1'],
  );
  const allMessages = await request(running.base, `/api/v1/sessions/${sessionId}/messages`);
  assert.deepEqual(allMessages.body.messages.map(({ role }) => role), [
    'user',
    'assistant',
    'user',
    'assistant',
    'user',
    'assistant',
  ]);
});

test('authorized task lookup returns persisted Work status after reconnect', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'debian13-chat-api-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'state.json');
  let running = await startServer(path);
  t.after(() => stopServer(running.server));

  const response = await request(running.base, '/api/v1/chat', {
    method: 'POST',
    body: { message: 'A task to reconnect to', agent: 'astyria' },
  });
  assert.equal(response.status, 200);
  const taskId = response.body.task.id;

  const denied = await request(running.base, `/api/v1/tasks/${taskId}`, { token: '' });
  assert.equal(denied.status, 401);

  const first = await request(running.base, `/api/v1/tasks/${taskId}`);
  assert.equal(first.status, 200);
  assert.equal(first.body.task.status, 'completed');
  assert.equal(first.body.task.result, 'answer-1');
  assert.equal(first.body.task.id, taskId);
  assert.deepEqual(Object.keys(first.body.task).sort(), [
    'agent',
    'created_at',
    'error',
    'id',
    'kind',
    'result',
    'status',
    'updated_at',
  ]);
  const firstEvents = await request(running.base, '/api/v1/events');
  assert.deepEqual(firstEvents.body.events.map(({ type }) => type), [
    'task.completed',
    'task.running',
    'task.queued',
  ]);
  assert.ok(firstEvents.body.events.every((event) =>
    Object.keys(event).sort().join(',') === 'agent,at,task_id,type'));
  assert.ok(firstEvents.body.events.every((event) => event.task_id === taskId));

  await stopServer(running.server);
  running = await startServer(path);
  const reconnected = await request(running.base, `/api/v1/tasks/${taskId}`);
  assert.equal(reconnected.status, 200);
  assert.deepEqual(reconnected.body, first.body);
  assert.deepEqual(
    (await request(running.base, '/api/v1/events')).body,
    firstEvents.body,
  );

  const missing = await request(
    running.base,
    '/api/v1/tasks/00000000-0000-4000-8000-000000000000',
  );
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, 'task_not_found');
  const malformed = await request(running.base, '/api/v1/tasks/not-a-uuid');
  assert.equal(malformed.status, 404);
});

test('API startup marks interrupted tasks failed instead of leaving them running', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'debian13-chat-api-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'state.json');
  const store = new JsonStateStore(path);
  store.update((state) => {
    state.tasks.push(
      {
        id: '00000000-0000-4000-8000-000000000001',
        agent: 'astyria',
        kind: 'chat',
        status: 'running',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        result: null,
        error: null,
      },
      {
        id: '00000000-0000-4000-8000-000000000002',
        agent: 'astyria',
        kind: 'chat',
        status: 'cancel_requested',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        result: null,
        error: null,
      },
    );
  });
  const { server, base } = await startServer(path);
  t.after(() => stopServer(server));

  for (const id of [
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
  ]) {
    const response = await request(base, `/api/v1/tasks/${id}`);
    assert.equal(response.body.task.status, 'failed');
    assert.equal(response.body.task.error, 'process_restarted');
  }
});

test('authorized streamed chat cancellation is delivered and persists across reconnect', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'debian13-chat-api-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'state.json');
  const model = new CancellableModel();
  let running = await startServer(path, model);
  t.after(() => stopServer(running.server));

  const pendingResponse = fetch(`${running.base}/api/v1/chat/stream`, {
    method: 'POST',
    headers: { Authorization: authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Please answer and allow cancellation.', agent: 'astyria' }),
  });
  await model.started;
  const response = await pendingResponse;
  const reader = response.body.getReader();
  const first = await reader.read();
  const metadata = new TextDecoder().decode(first.value);
  assert.match(metadata, /event: meta/);
  const meta = sseData(metadata, 'meta');
  assert.deepEqual(Object.keys(meta).sort(), ['session_id', 'task_id']);
  const { session_id: sessionId, task_id: taskId } = meta;
  assert.ok(sessionId);
  assert.ok(taskId);

  const denied = await request(running.base, `/api/v1/tasks/${taskId}/cancel`, {
    method: 'POST',
    token: '',
  });
  assert.equal(denied.status, 401);
  assert.equal(model.signal.aborted, false);

  const requestBodyRejected = await request(
    running.base,
    `/api/v1/tasks/${taskId}/cancel`,
    { method: 'POST', body: {} },
  );
  assert.equal(requestBodyRejected.status, 400);
  assert.equal(requestBodyRejected.body.error, 'invalid_cancel_request');
  assert.equal(model.signal.aborted, false);

  const cancellation = await request(running.base, `/api/v1/tasks/${taskId}/cancel`, {
    method: 'POST',
  });
  assert.equal(cancellation.status, 202);
  assert.equal(cancellation.body.task.status, 'cancel_requested');
  assert.deepEqual(Object.keys(cancellation.body), ['task']);
  assert.deepEqual(Object.keys(cancellation.body.task).sort(), [
    'agent',
    'created_at',
    'error',
    'id',
    'kind',
    'result',
    'status',
    'updated_at',
  ]);
  assert.equal(model.signal.aborted, true);

  let remaining = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    remaining += new TextDecoder().decode(value);
  }
  const cancelledEvent = sseData(remaining, 'cancelled');
  assert.deepEqual(Object.keys(cancelledEvent).sort(), ['error', 'task']);
  assert.equal(cancelledEvent.error, 'request_cancelled');
  assert.equal(cancelledEvent.task.status, 'cancelled');
  assert.deepEqual(Object.keys(cancelledEvent.task).sort(), [
    'agent',
    'created_at',
    'error',
    'id',
    'kind',
    'result',
    'status',
    'updated_at',
  ]);

  const task = await request(running.base, `/api/v1/tasks/${taskId}`);
  assert.equal(task.body.task.status, 'cancelled');
  assert.equal(task.body.task.error, 'request_cancelled');
  assert.equal(task.body.task.id, cancelledEvent.task.id);
  assert.equal(task.body.task.status, cancelledEvent.task.status);
  assert.equal(task.body.task.result, cancelledEvent.task.result);
  assert.equal(task.body.task.error, cancelledEvent.task.error);
  assert.ok(Number.isFinite(Date.parse(task.body.task.updated_at)));
  const history = await request(running.base, `/api/v1/sessions/${sessionId}/messages`);
  assert.deepEqual(history.body.messages.map(({ role }) => role), ['user', 'assistant']);
  assert.equal(history.body.messages[1].source, 'cancelled');

  await stopServer(running.server);
  running = await startServer(path, new CancellableModel());
  const reconnectedTask = await request(running.base, `/api/v1/tasks/${taskId}`);
  assert.equal(reconnectedTask.body.task.status, 'cancelled');
  const reconnectedHistory = await request(
    running.base,
    `/api/v1/sessions/${sessionId}/messages`,
  );
  assert.deepEqual(reconnectedHistory.body, history.body);
});

test('disconnecting active SSE aborts the provider and persists cancellation', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'debian13-chat-api-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'state.json');
  const model = new CancellableModel();
  const { server, base } = await startServer(path, model);
  t.after(() => stopServer(server));

  const url = new URL(`${base}/api/v1/chat/stream`);
  const stream = await new Promise((resolve, reject) => {
    let received = '';
    const clientRequest = httpRequest(url, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
    }, (response) => {
      response.on('data', (chunk) => {
        received += chunk.toString('utf8');
        if (received.includes('event: meta')) resolve({ clientRequest, received });
      });
    });
    clientRequest.once('error', reject);
    clientRequest.end(JSON.stringify({
      message: 'Disconnect the active response.',
      agent: 'astyria',
    }));
  });
  await model.started;
  const { session_id: sessionId, task_id: taskId } = JSON.parse(
    stream.received.match(/data: (.+)/)[1],
  );
  stream.clientRequest?.destroy();
  await model.cancelled;

  let task;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    task = await request(base, `/api/v1/tasks/${taskId}`);
    if (task.body.task.status === 'cancelled') break;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.equal(model.signal.aborted, true);
  assert.equal(task.body.task.status, 'cancelled');
  const history = await request(base, `/api/v1/sessions/${sessionId}/messages`);
  assert.equal(history.body.messages[1].source, 'cancelled');
});

test('task retention preserves active task records when terminal history grows', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'debian13-chat-api-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'state.json');
  const { server, base, store } = await startServer(path);
  t.after(() => stopServer(server));

  store.update((state) => {
    state.tasks.push({
      id: '00000000-0000-4000-8000-000000000001',
      agent: 'astyria',
      kind: 'chat',
      status: 'running',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      result: null,
      error: null,
    });
    for (let index = 1; index <= 105; index += 1) {
      state.tasks.push({
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        agent: 'astyria',
        kind: 'chat',
        status: 'completed',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        result: 'finished',
        error: null,
      });
    }
  });
  const terminal = await request(base, '/api/v1/terminal', {
    method: 'POST',
    body: { command: 'pwd' },
  });
  assert.equal(terminal.status, 200);

  const preserved = await request(
    base,
    '/api/v1/tasks/00000000-0000-4000-8000-000000000001',
  );
  assert.equal(preserved.body.task.status, 'running');
});

test('queued streamed chat can be authorized and cancelled before model execution', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'debian13-chat-api-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'state.json');
  const model = new DelayedModel();
  const { server, base } = await startServer(path, model);
  t.after(() => stopServer(server));

  const firstResponse = await fetch(`${base}/api/v1/chat/stream`, {
    method: 'POST',
    headers: { Authorization: authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'First request', agent: 'astyria' }),
  });
  const firstReader = firstResponse.body.getReader();
  const firstMetadata = new TextDecoder().decode((await firstReader.read()).value);
  const { session_id: sessionId } = JSON.parse(firstMetadata.match(/data: (.+)/)[1]);
  await model.started;

  const queuedResponse = await fetch(`${base}/api/v1/chat/stream`, {
    method: 'POST',
    headers: { Authorization: authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Second request, cancelled while queued',
      agent: 'astyria',
      session_id: sessionId,
    }),
  });
  const queuedReader = queuedResponse.body.getReader();
  const queuedMetadata = new TextDecoder().decode((await queuedReader.read()).value);
  const { task_id: queuedTaskId } = JSON.parse(queuedMetadata.match(/data: (.+)/)[1]);
  assert.match(queuedMetadata, /event: meta/);
  assert.equal(model.calls, 1);
  const cancellation = await request(base, `/api/v1/tasks/${queuedTaskId}/cancel`, {
    method: 'POST',
  });
  assert.equal(cancellation.status, 202);
  assert.equal(cancellation.body.task.status, 'cancel_requested');

  model.release();
  while (true) {
    const { done } = await firstReader.read();
    if (done) break;
  }
  let queuedEvents = '';
  while (true) {
    const { done, value } = await queuedReader.read();
    if (done) break;
    queuedEvents += new TextDecoder().decode(value);
  }
  assert.match(queuedEvents, /event: cancelled/);
  const tasks = await request(base, '/api/v1/tasks');
  assert.equal(model.calls, 1);
  assert.deepEqual(
    tasks.body.tasks.map(({ status }) => status).sort(),
    ['cancelled', 'completed'],
  );
  const queuedTask = await request(base, `/api/v1/tasks/${queuedTaskId}`);
  assert.equal(queuedTask.body.task.error, 'request_cancelled');
  const history = await request(base, `/api/v1/sessions/${sessionId}/messages`);
  assert.equal(history.body.messages.at(-1).source, 'cancelled');
});

test('API v1 streaming emits the documented session and task events', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'debian13-chat-api-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { server, base } = await startServer(join(directory, 'state.json'));
  t.after(() => stopServer(server));

  const response = await fetch(`${base}/api/v1/chat/stream`, {
    method: 'POST',
    headers: { Authorization: authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'hello', agent: 'astyria' }),
  });
  assert.equal(response.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  const stream = await response.text();
  assert.match(stream, /event: meta/);
  assert.match(stream, /event: delta/);
  assert.match(stream, /event: done/);
  const meta = sseData(stream, 'meta');
  const done = sseData(stream, 'done');
  const delta = sseData(stream, 'delta');
  assert.deepEqual(Object.keys(meta).sort(), ['session_id', 'task_id']);
  assert.deepEqual(Object.keys(delta), ['text']);
  assert.deepEqual(Object.keys(done).sort(), ['agent', 'session_id', 'source', 'task']);
  assert.deepEqual(Object.keys(done.task).sort(), ['id', 'status']);
});

test('SSE sends session metadata before model generation completes', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'debian13-chat-api-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const model = new DelayedModel();
  const { server, base } = await startServer(join(directory, 'state.json'), model);
  t.after(() => stopServer(server));

  const pendingResponse = fetch(`${base}/api/v1/chat/stream`, {
    method: 'POST',
    headers: { Authorization: authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'wait for model', agent: 'astyria' }),
  });
  await model.started;
  let timeout;
  const response = await Promise.race([
    pendingResponse,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('stream_metadata_timeout')), 1000);
    }),
  ]);
  clearTimeout(timeout);
  const reader = response.body.getReader();
  const first = await reader.read();
  assert.match(new TextDecoder().decode(first.value), /event: meta/);
  model.release();
  let rest = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    rest += new TextDecoder().decode(value);
  }
  assert.match(rest, /event: done/);
});

test('model inference status changes only after a successful response', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'debian13-chat-api-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const model = new VerifyingModel();
  const { server, base } = await startServer(join(directory, 'state.json'), model);
  t.after(() => stopServer(server));

  const before = await request(base, '/api/v1/status');
  assert.equal(before.body.model.status, 'model_available');
  assert.equal(before.body.model.inference, 'not_verified');
  await request(base, '/api/v1/chat', {
    method: 'POST',
    body: { message: 'x'.repeat(10_000), agent: 'astyria' },
  });
  const after = await request(base, '/api/v1/status');
  assert.equal(after.body.model.inference, 'verified');
});

test('v1 status and terminal retain the documented safe, read-only contract', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'debian13-chat-api-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const workspace = join(directory, 'workspace');
  const { server, base } = await startServer(join(directory, 'state.json'), new TestModel(), workspace);
  t.after(() => stopServer(server));
  await writeFile(join(workspace, 'hello.txt'), 'hello workspace', 'utf8');
  await writeFile(join(workspace, 'large.txt'), 'x'.repeat(20_000), 'utf8');

  const status = await request(base, '/api/v1/status');
  assert.equal(status.status, 200);
  assert.equal(status.body.api_version, 'v1');
  assert.equal(status.body.operating_system.runtime.debian_13_boot_verified, false);
  assert.equal(status.body.agents[0].worker, 'not_running');
  assert.equal(status.body.diagnostics.runtime.platform.length > 0, true);
  assert.equal(Number.isInteger(status.body.diagnostics.resources.cpu_count), true);
  assert.ok(status.body.diagnostics.resources.cpu_count > 0);
  assert.ok(status.body.diagnostics.resources.memory_total_bytes > 0);
  assert.ok(status.body.diagnostics.resources.memory_available_bytes >= 0);
  assert.ok(status.body.diagnostics.runtime.uptime_seconds > 0);
  assert.equal(status.body.diagnostics.resources.workspace_filesystem.status, 'available');
  assert.ok(status.body.diagnostics.resources.workspace_filesystem.total_bytes > 0);
  assert.ok(
    status.body.diagnostics.resources.workspace_filesystem.available_bytes <=
      status.body.diagnostics.resources.workspace_filesystem.total_bytes,
  );

  const terminal = await request(base, '/api/v1/terminal', {
    method: 'POST',
    body: { command: 'cat hello.txt' },
  });
  assert.equal(terminal.status, 200);
  assert.equal(terminal.body.output, 'hello workspace');
  const largeTerminal = await request(base, '/api/v1/terminal', {
    method: 'POST',
    body: { command: 'cat large.txt' },
  });
  assert.equal(largeTerminal.body.output.length, 20_000);
  assert.ok(Buffer.byteLength(largeTerminal.body.task.result, 'utf8') <= 16_000);
  const tasks = await request(base, '/api/v1/tasks');
  assert.ok(Buffer.byteLength(tasks.body.tasks[0].result, 'utf8') <= 16_000);
  const terminalChat = await request(base, '/api/v1/chat', {
    method: 'POST',
    body: { message: '/terminal cat hello.txt', agent: 'astyria' },
  });
  assert.equal(terminalChat.status, 200);
  assert.equal(terminalChat.body.source, 'restricted_terminal');
  assert.equal(terminalChat.body.reply, 'hello workspace');
  for (const command of ['sh -c id', 'cat ../state.json', 'ls /']) {
    const denied = await request(base, '/api/v1/terminal', {
      method: 'POST',
      body: { command },
    });
    assert.equal(denied.status, 400, command);
    assert.equal(denied.body.task.status, 'failed');
  }

  const localCommand = await request(base, '/api/v1/chat', {
    method: 'POST',
    body: { message: '/help', agent: 'astyria' },
  });
  assert.equal(localCommand.status, 200);
  assert.equal(localCommand.body.source, 'local_command');
  assert.match(localCommand.body.reply, /\/terminal pwd/);
});

test('failed chat reports its task and does not poison queued session requests', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'debian13-chat-api-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { server, base } = await startServer(join(directory, 'state.json'), null);
  t.after(() => stopServer(server));

  const failed = await request(base, '/api/v1/chat', {
    method: 'POST',
    body: { message: 'A general question', agent: 'astyria' },
  });
  assert.equal(failed.status, 503);
  assert.equal(failed.body.task.status, 'failed');
  assert.equal(failed.body.error, 'model_unavailable');
  assert.equal(failed.body.session_id.length, 36);
  const status = await request(base, '/api/v1/status');
  assert.equal(status.body.model.provider, 'ollama');
  assert.equal(status.body.model.status, 'not_configured');

  const continued = await request(base, '/api/v1/chat', {
    method: 'POST',
    body: {
      message: '/help',
      agent: 'astyria',
      session_id: failed.body.session_id,
    },
  });
  assert.equal(continued.status, 200);
  assert.equal(continued.body.source, 'local_command');
});
