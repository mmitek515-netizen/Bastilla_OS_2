import assert from 'node:assert/strict';
import test from 'node:test';
import { getServerHost } from '../src/lib/serverHost.mjs';

test('defaults to loopback when no host is configured', () => {
  assert.equal(getServerHost(undefined), '127.0.0.1');
  assert.equal(getServerHost('  '), '127.0.0.1');
});

test('uses a trimmed explicitly configured host', () => {
  assert.equal(getServerHost(' 127.0.0.2 '), '127.0.0.2');
  assert.equal(getServerHost('::1'), '::1');
  assert.equal(getServerHost('LOCALHOST'), 'LOCALHOST');
});

test('rejects explicit non-loopback hosts', () => {
  for (const host of ['0.0.0.0', '192.168.1.10', 'example.com']) {
    assert.throws(() => getServerHost(host), /loopback address/);
  }
});
