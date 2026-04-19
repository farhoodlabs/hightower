/**
 * Bearer token authentication middleware.
 * Validates the Authorization header against the configured API key.
 * Skips health check endpoints.
 */

import crypto from 'node:crypto';
import type { Context, Next } from 'hono';

const PUBLIC_PATHS = new Set(['/healthz', '/readyz']);

export function authMiddleware(apiKey: string) {
  const expectedBuffer = Buffer.from(apiKey);

  return async (c: Context, next: Next) => {
    if (PUBLIC_PATHS.has(c.req.path)) {
      return next();
    }

    const header = c.req.header('Authorization');
    if (!header?.startsWith('Bearer ')) {
      return c.json({ error: 'Missing or invalid Authorization header' }, 401);
    }

    const token = header.slice(7);
    const tokenBuffer = Buffer.from(token);

    if (tokenBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(tokenBuffer, expectedBuffer)) {
      return c.json({ error: 'Invalid API key' }, 401);
    }

    return next();
  };
}
