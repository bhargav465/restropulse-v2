import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        setupFiles: ['./tests/setup.ts'],
        include: ['tests/**/*.test.ts'],
        exclude: ['node_modules', 'dist'],
        testTimeout: 20000,
        hookTimeout: 60000,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov', 'html'],
            // The publisher's own src/ is only the process entry point
            // (worker.ts, instrument.ts). The logic it runs lives in
            // @restropulse/publishing, which these tests import from its
            // built dist/. allowExternal plus the source maps in dist/ let v8
            // attribute that coverage back to packages/publishing/src/*.ts.
            allowExternal: true,
            include: ['**/packages/publishing/src/**/*.ts', '**/packages/publishing/dist/**/*.js'],
            exclude: ['node_modules/', 'tests/', '**/*.d.ts']
        }
    }
});
