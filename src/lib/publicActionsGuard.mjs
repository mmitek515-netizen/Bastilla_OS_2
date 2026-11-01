const PUBLIC_ACTION_ROUTES = new Set([
  'GET /api/gpt-actions/setup',
  'GET /api/gpt-actions/openapi.json',
  'GET /api/gpt-actions/status',
  'POST /api/gpt-actions/message',
]);

export function createPublicActionsGuard(enabled) {
  return (req, res, next) => {
    if (!enabled || PUBLIC_ACTION_ROUTES.has(`${req.method} ${req.path}`)) return next();
    res.setHeader('Cache-Control', 'no-store');
    return res.status(403).json({ error: 'Endpoint unavailable in public GPT Actions mode.' });
  };
}
