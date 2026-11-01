import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

const digest = (value) => createHash('sha256').update(value).digest();

export const MCP_TOOLS = [
  {
    name: 'kernel_status',
    description: 'Read SVL kernel state and system metrics. No write or command tools are exposed.',
    inputSchema: { type: 'object', properties: {} },
  },
];

export function createMcpRateLimiter({
  limit = 60,
  windowMs = 60_000,
  maxClients = 4096,
  now = Date.now,
} = {}) {
  const clients = new Map();
  return (clientKey) => {
    const currentTime = now();
    let client = clients.get(clientKey);
    if (!client || currentTime >= client.resetAt) {
      if (!client && clients.size >= maxClients) {
        for (const [key, entry] of clients) {
          if (currentTime >= entry.resetAt) clients.delete(key);
        }
        if (clients.size >= maxClients) {
          return { allowed: false, retryAfterSeconds: Math.ceil(windowMs / 1000) };
        }
      }
      client = { count: 0, resetAt: currentTime + windowMs };
      clients.set(clientKey, client);
    }
    if (client.count >= limit) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((client.resetAt - currentTime) / 1000)) };
    }
    client.count++;
    return { allowed: true, retryAfterSeconds: 0 };
  };
}

export function mcpTokenConfigured(env = process.env) {
  return (env.BASTILLA_MCP_TOKEN || '').trim().length >= 32;
}

export function authorizeMcpRequest(authorization, token) {
  if (typeof token !== 'string' || token.trim().length < 32) return false;
  const expected = digest(['Be', 'arer ', token.trim()].join(''));
  const supplied = digest(typeof authorization === 'string' ? authorization : '');
  return timingSafeEqual(supplied, expected);
}

export function configuredMcpPublicUrl(env = process.env) {
  const value = (env.BASTILLA_MCP_PUBLIC_URL || '').trim();
  if (!value) return null;

  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const privateIpv4 = /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
    const privateIpv6 = /^\[(::1|fc|fd|fe80)/i.test(host);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/\/mcp\/?$/.test(url.pathname) ||
      host === 'localhost' ||
      host === '::1' ||
      (isIP(host.replace(/^\[|\]$/g, '')) > 0 && (privateIpv4 || privateIpv6)) ||
      host.endsWith('.local') ||
      /^ais-(dev|pre)-/i.test(host)
    ) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function buildMcpDiagnostics(env = process.env, localProbe = {}) {
  const publicUrl = configuredMcpPublicUrl(env);
  return {
    publicUrl,
    publicUrlConfigured: Boolean(publicUrl),
    legacyBearerConfigured: mcpTokenConfigured(env),
    serverAvailable: localProbe.serverAvailable === true,
    handshakeOk: localProbe.handshakeOk === true,
    error: typeof localProbe.error === 'string' ? localProbe.error : null,
    chatGptConnected: null,
    externalConnectionVerified: false,
  };
}
