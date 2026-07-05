import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/suites/**/*.test.ts'],
    testTimeout: 60000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      '@restropulse/shared': resolve('./packages/shared/src/index.ts'),
      '@restropulse/db': resolve('./packages/db/src/index.ts'),
      '@restropulse/publishing': resolve('./packages/publishing/src/index.ts'),
    },
  },
});
