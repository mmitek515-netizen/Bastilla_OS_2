export function resolveServerHost(env: { BASTILLA_HOST?: string } = process.env): string {
  const host = env.BASTILLA_HOST;
  return typeof host === 'string' && host.trim() ? host.trim() : '127.0.0.1';
}
