import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBuildInfo } from '../scripts/build-info.mjs';

test('resolves a build version and abbreviated source commit', () => {
  assert.deepEqual(
    resolveBuildInfo(' 2.4.0 ', 'abcdef0123456789abcdef0123456789abcdef01'),
    { version: '2.4.0', commit: 'abcdef012345', dirty: false },
  );
});

test('does not present missing or invalid source metadata as a commit', () => {
  assert.deepEqual(resolveBuildInfo('', 'not-a-commit', true), {
    version: 'unknown',
    commit: 'unknown',
    dirty: true,
  });
});
