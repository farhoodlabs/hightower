/**
 * Orchestrator interface — abstraction over container orchestration backends.
 *
 * Docker and Kubernetes implement this interface so the CLI commands
 * can swap backends without changing their logic.
 */

export interface WorkerOptions {
  version: string;
  url: string;
  repo: { hostPath: string; containerPath: string };
  workspacesDir: string;
  taskQueue: string;
  containerName: string;
  envFlags: string[];
  config?: { hostPath: string; containerPath: string };
  credentials?: string;
  promptsDir?: string;
  outputDir?: string;
  workspace: string;
  pipelineTesting?: boolean;
}

/** Handle to a running worker, returned by Orchestrator.spawnWorker(). */
export interface WorkerHandle {
  onError(cb: (err: Error) => void): void;
  kill(): void;
}

/** Container orchestration backend. */
export interface Orchestrator {
  ensureInfra(useRouter: boolean): Promise<void>;
  ensureImage(version: string): void;
  spawnWorker(opts: WorkerOptions): WorkerHandle;
  stopWorkers(): void;
  stopInfra(clean: boolean): void;
  listRunningWorkers(): string;
  isTemporalReady(): boolean;
  getWorkerImage(version: string): string;

  /**
   * Run a one-shot ephemeral container and inherit stdio.
   * Used by commands like `workspaces` that need to run worker-side scripts.
   */
  runEphemeral(image: string, args: string[], mounts: string[]): void;
}
