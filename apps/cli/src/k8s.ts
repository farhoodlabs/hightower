/**
 * Kubernetes orchestration backend.
 *
 * Replaces Docker CLI commands with Kubernetes API calls:
 * - `docker compose up` → apply Deployments, Services, PVCs
 * - `docker run --rm` → K8s Job per scan
 * - `docker stop` → delete Jobs
 */

import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import * as k8s from '@kubernetes/client-node';
import { buildEnvRecord } from './env.js';
import { getMode } from './mode.js';
import type { Orchestrator, WorkerHandle, WorkerOptions } from './orchestrator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NAMESPACE = 'hightower';
const NPX_IMAGE_REPO = 'keygraph/shannon';
const DEV_IMAGE = 'shannon-worker';
const WORKER_LABEL = 'hightower-worker';
const K8S_MANIFESTS_DIR = path.resolve(__dirname, '..', 'infra', 'k8s');

// === K8s Client Setup ===

function loadKubeConfig(): k8s.KubeConfig {
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();
  return kc;
}

/** Detect if running on kind or minikube (local K8s). */
function isLocalCluster(kc: k8s.KubeConfig): boolean {
  const context = kc.getCurrentContext();
  return context.startsWith('kind-') || context === 'minikube' || context.startsWith('minikube');
}

// === K8sOrchestrator ===

/** Kubernetes-based orchestration backend. */
export class K8sOrchestrator implements Orchestrator {
  private readonly kc: k8s.KubeConfig;
  private readonly coreApi: k8s.CoreV1Api;
  private readonly appsApi: k8s.AppsV1Api;
  private readonly batchApi: k8s.BatchV1Api;

  constructor() {
    this.kc = loadKubeConfig();
    this.coreApi = this.kc.makeApiClient(k8s.CoreV1Api);
    this.appsApi = this.kc.makeApiClient(k8s.AppsV1Api);
    this.batchApi = this.kc.makeApiClient(k8s.BatchV1Api);
  }

  getWorkerImage(version: string): string {
    return getMode() === 'local' ? DEV_IMAGE : `${NPX_IMAGE_REPO}:${version}`;
  }

  // === Infrastructure ===

