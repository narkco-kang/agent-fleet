import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // 固定 root 到 modelgateway 目录，确保从 monorepo 根运行
  // `vitest run --config modelgateway/vitest.config.ts` 也能正确发现 tests/**
  root: __dirname,
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      '@agentfleet/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
});
