/**
 * Backend detection — Docker (default) vs Kubernetes.
 *
 * Orthogonal to the local/npx mode axis. Mode controls where state lives
 * and where the image comes from. Backend controls how containers are orchestrated.
 */

import type { Orchestrator } from './orchestrator.js';

export type Backend = 'docker' | 'k8s';

let cachedBackend: Backend | undefined;
let cachedOrchestrator: Orchestrator | undefined;

/**
 * Detect the orchestration backend.
 * SHANNON_BACKEND env var takes precedence, otherwise defaults to docker.
 */
export function getBackend(): Backend {
  if (cachedBackend !== undefined) return cachedBackend;

  const env = process.env.SHANNON_BACKEND;
  if (env === 'k8s' || env === 'kubernetes') {
    cachedBackend = 'k8s';
  } else {
    cachedBackend = 'docker';
  }
  return cachedBackend;
}

export function setBackend(backend: Backend): void {
  cachedBackend = backend;
  cachedOrchestrator = undefined;
}

/**
 * Get the orchestrator for the current backend.
 * Lazy-loads the implementation to avoid importing unused dependencies.
 */
export async function getOrchestrator(): Promise<Orchestrator> {
  if (cachedOrchestrator) return cachedOrchestrator;

  let orchestrator: Orchestrator;
  if (getBackend() === 'k8s') {
    const { K8sOrchestrator } = await import('./k8s.js');
    orchestrator = new K8sOrchestrator();
  } else {
    const { DockerOrchestrator } = await import('./docker.js');
    orchestrator = new DockerOrchestrator();
  }

  cachedOrchestrator = orchestrator;
  return orchestrator;
}
