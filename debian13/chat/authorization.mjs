import { timingSafeEqual } from 'node:crypto';

export const MIN_OPERATOR_TOKEN_BYTES = 32;

export function isOperatorTokenConfigured(token) {
  return typeof token === 'string' && Buffer.byteLength(token, 'utf8') >= MIN_OPERATOR_TOKEN_BYTES;
}

export function isOperatorAuthorized(configuredToken, authorizationHeader) {
  if (
    !isOperatorTokenConfigured(configuredToken) ||
    typeof authorizationHeader !== 'string' ||
    authorizationHeader.length > 1024
  ) {
    return false;
  }

  const prefix = 'Bear' + 'er ';
  if (!authorizationHeader.startsWith(prefix)) return false;

  const supplied = Buffer.from(authorizationHeader.slice(prefix.length), 'utf8');
  if (supplied.length === 0 || /\s/.test(authorizationHeader.slice(prefix.length))) return false;
  const expected = Buffer.from(configuredToken, 'utf8');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
