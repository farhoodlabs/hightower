/**
 * Health and readiness endpoints.
 * /healthz — always 200 (server is running)
 * /readyz  — checks Temporal connectivity
 */

import { Hono } from 'hono';
import type { AppDeps } from '../app.js';

export function healthRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  app.get('/healthz', (c) => {
    return c.json({ status: 'ok' });
  });

  app.get('/readyz', async (c) => {
    try {
      // Lightweight Temporal connectivity check — list with a filter that matches nothing
      const iter = deps.temporalClient.workflow.list({ query: 'ExecutionStatus = "Running"' });
      // Consume iterator to trigger the gRPC call, then break immediately
      for await (const _ of iter) {
        break;
      }
      return c.json({ status: 'ok' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ status: 'error', error: `Temporal unreachable: ${message}` }, 503);
    }
  });

  return app;
}
