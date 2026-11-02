import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestRateLimit } from '../src/lib/requestRateLimit.mjs';

function invoke(limiter, ip) {
  const response = {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
  let nextCalled = false;
  limiter({ ip }, response, () => { nextCalled = true; });
  return { ...response, nextCalled };
}

test('limits requests per client and resets after the time window', () => {
  let time = 1000;
  const limiter = createRequestRateLimit({ limit: 2, windowMs: 1000, now: () => time });
  assert.equal(invoke(limiter, 'client-a').nextCalled, true);
  assert.equal(invoke(limiter, 'client-a').nextCalled, true);
  const blocked = invoke(limiter, 'client-a');
  assert.equal(blocked.code, 429);
  assert.equal(blocked.headers['Retry-After'], '1');
  assert.equal(blocked.nextCalled, false);
  time = 2000;
  assert.equal(invoke(limiter, 'client-a').nextCalled, true);
});

test('bounds client tracking and evicts expired entries before refusing new clients', () => {
  let time = 1000;
  const limiter = createRequestRateLimit({ limit: 1, windowMs: 1000, maxClients: 1, now: () => time });
  assert.equal(invoke(limiter, 'client-a').nextCalled, true);
  assert.equal(invoke(limiter, 'client-b').code, 429);
  time = 2000;
  assert.equal(invoke(limiter, 'client-b').nextCalled, true);
});
