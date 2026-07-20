/// <reference types="vitest/config" />
import path from 'path';
import fs from 'fs';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

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
  plugins: [
    tailwindcss(),
    react(),
    // Progressive Web App: installable ordering site with an offline app shell.
    // Menu/config responses are network-first (fresh when online, cached when
    // not); dish images are cache-first. Payments and order placement are
    // never cached (POSTs bypass the service worker by default).
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'RestroPulse — Order Online',
        short_name: 'Order Online',
        description: 'Order food online — delivery, pickup and table reservations.',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#ea580c',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            urlPattern: /\/api\/storefront\/[^/]+\/(config|menu|content)/,
            handler: 'NetworkFirst',
            options: { cacheName: 'storefront-data', networkTimeoutSeconds: 4, expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 } },
          },
          {
            urlPattern: /^https:\/\/images\.unsplash\.com\/.*/,
            handler: 'CacheFirst',
            options: { cacheName: 'dish-images', expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
          {
            urlPattern: /\/api\/assets\/.*/,
            handler: 'CacheFirst',
            options: { cacheName: 'uploaded-images', expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
        ],
      },
    }),
  ] as any,
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
