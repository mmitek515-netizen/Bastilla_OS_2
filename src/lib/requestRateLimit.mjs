export function createRequestRateLimit({ limit, windowMs, maxClients = 2048, now = Date.now }) {
  if (
    !Number.isInteger(limit) || limit < 1 ||
    !Number.isInteger(windowMs) || windowMs < 1 ||
    !Number.isInteger(maxClients) || maxClients < 1 ||
    typeof now !== 'function'
  ) {
    throw new TypeError('Rate limit options must be positive integers and now must be a function.');
  }
  const buckets = new Map();

  return (req, res, next) => {
    const currentTime = now();
    const key = String(req.ip || req.socket?.remoteAddress || 'unknown');
    let bucket = buckets.get(key);

    if (!bucket || currentTime >= bucket.resetAt) {
      if (!bucket && buckets.size >= maxClients) {
        for (const [client, entry] of buckets) {
          if (currentTime >= entry.resetAt) buckets.delete(client);
        }
        if (buckets.size >= maxClients) {
          res.setHeader('Retry-After', '1');
          return res.status(429).json({ success: false, error: 'Too many requests. Try again shortly.' });
        }
      }
      bucket = { count: 0, resetAt: currentTime + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    res.setHeader('RateLimit-Limit', String(limit));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, limit - bucket.count)));
    res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > limit) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - currentTime) / 1000))));
      return res.status(429).json({ success: false, error: 'Too many requests. Try again shortly.' });
    }
    return next();
  };
}
