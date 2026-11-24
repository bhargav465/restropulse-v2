import { describe, test, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// ----- @restropulse/db mocks (only the CMS helpers the router uses) -----
const db = {
    countMenuItemsInCategory: vi.fn(),
    deleteMenuCategory: vi.fn(),
    deleteMenuItem: vi.fn(),
    deleteOffer: vi.fn(),
    findMenuCategories: vi.fn(),
    findMenuCategoryById: vi.fn(),
    findMenuItemById: vi.fn(),
    findMenuItems: vi.fn(),
    findOfferById: vi.fn(),
    findOffers: vi.fn(),
    findStorefrontContent: vi.fn(),
    insertMenuCategory: vi.fn(),
    insertMenuItem: vi.fn(),
    insertOffer: vi.fn(),
    refreshMenuProjection: vi.fn(),
    reorderMenuCategories: vi.fn(),
    reorderMenuItems: vi.fn(),
    saveStorefrontDraft: vi.fn(),
    saveStorefrontPublish: vi.fn(),
    setMenuItemAvailability: vi.fn(),
    updateMenuCategory: vi.fn(),
    updateMenuItem: vi.fn(),
    updateOffer: vi.fn(),
    upsertMenuItemByName: vi.fn(),
};

class DuplicateMenuItemNameError extends Error {}
class DuplicateOfferCodeError extends Error {}

vi.mock('@restropulse/db', async (importOriginal) => {
    const actual = await importOriginal() as Record<string, unknown>;
    return { ...actual, ...db, DuplicateMenuItemNameError, DuplicateOfferCodeError };
});

vi.mock('@restropulse/telemetry/server', () => {
    const noop = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    return { createLogger: vi.fn(() => noop), trackEvent: vi.fn() };
});

const { generateTokens } = await import('../../src/services/jwt.js');
const { default: adminCmsRoutes } = await import('../../src/routes/admin-cms.js');

const app = express();
app.use(express.json());
app.use('/api/admin/cms', adminCmsRoutes);
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ success: false, error: err.message });
});

const token = (role: 'OWNER' | 'MANAGER' | 'ADMIN' = 'OWNER') => `Bearer ${generateTokens('u1', '+910000000000', 'r1', role).accessToken}`;
const owner = token('OWNER');

const category = { id: 'c1', restaurantId: 'r1', name: 'Starters', sortOrder: 1 };
const menuItem = { id: 'i1', restaurantId: 'r1', categoryId: 'c1', name: 'Samosa', price: 40, isVeg: true, availability: 'in_stock', sortOrder: 1 };
const offer = {
    id: 'o1', restaurantId: 'r1', title: 'Lunch', reward: { kind: 'percent_off', percent: 10 }, scope: { kind: 'all' },
    schedule: { startsAt: '2026-01-01T00:00:00.000Z' }, showOnSite: true, promoteInContent: true, status: 'active',
};

beforeEach(() => {
    vi.clearAllMocks();
    db.findMenuCategories.mockResolvedValue([category]);
    db.findMenuCategoryById.mockResolvedValue(category);
    db.findMenuItems.mockResolvedValue([menuItem]);
    db.refreshMenuProjection.mockResolvedValue(1);
});

describe('auth', () => {
    test('rejects missing token and platform admins', async () => {
        expect((await request(app).get('/api/admin/cms/menu/categories')).status).toBe(401);
        expect((await request(app).get('/api/admin/cms/menu/categories').set('Authorization', token('ADMIN'))).status).toBe(403);
    });

    test('lets managers in', async () => {
        const res = await request(app).get('/api/admin/cms/menu/categories').set('Authorization', token('MANAGER'));
        expect(res.status).toBe(200);
        expect(db.findMenuCategories).toHaveBeenCalledWith('r1');
    });
});

