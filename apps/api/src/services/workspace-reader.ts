/**
 * Workspace reader — reads session.json and deliverables from the shared workspaces PVC.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface SessionInfo {
  readonly workspace: string;
  readonly originalWorkflowId?: string;
  readonly webUrl?: string;
  readonly startTime?: number;
  readonly cost?: number;
  readonly resumeAttempts?: readonly { workflowId: string; timestamp: number }[];
}

export function readSessionJson(workspacesDir: string, workspace: string): SessionInfo | null {
  const sessionPath = path.join(workspacesDir, workspace, 'session.json');
  try {
    const raw = fs.readFileSync(sessionPath, 'utf-8');
    const data = JSON.parse(raw) as Record<string, unknown>;
    const session = data.session as Record<string, unknown> | undefined;
    const originalWorkflowId = session?.originalWorkflowId as string | undefined;
    const webUrl = session?.webUrl as string | undefined;
    const startTime = session?.startTime as number | undefined;
    const cost = session?.totalCostUsd as number | undefined;
    const resumeAttempts = session?.resumeAttempts as SessionInfo['resumeAttempts'];

    return {
      workspace,
      ...(originalWorkflowId && { originalWorkflowId }),
      ...(webUrl && { webUrl }),
      ...(startTime && { startTime }),
      ...(cost && { cost }),
      ...(resumeAttempts && { resumeAttempts }),
    };
  } catch {
    return null;
  }
}

export function readReport(workspacesDir: string, workspace: string): string | null {
  const delivDir = path.join(workspacesDir, workspace, 'deliverables');
  try {
    const files = fs.readdirSync(delivDir);
    const reportFile = files.find((f) => f.includes('report') && f.endsWith('.md'));
    if (!reportFile) return null;
    return fs.readFileSync(path.join(delivDir, reportFile), 'utf-8');
  } catch {
    return null;
  }
}

export function listWorkspaces(workspacesDir: string): SessionInfo[] {
  try {
    const entries = fs.readdirSync(workspacesDir, { withFileTypes: true });
    const results: SessionInfo[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const session = readSessionJson(workspacesDir, entry.name);
      if (session) {
        results.push(session);
      }
    }

    return results.sort((a, b) => (b.startTime ?? 0) - (a.startTime ?? 0));
  } catch {
    return [];
  }
}
