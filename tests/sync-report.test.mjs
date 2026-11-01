import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('tsx', import.meta.url);
const { buildSyncReport, formatSyncReport } = await import('../src/lib/syncReport.ts');

test('fresh kernel read does not imply external sync success', () => {
  const report = buildSyncReport(true);
  assert.equal(report.length, 12);
  assert.deepEqual(report.filter(c => c.state === 'confirmed').map(c => c.domain), ['chat']);
  assert.equal(report.find(c => c.domain === 'github').state, 'unavailable');
  assert.equal(report.find(c => c.domain === 'databases').state, 'unavailable');
  assert.match(formatSyncReport(report), /2\/12/);
});

test('failed kernel read cannot be marked successful', () => {
  const report = buildSyncReport(false);
  assert.ok(report.every(c => c.state === 'failed'));
  assert.match(formatSyncReport(report), /0\/12/);
});
