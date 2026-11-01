import { timingSafeEqual } from 'node:crypto';

const READ_ONLY_MCP_TOOLS = new Set(['kernel_status']);
const MIN_TOKEN_LENGTH = 32;

export function createMcpRateLimiter(limit = 120, windowMs = 60000, maxClients = 10000) {
  const clients = new Map<string, { count: number; resetAt: number }>();
  return (client: string, now = Date.now()): boolean => {
    const bucket = clients.get(client);
    if (bucket && now < bucket.resetAt) {
      if (bucket.count >= limit) return false;
      bucket.count += 1;
      return true;
    }

    if (clients.size >= maxClients) {
      for (const [key, value] of clients) {
        if (now >= value.resetAt) clients.delete(key);
      }
      if (clients.size >= maxClients) return false;
    }
    clients.set(client, { count: 1, resetAt: now + windowMs });
    return true;
  };
}

export function isMcpToolAuthorized(
  toolName: unknown,
  authorization: string | undefined,
  configuredToken: string | undefined,
): boolean {
  if (typeof toolName === 'string' && READ_ONLY_MCP_TOOLS.has(toolName)) return true;
  if (!configuredToken || configuredToken.length < MIN_TOKEN_LENGTH) return false;

  const prefix = ['Bear', 'er '].join('');
  if (!authorization || authorization.slice(0, prefix.length).toLowerCase() !== prefix.toLowerCase()) return false;
  const token = authorization.slice(prefix.length);
  if (!token || /\s/.test(token)) return false;
  const supplied = Buffer.from(token);
  const expected = Buffer.from(configuredToken);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
