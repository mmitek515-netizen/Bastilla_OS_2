import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
const { getSyncPaths, SYNC_FOLDERS } = await import('../src/lib/syncWorkspace.ts');

test('default paths are grouped under one root', () => {
  const before = process.env.BASTILLA_SYNC_ROOT;
  delete process.env.BASTILLA_SYNC_ROOT;
  try {
    const { root, folders } = getSyncPaths('/tmp/bastilla-workspace');
    assert.equal(root, path.resolve('/tmp/bastilla-workspace/data/bastilla-sync'));
    assert.equal(Object.keys(folders).length, SYNC_FOLDERS.length);
    for (const name of SYNC_FOLDERS) assert.equal(folders[name], path.join(root, name));
  } finally {
    if (before === undefined) delete process.env.BASTILLA_SYNC_ROOT;
    else process.env.BASTILLA_SYNC_ROOT = before;
  }
});

test('deployment can override the workspace root', () => {
  const before = process.env.BASTILLA_SYNC_ROOT;
  process.env.BASTILLA_SYNC_ROOT = '/mnt/bastilla-persistent';
  try { assert.equal(getSyncPaths('/tmp/elsewhere').root, '/mnt/bastilla-persistent'); }
  finally { if (before === undefined) delete process.env.BASTILLA_SYNC_ROOT; else process.env.BASTILLA_SYNC_ROOT = before; }
});
