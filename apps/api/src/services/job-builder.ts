/**
 * K8s Job spec builder for worker scan Jobs.
 * Constructs a Job that runs the Shannon worker image with the correct
 * volumes, env, and security context. Optionally includes a git clone init container.
 */

import type * as k8s from '@kubernetes/client-node';

export interface JobParams {
  readonly jobName: string;
  readonly namespace: string;
  readonly workerImage: string;
  readonly targetUrl: string;
  readonly taskQueue: string;
  readonly workspace: string;
  readonly credentialsSecretName: string;
  readonly gitUrl?: string;
  readonly gitRef?: string;
  readonly repoPath?: string;
  readonly configYaml?: string;
  readonly pipelineTesting?: boolean;
}

const WORKER_LABEL = 'hightower-worker';
const REPO_MOUNT_PATH = '/repo';

export function buildJobSpec(params: JobParams): k8s.V1Job {
  const repoPath = params.repoPath ?? REPO_MOUNT_PATH;

  // 1. Build worker command
  const command = ['node', 'apps/worker/dist/temporal/worker.js', params.targetUrl, repoPath];
  const args: string[] = [
    '--task-queue',
    params.taskQueue,
    '--workspace',
    params.workspace,
    '--output',
    `/app/workspaces/${params.workspace}/deliverables`,
  ];
  if (params.pipelineTesting) {
    args.push('--pipeline-testing');
  }

  // 2. Build volumes and mounts
  const volumes: k8s.V1Volume[] = [
    { name: 'workspaces', persistentVolumeClaim: { claimName: 'hightower-workspaces' } },
    { name: 'shm', emptyDir: { medium: 'Memory', sizeLimit: '2Gi' } },
  ];

  const volumeMounts: k8s.V1VolumeMount[] = [
    { name: 'workspaces', mountPath: '/app/workspaces' },
    { name: 'shm', mountPath: '/dev/shm' },
  ];

  // Overlay dirs (writable areas over the read-only repo)
  for (const overlay of ['deliverables', 'scratchpad', 'playwright-cli']) {
    const volName = `overlay-${overlay}`;
    volumes.push({ name: volName, emptyDir: {} });
    volumeMounts.push({
      name: volName,
      mountPath: `${repoPath}/.shannon/${overlay === 'playwright-cli' ? '.playwright-cli' : overlay}`,
    });
  }

  // 3. Repo volume — emptyDir for git clone, or PVC sub-path for pre-staged repos
  const initContainers: k8s.V1Container[] = [];

  if (params.gitUrl) {
    // Git clone into an emptyDir
    volumes.push({ name: 'repo', emptyDir: {} });
    volumeMounts.push({ name: 'repo', mountPath: REPO_MOUNT_PATH, readOnly: true });

    const cloneArgs = ['clone', '--depth', '1'];
    if (params.gitRef) {
      cloneArgs.push('--branch', params.gitRef);
    }
    cloneArgs.push(params.gitUrl, REPO_MOUNT_PATH);

    initContainers.push({
      name: 'git-clone',
      image: 'alpine/git:latest',
      command: ['sh', '-c'],
      args: [
        `git clone --depth 1 "${params.gitUrl}" "${REPO_MOUNT_PATH}" && mkdir -p "${REPO_MOUNT_PATH}/.shannon/deliverables" "${REPO_MOUNT_PATH}/.shannon/scratchpad" "${REPO_MOUNT_PATH}/.shannon/.playwright-cli"`,
      ],
      volumeMounts: [{ name: 'repo', mountPath: REPO_MOUNT_PATH }],
    });
  } else if (params.repoPath) {
    // Repo already on a PVC — mount the workspaces PVC (assumes repo is staged there)
    volumeMounts.push({
      name: 'workspaces',
      mountPath: repoPath,
      readOnly: true,
      subPath: `repos/${params.workspace}`,
    });
  }

  // 4. Env vars
  const env: k8s.V1EnvVar[] = [{ name: 'TEMPORAL_ADDRESS', value: 'hightower-temporal:7233' }];

  // 5. Construct the Job
  return {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: {
      name: params.jobName,
      namespace: params.namespace,
      labels: {
        app: WORKER_LABEL,
        'hightower.io/workspace': params.workspace,
        'hightower.io/scan-id': params.jobName,
      },
    },
    spec: {
      backoffLimit: 0,
      ttlSecondsAfterFinished: 3600,
      template: {
        metadata: {
          labels: {
            app: WORKER_LABEL,
            'hightower.io/workspace': params.workspace,
          },
        },
        spec: {
          restartPolicy: 'Never',
          serviceAccountName: 'default',
          securityContext: {
            seccompProfile: { type: 'Unconfined' },
            // Claude Code refuses --allow-dangerously-skip-permissions as root.
            // The worker image creates a "pentest" user (UID/GID 1001) but K8s job specs
            // bypass the entrypoint.sh that normally switches to it. Run as 1001 explicitly.
            // fsGroup gives the pentest group write access to PVC volume mounts.
            runAsUser: 1001,
            runAsGroup: 1001,
            runAsNonRoot: true,
            fsGroup: 1001,
          },
          ...(initContainers.length > 0 && { initContainers }),
          containers: [
            {
              name: 'worker',
              image: params.workerImage,
              command,
              args,
              env,
              envFrom: [{ secretRef: { name: params.credentialsSecretName } }],
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
}
