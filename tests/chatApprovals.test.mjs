import assert from 'node:assert/strict';
import test from 'node:test';
import { parseChatApprovalCommand } from '../src/kernel/chatApprovals.ts';

test('parses bounded project, database, preview and file proposals', () => {
  assert.deepEqual(parseChatApprovalCommand('/propose create-app my-project node-api'), {
    type: 'propose',
    action: { type: 'create-app', id: 'my-project', appType: 'node-api' },
  });
  assert.deepEqual(parseChatApprovalCommand('/propose create-db project-data'), {
    type: 'propose',
    action: { type: 'create-db', id: 'project-data' },
  });
  assert.deepEqual(parseChatApprovalCommand('/propose launch my-project'), {
    type: 'propose',
    action: { type: 'launch', appId: 'my-project' },
  });
  assert.deepEqual(parseChatApprovalCommand('/propose write-file my-project index.html\n<h1>Draft</h1>\n'), {
    type: 'propose',
    action: { type: 'write-file', appId: 'my-project', filename: 'index.html', content: '<h1>Draft</h1>\n' },
  });
});

test('parses explicit approval, rejection and proposal-list commands', () => {
  const approvalId = 'c61561bd-fd79-49c3-b1d3-b3f9d44e9c74';
  assert.deepEqual(parseChatApprovalCommand(`/approve ${approvalId}`), { type: 'approve', approvalId });
  assert.deepEqual(parseChatApprovalCommand(`/reject ${approvalId}`), { type: 'reject', approvalId });
  assert.deepEqual(parseChatApprovalCommand('/proposals'), { type: 'list' });
});

test('rejects unsafe paths, protected manifests, unsupported actions and oversized content', () => {
  assert.equal(parseChatApprovalCommand('/propose write-file my-project ../index.html\nx').type, 'invalid');
  assert.equal(parseChatApprovalCommand('/propose write-file my-project app.json\n{}').type, 'invalid');
  assert.equal(parseChatApprovalCommand('/propose write-file my-project .env\nsecret').type, 'invalid');
  assert.equal(parseChatApprovalCommand('/propose write-file my-project index.html\n' + 'x'.repeat(20_001)).type, 'invalid');
  assert.equal(parseChatApprovalCommand('/propose run whoami').type, 'invalid');
  assert.equal(parseChatApprovalCommand('/approve not-a-uuid').type, 'invalid');
  assert.equal(parseChatApprovalCommand('hello Alex'), null);
});

test('maps explicit Polish and English operation requests to bounded proposals', () => {
  assert.deepEqual(parseChatApprovalCommand('Utwórz nową aplikację Moja-Apka node-api'), {
    type: 'propose',
    action: { type: 'create-app', id: 'moja-apka', appType: 'node-api' },
  });
  assert.deepEqual(parseChatApprovalCommand('Create a new app my-app'), {
    type: 'propose',
    action: { type: 'create-app', id: 'my-app', appType: 'html5-web' },
  });
  assert.deepEqual(parseChatApprovalCommand('Utwórz bazę raporty_2026'), {
    type: 'propose',
    action: { type: 'create-db', id: 'raporty_2026' },
  });
  assert.deepEqual(parseChatApprovalCommand('Launch the app my-app'), {
    type: 'propose',
    action: { type: 'launch', appId: 'my-app' },
  });
  assert.deepEqual(parseChatApprovalCommand('Otwórz projekt moja-apka'), {
    type: 'propose',
    action: { type: 'launch', appId: 'moja-apka' },
  });
});

test('rejects unsafe and arbitrary shell requests without producing executable commands', () => {
  for (const message of [
    'Create app ../outside',
    'Utwórz bazę ../../outside',
    '/exec rm -rf /',
    '!cat /etc/passwd',
  ]) {
    const parsed = parseChatApprovalCommand(message);
    assert.ok(parsed?.type === 'invalid', `${message} should be rejected`);
  }
  assert.equal(parseChatApprovalCommand('Please create an app someday'), null);
});
