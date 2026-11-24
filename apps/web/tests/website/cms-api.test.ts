import { describe, it, expect, beforeEach, vi } from 'vitest';
import { realCmsAPI } from '../../api';

vi.mock('../../utils/client-config', () => ({
    getClientConfig: vi.fn(() => ({ apiUrl: 'http://localhost:3001/api' })),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

const ok = (data: unknown) => ({ ok: true, json: async () => ({ success: true, data }) });
const call = (i = 0) => {
    const [url, init] = mockFetch.mock.calls[i];
    return { url: url as string, method: (init?.method ?? 'GET') as string, body: init?.body, headers: init?.headers as Record<string, string> };
};

describe('cmsAPI (real client)', () => {
    beforeEach(() => mockFetch.mockReset());

    it('reads and writes the menu', async () => {
        mockFetch.mockResolvedValue(ok([]));
        await realCmsAPI.getCategories();
        expect(call(0)).toMatchObject({ url: 'http://localhost:3001/api/admin/cms/menu/categories', method: 'GET' });

        await realCmsAPI.createCategory({ name: 'Mains' });
        expect(call(1)).toMatchObject({ method: 'POST', body: JSON.stringify({ name: 'Mains' }) });

        await realCmsAPI.updateCategory('c1', { name: 'B' });
        expect(call(2)).toMatchObject({ url: expect.stringContaining('/menu/categories/c1'), method: 'PATCH' });
        await realCmsAPI.deleteCategory('c1');
        expect(call(3).method).toBe('DELETE');
        await realCmsAPI.reorderCategories(['c2', 'c1']);
        expect(call(4)).toMatchObject({ url: expect.stringContaining('/categories/reorder'), method: 'PUT', body: JSON.stringify({ orderedIds: ['c2', 'c1'] }) });

        await realCmsAPI.getItems();
        await realCmsAPI.createItem({ categoryId: 'c1', name: 'Dal', price: 200 });
        await realCmsAPI.updateItem('i1', { price: 210 });
        await realCmsAPI.setAvailability('i1', 'hidden');
        expect(call(8)).toMatchObject({ url: expect.stringContaining('/menu/items/i1/availability'), body: JSON.stringify({ availability: 'hidden' }) });
        await realCmsAPI.deleteItem('i1');
        expect(call(9)).toMatchObject({ url: expect.stringContaining('/menu/items/i1'), method: 'DELETE' });
    });

    it('sends CSV as text/csv', async () => {
        mockFetch.mockResolvedValue(ok({ created: 1, updated: 0, failed: 0, errors: [] }));
        const result = await realCmsAPI.importCsv('category,name,price\nA,B,1');
        expect(result.created).toBe(1);
        expect(call().headers['Content-Type']).toBe('text/csv');
        expect(call().body).toBe('category,name,price\nA,B,1');
    });

    it('reads and writes offers', async () => {
        mockFetch.mockResolvedValue(ok([]));
        await realCmsAPI.getOffers();
        expect(call(0).url).toMatch(/\/admin\/cms\/offers$/);
        await realCmsAPI.getOffers(true);
        expect(call(1).url).toMatch(/offers\?includeArchived=true$/);
        await realCmsAPI.createOffer({ title: 'X', reward: { kind: 'free_delivery' } });
        await realCmsAPI.updateOffer('o1', { status: 'paused' });
        expect(call(3)).toMatchObject({ url: expect.stringContaining('/offers/o1'), method: 'PATCH' });
        await realCmsAPI.deleteOffer('o1');
        expect(call(4).method).toBe('DELETE');
    });

    it('reads, saves, publishes and rolls back site content', async () => {
        mockFetch.mockResolvedValueOnce(ok({ draft: { heroImages: [] }, published: null, publishedVersion: null, publishedAt: null, versions: [] }));
        expect((await realCmsAPI.getContent()).versions).toEqual([]);
        mockFetch.mockResolvedValueOnce(ok({ draft: { heroImages: [], about: 'Hi' } }));
        expect(await realCmsAPI.saveDraft({ heroImages: [], about: 'Hi' })).toEqual({ heroImages: [], about: 'Hi' });
        expect(call(1).method).toBe('PUT');
        mockFetch.mockResolvedValueOnce(ok({ publishedVersion: 2, publishedAt: 'x' }));
        expect((await realCmsAPI.publish()).publishedVersion).toBe(2);
        mockFetch.mockResolvedValueOnce(ok({ publishedVersion: 3, publishedAt: 'y', restoredFrom: 1 }));
        expect((await realCmsAPI.rollback(1)).restoredFrom).toBe(1);
        expect(call(3).body).toBe(JSON.stringify({ version: 1 }));
    });

    it('surfaces the server error message', async () => {
        mockFetch.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ success: false, error: 'Another offer already uses the code X' }) });
        await expect(realCmsAPI.createOffer({ title: 'X', reward: { kind: 'free_delivery' }, code: 'X' })).rejects.toThrow('Another offer already uses the code X');
    });
});
