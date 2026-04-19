/**
 * Temporal client management — connection lifecycle and workflow operations.
 * Uses @temporalio/client (not worker) since the API server only submits and queries workflows.
 */

import type { PipelineProgress } from '@shannon/worker/pipeline';
import { Client, Connection } from '@temporalio/client';

export interface TemporalClients {
  readonly client: Client;
  readonly connection: Connection;
}

export async function connectTemporal(address: string): Promise<TemporalClients> {
  console.log(`Connecting to Temporal at ${address}...`);
  const connection = await Connection.connect({ address });
  const client = new Client({ connection });
  console.log('Temporal connected.');
  return { client, connection };
}

export async function disconnectTemporal(clients: TemporalClients): Promise<void> {
  await clients.connection.close();
}

/** Query a workflow's progress via the getProgress query. */
export async function queryProgress(client: Client, workflowId: string): Promise<PipelineProgress> {
  const handle = client.workflow.getHandle(workflowId);
  return handle.query<PipelineProgress>('getProgress');
}

/** Cancel a running workflow. */
export async function cancelWorkflow(client: Client, workflowId: string): Promise<void> {
  const handle = client.workflow.getHandle(workflowId);
  await handle.cancel();
}
