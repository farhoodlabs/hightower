/**
 * Scan lifecycle orchestration — combines Temporal queries with K8s Job management.
 * This is the main service that route handlers delegate to.
 */

import crypto from 'node:crypto';
import type * as k8s from '@kubernetes/client-node';
import type { Client } from '@temporalio/client';
import type { Config } from '../config.js';
import type { CreateScanInput, ScanResponse } from '../types/api.js';
import { buildJobSpec } from './job-builder.js';
import { createJob, deleteJob, listWorkerJobs } from './job-manager.js';
import { cancelWorkflow, queryProgress } from './temporal-client.js';
import { listWorkspaces, readReport, readSessionJson } from './workspace-reader.js';

function randomSuffix(): string {
  return crypto.randomBytes(4).toString('hex');
}

// === Start Scan ===

export async function startScan(
  config: Config,
  batchApi: k8s.BatchV1Api,
  input: CreateScanInput,
): Promise<ScanResponse> {
  const suffix = randomSuffix();
  const taskQueue = `api-${suffix}`;
  const jobName = `hightower-worker-${suffix}`;

  const workspace =
    input.workspace ?? `${new URL(input.targetUrl).hostname.replace(/[^a-zA-Z0-9-]/g, '-')}_hightower-${Date.now()}`;

  const job = buildJobSpec({
    jobName,
    namespace: config.k8sNamespace,
    workerImage: config.workerImage,
    targetUrl: input.targetUrl,
    taskQueue,
    workspace,
    credentialsSecretName: config.credentialsSecretName,
    ...(input.gitUrl && { gitUrl: input.gitUrl }),
    ...(input.gitRef && { gitRef: input.gitRef }),
    ...(input.repoPath && { repoPath: input.repoPath }),
    ...(input.configYaml && { configYaml: input.configYaml }),
    ...(input.pipelineTesting && { pipelineTesting: true }),
  });

  await createJob(batchApi, config.k8sNamespace, job);

  return {
    id: jobName,
    workspace,
    targetUrl: input.targetUrl,
    status: 'running',
    createdAt: new Date().toISOString(),
  };
}

// === Get Scan ===

export async function getScan(config: Config, temporalClient: Client, scanId: string): Promise<ScanResponse | null> {
  // 1. Try Temporal query for live progress
  try {
    const progress = await queryProgress(temporalClient, scanId);
    return {
      id: scanId,
      workspace: scanId,
      targetUrl: '',
      status: progress.status,
      createdAt: new Date(progress.startTime).toISOString(),
      completedAgents: progress.completedAgents,
      agentMetrics: progress.agentMetrics,
      ...(progress.currentPhase && { currentPhase: progress.currentPhase }),
      ...(progress.currentAgent && { currentAgent: progress.currentAgent }),
      ...(progress.summary && { summary: progress.summary }),
      ...(progress.error && { error: progress.error }),
    };
  } catch {
    // Workflow not found in Temporal — try workspace session.json
  }

  // 2. Fall back to workspace session.json (completed/historical scans)
  const session = readSessionJson(config.workspacesDir, scanId);
  if (!session) return null;

  return {
    id: session.originalWorkflowId ?? scanId,
    workspace: session.workspace,
    targetUrl: session.webUrl ?? '',
    status: 'completed',
    createdAt: session.startTime ? new Date(session.startTime).toISOString() : '',
  };
}

// === List Scans ===

export async function listScans(
  config: Config,
  _temporalClient: Client,
  batchApi: k8s.BatchV1Api,
): Promise<ScanResponse[]> {
  const results: ScanResponse[] = [];

  // 1. Running scans from K8s Jobs
  const jobs = await listWorkerJobs(batchApi, config.k8sNamespace);
  for (const job of jobs) {
    const jobName = job.metadata?.name ?? '';
    const workspace = job.metadata?.labels?.['shannon.io/workspace'] ?? jobName;
    const startTime = job.status?.startTime;

    results.push({
      id: jobName,
      workspace,
      targetUrl: '',
      status: job.status?.succeeded ? 'completed' : job.status?.failed ? 'failed' : 'running',
      createdAt: startTime ? new Date(startTime).toISOString() : '',
    });
  }

  // 2. Historical scans from workspace session.json files
  const workspaces = listWorkspaces(config.workspacesDir);
  const jobNames = new Set(results.map((r) => r.workspace));

  for (const ws of workspaces) {
    if (jobNames.has(ws.workspace)) continue;
    results.push({
      id: ws.originalWorkflowId ?? ws.workspace,
      workspace: ws.workspace,
      targetUrl: ws.webUrl ?? '',
      status: 'completed',
      createdAt: ws.startTime ? new Date(ws.startTime).toISOString() : '',
    });
  }

  return results;
}

// === Cancel Scan ===

export async function cancelScan(
  config: Config,
  temporalClient: Client,
  batchApi: k8s.BatchV1Api,
  scanId: string,
): Promise<void> {
  // Cancel Temporal workflow (best-effort)
  try {
    await cancelWorkflow(temporalClient, scanId);
  } catch {
    // Workflow may have already completed
  }

  // Delete K8s Job
  try {
    await deleteJob(batchApi, config.k8sNamespace, scanId);
  } catch {
    // Job may have already been cleaned up
  }
}

// === Get Report ===

export async function getReport(config: Config, scanId: string): Promise<string | null> {
  return readReport(config.workspacesDir, scanId);
}