describe('categories', () => {
    test('creates with the next sort order', async () => {
        db.insertMenuCategory.mockResolvedValue({ ...category, id: 'c2', name: 'Mains', sortOrder: 2 });
        const res = await request(app).post('/api/admin/cms/menu/categories').set('Authorization', owner).send({ name: '  Mains ', extra: 'x' });
        expect(res.status).toBe(201);
        expect(db.insertMenuCategory).toHaveBeenCalledWith('r1', { name: 'Mains', sortOrder: 2 });
    });

    test('keeps an explicit sort order and description', async () => {
        db.insertMenuCategory.mockResolvedValue(category);
        await request(app).post('/api/admin/cms/menu/categories').set('Authorization', owner).send({ name: 'Mains', description: 'Big plates', sortOrder: 5 });
        expect(db.insertMenuCategory).toHaveBeenCalledWith('r1', { name: 'Mains', description: 'Big plates', sortOrder: 5 });
    });

    test('validates the name', async () => {
        const res = await request(app).post('/api/admin/cms/menu/categories').set('Authorization', owner).send({ name: ' ' });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Category name is required.');
    });

    test('updates and re-projects; 404 when missing; rejects empty patch', async () => {
        db.updateMenuCategory.mockResolvedValueOnce({ ...category, name: 'Snacks' });
        const ok = await request(app).patch('/api/admin/cms/menu/categories/c1').set('Authorization', owner).send({ name: 'Snacks' });
        expect(ok.status).toBe(200);
        expect(db.refreshMenuProjection).toHaveBeenCalledWith('r1');

        db.updateMenuCategory.mockResolvedValueOnce(null);
        expect((await request(app).patch('/api/admin/cms/menu/categories/zz').set('Authorization', owner).send({ name: 'X' })).status).toBe(404);
        expect((await request(app).patch('/api/admin/cms/menu/categories/c1').set('Authorization', owner).send({})).body.error).toBe('Nothing to update.');
    });

    test('refuses to delete a non-empty category', async () => {
        db.countMenuItemsInCategory.mockResolvedValue(3);
        const res = await request(app).delete('/api/admin/cms/menu/categories/c1').set('Authorization', owner);
        expect(res.status).toBe(409);
        expect(db.deleteMenuCategory).not.toHaveBeenCalled();
    });

    test('deletes an empty category; 404 for unknown', async () => {
        db.countMenuItemsInCategory.mockResolvedValue(0);
        expect((await request(app).delete('/api/admin/cms/menu/categories/c1').set('Authorization', owner)).status).toBe(200);
        expect(db.deleteMenuCategory).toHaveBeenCalledWith('r1', 'c1');
        db.findMenuCategoryById.mockResolvedValueOnce(null);
        expect((await request(app).delete('/api/admin/cms/menu/categories/zz').set('Authorization', owner)).status).toBe(404);
    });

    test('reorders (and is not captured by /:id)', async () => {
        const res = await request(app).put('/api/admin/cms/menu/categories/reorder').set('Authorization', owner).send({ orderedIds: ['c2', 'c1'] });
        expect(res.status).toBe(200);
        expect(db.reorderMenuCategories).toHaveBeenCalledWith('r1', ['c2', 'c1']);
        expect(db.updateMenuCategory).not.toHaveBeenCalled();
        const dup = await request(app).put('/api/admin/cms/menu/categories/reorder').set('Authorization', owner).send({ orderedIds: ['c1', 'c1'] });
        expect(dup.body.error).toBe('orderedIds has duplicates.');
    });
});

