import { describe, it, expect, beforeEach } from 'vitest';
import { cmsAPI, resetDemoCms } from '../../demo-api-cms';

describe('cmsAPI demo twin', () => {
    beforeEach(() => resetDemoCms());

    it('serves a sample catalog and supports category CRUD', async () => {
        const cats = await cmsAPI.getCategories();
        expect(cats.map((c) => c.name)).toEqual(['[SAMPLE] Starters', '[SAMPLE] Mains', '[SAMPLE] Desserts']);
        const added = await cmsAPI.createCategory({ name: 'Drinks' });
        expect(added.sortOrder).toBe(4);
        expect((await cmsAPI.updateCategory(added.id, { name: 'Beverages' })).name).toBe('Beverages');
        await expect(cmsAPI.updateCategory('nope', { name: 'x' })).rejects.toThrow('Category not found');
        await expect(cmsAPI.deleteCategory('demo-cat-1')).rejects.toThrow(/Move or delete/);
        await cmsAPI.deleteCategory(added.id);
        const reordered = await cmsAPI.reorderCategories(['demo-cat-3', 'demo-cat-1', 'demo-cat-2']);
        expect(reordered[0].id).toBe('demo-cat-3');
    });

    it('supports item CRUD with option ids and duplicate names rejected', async () => {
        const item = await cmsAPI.createItem({ categoryId: 'demo-cat-1', name: 'Samosa', price: 40, variants: [{ name: 'Two', price: 70 }], addons: [{ name: 'Chutney', price: 5 }] });
        expect(item.variants?.[0].id).toBeTruthy();
        expect(item.addons?.[0].id).toBeTruthy();
        await expect(cmsAPI.createItem({ categoryId: 'demo-cat-1', name: 'Samosa', price: 1 })).rejects.toThrow(/already exists/);
        const updated = await cmsAPI.updateItem(item.id, { price: 45, variants: [{ name: 'Four', price: 130 }], addons: [] });
        expect(updated.price).toBe(45);
        expect(updated.variants?.[0].name).toBe('Four');
        expect((await cmsAPI.setAvailability(item.id, 'hidden')).availability).toBe('hidden');
        await expect(cmsAPI.updateItem('nope', {})).rejects.toThrow('Menu item not found');
        await cmsAPI.deleteItem(item.id);
        expect((await cmsAPI.getItems()).some((i) => i.id === item.id)).toBe(false);
    });

    it('imports simple CSV rows', async () => {
        const result = await cmsAPI.importCsv('category,name,price\n[SAMPLE] Mains,Dal Makhani,270\nDrinks,Chai,20\nDrinks,,5');
        expect(result).toMatchObject({ created: 1, updated: 1, failed: 1 });
        expect(result.errors[0].row).toBe(4);
        await expect(cmsAPI.importCsv('name,price\nA,1')).rejects.toThrow(/category, name and price/);
    });

    it('manages offers with summaries and nullable schedule parts', async () => {
        const offers = await cmsAPI.getOffers();
        expect(offers[0].summary).toContain('Code LUNCH15');
        const created = await cmsAPI.createOffer({
            title: 'Diwali', reward: { kind: 'flat_off', amount: 100 }, code: 'diwali', minOrderValue: 500, description: 'Festive',
            schedule: { startsAt: '2026-11-01', endsAt: '2026-11-10' },
        });
        expect(created.code).toBe('DIWALI');
        expect(created.status).toBe('draft');
        const updated = await cmsAPI.updateOffer(created.id, {
            status: 'archived', code: null, description: null, minOrderValue: null, bannerImage: null, schedule: { endsAt: null },
        });
        expect(updated).toMatchObject({ status: 'archived' });
        expect(updated.code).toBeUndefined();
        expect(updated.schedule.endsAt).toBeUndefined();
        expect((await cmsAPI.getOffers()).some((o) => o.id === created.id)).toBe(false);
        expect((await cmsAPI.getOffers(true)).some((o) => o.id === created.id)).toBe(true);
        await expect(cmsAPI.updateOffer('nope', {})).rejects.toThrow('Offer not found');
        await cmsAPI.deleteOffer(created.id);
        expect((await cmsAPI.getOffers(true)).length).toBe(2);
    });

    it('saves, publishes and rolls back site content', async () => {
        const start = await cmsAPI.getContent();
        expect(start.publishedVersion).toBe(1);
        await cmsAPI.saveDraft({ ...start.draft, tagline: 'New tagline' });
        const published = await cmsAPI.publish();
        expect(published.publishedVersion).toBe(2);
        const after = await cmsAPI.getContent();
        expect(after.published?.tagline).toBe('New tagline');
        expect(after.versions.map((v) => v.version)).toEqual([2, 1]);
        const rolled = await cmsAPI.rollback(1);
        expect(rolled).toMatchObject({ publishedVersion: 3, restoredFrom: 1 });
        expect((await cmsAPI.getContent()).draft.tagline).toBe(start.draft.tagline);
        await expect(cmsAPI.rollback(99)).rejects.toThrow('That version not found');
    });
});
