import assert from 'node:assert/strict';
import test from 'node:test';
import { isMcpToolAuthorized } from '../src/kernel/mcpAuthorization.ts';

const token = 'a'.repeat(32);
const authorization = ['Bear', 'er ', token].join('');

test('only status is available without MCP write authorization', () => {
  assert.equal(isMcpToolAuthorized('kernel_status', undefined, undefined), true);
  assert.equal(isMcpToolAuthorized('astyria_mission', undefined, undefined), false);
  assert.equal(isMcpToolAuthorized('chat_triad', undefined, token), false);
});

test('state-changing MCP tools require the configured token', () => {
  assert.equal(isMcpToolAuthorized('astyria_mission', authorization, token), true);
  assert.equal(isMcpToolAuthorized('astyria_command', authorization, token), true);
  assert.equal(isMcpToolAuthorized('chat_triad', authorization, token), true);
  assert.equal(isMcpToolAuthorized('chat_triad', authorization.toLowerCase(), token), true);
  assert.equal(isMcpToolAuthorized('chat_triad', authorization, 'different-token-value-32-chars'), false);
  assert.equal(isMcpToolAuthorized('chat_triad', authorization, 'short'), false);
  assert.equal(isMcpToolAuthorized('chat_triad', `${authorization} extra`, token), false);
});
