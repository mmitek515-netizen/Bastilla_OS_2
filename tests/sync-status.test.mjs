import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('sync:status produces a read-only inventory without claiming remote synchronization', () => {
  const output = execFileSync(process.execPath, ['scripts/sync-status.mjs'], { encoding: 'utf8' });
  const report = JSON.parse(output);
  assert.equal(report.command, 'sync:status');
  assert.equal(report.scope, 'local-filesystem-read-only');
  assert.ok(report.results.some(row => row.name === 'server' && row.state === 'present'));
  assert.ok(report.results.some(row => row.name === 'global-sync' && row.state === 'present'));
  assert.ok(report.results.every(row => ['present', 'missing'].includes(row.state)));
  assert.ok(Object.values(report.externalSync).every(value => value === 'not-verified'));
  assert.match(report.warning, /does not synchronize/);
});
