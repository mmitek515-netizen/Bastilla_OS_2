import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isAutoGitSyncEnabled,
  isAutonomousMissionEnabled,
  resolveServerHost,
} from '../src/kernel/serverConfig.ts';

test('server binds to loopback unless an explicit host is configured', () => {
  assert.equal(resolveServerHost({}), '127.0.0.1');
  assert.equal(resolveServerHost({ BASTILLA_HOST: '  ' }), '127.0.0.1');
  assert.equal(resolveServerHost({ BASTILLA_HOST: '0.0.0.0' }), '0.0.0.0');
});

test('background mutations remain opt-in with exact true values', () => {
  assert.equal(isAutoGitSyncEnabled({}), false);
  assert.equal(isAutoGitSyncEnabled({ BASTILLA_AUTO_GIT_SYNC: '1' }), false);
  assert.equal(isAutoGitSyncEnabled({ BASTILLA_AUTO_GIT_SYNC: 'true' }), true);
  assert.equal(isAutonomousMissionEnabled({}), false);
  assert.equal(isAutonomousMissionEnabled({ BASTILLA_AUTONOMOUS_MISSION: 'true' }), true);
});
