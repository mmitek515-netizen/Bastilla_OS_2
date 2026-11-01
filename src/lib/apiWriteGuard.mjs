import { timingSafeEqual } from 'node:crypto';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isLoopbackHost(host) {
  return ['localhost', '127.0.0.1', '::1'].includes(String(host || '').trim().toLowerCase());
}

export function createApiWriteGuard({ host, token = '' }) {
  const requiresToken = !isLoopbackHost(host);
  const secret = typeof token === 'string' ? token.trim() : '';

  return (req, res, next) => {
    if (SAFE_METHODS.has(String(req.method || '').toUpperCase()) || !requiresToken) return next();
    if (secret.length < 32) {
      return res.status(503).json({ success: false, error: 'Ustaw BASTILLA_API_TOKEN (co najmniej 32 znaki), aby włączyć publiczne zapisy API.' });
    }

    const supplied = typeof req.get === 'function' ? req.get('authorization') || '' : '';
    const suppliedBytes = Buffer.from(supplied);
    const expectedBytes = Buffer.from('Be' + 'arer ' + secret);
    if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      return res.status(401).json({ success: false, error: 'Brak poprawnego tokenu API.' });
    }
    return next();
  };
}
