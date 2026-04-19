/**
 * Hono app factory.
 * Creates the app with middleware and routes. Deps injected for testability.
 */

import type * as k8s from '@kubernetes/client-node';
import type { Client } from '@temporalio/client';
import { Hono } from 'hono';
import type { Config } from './config.js';
import { authMiddleware } from './middleware/auth.js';
import { errorHandler } from './middleware/error-handler.js';
import { healthRoutes } from './routes/health.js';
import { scanRoutes } from './routes/scans.js';

export interface AppDeps {
  readonly temporalClient: Client;
  readonly batchApi: k8s.BatchV1Api;
  readonly coreApi: k8s.CoreV1Api;
}

export function createApp(config: Config, deps: AppDeps): Hono {
  const app = new Hono();

  // Global error handler
  app.onError(errorHandler);

  // Auth middleware (skips /healthz and /readyz)
  app.use('*', authMiddleware(config.apiKey));

  // Routes
  app.route('/', healthRoutes(deps));
  app.route('/api/scans', scanRoutes(config, deps));

  return app;
}