describe('items', () => {
    test('lists including hidden', async () => {
        await request(app).get('/api/admin/cms/menu/items').set('Authorization', owner);
        expect(db.findMenuItems).toHaveBeenCalledWith('r1', { includeHidden: true });
    });

    test('creates with defaults and option ids', async () => {
        db.insertMenuItem.mockResolvedValue(menuItem);
        const res = await request(app).post('/api/admin/cms/menu/items').set('Authorization', owner).send({
            categoryId: 'c1', name: 'Samosa', price: '40', variants: [{ name: 'Two', price: 70 }],
        });
        expect(res.status).toBe(201);
        const [, input] = db.insertMenuItem.mock.calls[0];
        expect(input).toMatchObject({ categoryId: 'c1', name: 'Samosa', price: 40, isVeg: false, availability: 'in_stock', images: [], addons: [], sortOrder: 0 });
        expect(input.variants[0]).toMatchObject({ name: 'Two', price: 70, id: expect.any(String) });
        expect(db.refreshMenuProjection).toHaveBeenCalledWith('r1');
    });

    test('rejects unknown category, bad price, http images, duplicate names', async () => {
        db.findMenuCategoryById.mockResolvedValueOnce(null);
        expect((await request(app).post('/api/admin/cms/menu/items').set('Authorization', owner).send({ categoryId: 'zz', name: 'A', price: 1 })).status).toBe(400);
        expect((await request(app).post('/api/admin/cms/menu/items').set('Authorization', owner).send({ categoryId: 'c1', name: 'A', price: -1 })).body.error)
            .toBe("Price can't be negative.");
        expect((await request(app).post('/api/admin/cms/menu/items').set('Authorization', owner).send({ categoryId: 'c1', name: 'A', price: 1, images: ['http://x'] })).body.error)
            .toBe('Links and images must start with https://');
        db.insertMenuItem.mockRejectedValueOnce(new DuplicateMenuItemNameError('A'));
        expect((await request(app).post('/api/admin/cms/menu/items').set('Authorization', owner).send({ categoryId: 'c1', name: 'A', price: 1 })).status).toBe(409);
    });

    test('surfaces unexpected errors as 500', async () => {
        db.insertMenuItem.mockRejectedValueOnce(new Error('boom'));
        expect((await request(app).post('/api/admin/cms/menu/items').set('Authorization', owner).send({ categoryId: 'c1', name: 'A', price: 1 })).status).toBe(500);
    });

    test('updates, checks category, maps duplicates and missing', async () => {
        db.updateMenuItem.mockResolvedValueOnce({ ...menuItem, price: 45 });
        expect((await request(app).patch('/api/admin/cms/menu/items/i1').set('Authorization', owner).send({ price: 45 })).status).toBe(200);
        expect(db.updateMenuItem).toHaveBeenCalledWith('r1', 'i1', { price: 45 });

        db.findMenuCategoryById.mockResolvedValueOnce(null);
        expect((await request(app).patch('/api/admin/cms/menu/items/i1').set('Authorization', owner).send({ categoryId: 'zz' })).status).toBe(400);

        db.updateMenuItem.mockRejectedValueOnce(new DuplicateMenuItemNameError('B'));
        expect((await request(app).patch('/api/admin/cms/menu/items/i1').set('Authorization', owner).send({ name: 'B' })).status).toBe(409);

        db.updateMenuItem.mockResolvedValueOnce(null);
        expect((await request(app).patch('/api/admin/cms/menu/items/zz').set('Authorization', owner).send({ name: 'C' })).status).toBe(404);

        db.updateMenuItem.mockRejectedValueOnce(new Error('boom'));
        expect((await request(app).patch('/api/admin/cms/menu/items/i1').set('Authorization', owner).send({ name: 'D' })).status).toBe(500);
    });

    test('toggles availability', async () => {
        db.setMenuItemAvailability.mockResolvedValueOnce({ ...menuItem, availability: 'out_of_stock' });
        expect((await request(app).patch('/api/admin/cms/menu/items/i1/availability').set('Authorization', owner).send({ availability: 'out_of_stock' })).status).toBe(200);
        expect((await request(app).patch('/api/admin/cms/menu/items/i1/availability').set('Authorization', owner).send({ availability: 'gone' })).status).toBe(400);
        db.setMenuItemAvailability.mockResolvedValueOnce(null);
        expect((await request(app).patch('/api/admin/cms/menu/items/zz/availability').set('Authorization', owner).send({ availability: 'hidden' })).status).toBe(404);
    });

    test('deletes and reorders', async () => {
        db.deleteMenuItem.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
        expect((await request(app).delete('/api/admin/cms/menu/items/i1').set('Authorization', owner)).status).toBe(200);
        expect((await request(app).delete('/api/admin/cms/menu/items/zz').set('Authorization', owner)).status).toBe(404);
        expect((await request(app).put('/api/admin/cms/menu/items/reorder').set('Authorization', owner).send({ orderedIds: ['i2', 'i1'] })).status).toBe(200);
        expect(db.reorderMenuItems).toHaveBeenCalledWith('r1', ['i2', 'i1']);
    });

    test('a failed projection never fails the write', async () => {
        db.refreshMenuProjection.mockRejectedValueOnce(new Error('mongo down'));
        db.deleteMenuItem.mockResolvedValueOnce(true);
        expect((await request(app).delete('/api/admin/cms/menu/items/i1').set('Authorization', owner)).status).toBe(200);
    });
});

