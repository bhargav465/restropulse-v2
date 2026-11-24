import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Process entry points: wiring only, exercised by running the worker.
      exclude: ['src/worker.ts', 'src/instrument.ts'],
      reporter: ['text', 'json-summary'],
      thresholds: { lines: 85, functions: 85, branches: 80, statements: 85 },
    },
  },
});
