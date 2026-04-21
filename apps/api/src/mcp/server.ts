/**
 * MCP server for Hightower scan management.
 * Exposes scan-manager tools via the Model Context Protocol over HTTP.
 */

import http from 'node:http';
import type * as k8s from '@kubernetes/client-node';
import type { Client } from '@temporalio/client';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import type { Config } from '../config.js';
import {
  cancelScan,
  getReport,
  getScan,
  listScans,
  startScan,
} from '../services/scan-manager.js';
import type { CreateScanInput } from '../types/api.js';

export interface McpServerDeps {
  readonly config: Config;
  readonly temporalClient: Client;
  readonly batchApi: k8s.BatchV1Api;
  readonly coreApi: k8s.CoreV1Api;
}

function createMcpServer(deps: McpServerDeps): McpServer {
  const server = new McpServer(
    { name: 'hightower', version: '1.0.0' },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // === Tool: start_scan ===
  server.registerTool(
    'start_scan',
    {
      description:
        'Start a new penetration test scan. Returns the scan ID and initial status.',
      inputSchema: z.object({
        targetUrl: z.string().describe('Target URL to scan (e.g., https://example.com)'),
        gitUrl: z.string().describe(
          'Git URL of the repository to analyze (e.g., https://github.com/user/repo)',
        ),
        workspace: z
          .string()
          .optional()
          .describe(
            'Optional workspace name. Must match /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/. Defaults to auto-generated from target URL.',
          ),
        gitRef: z
          .string()
          .optional()
          .describe('Optional Git branch/tag/commit to checkout before scanning.'),
        pipelineTesting: z
          .boolean()
          .optional()
          .describe(
            'If true, runs in minimal testing mode with fast retries (10s). Use for development.',
          ),
      }),
    },
    async ({ targetUrl, gitUrl, workspace, gitRef, pipelineTesting }) => {
      const input: CreateScanInput = {
        targetUrl,
        gitUrl,
        workspace,
        ...(gitRef !== undefined && { gitRef }),
        ...(pipelineTesting !== undefined && { pipelineTesting }),
      };

      const result = await startScan(deps.config, deps.batchApi, input);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  // === Tool: get_scan ===
  server.registerTool(
    'get_scan',
    {
      description:
        'Get the status, progress, and results of a running or completed scan.',
      inputSchema: z.object({
        scanId: z.string().describe(
          "The scan ID returned from start_scan (e.g., hightower-worker-abc123)",
        ),
      }),
    },
    async ({ scanId }) => {
      const result = await getScan(deps.config, deps.temporalClient, scanId);

      if (!result) {
        return {
          content: [
            { type: 'text' as const, text: `Scan '${scanId}' not found.` },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  // === Tool: list_scans ===
  server.registerTool(
    'list_scans',
    {
      description: 'List all running and historical scans.',
      inputSchema: z.object({}),
    },
    async () => {
      const results = await listScans(
        deps.config,
        deps.temporalClient,
        deps.batchApi,
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    },
  );

  // === Tool: cancel_scan ===
  server.registerTool(
    'cancel_scan',
    {
      description:
        'Cancel a running scan by terminating its Kubernetes Job and Temporal workflow.',
      inputSchema: z.object({
        scanId: z.string().describe('The scan ID to cancel.'),
      }),
    },
    async ({ scanId }) => {
      await cancelScan(
        deps.config,
        deps.temporalClient,
        deps.batchApi,
        scanId,
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: `Scan '${scanId}' cancellation requested.`,
          },
        ],
      };
    },
  );

  // === Tool: get_report ===
  server.registerTool(
    'get_report',
    {
      description: 'Get the final security report for a completed scan.',
      inputSchema: z.object({
        scanId: z.string().describe("The scan ID to get the report for."),
      }),
    },
    async ({ scanId }) => {
      const report = await getReport(deps.config, scanId);

      if (!report) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Report for scan '${scanId}' not found.`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text' as const, text: report }],
      };
    },
  );

  return server;
}

export async function startMcpServer(
  deps: McpServerDeps,
  port: number,
): Promise<http.Server> {
  const mcpServer = createMcpServer(deps);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });

  // Cast to Transport — the SDK's Transport interface requires onclose: () => void
  // but StreamableHTTPServerTransport allows undefined (handled internally).
  await mcpServer.connect(transport as never);

  const server = http.createServer((req, res) => {
    transport.handleRequest(req, res, undefined);
  });

  return new Promise<http.Server>((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, () => {
      console.log(`MCP server listening on port ${port}`);
      resolve(server);
    });
  });
}
