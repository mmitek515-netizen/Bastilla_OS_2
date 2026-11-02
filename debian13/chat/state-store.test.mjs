import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { JsonStateStore } from './state-store.mjs';

test('JSON chat state is durable, bounded, and private to its owner', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'debian13-chat-state-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'state.json');
  const store = new JsonStateStore(path);
  store.update((state) => {
    state.sessions['session-test'] = { id: 'session-test', messages: [] };
    state.approvals.push({ id: 'proposal-test', status: 'pending_approval' });
  });

  const restarted = new JsonStateStore(path);
  assert.equal(restarted.read().sessions['session-test'].id, 'session-test');
  assert.equal(restarted.read().approvals[0].id, 'proposal-test');
  assert.equal(statSync(path).mode & 0o777, 0o600);
});

test('state paths must be absolute and invalid persisted state fails closed', async (t) => {
  assert.throws(
    () => new JsonStateStore('relative-state.json'),
    { name: 'TypeError', message: 'absolute_state_path_required' },
  );

  const directory = await mkdtemp(join(tmpdir(), 'debian13-chat-state-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'state.json');
  await writeFile(path, '{"version":2}');
  assert.throws(() => new JsonStateStore(path), { message: 'invalid_chat_state' });
});
