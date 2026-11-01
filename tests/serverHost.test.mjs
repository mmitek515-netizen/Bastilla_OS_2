import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveServerHost } from '../src/kernel/serverHost.ts';

test('server binds to loopback unless an explicit host is configured', () => {
  assert.equal(resolveServerHost({}), '127.0.0.1');
  assert.equal(resolveServerHost({ BASTILLA_HOST: '  ' }), '127.0.0.1');
  assert.equal(resolveServerHost({ BASTILLA_HOST: '0.0.0.0' }), '0.0.0.0');
});
