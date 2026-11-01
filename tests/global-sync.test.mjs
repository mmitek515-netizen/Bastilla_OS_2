import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('tsx', import.meta.url);
const { LocalSyncBus } = await import('../src/lib/globalSync.ts');

const event = (overrides = {}) => ({
  id: 'event-1', domain: 'files', resourceId: 'file-1', projectId: 'project-1',
  revision: 1, phase: 'saved', target: 'backend',
  timestamp: '2026-11-02T00:00:00.000Z', ...overrides,
});

test('publishes confirmed local event to subscribers and supports unsubscribe', () => {
  const bus = new LocalSyncBus();
  const received = [];
  const unsubscribe = bus.subscribe(e => received.push(e));
  assert.equal(bus.publish(event()), true);
  assert.deepEqual(received, [event()]);
  unsubscribe();
  bus.publish(event({ id: 'event-2', revision: 2 }));
  assert.equal(received.length, 1);
});

test('rejects duplicate event ID and stale revision', () => {
  const bus = new LocalSyncBus();
  assert.equal(bus.publish(event()), true);
  assert.equal(bus.publish(event()), false);
  assert.equal(bus.publish(event({ id: 'event-stale', revision: 0 })), false);
});

test('allows distinct phase events for same revision and isolates projects', () => {
  const bus = new LocalSyncBus();
  assert.equal(bus.publish(event()), true);
  assert.equal(bus.publish(event({ id: 'event-2', phase: 'confirmed' })), true);
  assert.equal(bus.publish(event({ id: 'event-3', projectId: 'project-2' })), true);
  assert.equal(bus.publish(event({ id: 'event-4', revision: 2 })), true);
  assert.equal(bus.publish(event({ id: 'event-5', revision: 1 })), false);
});

test('rejects malformed event metadata', () => {
  for (const bad of [
    { domain: 'other' }, { phase: 'magic' }, { target: 'unknown' },
    { revision: -1 }, { revision: 1.5 }, { timestamp: 'not-a-date' },
    { id: '' }, { resourceId: '' }, { projectId: 7 },
  ]) {
    const bus = new LocalSyncBus();
    assert.throws(() => bus.publish(event(bad)));
  }
});

test('one failing subscriber does not prevent delivery to others', () => {
  const bus = new LocalSyncBus();
  let count = 0;
  bus.subscribe(() => { throw Error('subscriber failure'); });
  bus.subscribe(() => { count++; });
  assert.equal(bus.publish(event()), true);
  assert.equal(count, 1);
});
