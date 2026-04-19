import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  target: 'node18',
  outDir: 'dist',
  clean: true,
  deps: { neverBundle: ['@clack/prompts', 'dotenv', 'smol-toml', '@kubernetes/client-node'] },
  banner: { js: '#!/usr/bin/env node' },
});
