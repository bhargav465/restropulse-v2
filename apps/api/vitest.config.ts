import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        setupFiles: ['./tests/setup.ts'],
        include: ['tests/**/*.test.ts'],
        exclude: ['node_modules', 'dist'],
        testTimeout: 10000,
        hookTimeout: 60000, // For MongoDB memory server startup
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov', 'html'],
            exclude: [
                'node_modules/',
                'dist/',
                'tests/',
                'src/**/*.d.ts',
                'src/server.ts'
            ]
        }
    }
});
