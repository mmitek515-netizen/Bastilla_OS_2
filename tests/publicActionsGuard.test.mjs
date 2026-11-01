import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicActionsGuard } from '../src/lib/publicActionsGuard.mjs';

async function request(guard, method, path) {
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  let continued = false;
  guard({ method, path }, res, () => { continued = true; });
  return { ...res, continued };
}

test('private mode preserves existing API route behavior', async () => {
  for (const [method, path] of [
    ['POST', '/api/apps/execute'],
    ['POST', '/api/kernel/command'],
    ['GET', '/api/kernel/state'],
  ]) {
    assert.equal((await request(createPublicActionsGuard(false), method, path)).continued, true);
  }
});

test('public GPT Actions mode denies every API except its four authenticated integration routes', async () => {
  const guard = createPublicActionsGuard(true);
  for (const [method, path] of [
    ['POST', '/api/apps/execute'],
    ['POST', '/api/kernel/command'],
    ['GET', '/api/kernel/state'],
    ['POST', '/api/agents/inbox/read'],
    ['POST', '/api/mission/toggle'],
    ['GET', '/api/mcp'],
    ['POST', '/api/mcp'],
    ['OPTIONS', '/api/mcp'],
    ['GET', '/api/mcp/openapi.json'],
    ['GET', '/'],
    ['GET', '/download'],
  ]) {
    const response = await request(guard, method, path);
    assert.equal(response.statusCode, 403, `${method} ${path}`);
    assert.equal(response.continued, false, `${method} ${path}`);
    assert.equal(response.headers['Cache-Control'], 'no-store');
  }

  for (const [method, path] of [
    ['GET', '/api/gpt-actions/setup'],
    ['GET', '/api/gpt-actions/openapi.json'],
    ['GET', '/api/gpt-actions/status'],
    ['POST', '/api/gpt-actions/message'],
  ]) {
    assert.equal((await request(guard, method, path)).continued, true);
  }
  assert.equal((await request(guard, 'DELETE', '/api/gpt-actions/message')).statusCode, 403);
});
