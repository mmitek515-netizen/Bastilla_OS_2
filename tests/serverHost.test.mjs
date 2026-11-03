import assert from 'node:assert/strict';
import test from 'node:test';
import { getServerHost } from '../src/lib/serverHost.mjs';

test('defaults to loopback when no host is configured', () => {
  assert.equal(getServerHost(undefined), '127.0.0.1');
  assert.equal(getServerHost('  '), '127.0.0.1');
});

test('uses a trimmed explicitly configured host', () => {
  assert.equal(getServerHost(' 0.0.0.0 '), '0.0.0.0');
});
