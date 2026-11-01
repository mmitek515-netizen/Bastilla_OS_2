import { timingSafeEqual } from 'node:crypto';

const READ_ONLY_MCP_TOOLS = new Set(['kernel_status']);
const MIN_TOKEN_LENGTH = 32;

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
