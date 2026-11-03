export function getServerHost(value = process.env.HOST) {
  const host = typeof value === 'string' ? value.trim() : '';
  return host || '127.0.0.1';
}
