export function resolveServerHost(env: { BASTILLA_HOST?: string } = process.env): string {
  const host = env.BASTILLA_HOST;
  return typeof host === 'string' && host.trim() ? host.trim() : '127.0.0.1';
}

export function isAutoGitSyncEnabled(env: { BASTILLA_AUTO_GIT_SYNC?: string } = process.env): boolean {
  return env.BASTILLA_AUTO_GIT_SYNC === 'true';
}

export function isAutonomousMissionEnabled(env: { BASTILLA_AUTONOMOUS_MISSION?: string } = process.env): boolean {
  return env.BASTILLA_AUTONOMOUS_MISSION === 'true';
}
