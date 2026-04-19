/**
 * `shannon stop` command — stop workers and infrastructure.
 */

import * as p from '@clack/prompts';
import { getOrchestrator } from '../backend.js';

export async function stop(clean: boolean): Promise<void> {
  if (clean) {
    const confirmed = await p.confirm({
      message: 'This will stop all running scans and remove the Temporal data. Continue?',
    });
    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel('Aborted.');
      process.exit(0);
    }
  }

  const orchestrator = await getOrchestrator();
  orchestrator.stopWorkers();
  orchestrator.stopInfra(clean);
}
