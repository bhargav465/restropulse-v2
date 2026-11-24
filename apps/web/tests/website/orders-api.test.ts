import { describe, it, expect, beforeEach, vi } from 'vitest';
import { realOrdersAPI } from '../../api';
import { DEFAULT_ORDERING_SETTINGS } from '@restropulse/shared';

vi.mock('../../utils/client-config', () => ({
    getClientConfig: vi.fn(() => ({ apiUrl: 'http://localhost:3001/api' })),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

const ok = (data: unknown) => ({ ok: true, json: async () => ({ success: true, data }) });
const call = (i = 0) => {
    const [url, init] = mockFetch.mock.calls[i];
    return { url: url as string, method: (init?.method ?? 'GET') as string, body: init?.body };
};

describe('ordersAPI (real client)', () => {
    beforeEach(() => mockFetch.mockReset());

    it('reads the feed with and without filters', async () => {
        mockFetch.mockResolvedValue(ok({ orders: [], serverTime: 't' }));
        expect(await realOrdersAPI.getFeed()).toEqual({ orders: [], serverTime: 't' });
        expect(call(0).url).toBe('http://localhost:3001/api/admin/orders');
        await realOrdersAPI.getFeed({ status: 'active', since: '2026-11-24T10:00:00.000Z', limit: 20 });
        expect(call(1).url).toBe('http://localhost:3001/api/admin/orders?status=active&since=2026-11-24T10%3A00%3A00.000Z&limit=20');
    });

    it('moves, cancels and reads one order', async () => {
        mockFetch.mockResolvedValue(ok({ id: 'o1' }));
        await realOrdersAPI.getOrder('o1');
        expect(call(0).url).toContain('/admin/orders/o1');
        await realOrdersAPI.setStatus('o1', 'PREPARING');
        expect(call(1)).toMatchObject({ url: expect.stringContaining('/admin/orders/o1/status'), method: 'POST', body: JSON.stringify({ to: 'PREPARING' }) });
        await realOrdersAPI.setStatus('o1', 'READY', 'Packed');
        expect(call(2).body).toBe(JSON.stringify({ to: 'READY', note: 'Packed' }));
        await realOrdersAPI.cancel('o1', 'Out of rice');
        expect(call(3)).toMatchObject({ url: expect.stringContaining('/o1/cancel'), body: JSON.stringify({ reason: 'Out of rice', refund: true }) });
        await realOrdersAPI.cancel('o1', 'x', false);
        expect(call(4).body).toBe(JSON.stringify({ reason: 'x', refund: false }));
    });

    it('reads and saves settings', async () => {
        mockFetch.mockResolvedValue(ok({ slug: 'a' }));
        await realOrdersAPI.getSettings();
        expect(call(0).url).toContain('/admin/orders/settings');
        await realOrdersAPI.saveSettings({ slug: 'abc', ordering: DEFAULT_ORDERING_SETTINGS });
        expect(call(1)).toMatchObject({ method: 'PUT', body: JSON.stringify({ slug: 'abc', ordering: DEFAULT_ORDERING_SETTINGS }) });
    });

    it('surfaces the server error message', async () => {
        mockFetch.mockResolvedValue({ ok: false, status: 409, json: async () => ({ success: false, error: 'That web address is taken. Try another.' }) });
        await expect(realOrdersAPI.saveSettings({ slug: 'x', ordering: DEFAULT_ORDERING_SETTINGS })).rejects.toThrow('That web address is taken. Try another.');
    });
});

describe('sitesAPI (real client)', () => {
    beforeEach(() => mockFetch.mockReset());

    it('reads the site and manages domains', async () => {
        const { realSitesAPI } = await import('../../api');
        mockFetch.mockResolvedValue(ok({ id: 'd1' }));
        await realSitesAPI.getSite();
        expect(call(0).url).toBe('http://localhost:3001/api/admin/sites');
        await realSitesAPI.addDomain('www.a.in');
        expect(call(1)).toMatchObject({ url: 'http://localhost:3001/api/admin/sites/domains', method: 'POST', body: JSON.stringify({ hostname: 'www.a.in' }) });
        await realSitesAPI.verifyDomain('d1');
        expect(call(2)).toMatchObject({ url: 'http://localhost:3001/api/admin/sites/domains/d1/verify', method: 'POST' });
        await realSitesAPI.removeDomain('d1');
        expect(call(3)).toMatchObject({ url: 'http://localhost:3001/api/admin/sites/domains/d1', method: 'DELETE' });
    });

    it('talks to the rider dispatch routes', async () => {
        const { realDeliveryAPI } = await import('../../api');
        mockFetch.mockResolvedValue(ok({ shipment: null, queued: null, lastError: null }));
        await realDeliveryAPI.getSettings();
        expect(call(0).url).toBe('http://localhost:3001/api/admin/delivery/settings');
        const settings = { dispatchEnabled: true, dispatchAt: 'READY' as const, strategy: 'preferred' as const, providers: ['self' as const] };
        await realDeliveryAPI.saveSettings(settings);
        expect(call(1)).toMatchObject({ method: 'PUT', body: JSON.stringify(settings) });
        await realDeliveryAPI.getRider('o1');
        expect(call(2).url).toBe('http://localhost:3001/api/admin/delivery/orders/o1');
        await realDeliveryAPI.findRider('o1');
        expect(call(3)).toMatchObject({ url: 'http://localhost:3001/api/admin/delivery/orders/o1/dispatch', method: 'POST' });
        await realDeliveryAPI.useOwnRider('o1');
        expect(call(4)).toMatchObject({ url: 'http://localhost:3001/api/admin/delivery/orders/o1/own-rider', method: 'POST' });
        await realDeliveryAPI.updateOwnRider('o1', { status: 'PICKED_UP' });
        expect(call(5)).toMatchObject({ url: 'http://localhost:3001/api/admin/delivery/orders/o1/rider', method: 'POST', body: JSON.stringify({ status: 'PICKED_UP' }) });
        await realDeliveryAPI.cancelRider('o1', 'Customer will collect');
        expect(call(6)).toMatchObject({ url: 'http://localhost:3001/api/admin/delivery/orders/o1/cancel', method: 'POST', body: JSON.stringify({ reason: 'Customer will collect' }) });
    });
});
