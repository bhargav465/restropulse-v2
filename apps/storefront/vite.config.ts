/// <reference types="vitest/config" />
import path from 'path';
import fs from 'fs';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';

function getStorefrontPort(): number {
  try {
    const configPath = path.resolve(__dirname, '../../config/ports.json');
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as { storefront?: number };
    if (typeof parsed.storefront === 'number' && parsed.storefront > 0) {
      return parsed.storefront;
    }
  } catch {
  }

  return 3003;
}

function getApiPort(): number {
  try {
    const configPath = path.resolve(__dirname, '../../config/ports.json');
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as { api?: number };
    if (typeof parsed.api === 'number' && parsed.api > 0) {
      return parsed.api;
    }
  } catch {
  }

  return 3001;
}

const STOREFRONT_PORT = getStorefrontPort();
const API_PORT = getApiPort();

export default defineConfig({
  server: {
    port: STOREFRONT_PORT,
    host: '0.0.0.0',
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true,
      },
    },
  },
  plugins: [tailwindcss(), react()] as any,
  build: {
    sourcemap: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './tests/setup.ts',
    css: true,
    testTimeout: 10000,
    hookTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      exclude: ['node_modules/', 'tests/', '*.config.ts', 'dist/'],
    },
  },
});
