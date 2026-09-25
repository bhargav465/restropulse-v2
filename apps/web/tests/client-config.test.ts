import { describe, it, expect, vi, beforeEach } from 'vitest';

// Reset the module registry between tests so the module-scoped `config`
// variable in client-config.ts starts fresh (get-before-init behavior).
beforeEach(() => {
    vi.resetModules();
});

describe('client-config', () => {
    it('getClientConfig() throws before initClientConfig() resolves', async () => {
        const { getClientConfig } = await import('../utils/client-config');
        expect(() => getClientConfig()).toThrow(
            'getClientConfig() called before initClientConfig() resolved'
        );
    });

    it('resolves config from /config.json when fetch succeeds', async () => {
        const remoteConfig = {
            apiUrl: 'https://api.staging.example.com/api',
            appUrl: 'https://staging.example.com',
            googleMapsApiKey: 'maps-key',
            razorpayKeyId: 'rzp-key',
            appInsightsConnectionString: 'InstrumentationKey=abc',
            telemetrySampleRate: 50,
            firebase: {
                apiKey: 'fb-api-key',
                authDomain: 'fb-project.firebaseapp.com',
                projectId: 'fb-project',
                storageBucket: 'fb-project.appspot.com',
                messagingSenderId: '111',
                appId: '1:111:web:aaa',
            },
        };

        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(remoteConfig),
        }) as unknown as typeof fetch;

        const { initClientConfig, getClientConfig } = await import('../utils/client-config');
        await initClientConfig();

        expect(getClientConfig()).toEqual(remoteConfig);
    });

    it('falls back to import.meta.env values when the /config.json fetch is not ok', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: false,
            json: () => Promise.resolve({}),
        }) as unknown as typeof fetch;

        const { initClientConfig, getClientConfig } = await import('../utils/client-config');
        await initClientConfig();

        const cfg = getClientConfig();
        expect(cfg.apiUrl).toBe('http://localhost:3001/api');
        expect(cfg.appUrl).toBe('http://localhost:3000');
        expect(cfg.telemetrySampleRate).toBe(100);
        expect(cfg.firebase.projectId).toBeTruthy();
    });

    it('falls back to import.meta.env values when the fetch throws (e.g. local dev, no sidecar file)', async () => {
        global.fetch = vi.fn().mockRejectedValue(new Error('network error')) as unknown as typeof fetch;

        const { initClientConfig, getClientConfig } = await import('../utils/client-config');
        await initClientConfig();

        const cfg = getClientConfig();
        expect(cfg.apiUrl).toBe('http://localhost:3001/api');
    });

    it('falls back to import.meta.env values when the fetch response body is malformed JSON', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.reject(new Error('invalid JSON')),
        }) as unknown as typeof fetch;

        const { initClientConfig, getClientConfig } = await import('../utils/client-config');
        await initClientConfig();

        const cfg = getClientConfig();
        expect(cfg.apiUrl).toBe('http://localhost:3001/api');
    });
});
