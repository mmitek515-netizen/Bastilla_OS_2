export function createBuildMetadata(version, revision, isDirty = false) {
  const normalizedVersion = typeof version === 'string' && version.trim() ? version.trim() : 'unknown';
  const match = typeof revision === 'string' ? revision.trim().match(/^[0-9a-f]{40}$/i) : null;

  return {
    version: normalizedVersion,
    commit: match && !isDirty ? match[0].toLowerCase() : 'unknown',
  };
}
