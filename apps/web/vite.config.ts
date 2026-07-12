import path from 'path';
import fs from 'fs';
import { defineConfig, loadEnv } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

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
  // PWA is scoped to the v2 admin shell only (Brief 05 item 3). Default builds
  // (VITE_ADMIN_SHELL unset) get no service worker or manifest, so existing
  // users stay byte-identical and the index.html "unregister stale SW" guard
  // keeps running. scope/start_url inherit Vite's `base` (e.g. /admin-v2/), so
  // the GitHub Pages sub-path + 404.html SPA trick keep working. Raw hex is
  // allowed here — manifest/config are not components.
  const pwaEnabled = env.VITE_ADMIN_SHELL === 'v2';
  const pwaPlugins = pwaEnabled
    ? [
        VitePWA({
          registerType: 'autoUpdate',
          injectRegister: 'auto',
          includeAssets: ['apple-touch-icon.png', 'favicon-64x64.png'],
          manifest: {
            name: 'RestroPulse Admin',
            short_name: 'RestroPulse',
            description: 'Run your restaurant — content, ordering and insights in one app.',
            display: 'standalone',
            orientation: 'portrait',
            theme_color: '#221833',
            background_color: '#FAF8FF',
            icons: [
              { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
              { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
              { src: 'pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            ],
          },
          workbox: {
            // Precache the app shell so it opens offline (no white screen).
            globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
            navigateFallback: 'index.html',
            navigateFallbackDenylist: [/\/api\//],
            runtimeCaching: [
              {
                // NetworkFirst for API reads with a short TTL. Workbox only
                // caches GET, so POST/PUT are never cached.
                urlPattern: ({ url }: { url: URL }) => url.pathname.includes('/api/'),
                handler: 'NetworkFirst',
                options: {
                  cacheName: 'rp-api',
                  networkTimeoutSeconds: 5,
                  expiration: { maxEntries: 60, maxAgeSeconds: 300 },
                  cacheableResponse: { statuses: [0, 200] },
                },
              },
            ],
          },
        }),
      ]
    : [];
  return {
    server: {
      port: WEB_PORT,
      host: '0.0.0.0',
      strictPort: true,
    },
    plugins: [tailwindcss(), react(), ...pwaPlugins] as any,
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
