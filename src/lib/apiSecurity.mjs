import { timingSafeEqual } from 'node:crypto';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);
const PUBLICLY_AUTHENTICATED_GPT_ROUTES = new Set([
  '/api/gpt-actions/status',
  '/api/gpt-actions/message',
  '/api/gpt-actions/setup',
  '/api/gpt-actions/openapi.json',
]);
export function createApiSecurity({ host, token, isProduction }) {
  const bindHost = String(host || '').trim().toLowerCase();
  const apiToken = String(token || '').trim();
  if (!bindHost) throw new Error('BASTILLA_API_HOST must not be empty.');

  const isLoopback = LOOPBACK_HOSTS.has(bindHost);
  if (!isLoopback && !isProduction) {
    throw new Error('Non-loopback API binding is disabled outside production mode.');
  }
  if (!isLoopback && !/^[\x21-\x7e]{32,256}$/.test(apiToken)) {
    throw new Error('Public API binding requires BASTILLA_API_TOKEN with 32–256 non-whitespace characters.');
  }

  return {
    isLoopback,
    middleware(req, res, next) {
      const requestPath = req.path.toLowerCase();
      const protectedPath = requestPath === '/api' || requestPath.startsWith('/api/')
        || requestPath === '/mcp' || requestPath === '/download';
      if (isLoopback || !protectedPath || req.method === 'OPTIONS'
        || PUBLICLY_AUTHENTICATED_GPT_ROUTES.has(requestPath)) {
        return next();
      }

      const supplied = Buffer.from(req.get('authorization') || '');
      const expected = Buffer.from(['Be', 'arer ', apiToken].join(''));
      const comparable = Buffer.alloc(expected.length);
      supplied.copy(comparable, 0, 0, expected.length);
      const authorized = timingSafeEqual(comparable, expected) && supplied.length === expected.length;
      if (!authorized) {
        res.setHeader('WWW-Authenticate', 'Bearer');
        return res.status(401).json({ error: 'A valid bearer token is required for public API access.' });
      }
      return next();
    },
  };
}

export function parseAllowedOrigins(value = '') {
  const origins = new Set();
  for (const entry of String(value).split(',').map((item) => item.trim()).filter(Boolean)) {
    const url = new URL(entry);
    const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !localHttp) || url.username || url.password
      || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('BASTILLA_CORS_ORIGINS must contain only HTTPS origins (HTTP is allowed for localhost) without paths or credentials.');
    }
    origins.add(url.origin);
  }
  return origins;
}

export function setAllowedCorsOrigin(req, res, allowedOrigins) {
  const origin = req.get('origin');
  if (typeof res.vary === 'function') res.vary('Origin');
  else res.setHeader('Vary', 'Origin');
  if (origin && allowedOrigins.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
}
