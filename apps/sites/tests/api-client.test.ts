import { describe, it, expect, vi } from 'vitest';
import { ApiUnavailableError, createApiClient } from '../src/api-client.js';

const ok = (data: unknown) => ({ status: 200, ok: true, json: async () => ({ success: true, data }) });

describe('api client', () => {
    it('fetches, caches for the TTL and refetches after', async () => {
        let t = 0;
        const fetchImpl = vi.fn(async () => ok({ restaurant: { slug: 'bawarchi' } }));
        const api = createApiClient({ apiUrl: 'http://api', ttlMs: 1000, fetchImpl, now: () => t });
        await api.getConfig('bawarchi');
        await api.getConfig('bawarchi');
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(fetchImpl.mock.calls[0][0]).toBe('http://api/api/storefront/bawarchi');
        t = 1001;
        await api.getConfig('bawarchi');
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        api.clear();
        await api.getConfig('bawarchi');
        expect(fetchImpl).toHaveBeenCalledTimes(3);
    });

    it('menu and resolve use their endpoints', async () => {
        const fetchImpl = vi.fn(async (url: string) => (url.includes('resolve') ? ok({ slug: 'bawarchi' }) : ok({ items: [] })));
        const api = createApiClient({ apiUrl: 'http://api', ttlMs: 1000, fetchImpl });
        expect(await api.getMenu('bawarchi')).toEqual({ items: [] });
        expect(await api.resolveHost('www.b.in')).toBe('bawarchi');
        expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual(['http://api/api/storefront/bawarchi/menu', 'http://api/api/sites/resolve?host=www.b.in']);
    });

    it('a 404 is null and briefly cached', async () => {
        let t = 0;
        const fetchImpl = vi.fn(async () => ({ status: 404, ok: false, json: async () => ({}) }));
        const api = createApiClient({ apiUrl: 'http://api', ttlMs: 60_000, fetchImpl, now: () => t });
        expect(await api.resolveHost('x.in')).toBeNull();
        expect(await api.resolveHost('x.in')).toBeNull();
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        t = 30_001;
        await api.resolveHost('x.in');
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('errors throw ApiUnavailableError, but a stale answer wins', async () => {
        let t = 0;
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(ok({ restaurant: { slug: 'b' } }))
            .mockResolvedValueOnce({ status: 500, ok: false, json: async () => ({}) });
        const api = createApiClient({ apiUrl: 'http://api', ttlMs: 10, fetchImpl, now: () => t });
        await api.getConfig('bawarchi');
        t = 20;
        expect(await api.getConfig('bawarchi')).toEqual({ restaurant: { slug: 'b' } });

        const failing = createApiClient({ apiUrl: 'http://api', ttlMs: 10, fetchImpl: vi.fn().mockResolvedValue({ status: 502, ok: false, json: async () => ({}) }) });
        await expect(failing.getConfig('x')).rejects.toBeInstanceOf(ApiUnavailableError);
        const network = createApiClient({ apiUrl: 'http://api', ttlMs: 10, fetchImpl: vi.fn().mockRejectedValue(new TypeError('fetch failed')) });
        await expect(network.getMenu('x')).rejects.toThrow('fetch failed');
        const noData = createApiClient({ apiUrl: 'http://api', ttlMs: 10, fetchImpl: vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => ({ success: false }) }) });
        await expect(noData.getMenu('x')).rejects.toThrow('without data');
        const emptyData = createApiClient({ apiUrl: 'http://api', ttlMs: 10, fetchImpl: vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => ({ success: true }) }) });
        expect(await emptyData.getMenu('x')).toBeNull();
    });

    it('caps the cache size', async () => {
        const fetchImpl = vi.fn(async () => ok({ slug: 's' }));
        const api = createApiClient({ apiUrl: 'http://api', ttlMs: 60_000, fetchImpl });
        for (let i = 0; i < 1001; i++) await api.resolveHost(`h${i}.in`);
        await api.resolveHost('h0.in');
        expect(fetchImpl).toHaveBeenCalledTimes(1002);
    });

    it('uses global fetch by default', async () => {
        const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: true, data: { slug: 'z' } }), { status: 200 }));
        const api = createApiClient({ apiUrl: 'http://api', ttlMs: 10 });
        expect(await api.resolveHost('z.in')).toBe('z');
        spy.mockRestore();
    });
});