describe('CSV import', () => {
    const csv = 'category,name,price,isVeg\nStarters,Samosa,40,veg\nDrinks,Chai,20,veg\nDrinks,,5,veg';

    test('creates missing categories, upserts rows and reports errors', async () => {
        db.insertMenuCategory.mockResolvedValue({ id: 'c9', restaurantId: 'r1', name: 'Drinks', sortOrder: 2 });
        db.upsertMenuItemByName.mockResolvedValueOnce('updated').mockResolvedValueOnce('created');
        const res = await request(app).post('/api/admin/cms/menu/import').set('Authorization', owner).set('Content-Type', 'text/csv').send(csv);
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ created: 1, updated: 1, failed: 1 });
        expect(db.insertMenuCategory).toHaveBeenCalledTimes(1);
        expect(db.insertMenuCategory).toHaveBeenCalledWith('r1', { name: 'Drinks', sortOrder: 2 });
        expect(db.upsertMenuItemByName).toHaveBeenCalledWith('r1', 'Samosa',
            expect.objectContaining({ categoryId: 'c1', price: 40, isVeg: true, availability: 'in_stock' }),
            { sortOrder: 0, images: [], variants: [], addons: [] });
        expect(db.refreshMenuProjection).toHaveBeenCalledWith('r1');
    });

    test('keeps optional columns on update only when present', async () => {
        db.upsertMenuItemByName.mockResolvedValue('updated');
        const full = 'category,name,description,price,isVeg,images,variants,addons,sortOrder\nStarters,Samosa,Crisp,40,veg,https://a.jpg,One:20,Chutney:5,3';
        await request(app).post('/api/admin/cms/menu/import').set('Authorization', owner).set('Content-Type', 'text/csv').send(full);
        const [, , set, onInsert] = db.upsertMenuItemByName.mock.calls[0];
        expect(set).toMatchObject({ description: 'Crisp', images: ['https://a.jpg'], sortOrder: 3 });
        expect(set.variants[0]).toMatchObject({ name: 'One', price: 20 });
        expect(onInsert).toEqual({});
    });

    test('rejects an empty body or malformed CSV', async () => {
        expect((await request(app).post('/api/admin/cms/menu/import').set('Authorization', owner).set('Content-Type', 'text/csv').send('')).status).toBe(400);
        expect((await request(app).post('/api/admin/cms/menu/import').set('Authorization', owner).send({ csv: 'x' })).status).toBe(400);
        const bad = await request(app).post('/api/admin/cms/menu/import').set('Authorization', owner).set('Content-Type', 'text/csv').send('name,price\nA,1');
        expect(bad.body.error).toBe('CSV is missing required column "category"');
    });

    test('does not re-project when nothing imported', async () => {
        await request(app).post('/api/admin/cms/menu/import').set('Authorization', owner).set('Content-Type', 'text/csv').send('category,name,price\n,,');
        expect(db.refreshMenuProjection).not.toHaveBeenCalled();
    });
});

