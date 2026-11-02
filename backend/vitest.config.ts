import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15000,
    hookTimeout: 15000,
  },
  resolve: {
    alias: {
      '@agentfleet/shared': path.resolve(__dirname, '../shared/src/index.ts'),
      '@agentfleet/memory': path.resolve(__dirname, '../memory/src/index.ts'),
    },
  },
});
