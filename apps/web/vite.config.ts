import path from 'path';
import fs from 'fs';
import { defineConfig, loadEnv } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';

function getWebPort(): number {
  try {
    const configPath = path.resolve(__dirname, '../../config/ports.json');
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as { web?: number };
    if (typeof parsed.web === 'number' && parsed.web > 0) {
      return parsed.web;
    }
  } catch {
  }

  return 3000;
}

const WEB_PORT = getWebPort();

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: WEB_PORT,
      host: '0.0.0.0',
      strictPort: true,
    },
    plugins: [tailwindcss(), react()] as any,
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
    },
    build: {
      sourcemap: true,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
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
        exclude: [
          'node_modules/',
          'tests/',
          '*.config.ts',
          'dist/',
          'mockdata/',
          'components/PlacesAutocompleteInput.tsx',
          'firebase.ts'
        ]
      }
    }
  };
});
