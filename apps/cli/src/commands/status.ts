/**
 * `shannon status` command — show running workers and Temporal health.
 */

import { getOrchestrator } from '../backend.js';

export async function status(): Promise<void> {
  const orchestrator = await getOrchestrator();

  // 1. Temporal health
  const temporalUp = orchestrator.isTemporalReady();
  console.log(`Temporal: ${temporalUp ? 'running' : 'not running'}`);
  if (temporalUp) {
    console.log('  Web UI: http://localhost:8233');
  }
  console.log('');

  // 2. Running workers
  const workers = orchestrator.listRunningWorkers();
  if (workers) {
    console.log('Workers:');
    console.log(workers);
  } else {
    console.log('Workers: none running');
  }
}
