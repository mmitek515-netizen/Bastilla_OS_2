import assert from 'node:assert/strict';
import test from 'node:test';
import { ApprovalQueue, ApprovalQueueError } from './approval-queue.mjs';
import { isOperatorAuthorized, isOperatorTokenConfigured } from './authorization.mjs';
import { parseNaturalCommand } from './parser.mjs';

const token = 'operator-test-token-0123456789abcdef';
const authorization = ['Bear', 'er ', token].join('');

test('operator tokens fail closed and use exact bearer credentials', () => {
  assert.equal(isOperatorTokenConfigured(token), true);
  assert.equal(isOperatorTokenConfigured('too-short'), false);
  assert.equal(isOperatorAuthorized(token, authorization), true);
  assert.equal(isOperatorAuthorized(token, ['bear', 'er ', token].join('')), false);
  assert.equal(isOperatorAuthorized(token, ['Bear', 'er '].join('')), false);
  assert.equal(isOperatorAuthorized('', authorization), false);
  assert.equal(isOperatorAuthorized(token, ['Bear', 'er ', 'x'.repeat(1025)].join('')), false);
});

test('Polish and English read intents are recognized without creating proposals', () => {
  assert.deepEqual(parseNaturalCommand('Pokaż status systemu.'), {
    kind: 'read',
    operation: 'system.status',
  });
  assert.deepEqual(parseNaturalCommand('Show the system status?'), {
    kind: 'read',
    operation: 'system.status',
  });
});

test('supported state-changing requests become bounded, high-risk proposals', () => {
  assert.deepEqual(parseNaturalCommand('Zrestartuj usługę ssh'), {
    kind: 'proposal',
    operation: { type: 'service.restart', service: 'ssh' },
    risk: 'high',
  });
  assert.deepEqual(parseNaturalCommand('Restart service cron'), {
    kind: 'proposal',
    operation: { type: 'service.restart', service: 'cron' },
    risk: 'high',
  });
  assert.deepEqual(parseNaturalCommand('Uruchom ponownie system'), {
    kind: 'proposal',
    operation: { type: 'system.reboot' },
    risk: 'high',
  });
  assert.deepEqual(parseNaturalCommand('Reboot the system'), {
    kind: 'proposal',
    operation: { type: 'system.reboot' },
    risk: 'high',
  });
});

test('unknown, oversized, injected, and unsupported service commands do not parse', () => {
  for (const request of [
    'sudo reboot',
    'restart service unknown',
    'restart service ssh; id',
    'reboot && whoami',
    '/exec rm -rf /',
    '!cat /etc/passwd',
    'show system status\nreboot',
    'x'.repeat(513),
  ]) {
    assert.equal(parseNaturalCommand(request), null, request);
  }
});

test('approval queue requires authorization, validates operations, and only records decisions', () => {
  const queue = new ApprovalQueue({ operatorToken: token, idGenerator: () => 'proposal-1' });
  assert.throws(() => queue.list(), { code: 'unauthorized' });
  assert.throws(
    () => queue.submit({ type: 'shell.exec', command: 'id' }, authorization),
    { code: 'invalid_operation' },
  );

  const proposal = queue.submit({ type: 'system.reboot' }, authorization);
  assert.equal(proposal.status, 'pending_approval');
  assert.deepEqual(queue.list(authorization), [proposal]);

  const approved = queue.decide(proposal.id, 'approve', proposal.version, authorization);
  assert.equal(approved.status, 'approved');
  assert.equal(approved.version, 2);
  assert.throws(
    () => queue.decide(proposal.id, 'approve', proposal.version, authorization),
    { code: 'already_decided' },
  );
  assert.deepEqual(queue.list(authorization), []);
  assert.deepEqual(
    queue.auditEntries(authorization).map(({ event }) => event),
    ['operation.proposed', 'operation.approved'],
  );
});

test('stale, invalid, and unauthorized decisions do not change queue state', () => {
  const queue = new ApprovalQueue({ operatorToken: token, idGenerator: () => 'proposal-2' });
  const proposal = queue.submit({ type: 'service.restart', service: 'nginx' }, authorization);
  assert.throws(
    () => queue.decide(proposal.id, 'approve', 0, authorization),
    { code: 'stale_version' },
  );
  assert.throws(
    () => queue.decide(proposal.id, 'execute', proposal.version, authorization),
    { code: 'invalid_decision' },
  );
  assert.throws(
    () => queue.decide(proposal.id, 'approve', proposal.version, 'invalid'),
    { code: 'unauthorized' },
  );
  assert.equal(queue.list(authorization)[0].status, 'pending_approval');
});

test('expired proposals cannot be approved and audit entries omit credentials', () => {
  let now = 1_800_000_000_000;
  const queue = new ApprovalQueue({
    operatorToken: token,
    clock: () => now,
    idGenerator: () => 'proposal-3',
    ttlMs: 1000,
  });
  const proposal = queue.submit({ type: 'system.reboot' }, authorization);
  now += 1000;

  assert.deepEqual(queue.list(authorization), []);
  assert.throws(
    () => queue.decide(proposal.id, 'approve', proposal.version, authorization),
    (error) => error instanceof ApprovalQueueError && error.code === 'expired',
  );
  assert.deepEqual(
    queue.auditEntries(authorization).map(({ event }) => event),
    ['operation.proposed', 'operation.expired'],
  );
  assert.equal(JSON.stringify(queue.auditEntries(authorization)).includes(token), false);
});

test('queue capacity counts pending proposals and returns defensive copies', () => {
  let nextId = 0;
  const queue = new ApprovalQueue({
    operatorToken: token,
    idGenerator: () => `proposal-${++nextId}`,
    maxPending: 1,
  });
  const proposal = queue.submit({ type: 'system.reboot' }, authorization);
  proposal.operation.type = 'shell.exec';
  assert.equal(queue.list(authorization)[0].operation.type, 'system.reboot');
  assert.throws(
    () => queue.submit({ type: 'system.reboot' }, authorization),
    { code: 'queue_full' },
  );
  queue.decide('proposal-1', 'reject', 1, authorization);
  assert.equal(queue.submit({ type: 'system.reboot' }, authorization).status, 'pending_approval');
});

test('invalid queue bounds and duplicate proposal IDs fail safely', () => {
  assert.throws(
    () => new ApprovalQueue({ operatorToken: token, maxPending: 2, maxRecords: 1 }),
    { name: 'TypeError' },
  );
  const queue = new ApprovalQueue({ operatorToken: token, idGenerator: () => 'duplicate' });
  queue.submit({ type: 'system.reboot' }, authorization);
  assert.throws(
    () => queue.submit({ type: 'system.reboot' }, authorization),
    { code: 'id_generation_failed' },
  );
});
