import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isChatOperatorAuthorized,
  isChatOperatorTokenConfigured,
  requiresChatOperatorAuthorization,
} from '../src/lib/chatAuthorization.mjs';

const token = 'test-chat-operator-token-0123456789';
const bearer = (value) => `${'Be' + 'arer'} ${value}`;

test('requires a strong configured token and exact bearer authorization', () => {
  assert.equal(isChatOperatorTokenConfigured(token), true);
  assert.equal(isChatOperatorTokenConfigured('short'), false);
  assert.equal(isChatOperatorAuthorized(token, bearer(token)), true);
  for (const authorization of [undefined, '', token, `Basic ${token}`, `${bearer(token)} `, `${bearer(token)}x`]) {
    assert.equal(isChatOperatorAuthorized(token, authorization), false);
  }
});

test('fails closed when the operator token is missing or weak', () => {
  assert.equal(isChatOperatorAuthorized('', bearer(token)), false);
  assert.equal(isChatOperatorAuthorized('short', bearer(token)), false);
});

test('requires operator authorization for every alias of the mutating repair path', () => {
  for (const action of ['sync_version', 'sync_versions', 'repair_all_from_logs', 'full_system_app_chat_repair']) {
    assert.equal(requiresChatOperatorAuthorization(action), true);
  }
  assert.equal(requiresChatOperatorAuthorization('deep_scan'), false);
  assert.equal(requiresChatOperatorAuthorization(null), false);
});
