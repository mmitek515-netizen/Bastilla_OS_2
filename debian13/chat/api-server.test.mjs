import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
    this.started = new Promise((resolve) => {
      this.resolveStarted = resolve;
    });
    this.completed = new Promise((resolve) => {
      this.resolveCompleted = resolve;
    });
  }

  async chat() {
    this.resolveStarted();
    await this.completed;
    return JSON.stringify({ reply: 'delayed answer', operation: null });
  }

  release() {
    this.resolveCompleted();
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
  const server = createApiServer({
    token,
    store: new JsonStateStore(path),
    model,
    workspace,
    port: 0,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    server,
    model,
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

test('API v1 endpoints deny requests without an operator bearer token', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'debian13-chat-api-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { server, base } = await startServer(join(directory, 'state.json'));
  t.after(() => stopServer(server));

  assert.equal((await request(base, '/api/v1/status', { token: '' })).status, 401);
  const chat = await request(base, '/api/v1/chat', {
    method: 'POST',
    body: { message: 'hello', agent: 'astyria' },
    token: '',
  });
  assert.equal(chat.status, 401);
  const queue = await request(base, '/api/v1/operations', { token: '' });
  assert.equal(queue.status, 401);
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
