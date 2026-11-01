export function resolveBuildInfo(version, commitSha, dirty = false) {
  const normalizedVersion = typeof version === 'string' && version.trim() ? version.trim() : 'unknown';
  const normalizedCommit = typeof commitSha === 'string' ? commitSha.trim() : '';

  return {
    version: normalizedVersion,
    commit: /^[a-f0-9]{7,40}$/i.test(normalizedCommit) ? normalizedCommit.slice(0, 12) : 'unknown',
    dirty: Boolean(dirty),
  };
}
