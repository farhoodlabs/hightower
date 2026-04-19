/**
 * Request/response types and Zod validation schemas for the scan API.
 */

import type { AgentMetrics, PipelineSummary } from '@shannon/worker/pipeline';
import { z } from 'zod';

// === Request Schemas ===

export const CreateScanSchema = z
  .object({
    targetUrl: z.string().url(),
    gitUrl: z.string().url().optional(),
    repoPath: z.string().optional(),
    gitRef: z.string().optional(),
    configYaml: z.string().optional(),
    workspace: z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/)
      .optional(),
    pipelineTesting: z.boolean().optional(),
  })
  .refine((data) => data.gitUrl || data.repoPath, {
    message: 'Either gitUrl or repoPath is required',
  });

export type CreateScanInput = z.infer<typeof CreateScanSchema>;

// === Response Types ===

export interface ScanResponse {
  id: string;
  workspace: string;
  targetUrl: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  currentPhase?: string;
  currentAgent?: string;
  completedAgents?: string[];
  agentMetrics?: Record<string, AgentMetrics>;
  summary?: PipelineSummary;
  error?: string;
}

export interface ScanListResponse {
  scans: ScanResponse[];
}
