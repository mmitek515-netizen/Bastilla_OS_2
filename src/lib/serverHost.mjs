import { isIP } from 'node:net';

export function getServerHost(value = process.env.HOST) {
  const host = typeof value === 'string' ? value.trim() : '';
  if (!host) return '127.0.0.1';

  const isLoopback = host.toLowerCase() === 'localhost'
    || host === '::1'
    || (isIP(host) === 4 && host.startsWith('127.'));
  if (!isLoopback) throw new Error('HOST must be a loopback address to keep the API private.');
  return host;
}
