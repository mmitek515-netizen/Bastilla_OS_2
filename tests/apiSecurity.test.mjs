import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createApiSecurity, parseAllowedOrigins, setAllowedCorsOrigin } from '../src/lib/apiSecurity.mjs';

const token = 'test-token-012345678901234567890123456789';

function request(security, { method = 'POST', path = '/api/apps/create', authorization = '' } = {}) {
  const res = {
    code: 200,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
  let continued = false;
  security.middleware({ method, path, get: (name) => name.toLowerCase() === 'authorization' ? authorization : undefined },
    res, () => { continued = true; });
  return { res, continued };
}

test('public API access fails closed without a strong configured token', () => {
  for (const tokenValue of ['', 'short-token', 'x'.repeat(257)]) {
    assert.throws(() => createApiSecurity({ host: '0.0.0.0', token: tokenValue, isProduction: true }), /BASTILLA_API_TOKEN/);
  }
  assert.throws(() => createApiSecurity({ host: '0.0.0.0', token }), /disabled outside production/);
  const security = createApiSecurity({ host: '0.0.0.0', token, isProduction: true });
  for (const authorization of ['', 'wrong', `Basic ${token}`]) {
    const { res, continued } = request(security, { authorization });
    assert.equal(res.code, 401);
    assert.equal(res.headers['WWW-Authenticate'], 'Bearer');
    assert.equal(continued, false);
  }
});

test('public API token protects reads, mutations, MCP and downloads', () => {
  const security = createApiSecurity({ host: '0.0.0.0', token, isProduction: true });
  assert.equal(request(security, { authorization: ['Be', 'arer ', token].join('') }).continued, true);
  assert.equal(request(security, { method: 'GET' }).res.code, 401);
  assert.equal(request(security, { method: 'OPTIONS' }).continued, true);
  assert.equal(request(security, { path: '/health' }).continued, true);
  assert.equal(request(security, { path: '/mcp' }).res.code, 401);
  assert.equal(request(security, { path: '/mcp', method: 'TRACE' }).res.code, 401);
  assert.equal(request(security, { path: '/API/apps/create' }).res.code, 401);
  assert.equal(request(security, { path: '/download', method: 'GET' }).res.code, 401);
  assert.equal(request(security, { path: '/api/gpt-actions/message', method: 'POST' }).continued, true);
});

test('Express rejects an unauthenticated public API request before its handler runs', async (t) => {
  const app = express();
  const security = createApiSecurity({ host: '0.0.0.0', token, isProduction: true });
  let executions = 0;
  app.use(security.middleware);
  app.post('/api/command', (_req, res) => {
    executions++;
    res.sendStatus(204);
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  const url = `http://127.0.0.1:${server.address().port}/api/command`;
  const denied = await fetch(url, { method: 'POST' });
  assert.equal(denied.status, 401);
  assert.equal(executions, 0);

  const allowed = await fetch(url, {
    method: 'POST',
    headers: { Authorization: ['Be', 'arer ', token].join('') },
  });
  assert.equal(allowed.status, 204);
  assert.equal(executions, 1);
});

test('loopback mode preserves existing unauthenticated local API behavior', () => {
  for (const host of ['127.0.0.1', 'localhost', '::1']) {
    const security = createApiSecurity({ host });
    assert.equal(security.isLoopback, true);
    assert.equal(request(security).continued, true);
  }
});

test('CORS policy accepts only explicitly configured origins', () => {
  const origins = parseAllowedOrigins('https://ui.example, http://localhost:3000');
  assert.deepEqual([...origins], ['https://ui.example', 'http://localhost:3000']);
  for (const invalid of ['*', 'https://ui.example/path', 'http://ui.example', 'ftp://ui.example']) {
    assert.throws(() => parseAllowedOrigins(invalid));
  }

  const response = {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    vary(value) { this.headers.Vary = value; },
  };
  setAllowedCorsOrigin({ get: () => 'https://ui.example' }, response, origins);
  assert.equal(response.headers['Access-Control-Allow-Origin'], 'https://ui.example');
  assert.equal(response.headers.Vary, 'Origin');
  const rejectedResponse = {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    vary(value) { this.headers.Vary = value; },
  };
  setAllowedCorsOrigin({ get: () => 'https://attacker.example' }, rejectedResponse, origins);
  assert.equal(rejectedResponse.headers['Access-Control-Allow-Origin'], undefined);
});