  async ensureInfra(useRouter: boolean): Promise<void> {
    // 1. Create or update credentials secret
    await this.ensureCredentialsSecret();

    // 3. Apply Temporal manifests
    await this.applyManifest('temporal.yaml');

    // 4. Apply workspaces PVC
    await this.applyManifest('workspaces-pvc.yaml');

    // 5. Optionally apply router
    if (useRouter) {
      await this.applyManifest('router.yaml');
    }

    // 6. Wait for Temporal to be ready
    if (!(await this.isTemporalReadyAsync())) {
      console.log('Waiting for Temporal to be ready...');
      for (let i = 0; i < 30; i++) {
        if (await this.isTemporalReadyAsync()) {
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
  }

  ensureImage(_version: string): void {
    // K8s pulls images via imagePullPolicy — no-op for remote clusters.
    // For kind, users must run `kind load docker-image shannon-worker` manually.
    if (getMode() === 'local' && isLocalCluster(this.kc)) {
      console.log('NOTE: For kind/minikube, ensure the worker image is loaded:');
      console.log('  kind load docker-image shannon-worker');
    }
  }

  isTemporalReady(): boolean {
    // K8s API is async — synchronous check returns false, ensureInfra uses async polling
    return false;
  }

  private async isTemporalReadyAsync(): Promise<boolean> {
    try {
      const response = await this.coreApi.listNamespacedPod({
        namespace: NAMESPACE,
        labelSelector: 'app=hightower-temporal',
      });
      return response.items.some((pod) => {
        const conditions = pod.status?.conditions ?? [];
        return conditions.some((c) => c.type === 'Ready' && c.status === 'True');
      });
    } catch {
      return false;
    }
  }

  // === Worker Lifecycle ===

  spawnWorker(opts: WorkerOptions): WorkerHandle {
    const image = this.getWorkerImage(opts.version);
    const jobName = opts.containerName;

    // Build command + args for the worker
    const command = ['node', 'apps/worker/dist/temporal/worker.js', opts.url, opts.repo.containerPath];
    const args: string[] = ['--task-queue', opts.taskQueue, '--workspace', opts.workspace];
    if (opts.config) {
      args.push('--config', opts.config.containerPath);
    }
    if (opts.outputDir) {
      args.push('--output', '/app/output');
    }
    if (opts.pipelineTesting) {
      args.push('--pipeline-testing');
    }

    // Build volume mounts and volumes
    const volumeMounts: k8s.V1VolumeMount[] = [
      { name: 'workspaces', mountPath: '/app/workspaces' },
      { name: 'shm', mountPath: '/dev/shm' },
    ];
    const volumes: k8s.V1Volume[] = [
      {
        name: 'workspaces',
        persistentVolumeClaim: { claimName: 'hightower-workspaces' },
      },
      {
        name: 'shm',
        emptyDir: { medium: 'Memory', sizeLimit: '2Gi' },
      },
    ];

    // Repo volume — hostPath for local clusters, PVC for managed
    if (isLocalCluster(this.kc)) {
      volumes.push({
        name: 'repo',
        hostPath: { path: opts.repo.hostPath, type: 'Directory' },
      });
    } else {
      volumes.push({
        name: 'repo',
        persistentVolumeClaim: { claimName: `hightower-repo-${jobName}` },
      });
    }
    volumeMounts.push({
      name: 'repo',
      mountPath: opts.repo.containerPath,
      readOnly: true,
    });

    // Overlay dirs for deliverables/scratchpad/playwright (writable areas over :ro repo)
    for (const overlay of ['deliverables', 'scratchpad', '.playwright-cli']) {
      const volName = `overlay-${overlay.replace('.', '')}`;
      volumes.push({
        name: volName,
        emptyDir: {},
      });
      volumeMounts.push({
        name: volName,
        mountPath: `${opts.repo.containerPath}/.shannon/${overlay}`,
      });
    }

    // Optional volume mounts
    if (opts.config) {
      // Config would need a ConfigMap — for now, pass via env or mount differently
    }

    // Build env vars from the secret + TEMPORAL_ADDRESS
    const env: k8s.V1EnvVar[] = [{ name: 'TEMPORAL_ADDRESS', value: 'hightower-temporal:7233' }];

    const job: k8s.V1Job = {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: {
        name: jobName,
        namespace: NAMESPACE,
        labels: {
          app: WORKER_LABEL,
          'hightower.io/workspace': opts.workspace,
        },
      },
      spec: {
        backoffLimit: 0,
        ttlSecondsAfterFinished: 3600,
        template: {
          metadata: {
            labels: {
              app: WORKER_LABEL,
              'hightower.io/workspace': opts.workspace,
            },
          },
          spec: {
            restartPolicy: 'Never',
            securityContext: {
              seccompProfile: { type: 'Unconfined' },
            },
            containers: [
              {
                name: 'worker',
                image,
                command,
                args,
                env,
                envFrom: [{ secretRef: { name: 'hightower-credentials' } }],
                volumeMounts,
                resources: {
                  requests: { memory: '2Gi' },
                },
              },
            ],
            volumes,
          },
        },
      },
    };

    // Create the Job asynchronously — errors are reported via the handle
    const createPromise = this.batchApi.createNamespacedJob({ namespace: NAMESPACE, body: job }).then(() => {
      console.log(`Worker job ${jobName} created in namespace ${NAMESPACE}`);
    });

    return new K8sWorkerHandle(jobName, this.batchApi, createPromise);
  }

  stopWorkers(): void {
    // Delete all worker jobs — fire and forget
    this.batchApi
      .deleteCollectionNamespacedJob({
        namespace: NAMESPACE,
        labelSelector: `app=${WORKER_LABEL}`,
        propagationPolicy: 'Background',
      })
      .then(() => {
        console.log('Worker jobs deleted.');
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Failed to stop workers: ${message}`);
      });
  }

  stopInfra(clean: boolean): void {
    if (clean) {
      // Delete the entire namespace (removes everything)
      this.coreApi
        .deleteNamespace({ name: NAMESPACE })
        .then(() => {
          console.log(`Namespace ${NAMESPACE} deleted.`);
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`Failed to delete namespace: ${message}`);
        });
    } else {
      // Just delete the Temporal deployment and services
      this.appsApi.deleteNamespacedDeployment({ name: 'hightower-temporal', namespace: NAMESPACE }).catch(() => {});
      this.coreApi.deleteNamespacedService({ name: 'hightower-temporal', namespace: NAMESPACE }).catch(() => {});
      this.appsApi.deleteNamespacedDeployment({ name: 'hightower-router', namespace: NAMESPACE }).catch(() => {});
      this.coreApi.deleteNamespacedService({ name: 'hightower-router', namespace: NAMESPACE }).catch(() => {});
      console.log('Infrastructure resources deleted.');
    }
  }

  listRunningWorkers(): string {
    // This is called synchronously by the status command — return empty for now,
    // actual implementation needs async refactor of the status command
    return '';
  }

  runEphemeral(image: string, args: string[], mounts: string[]): void {
    // For K8s, run an ephemeral pod and wait for completion
    const podName = `hightower-ephemeral-${Date.now()}`;

    const volumeMounts: k8s.V1VolumeMount[] = [];
    const volumes: k8s.V1Volume[] = [];

    // Parse Docker-style mount strings (src:dst)
    for (let i = 0; i < mounts.length; i++) {
      const mount = mounts[i];
      if (!mount) continue;
      const parts = mount.split(':');
      const dst = parts[1];
      if (parts.length >= 2 && dst) {
        const volName = `vol-${i}`;
        volumeMounts.push({ name: volName, mountPath: dst });
        volumes.push({
          name: volName,
          persistentVolumeClaim: { claimName: 'hightower-workspaces' },
        });
      }
    }

    const pod: k8s.V1Pod = {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: {
        name: podName,
        namespace: NAMESPACE,
      },
      spec: {
        restartPolicy: 'Never',
        containers: [
          {
            name: 'ephemeral',
            image,
            command: args,
            volumeMounts,
            env: [{ name: 'WORKSPACES_DIR', value: '/app/workspaces' }],
          },
        ],
        volumes,
      },
    };

    // Create pod and wait for completion
    this.coreApi
      .createNamespacedPod({ namespace: NAMESPACE, body: pod })
      .then(async () => {
        // Poll for completion
        for (let i = 0; i < 30; i++) {
          const status = await this.coreApi.readNamespacedPod({ name: podName, namespace: NAMESPACE });
          if (status.status?.phase === 'Succeeded' || status.status?.phase === 'Failed') {
            // Read logs
            const log = await this.coreApi.readNamespacedPodLog({ name: podName, namespace: NAMESPACE });
            console.log(log);
            // Clean up
            await this.coreApi.deleteNamespacedPod({ name: podName, namespace: NAMESPACE });
            return;
          }
          await sleep(2000);
        }
        console.error('Timeout waiting for ephemeral pod');
        await this.coreApi.deleteNamespacedPod({ name: podName, namespace: NAMESPACE });
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Failed to run ephemeral pod: ${message}`);
      });
  }

  // === Private Helpers ===

  private async ensureCredentialsSecret(): Promise<void> {
    const envRecord = buildEnvRecord();
    const stringData: Record<string, string> = {};
    for (const [key, value] of Object.entries(envRecord)) {
      if (key !== 'TEMPORAL_ADDRESS') {
        stringData[key] = value;
      }
    }

    const secret: k8s.V1Secret = {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: {
        name: 'hightower-credentials',
        namespace: NAMESPACE,
      },
      stringData,
    };

    try {
      await this.coreApi.replaceNamespacedSecret({
        name: 'hightower-credentials',
        namespace: NAMESPACE,
        body: secret,
      });
    } catch {
      await this.coreApi.createNamespacedSecret({ namespace: NAMESPACE, body: secret });
    }
  }

  private async applyManifest(filename: string): Promise<void> {
    const manifestPath = path.join(K8S_MANIFESTS_DIR, filename);
    const content = fs.readFileSync(manifestPath, 'utf-8');

    // Split multi-document YAML
    const docs = content.split(/^---$/m).filter((doc) => doc.trim());

    for (const doc of docs) {
      await this.applyResource(doc);
    }
  }

  private async applyResource(yamlDoc: string): Promise<void> {
    const objects = k8s.loadAllYaml(yamlDoc) as k8s.KubernetesObject[];
    const objectApi = k8s.KubernetesObjectApi.makeApiClient(this.kc);

    for (const obj of objects) {
      if (!obj || !obj.kind || !obj.metadata?.name) continue;

      // Ensure metadata has required fields for the typed API
      const spec = {
        ...obj,
        metadata: { ...obj.metadata, name: obj.metadata.name },
      };

      try {
        await objectApi.read(spec);
        await objectApi.patch(spec);
      } catch {
        try {
          await objectApi.create(spec);
        } catch (createErr: unknown) {
          const message = createErr instanceof Error ? createErr.message : String(createErr);
          console.error(`Failed to apply ${obj.kind}/${obj.metadata.name}: ${message}`);
        }
      }
    }
  }
}

// === K8sWorkerHandle ===

/** WorkerHandle wrapping a K8s Job. */
class K8sWorkerHandle implements WorkerHandle {
  private errorCallback: ((err: Error) => void) | undefined;

  constructor(
    private readonly jobName: string,
    private readonly batchApi: k8s.BatchV1Api,
    createPromise: Promise<void>,
  ) {
    // Wire up creation errors to the error callback
    createPromise.catch((err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));
      if (this.errorCallback) {
        this.errorCallback(error);
      } else {
        console.error(`Worker job creation failed: ${error.message}`);
      }
    });
  }

  onError(cb: (err: Error) => void): void {
    this.errorCallback = cb;
  }

  kill(): void {
    this.batchApi
      .deleteNamespacedJob({
        name: this.jobName,
        namespace: NAMESPACE,
        propagationPolicy: 'Background',
      })
      .catch(() => {
        // Job may have already completed
      });
  }
}
