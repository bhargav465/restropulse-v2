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
            // Every module under src/ counts, tested or not, so a new file
            // without tests lowers the number. The three process entry points
            // (cron wiring, OTel bootstrap, one-shot CLI) are excluded.
            include: ['src/**/*.ts'],
            exclude: ['node_modules/', 'dist/', 'tests/', 'src/worker.ts', 'src/instrument.ts', 'src/cli.ts']
        }
    }
});
