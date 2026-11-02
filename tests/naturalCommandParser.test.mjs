import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNaturalCommand } from '../src/kernel/naturalCommandParser.ts';

test('recognizes bounded Polish and English read-only commands', () => {
  assert.deepEqual(parseNaturalCommand('Pokaż status systemu.'), {
    type: 'read',
    operation: 'system-status',
  });
  assert.deepEqual(parseNaturalCommand('What is the system status?'), {
    type: 'read',
    operation: 'system-status',
  });
  assert.deepEqual(parseNaturalCommand('Show system status'), {
    type: 'read',
    operation: 'system-status',
  });
  assert.deepEqual(parseNaturalCommand('Show me the system status'), {
    type: 'read',
    operation: 'system-status',
  });
  assert.deepEqual(parseNaturalCommand('Lista aplikacji'), {
    type: 'read',
    operation: 'list-apps',
  });
  assert.deepEqual(parseNaturalCommand('List installed apps'), {
    type: 'read',
    operation: 'list-apps',
  });
});

test('maps supported Polish and English write requests to validated proposals', () => {
  assert.deepEqual(parseNaturalCommand('Utwórz aplikację my-app typu node-api'), {
    type: 'propose',
    action: { type: 'create-app', id: 'my-app', appType: 'node-api' },
  });
  assert.deepEqual(parseNaturalCommand('Create a new app called my-app'), {
    type: 'propose',
    action: { type: 'create-app', id: 'my-app', appType: 'html5-web' },
  });
  assert.deepEqual(parseNaturalCommand('Create database project-data'), {
    type: 'propose',
    action: { type: 'create-db', id: 'project-data' },
  });
  assert.deepEqual(parseNaturalCommand('Open preview for application my-app'), {
    type: 'propose',
    action: { type: 'launch', appId: 'my-app' },
  });
  assert.deepEqual(parseNaturalCommand('Launch app my-app'), {
    type: 'propose',
    action: { type: 'launch', appId: 'my-app' },
  });
});

test('rejects invalid identifiers, unsupported operations and command injection text', () => {
  assert.equal(parseNaturalCommand('Create app ../outside'), null);
  assert.equal(parseNaturalCommand('Create app my-app type shell'), null);
  assert.equal(parseNaturalCommand('Run rm -rf /'), null);
  assert.equal(parseNaturalCommand('Delete the database'), null);
  assert.equal(parseNaturalCommand(''), null);
});
