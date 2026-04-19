/**
 * `shannon workspaces` command — list all workspaces.
 */

import { getOrchestrator } from '../backend.js';
import { getWorkspacesDir } from '../home.js';

export async function workspaces(version: string): Promise<void> {
  const orchestrator = await getOrchestrator();
  const workspacesDir = getWorkspacesDir();
  const image = orchestrator.getWorkerImage(version);

  try {
    orchestrator.runEphemeral(
      image,
      ['node', 'apps/worker/dist/temporal/workspaces.js'],
      [`${workspacesDir}:/app/workspaces`],
    );
  } catch {
    console.error('ERROR: Failed to list workspaces. Is the Docker image available?');
    console.error(`  Run: docker pull ${image}`);
    process.exit(1);
  }
}
