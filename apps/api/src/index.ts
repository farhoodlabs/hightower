/**
 * Shannon API Server — entry point.
 * Connects to Temporal, initializes K8s client, starts the Hono server.
 */

import { serve } from '@hono/node-server';
import * as k8s from '@kubernetes/client-node';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { connectTemporal, disconnectTemporal } from './services/temporal-client.js';

async function main(): Promise<void> {
  // 1. Load configuration
  const config = loadConfig();

  // 2. Connect to Temporal
  const temporal = await connectTemporal(config.temporalAddress);

  // 3. Initialize K8s client (in-cluster or from kubeconfig)
  const kc = new k8s.KubeConfig();
  try {
    kc.loadFromCluster();
  } catch {
    // Fallback to default kubeconfig (for local development)
    kc.loadFromDefault();
  }
  const batchApi = kc.makeApiClient(k8s.BatchV1Api);
  const coreApi = kc.makeApiClient(k8s.CoreV1Api);

  // 4. Create app
  const app = createApp(config, {
    temporalClient: temporal.client,
    batchApi,
    coreApi,
  });

  // 5. Start server
  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`Shannon API server listening on port ${info.port}`);
  });

  // 6. Graceful shutdown
  const shutdown = async (): Promise<void> => {
    console.log('Shutting down...');
    server.close();
    await disconnectTemporal(temporal);
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('Failed to start API server:', err);
  process.exit(1);
});
