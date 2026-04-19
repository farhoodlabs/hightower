/**
 * Scan CRUD routes — POST/GET /api/scans, GET/POST /api/scans/:id/*
 */

import { Hono } from 'hono';
import type { AppDeps } from '../app.js';
import type { Config } from '../config.js';
import { cancelScan, getReport, getScan, listScans, startScan } from '../services/scan-manager.js';
import { CreateScanSchema } from '../types/api.js';

export function scanRoutes(config: Config, deps: AppDeps): Hono {
  const app = new Hono();

  // POST /api/scans — start a new scan
  app.post('/', async (c) => {
    const body = await c.req.json();
    const parsed = CreateScanSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.issues }, 400);
    }

    const result = await startScan(config, deps.batchApi, parsed.data);
    return c.json(result, 201);
  });

  // GET /api/scans — list all scans
  app.get('/', async (c) => {
    const scans = await listScans(config, deps.temporalClient, deps.batchApi);
    return c.json({ scans });
  });

  // GET /api/scans/:id — get scan status/progress
  app.get('/:id', async (c) => {
    const scanId = c.req.param('id');
    const result = await getScan(config, deps.temporalClient, scanId);

    if (!result) {
      return c.json({ error: 'Scan not found' }, 404);
    }

    return c.json(result);
  });

  // POST /api/scans/:id/cancel — cancel a running scan
  app.post('/:id/cancel', async (c) => {
    const scanId = c.req.param('id');
    await cancelScan(config, deps.temporalClient, deps.batchApi, scanId);
    return c.json({ status: 'cancelled' });
  });

  // GET /api/scans/:id/report — get the scan report
  app.get('/:id/report', async (c) => {
    const scanId = c.req.param('id');
    const report = await getReport(config, scanId);

    if (!report) {
      return c.json({ error: 'Report not found' }, 404);
    }

    return c.text(report);
  });

  return app;
}
