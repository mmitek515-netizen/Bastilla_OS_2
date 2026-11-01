import test from 'node:test';
import assert from 'node:assert/strict';
import { gptActionsSchema, registerGptActions, registerGptActionsGateway } from '../src/lib/gptActions.mjs';

const token = 'test-token-012345678901234567890123456789';
function harness(options = {}) {
  const routes = new Map();
  const middleware = [];
  const calls = [];
  const app = Object.fromEntries(['get', 'post'].map((method) => [method, (path, ...handlers) => routes.set(`${method} ${path}`, handlers)]));
  app.use = (handler) => middleware.push(handler);
  app.get('/api/apps/list', (_req, res) => res.status(200).json({ apps: [] }));
  app.get('/', (_req, res) => res.status(200).json({ page: 'app' }));
  registerGptActionsGateway(app, options.env || { GPT_ACTIONS_PUBLIC_URL: 'https://bastilla.example' });
  registerGptActions(app, {
    env: { GPT_ACTIONS_TOKEN: token, GPT_ACTIONS_PUBLIC_URL: 'https://bastilla.example' },
    providers: () => ['ollama'],
    chat: async (...args) => { calls.push(args); return { text: 'Odpowiedź Arii', provider: 'ollama', model: 'local' }; },
    ...options,
  });
  return { calls, async request(method, path, body, auth = `Bearer ${token}`) {
    const res = { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    const requestPath = path.startsWith('/') ? path : `/api/gpt-actions/${path}`;
    const req = { body, method: method.toUpperCase(), path: requestPath, get: (key) => key === 'authorization' ? auth : 'attacker.example' };
    for (const handler of middleware) {
      let next = false;
      handler(req, res, () => { next = true; });
      if (!next) return res;
    }
    for (const handler of routes.get(`${method} ${requestPath}`) || []) {
      let next = false;
      await handler(req, res, () => { next = true; });
      if (!next) break;
    }
    return res;
  } };
}

test('OpenAPI uses configured HTTPS origin and supported agent operations', async () => {
  const h = harness();
  const r = await h.request('get', 'openapi.json');
  assert.equal(r.body.openapi, '3.1.0');
  assert.equal(r.body.servers[0].url, 'https://bastilla.example');
  assert.deepEqual(Object.keys(r.body.paths).sort(), ['/api/gpt-actions/message', '/api/gpt-actions/status']);
  assert.ok(r.body.security[0].bearerAuth);
  assert.deepEqual(Object.keys(r.body.paths['/api/gpt-actions/status'].get.responses).sort(), ['200', '401', '503']);
  assert.ok(['400', '401', '413', '429', '502', '503', '504'].every((code) => code in r.body.paths['/api/gpt-actions/message'].post.responses));
  for (const origin of ['http://host', 'https://user:pass@host', 'https://host/path', 'https://host/?token=secret']) assert.throws(() => gptActionsSchema(origin));
  assert.throws(() => gptActionsSchema('https://ais-dev-example-123.europe-west2.run.app'));
});
test('setup diagnoses missing settings without disclosing the token or claiming a live connection', async () => {
  const h = harness();
  const r = await h.request('get', 'setup');
  assert.equal(r.body.readyForExternalTest, true);
  assert.equal(r.body.externalConnectionVerified, false);
  assert.equal(r.body.modelResponseVerified, false);
  assert.ok(!JSON.stringify(r.body).includes(token));
  const missing = await harness({ env: {}, providers: () => [] }).request('get', 'setup');
  assert.equal(missing.body.readyForExternalTest, false);
  assert.equal(missing.body.tokenConfigured, false);
  assert.equal(missing.body.publicUrlConfigured, false);
  assert.equal(missing.body.schemaUrl, null);
});
test('disabled by default; missing or invalid token never calls a model', async () => {
  const disabled = harness({ env: {} });
  assert.equal((await disabled.request('post', 'message', { message: 'test' })).code, 503);
  const h = harness();
  for (const auth of ['', 'Bearer wrong', `Basic ${token}`]) assert.equal((await h.request('post', 'message', { message: 'test' }, auth)).code, 401);
  assert.equal(h.calls.length, 0);
});
test('Aria default and selected agent use actual model callback', async () => {
  const h = harness();
  const r = await h.request('post', 'message', { message: '  Przeanalizuj kod  ' });
  assert.equal(r.code, 200);
  assert.equal(r.body.reply, 'Odpowiedź Arii');
  assert.equal(h.calls[0][0], 'Aria');
  assert.equal(h.calls[0][1], 'Przeanalizuj kod');
  assert.ok(h.calls[0][2] instanceof AbortSignal);
  await h.request('post', 'message', { message: 'test', agent: 'Alex' });
  assert.equal(h.calls[1][0], 'Alex');
  assert.equal((await h.request('get', 'setup')).body.modelResponseVerified, true);
});
test('public gateway exposes only the GPT Actions endpoints', async () => {
  const h = harness();
  for (const [method, path] of [
    ['get', '/api/apps/list'], ['post', '/api/apps/execute'],
    ['post', '/api/kernel/command'], ['post', '/api/mcp'], ['get', '/download'],
    ['post', '/API/APPS/EXECUTE'], ['post', '/API/KERNEL/COMMAND'],
    ['get', '/DOWNLOAD/'], ['post', '/MCP'],
    ['delete', '/api/gpt-actions/message'],
  ]) {
    assert.equal((await h.request(method, path, { command: 'id' })).code, 404, `${method} ${path}`);
  }
  assert.equal(h.calls.length, 0);
  assert.equal((await h.request('get', '/')).code, 200);
  assert.equal((await h.request('get', 'openapi.json')).code, 200);
  assert.equal((await h.request('get', 'setup')).code, 200);
});
test('gateway remains disabled in local development unless a public origin is configured', async () => {
  const local = harness({ env: { NODE_ENV: 'development' } });
  assert.equal((await local.request('get', '/api/apps/list')).code, 200);
  const production = harness({ env: { NODE_ENV: 'production' } });
  assert.equal((await production.request('get', '/api/apps/list')).code, 404);
});
test('malformed, oversized, unknown-agent and extra-field requests are rejected', async () => {
  const h = harness();
  for (const body of [null, [], {}, { message: ' ' }, { message: 1 }, { message: 'x'.repeat(12001) }, { message: 'test', agent: 'root' }, { message: 'test', command: '/exec id' }]) {
    assert.equal((await h.request('post', 'message', body)).code, 400);
  }
  assert.equal(h.calls.length, 0);
});
test('status does not claim model health; no configured provider yields 503', async () => {
  const h = harness({ providers: () => [] });
  assert.equal((await h.request('get', 'status')).body.configured, false);
  assert.equal((await h.request('post', 'message', { message: 'test' })).code, 503);
});
test('provider failures do not leak credentials or pretend to succeed', async () => {
  const h = harness({ chat: async () => { throw new Error('secret-api-key'); } });
  const r = await h.request('post', 'message', { message: 'test' });
  assert.equal(r.code, 502);
  assert.ok(!JSON.stringify(r.body).includes('secret-api-key'));
  assert.equal((await h.request('get', 'setup')).body.modelResponseVerified, false);
});
test('slow model times out and receives cancellation', async () => {
  let signal;
  const h = harness({ timeoutMs: 10, chat: async (_agent, _message, incoming) => { signal = incoming; return new Promise(() => {}); } });
  assert.equal((await h.request('post', 'message', { message: 'test' })).code, 504);
  assert.equal(signal.aborted, true);
});
test('response is bounded; concurrent overload is rejected', async () => {
  const long = harness({ chat: async () => ({ text: 'x'.repeat(13000), provider: 'ollama', model: 'local' }) });
  const r = await long.request('post', 'message', { message: 'test' });
  assert.equal(r.body.reply.length, 12000);
  assert.equal(r.body.truncated, true);
  const resolvers = [];
  const h = harness({ chat: () => new Promise((resolve) => resolvers.push(resolve)) });
  const first = h.request('post', 'message', { message: 'first' });
  const second = h.request('post', 'message', { message: 'second' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await h.request('post', 'message', { message: 'third' })).code, 429);
  for (const resolve of resolvers) resolve({ text: 'OK', provider: 'ollama', model: 'local' });
  await Promise.all([first, second]);
});
