import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiWriteGuard, isLoopbackHost } from '../src/lib/apiWriteGuard.mjs';

const token = 'test-api-token-012345678901234567890123456789';

function request(guard, method, authorization = '') {
  const response = {
    statusCode: 200,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    json(body) { this.body = body; return this; },
  };
  let continued = false;
  guard({ method, get: (name) => name === 'authorization' ? authorization : undefined }, response, () => { continued = true; });
  return { ...response, continued };
}

test('identifies only local bind hosts as private', () => {
  for (const host of ['localhost', '127.0.0.1', '::1']) assert.equal(isLoopbackHost(host), true);
  for (const host of ['0.0.0.0', '192.0.2.1', 'bastilla.example']) assert.equal(isLoopbackHost(host), false);
});

test('preserves local writes and safe public requests without a token', () => {
  assert.equal(request(createApiWriteGuard({ host: '127.0.0.1' }), 'POST').continued, true);
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    assert.equal(request(createApiWriteGuard({ host: '0.0.0.0' }), method).continued, true);
  }
});

test('fails closed for public writes when the token is missing or invalid', () => {
  const missing = request(createApiWriteGuard({ host: '0.0.0.0' }), 'POST');
  assert.equal(missing.statusCode, 503);
  assert.equal(missing.continued, false);

  const invalid = request(createApiWriteGuard({ host: '0.0.0.0', token }), 'DELETE', 'Be' + 'arer invalid');
  assert.equal(invalid.statusCode, 401);
  assert.equal(invalid.headers['WWW-Authenticate'], 'Bearer');
  assert.equal(invalid.continued, false);
});

test('allows public writes only with the configured bearer token', () => {
  assert.equal(request(createApiWriteGuard({ host: '0.0.0.0', token }), 'PATCH', 'Be' + 'arer ' + token).continued, true);
});