describe('offers', () => {
    test('lists with summary and live flag', async () => {
        db.findOffers.mockResolvedValue([offer]);
        const res = await request(app).get('/api/admin/cms/offers?includeArchived=true').set('Authorization', owner);
        expect(db.findOffers).toHaveBeenCalledWith('r1', { includeArchived: true });
        expect(res.body.data[0]).toMatchObject({ summary: 'Lunch: 10% off', live: true });
    });

    test('creates with defaults and an upper-cased code', async () => {
        db.insertOffer.mockImplementation(async (_rid: string, input: object) => ({ id: 'o2', restaurantId: 'r1', ...input }));
        const res = await request(app).post('/api/admin/cms/offers').set('Authorization', owner).send({
            title: 'Diwali', reward: { kind: 'flat_off', amount: 100 }, code: 'diwali100', schedule: { startsAt: '2026-11-01', days: ['sat', 'sat'] },
        });
        expect(res.status).toBe(201);
        const [, input] = db.insertOffer.mock.calls[0];
        expect(input).toEqual({
            title: 'Diwali', reward: { kind: 'flat_off', amount: 100 }, scope: { kind: 'all' }, code: 'DIWALI100',
            schedule: { startsAt: '2026-11-01T00:00:00.000Z', days: ['sat'] },
            showOnSite: true, promoteInContent: true, status: 'draft',
        });
        expect(res.body.data.summary).toContain('Code DIWALI100');
    });

    test('validates reward, schedule and scope ids', async () => {
        const bad = (body: object) => request(app).post('/api/admin/cms/offers').set('Authorization', owner).send({ title: 'X', ...body });
        expect((await bad({ reward: { kind: 'percent_off', percent: 120 } })).body.error).toBe('Percent can be at most 100.');
        expect((await bad({ reward: { kind: 'bogo' } })).body.error).toMatch(/^Choose what the offer gives/);
        expect((await bad({ reward: { kind: 'free_delivery' }, schedule: { from: '12:00' } })).body.error).toBe('Give both a start and an end time, or neither.');
        expect((await bad({ reward: { kind: 'free_delivery' }, schedule: { startsAt: '2026-02-01', endsAt: '2026-01-01' } })).body.error)
            .toBe('The end date must be after the start date.');
        expect((await bad({ reward: { kind: 'free_delivery' }, code: 'no spaces' })).body.error).toMatch(/^Codes can use/);
        expect((await bad({ reward: { kind: 'free_delivery' }, scope: { kind: 'categories', categoryIds: ['zz'] } })).body.error)
            .toBe('One of the chosen categories no longer exists.');
        expect((await bad({ reward: { kind: 'free_delivery' }, scope: { kind: 'items', itemIds: ['zz'] } })).body.error)
            .toBe('One of the chosen items no longer exists.');
    });

    test('maps a duplicate code to 409', async () => {
        db.insertOffer.mockRejectedValueOnce(new DuplicateOfferCodeError('Another offer already uses the code X'));
        const res = await request(app).post('/api/admin/cms/offers').set('Authorization', owner).send({ title: 'X', reward: { kind: 'free_delivery' }, code: 'X' });
        expect(res.status).toBe(409);
    });

    test('updates: null clears, schedule merges, bad merge rejected', async () => {
        db.findOfferById.mockResolvedValue({ ...offer, code: 'OLD', schedule: { startsAt: '2026-01-01T00:00:00.000Z', endsAt: '2026-03-01T00:00:00.000Z' } });
        db.updateOffer.mockImplementation(async (_r: string, _id: string, u: object) => ({ ...offer, ...u }));
        const res = await request(app).patch('/api/admin/cms/offers/o1').set('Authorization', owner)
            .send({ code: null, status: 'paused', schedule: { days: ['mon'] }, scope: { kind: 'items', itemIds: ['i1'] } });
        expect(res.status).toBe(200);
        expect(db.updateOffer).toHaveBeenCalledWith('r1', 'o1', {
            code: undefined, status: 'paused', scope: { kind: 'items', itemIds: ['i1'] },
            schedule: { startsAt: '2026-01-01T00:00:00.000Z', endsAt: '2026-03-01T00:00:00.000Z', days: ['mon'] },
        });

        const merged = await request(app).patch('/api/admin/cms/offers/o1').set('Authorization', owner).send({ schedule: { startsAt: '2026-04-01' } });
        expect(merged.status).toBe(400);
        expect(merged.body.error).toBe('The end date must be after the start date.');
    });

    test('null clears the end date and daily window', async () => {
        db.findOfferById.mockResolvedValue({ ...offer, schedule: { startsAt: '2026-01-01T00:00:00.000Z', endsAt: '2026-03-01T00:00:00.000Z', from: '12:00', to: '15:00' } });
        db.updateOffer.mockImplementation(async (_r: string, _id: string, u: object) => ({ ...offer, ...u }));
        const res = await request(app).patch('/api/admin/cms/offers/o1').set('Authorization', owner)
            .send({ schedule: { endsAt: null, from: null, to: null } });
        expect(res.status).toBe(200);
        expect(db.updateOffer.mock.calls[0][2].schedule).toEqual({ startsAt: '2026-01-01T00:00:00.000Z' });
        const half = await request(app).patch('/api/admin/cms/offers/o1').set('Authorization', owner).send({ schedule: { from: null, to: '10:00' } });
        expect(half.body.error).toBe('Give both a start and an end time, or neither.');
    });

    test('update 404s and duplicate codes', async () => {
        db.findOfferById.mockResolvedValueOnce(null);
        expect((await request(app).patch('/api/admin/cms/offers/zz').set('Authorization', owner).send({ status: 'active' })).status).toBe(404);
        db.findOfferById.mockResolvedValue(offer);
        db.updateOffer.mockResolvedValueOnce(null);
        expect((await request(app).patch('/api/admin/cms/offers/o1').set('Authorization', owner).send({ status: 'active' })).status).toBe(404);
        db.updateOffer.mockRejectedValueOnce(new DuplicateOfferCodeError('dup'));
        expect((await request(app).patch('/api/admin/cms/offers/o1').set('Authorization', owner).send({ code: 'X' })).status).toBe(409);
        expect((await request(app).patch('/api/admin/cms/offers/o1').set('Authorization', owner).send({ scope: { kind: 'categories', categoryIds: ['zz'] } })).status).toBe(400);
    });

    test('deletes', async () => {
        db.deleteOffer.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
        expect((await request(app).delete('/api/admin/cms/offers/o1').set('Authorization', owner)).status).toBe(200);
        expect((await request(app).delete('/api/admin/cms/offers/zz').set('Authorization', owner)).status).toBe(404);
    });

    test('previews with server-side prices', async () => {
        db.findOfferById.mockResolvedValue(offer);
        db.findMenuItemById.mockResolvedValue(menuItem);
        const res = await request(app).post('/api/admin/cms/offers/o1/preview').set('Authorization', owner)
            .send({ lines: [{ menuItemId: 'i1', qty: 5, price: 1 }], at: '2026-06-01T10:00:00Z' });
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ subtotal: 200, discount: 20, deliveryDiscount: 0 });
    });

    test('preview 404/400 paths', async () => {
        db.findOfferById.mockResolvedValueOnce(null);
        expect((await request(app).post('/api/admin/cms/offers/zz/preview').set('Authorization', owner).send({ lines: [{ menuItemId: 'i1', qty: 1 }] })).status).toBe(404);
        db.findOfferById.mockResolvedValue(offer);
        db.findMenuItemById.mockResolvedValueOnce(null);
        expect((await request(app).post('/api/admin/cms/offers/o1/preview').set('Authorization', owner).send({ lines: [{ menuItemId: 'zz', qty: 1 }] })).status).toBe(400);
        expect((await request(app).post('/api/admin/cms/offers/o1/preview').set('Authorization', owner).send({ lines: [] })).body.error).toBe('Add at least one item.');
    });
});

