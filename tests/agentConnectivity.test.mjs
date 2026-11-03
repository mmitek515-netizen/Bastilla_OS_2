import assert from 'node:assert/strict';
import test from 'node:test';
import { getAgentConnectivity } from '../src/kernel/agentConnectivity.ts';

test('Ollama availability does not imply a connected original agent worker', () => {
  assert.deepEqual(getAgentConnectivity('online'), {
    sourceApi: 'not_connected',
    runtime: 'available',
  });
  assert.deepEqual(getAgentConnectivity('offline'), {
    sourceApi: 'not_connected',
    runtime: 'offline',
  });
  assert.deepEqual(getAgentConnectivity('no-models'), {
    sourceApi: 'not_connected',
    runtime: 'no-models',
  });
});

test('missing, failed, or unknown health probes stay unknown', () => {
  for (const status of [undefined, 'waiting', 'unexpected']) {
    assert.deepEqual(getAgentConnectivity(status), {
      sourceApi: 'not_connected',
      runtime: 'unknown',
    });
  }
  assert.deepEqual(getAgentConnectivity('online', true), {
    sourceApi: 'not_connected',
    runtime: 'unknown',
  });
});
