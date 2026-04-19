/**
 * Environment-driven configuration for the API server.
 * Parsed once at startup — missing required values cause a hard exit.
 */

export interface Config {
  readonly port: number;
  readonly temporalAddress: string;
  readonly apiKey: string;
  readonly k8sNamespace: string;
  readonly workerImage: string;
  readonly workspacesDir: string;
  readonly credentialsSecretName: string;
}

export function loadConfig(): Config {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    console.error('ERROR: API_KEY environment variable is required');
    process.exit(1);
  }

  const workerImage = process.env.WORKER_IMAGE;
  if (!workerImage) {
    console.error('ERROR: WORKER_IMAGE environment variable is required');
    process.exit(1);
  }

  return {
    port: Number(process.env.PORT) || 3000,
    temporalAddress: process.env.TEMPORAL_ADDRESS || 'shannon-temporal:7233',
    apiKey,
    k8sNamespace: process.env.K8S_NAMESPACE || 'shannon',
    workerImage,
    workspacesDir: process.env.WORKSPACES_DIR || '/app/workspaces',
    credentialsSecretName: process.env.CREDENTIALS_SECRET_NAME || 'shannon-credentials',
  };
}