describe('site content', () => {
    const doc = {
        id: 's1', restaurantId: 'r1',
        draft: { heroImages: ['https://h.jpg'], about: 'Hello' },
        published: { heroImages: [] }, publishedVersion: 1, publishedAt: '2026-11-01T00:00:00.000Z',
        versions: [{ version: 1, publishedAt: '2026-11-01T00:00:00.000Z', content: { heroImages: [] } }],
    };

    test('reads an empty state', async () => {
        db.findStorefrontContent.mockResolvedValueOnce(null);
        const res = await request(app).get('/api/admin/cms/content').set('Authorization', owner);
        expect(res.body.data).toEqual({ draft: { heroImages: [] }, published: null, publishedVersion: null, publishedAt: null, versions: [] });
    });

    test('reads draft, published and version list without snapshots', async () => {
        db.findStorefrontContent.mockResolvedValueOnce(doc);
        const res = await request(app).get('/api/admin/cms/content').set('Authorization', owner);
        expect(res.body.data.versions).toEqual([{ version: 1, publishedAt: '2026-11-01T00:00:00.000Z' }]);
        expect(res.body.data.publishedVersion).toBe(1);
    });

    test('saves a validated draft', async () => {
        db.saveStorefrontDraft.mockImplementation(async (_r: string, draft: object) => ({ draft }));
        const res = await request(app).put('/api/admin/cms/content/draft').set('Authorization', owner).send({
            about: '  Family-run since 1998 ',
            gallery: ['https://g1.jpg', { url: 'https://g2.jpg', caption: 'Patio' }],
            pages: [{ slug: 'Catering', title: 'Catering', body: 'We cater.' }],
            hours: [{ day: 'Monday', open: '11:00', close: '23:00' }],
            theme: { primaryColor: '#6B4EFF' },
            unknownKey: true,
        });
        expect(res.status).toBe(200);
        expect(db.saveStorefrontDraft).toHaveBeenCalledWith('r1', {
            heroImages: [],
            about: 'Family-run since 1998',
            gallery: [{ url: 'https://g1.jpg' }, { url: 'https://g2.jpg', caption: 'Patio' }],
            pages: [{ slug: 'catering', title: 'Catering', body: 'We cater.', visible: true }],
            hours: [{ day: 'Monday', open: '11:00', close: '23:00' }],
            theme: { primaryColor: '#6B4EFF' },
        });
    });

    test('rejects bad content', async () => {
        const put = (body: object) => request(app).put('/api/admin/cms/content/draft').set('Authorization', owner).send(body);
        expect((await put({ pages: [{ slug: 'menu', title: 'M', body: '' }] })).body.error).toBe('That page URL is reserved. Pick another.');
        expect((await put({ pages: [{ slug: 'a', title: 'A', body: '' }, { slug: 'a', title: 'B', body: '' }] })).body.error).toBe('Two pages share the same URL.');
        expect((await put({ theme: { primaryColor: 'red' } })).body.error).toBe('Colours must be hex like #6B4EFF.');
        expect((await put({ hours: [{ day: 'Monday', open: '9am', close: '23:00' }] })).body.error).toBe('Times must look like 09:30 (24-hour).');
        expect((await put({ reservations: { daysAhead: 7, slotMinutes: 20, maxPartySize: 4, startTime: '12:00', endTime: '22:00' } })).body.error)
            .toBe('Slots must be 15, 30 or 60 minutes.');
        expect((await put({ heroImages: ['javascript:alert(1)'] })).status).toBe(400);
    });

    test('publishes the next version with an optimistic check', async () => {
        db.findStorefrontContent.mockResolvedValue(doc);
        db.saveStorefrontPublish.mockResolvedValueOnce({ ...doc, publishedVersion: 2 });
        const res = await request(app).post('/api/admin/cms/content/publish').set('Authorization', owner);
        expect(res.status).toBe(200);
        expect(res.body.data.publishedVersion).toBe(2);
        const [, expected, result] = db.saveStorefrontPublish.mock.calls[0];
        expect(expected).toBe(1);
        expect(result.published).toEqual(doc.draft);
        expect(result.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);

        db.saveStorefrontPublish.mockResolvedValueOnce(null);
        expect((await request(app).post('/api/admin/cms/content/publish').set('Authorization', owner)).status).toBe(409);
    });

    test('publish without a draft is a 400', async () => {
        db.findStorefrontContent.mockResolvedValueOnce(null);
        expect((await request(app).post('/api/admin/cms/content/publish').set('Authorization', owner)).status).toBe(400);
    });

    test('rolls back to an earlier version as a new version', async () => {
        db.findStorefrontContent.mockResolvedValue(doc);
        db.saveStorefrontPublish.mockResolvedValueOnce({ ...doc });
        const res = await request(app).post('/api/admin/cms/content/rollback').set('Authorization', owner).send({ version: 1 });
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ publishedVersion: 2, restoredFrom: 1 });
        expect(db.saveStorefrontPublish.mock.calls[0][2].draft).toEqual({ heroImages: [] });

        expect((await request(app).post('/api/admin/cms/content/rollback').set('Authorization', owner).send({ version: 7 })).status).toBe(404);
        db.saveStorefrontPublish.mockResolvedValueOnce(null);
        expect((await request(app).post('/api/admin/cms/content/rollback').set('Authorization', owner).send({ version: 1 })).status).toBe(409);
        expect((await request(app).post('/api/admin/cms/content/rollback').set('Authorization', owner).send({})).status).toBe(400);
        db.findStorefrontContent.mockResolvedValueOnce(null);
        expect((await request(app).post('/api/admin/cms/content/rollback').set('Authorization', owner).send({ version: 1 })).status).toBe(404);
    });
});
