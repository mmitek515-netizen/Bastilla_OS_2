export const MAX_REQUEST_BYTES = 512;
export const SUPPORTED_SERVICES = new Set(['cron', 'nginx', 'ssh']);

function normalizeRequest(message) {
  return message
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .toLowerCase()
    .trim()
    .replace(/[.!?]+$/, '')
    .replace(/\s+/g, ' ');
}

export function validateOperation(operation) {
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)) return null;

  if (
    operation.type === 'system.reboot' &&
    Object.keys(operation).length === 1
  ) {
    return { type: 'system.reboot' };
  }

  if (
    operation.type === 'service.restart' &&
    Object.keys(operation).length === 2 &&
    typeof operation.service === 'string' &&
    SUPPORTED_SERVICES.has(operation.service)
  ) {
    return { type: 'service.restart', service: operation.service };
  }

  return null;
}

export function parseNaturalCommand(message) {
  if (typeof message !== 'string' || Buffer.byteLength(message, 'utf8') > MAX_REQUEST_BYTES) return null;
  if (/[\u0000-\u001f\u007f]/.test(message)) return null;

  const request = normalizeRequest(message);
  if (
    /^(?:(?:pokaz|wyswietl|sprawdz)(?: mi)? )?(?:status systemu|stan systemu|status serwera|stan serwera|system status|server status)$/.test(request) ||
    /^(?:what is )?(?:the )?(?:system|server) status$/.test(request) ||
    /^(?:show|display|check)(?: me)? (?:the )?(?:system|server) status$/.test(request)
  ) {
    return { kind: 'read', operation: 'system.status' };
  }

  const restartService = request.match(
    /^(?:zrestartuj|restartuj|uruchom ponownie) (?:usluge|serwis) (cron|nginx|ssh)$/,
  ) ?? request.match(
    /^(?:restart|restart service|restart the service) (cron|nginx|ssh)$/,
  );
  if (restartService) {
    const operation = validateOperation({ type: 'service.restart', service: restartService[1] });
    return operation ? { kind: 'proposal', operation, risk: 'high' } : null;
  }

  if (/^(?:uruchom ponownie|zrestartuj|restartuj) system$/.test(request) ||
      /^(?:reboot|reboot the system|restart system|restart the system)$/.test(request)) {
    return { kind: 'proposal', operation: { type: 'system.reboot' }, risk: 'high' };
  }

  return null;
}
