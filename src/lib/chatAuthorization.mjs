import { timingSafeEqual } from 'node:crypto';

const operatorRequiredMissionActions = new Set([
  'sync_version',
  'sync_versions',
  'repair_all_from_logs',
  'full_system_app_chat_repair',
]);

export function requiresChatOperatorAuthorization(action) {
  return typeof action === 'string' && operatorRequiredMissionActions.has(action);
}

export function isChatOperatorTokenConfigured(token) {
  return typeof token === 'string' && Buffer.byteLength(token) >= 32;
}

export function isChatOperatorAuthorized(configuredToken, authorizationHeader) {
  if (!isChatOperatorTokenConfigured(configuredToken) || typeof authorizationHeader !== 'string') {
    return false;
  }

  const prefix = 'Bearer ';
  if (!authorizationHeader.startsWith(prefix)) return false;

  const provided = Buffer.from(authorizationHeader.slice(prefix.length));
  const expected = Buffer.from(configuredToken);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
