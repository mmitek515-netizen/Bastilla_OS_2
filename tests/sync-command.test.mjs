import test from 'node:test';
import assert from 'node:assert/strict';
const { isSyncCommand } = await import('../src/lib/syncCommand.ts');

test('accepts exact operator sync commands', () => {
  for (const value of ['/sync', 'SYNC', 'sync!', 'synchronizuj', 'synchronizuj całą aplikację', 'synchronizuj cala aplikacje', '  /sync  ']) {
    assert.equal(isSyncCommand(value), true, value);
  }
});

test('does not intercept natural conversation about sync', () => {
  for (const value of ['czy sync działa?', 'synchronizuj pliki agenta', '/sync --force', 'synchronizuj i usuń bazę', '']) {
    assert.equal(isSyncCommand(value), false, value);
  }
});
