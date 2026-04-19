/**
 * Global error handler middleware.
 * Catches unhandled errors and returns structured JSON responses.
 */

import type { Context } from 'hono';

export function errorHandler(err: Error, c: Context): Response {
  console.error('Unhandled error:', err);

  const status = 'statusCode' in err && typeof err.statusCode === 'number' ? err.statusCode : 500;

  return c.json(
    {
      error: status === 500 ? 'Internal server error' : err.message,
      code: err.name || 'UNKNOWN_ERROR',
    },
    status as 500,
  );
}
