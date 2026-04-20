/**
 * K8s Job lifecycle management — create, delete, list worker Jobs.
 */

import type * as k8s from '@kubernetes/client-node';

const WORKER_LABEL = 'hightower-worker';

export async function createJob(batchApi: k8s.BatchV1Api, namespace: string, job: k8s.V1Job): Promise<void> {
  await batchApi.createNamespacedJob({ namespace, body: job });
}

export async function deleteJob(batchApi: k8s.BatchV1Api, namespace: string, name: string): Promise<void> {
  await batchApi.deleteNamespacedJob({
    name,
    namespace,
    propagationPolicy: 'Background',
  });
}

export async function getJob(batchApi: k8s.BatchV1Api, namespace: string, name: string): Promise<k8s.V1Job | null> {
  try {
    return await batchApi.readNamespacedJob({ name, namespace });
  } catch {
    return null;
  }
}

export async function listWorkerJobs(batchApi: k8s.BatchV1Api, namespace: string): Promise<k8s.V1Job[]> {
  const response = await batchApi.listNamespacedJob({
    namespace,
    labelSelector: `app=${WORKER_LABEL}`,
  });
  return response.items;
}
