/**
 * Brief 05 item 3 — PWA manifest/icon presence + gating. The manifest + service
 * worker are wired ONLY when the build sets VITE_ADMIN_SHELL=v2, so default
 * builds stay byte-identical (no SW), and the manifest's scope/start_url inherit
 * Vite's `base` (verified against a real demo build in the CI/manual gate).
 *
 * We assert on the shipped icon assets and the vite config source rather than
 * importing vite.config directly (that pulls esbuild, which is unhappy under
 * jsdom).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const webRoot = path.resolve(__dirname, '..');

describe('PWA manifest & icons (Brief 05 item 3)', () => {
    it('ships the 192 / 512 / maskable / apple-touch icons in public/', () => {
        for (const name of [
            'pwa-192x192.png',
            'pwa-512x512.png',
            'pwa-maskable-512x512.png',
            'apple-touch-icon.png',
        ]) {
            const p = path.join(webRoot, 'public', name);
            expect(fs.existsSync(p), `${name} missing`).toBe(true);
            // Non-trivial PNG payload.
            expect(fs.statSync(p).size).toBeGreaterThan(200);
        }
    });

    it('gates the PWA plugin on VITE_ADMIN_SHELL=v2 with the aubergine manifest', () => {
        const cfg = fs.readFileSync(path.join(webRoot, 'vite.config.ts'), 'utf8');
        expect(cfg).toContain('vite-plugin-pwa');
        expect(cfg).toMatch(/VITE_ADMIN_SHELL === 'v2'/);
        expect(cfg).toContain('registerType: \'autoUpdate\'');
        expect(cfg).toContain("theme_color: '#221833'");
        expect(cfg).toContain("background_color: '#FAF8FF'");
        expect(cfg).toContain('NetworkFirst');
        expect(cfg).toContain('pwa-maskable-512x512.png');
    });

    it('keeps the index.html SW-unregister guard for non-v2 builds', () => {
        const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
        // v2 switches theme + touch icon; everything else unregisters stale SWs.
        expect(html).toMatch(/'%VITE_ADMIN_SHELL%' === 'v2'/);
        expect(html).toContain('registrations[i].unregister()');
    });
});
