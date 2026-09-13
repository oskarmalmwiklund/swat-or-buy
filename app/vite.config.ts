import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: { chunkSizeWarningLimit: 800, target: 'es2022' },
  worker: { format: 'es' },
  test: { include: ['src/**/*.test.ts'], testTimeout: 120_000 },
});
