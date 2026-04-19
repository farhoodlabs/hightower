/**
 * Docker orchestration — compose lifecycle, network, image pull/build, worker spawning.
 *
 * Local mode: builds locally, uses docker-compose.yml from repo root, mounts prompts.
 * NPX mode: pulls from Docker Hub, uses bundled compose.yml.
 */

import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { getMode } from './mode.js';
import type { Orchestrator, WorkerHandle, WorkerOptions } from './orchestrator.js';

export type { WorkerOptions };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const NPX_IMAGE_REPO = 'keygraph/shannon';
const DEV_IMAGE = 'shannon-worker';

/** Generate an 8-char random hex suffix for container/queue names. */
export function randomSuffix(): string {
  return crypto.randomBytes(4).toString('hex');
}

// === Internal Helpers ===

/** Run a command silently, return true if it succeeds. */
function runQuiet(cmd: string, args: string[]): boolean {
  try {
    execFileSync(cmd, args, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** Run a command and return stdout, or empty string on failure. */
function runOutput(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { stdio: 'pipe', encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
}

function getComposeFile(): string {
  return getMode() === 'local'
    ? path.resolve('docker-compose.yml')
    : path.resolve(__dirname, '..', 'infra', 'compose.yml');
}

/** Check if the router container is running and healthy. */
function isRouterReady(): boolean {
  const status = runOutput('docker', ['inspect', '--format', '{{.State.Health.Status}}', 'shannon-router']);
  return status === 'healthy';
}

/**
 * Detect if --add-host is needed (Linux without Podman).
 * macOS has host.docker.internal built in.
 */
function addHostFlag(): string[] {
  if (os.platform() === 'linux') {
    const hasPodman = runQuiet('which', ['podman']);
    if (!hasPodman) {
      return ['--add-host', 'host.docker.internal:host-gateway'];
    }
  }
  return [];
}

/** Remove old keygraph/shannon images that don't match the current version. */
function pruneOldImages(currentVersion: string): void {
  const output = runOutput('docker', ['images', NPX_IMAGE_REPO, '--format', '{{.Tag}}']);
  if (!output) return;

  const stale = output.split('\n').filter((tag) => tag && tag !== currentVersion);
  for (const tag of stale) {
    runQuiet('docker', ['rmi', `${NPX_IMAGE_REPO}:${tag}`]);
  }
}

// === DockerOrchestrator ===

/** Docker-based orchestration backend. */
export class DockerOrchestrator implements Orchestrator {
  getWorkerImage(version: string): string {
    return getMode() === 'local' ? DEV_IMAGE : `${NPX_IMAGE_REPO}:${version}`;
  }

  isTemporalReady(): boolean {
    const output = runOutput('docker', [
      'exec',
      'shannon-temporal',
      'temporal',
      'operator',
      'cluster',
      'health',
      '--address',
      'localhost:7233',
    ]);
    return output.includes('SERVING');
  }

  async ensureInfra(useRouter: boolean): Promise<void> {
    const temporalReady = this.isTemporalReady();
    const routerNeeded = useRouter && !isRouterReady();

    if (temporalReady && !routerNeeded) {
      return;
    }

    const composeFile = getComposeFile();
    const composeArgs = ['compose', '-f', composeFile];
    if (useRouter) composeArgs.push('--profile', 'router');
    composeArgs.push('up', '-d');

    if (temporalReady && routerNeeded) {
      console.log('Starting router...');
    } else {
      console.log('Starting Shannon infrastructure...');
    }
    execFileSync('docker', composeArgs, { stdio: 'inherit' });

    // Wait for Temporal if it wasn't already running
    if (!temporalReady) {
      console.log('Waiting for Temporal to be ready...');
      for (let i = 0; i < 30; i++) {
        if (this.isTemporalReady()) {
          console.log('Temporal is ready!');
          break;
        }
        if (i === 29) {
          console.error('Timeout waiting for Temporal');
          process.exit(1);
        }
        await sleep(2000);
      }
    }

    // Wait for router if needed
    if (routerNeeded) {
      console.log('Waiting for router to be ready...');
      for (let i = 0; i < 15; i++) {
        if (isRouterReady()) {
          console.log('Router is ready!');
          return;
        }
        await sleep(2000);
      }
      console.error('Timeout waiting for router');
      process.exit(1);
    }
  }

  ensureImage(version: string): void {
    const image = this.getWorkerImage(version);
    const exists = runQuiet('docker', ['image', 'inspect', image]);
    if (exists) return;

    if (getMode() === 'local') {
      console.log('Worker image not found, building...');
      this.buildImage(false);
    } else {
      console.log(`Pulling ${image}...`);
      try {
        execFileSync('docker', ['pull', image], { stdio: 'inherit' });
      } catch {
        console.error(`\nERROR: Failed to pull ${image}`);
        console.error('The image may not be available for your platform yet.');
        console.error('Check https://hub.docker.com/r/keygraph/shannon for available tags.');
        process.exit(1);
      }
      pruneOldImages(version);
    }
  }

  spawnWorker(opts: WorkerOptions): WorkerHandle {
    const args = ['run', '-d', '--rm', '--name', opts.containerName, '--network', 'shannon-net'];

    // Add host flag for Linux
    args.push(...addHostFlag());

    // UID remapping for Linux bind mounts
    if (os.platform() === 'linux' && process.getuid && process.getgid) {
      args.push('-e', `SHANNON_HOST_UID=${process.getuid()}`, '-e', `SHANNON_HOST_GID=${process.getgid()}`);
    }

    // Volume mounts
    args.push('-v', `${opts.workspacesDir}:/app/workspaces`);
    args.push('-v', `${opts.repo.hostPath}:${opts.repo.containerPath}:ro`);

    // Writable overlays: shadow .shannon/ inside the :ro repo with workspace-backed dirs
    const workspacePath = path.join(opts.workspacesDir, opts.workspace);
    args.push('-v', `${path.join(workspacePath, 'deliverables')}:${opts.repo.containerPath}/.shannon/deliverables`);
    args.push('-v', `${path.join(workspacePath, 'scratchpad')}:${opts.repo.containerPath}/.shannon/scratchpad`);
    args.push(
      '-v',
      `${path.join(workspacePath, '.playwright-cli')}:${opts.repo.containerPath}/.shannon/.playwright-cli`,
    );

    // Local mode: mount prompts for live editing
    if (opts.promptsDir) {
      args.push('-v', `${opts.promptsDir}:/app/apps/worker/prompts:ro`);
    }

    if (opts.config) {
      args.push('-v', `${opts.config.hostPath}:${opts.config.containerPath}:ro`);
    }

    // Output directory for deliverables copy
    if (opts.outputDir) {
      args.push('-v', `${opts.outputDir}:/app/output`);
    }

    // Mount credentials file to fixed container path
    if (opts.credentials) {
      args.push('-v', `${opts.credentials}:/app/credentials/google-sa-key.json:ro`);
    }

    // Environment
    args.push(...opts.envFlags);

    // Container settings
    args.push('--shm-size', '2gb', '--security-opt', 'seccomp=unconfined');

    // Image
    args.push(this.getWorkerImage(opts.version));

    // Worker command
    args.push('node', 'apps/worker/dist/temporal/worker.js', opts.url, opts.repo.containerPath);
    args.push('--task-queue', opts.taskQueue);
    if (opts.config) {
      args.push('--config', opts.config.containerPath);
    }
    if (opts.outputDir) {
      args.push('--output', '/app/output');
    }
    args.push('--workspace', opts.workspace);
    if (opts.pipelineTesting) {
      args.push('--pipeline-testing');
    }

    // Prevent MSYS/Git Bash from converting Unix paths (e.g. /repos/my-repo) to Windows paths
    const proc = spawn('docker', args, {
      stdio: 'pipe',
      ...(os.platform() === 'win32' && { env: { ...process.env, MSYS_NO_PATHCONV: '1' } }),
    });

    return new DockerWorkerHandle(proc, opts.containerName);
  }

  stopWorkers(): void {
    const workers = runOutput('docker', ['ps', '-q', '--filter', 'name=shannon-worker-']);
    if (!workers) return;

    const ids = workers.split('\n').filter(Boolean);
    console.log('Stopping worker containers...');
    execFileSync('docker', ['stop', ...ids], { stdio: 'inherit' });
  }

  stopInfra(clean: boolean): void {
    const composeFile = getComposeFile();
    const args = ['compose', '-f', composeFile, '--profile', 'router', 'down'];
    if (clean) args.push('-v');
    execFileSync('docker', args, { stdio: 'inherit' });
  }

  listRunningWorkers(): string {
    return runOutput('docker', [
      'ps',
      '--filter',
      'name=shannon-worker-',
      '--format',
      'table {{.Names}}\t{{.Status}}\t{{.RunningFor}}',
    ]);
  }

  runEphemeral(image: string, args: string[], mounts: string[]): void {
    const dockerArgs = ['run', '--rm'];
    for (const mount of mounts) {
      dockerArgs.push('-v', mount);
    }
    dockerArgs.push(image, ...args);
    execFileSync('docker', dockerArgs, {
      stdio: 'inherit',
      ...(os.platform() === 'win32' && { env: { ...process.env, MSYS_NO_PATHCONV: '1' } }),
    });
  }

  /** Build the worker image locally (local mode only). */
  buildImage(noCache: boolean): void {
    console.log(`Building ${DEV_IMAGE}...`);
    const args = ['build'];
    if (noCache) args.push('--no-cache');
    args.push('-t', DEV_IMAGE, '.');
    execFileSync('docker', args, { stdio: 'inherit' });
    console.log(`Build complete: ${DEV_IMAGE}`);
  }
}

/** WorkerHandle wrapping a Docker container's ChildProcess. */
class DockerWorkerHandle implements WorkerHandle {
  constructor(
    private readonly proc: ChildProcess,
    private readonly containerName: string,
  ) {}

  onError(cb: (err: Error) => void): void {
    this.proc.on('error', cb);
  }

  kill(): void {
    try {
      execFileSync('docker', ['stop', this.containerName], { stdio: 'pipe' });
    } catch {
      // Container may have already exited
    }
  }
}

// === Backward-compatible exports ===

// NOTE: Used by commands/build.ts which doesn't go through the orchestrator
export function buildImage(noCache: boolean): void {
  new DockerOrchestrator().buildImage(noCache);
}
