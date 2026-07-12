/**
 * Route-level tests for the menu_items (restaurantId, name) unique-key hardening
 * (Brief 03 / DESIGN-03 G1):
 *   - POST  /api/admin/ordering/menu/items      duplicate name  -> 409
 *   - PATCH /api/admin/ordering/menu/items/:id  rename collision -> 409
 *   - POST  /api/admin/ordering/menu/import     concurrent-import 11000 -> retry once
 *
 * The DB layer and CSV parser are mocked so the tests exercise the route's
 * 11000 handling deterministically (mirrors storefront-payments.test.ts).
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { MongoServerError } from 'mongodb';

// ----- DB mock -----
const mockFindMenuCategoryById = vi.fn();
const mockFindMenuCategories = vi.fn();
const mockFindMenuItems = vi.fn().mockResolvedValue([]);

const mockItemInsertOne = vi.fn();
const mockItemFindOneAndUpdate = vi.fn();
const mockItemUpdateOne = vi.fn();
const mockCategoryInsertOne = vi.fn();

vi.mock('@restropulse/db', async (importOriginal) => {
    const actual = (await importOriginal()) as any;
    return {
        ...actual,
        findMenuCategoryById: mockFindMenuCategoryById,
        findMenuCategories: mockFindMenuCategories,
        findMenuItems: mockFindMenuItems,
        getMenuItemsCollection: () => ({
            insertOne: mockItemInsertOne,
            findOneAndUpdate: mockItemFindOneAndUpdate,
            updateOne: mockItemUpdateOne,
        }),
        getMenuCategoriesCollection: () => ({ insertOne: mockCategoryInsertOne }),
        toApiFormat: (d: any) => d,
        toApiFormatArray: (d: any) => d,
        toObjectId: (id: string) => id,
    };
});

// ----- Event emission is fire-and-forget; keep it inert -----
vi.mock('../../src/services/ordering/events.js', () => ({
    emitOrderingEvent: vi.fn(),
}));

// ----- CSV parser mock (import test drives rows directly) -----
const mockParseMenuCsv = vi.fn();
vi.mock('../../src/services/ordering/menu-csv.js', () => ({
    parseMenuCsv: mockParseMenuCsv,
}));

const { default: adminOrderingRoutes } = await import('../../src/routes/admin-ordering.js');
const { generateTokens } = await import('../../src/services/jwt.js');

const OWNER_TOKEN = generateTokens('u1', '+919999999999', 'r1', 'OWNER').accessToken;

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/admin/ordering', adminOrderingRoutes);
    return app;
}

function dupKeyError(): MongoServerError {
    const err = new MongoServerError({ message: 'E11000 duplicate key error' });
    err.code = 11000;
    return err;
}

beforeEach(() => {
    vi.clearAllMocks();
    mockFindMenuCategoryById.mockResolvedValue({ id: 'cat1', name: 'Starters' });
    mockFindMenuItems.mockResolvedValue([]);
});

describe('POST /menu/items — duplicate name', () => {
    test('returns 409 when the unique (restaurantId, name) index rejects the insert', async () => {
        mockItemInsertOne.mockRejectedValueOnce(dupKeyError());
        const res = await request(makeApp())
            .post('/api/admin/ordering/menu/items')
            .set('Authorization', `Bearer ${OWNER_TOKEN}`)
            .send({ categoryId: 'cat1', name: 'Paneer Tikka', price: 250 });

        expect(res.status).toBe(409);
        expect(res.body).toEqual({ success: false, error: 'An item with this name already exists' });
    });

    test('returns 201 on a fresh name', async () => {
        mockItemInsertOne.mockResolvedValueOnce({ insertedId: 'item1' });
        const res = await request(makeApp())
            .post('/api/admin/ordering/menu/items')
            .set('Authorization', `Bearer ${OWNER_TOKEN}`)
            .send({ categoryId: 'cat1', name: 'Paneer Tikka', price: 250 });

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
    });
});

describe('PATCH /menu/items/:id — rename collision', () => {
    test('returns 409 when renaming to an existing name', async () => {
        mockItemFindOneAndUpdate.mockRejectedValueOnce(dupKeyError());
        const res = await request(makeApp())
            .patch('/api/admin/ordering/menu/items/item1')
            .set('Authorization', `Bearer ${OWNER_TOKEN}`)
            .send({ name: 'Paneer Tikka' });

        expect(res.status).toBe(409);
        expect(res.body).toEqual({ success: false, error: 'An item with this name already exists' });
    });

    test('returns 404 when the item does not exist (no collision)', async () => {
        mockItemFindOneAndUpdate.mockResolvedValueOnce(null);
        const res = await request(makeApp())
            .patch('/api/admin/ordering/menu/items/itemX')
            .set('Authorization', `Bearer ${OWNER_TOKEN}`)
            .send({ name: 'Renamed Dish' });

        expect(res.status).toBe(404);
    });
});

describe('POST /menu/import — concurrent-import 11000 retry', () => {
    test('retries the upsert once on a duplicate-key race and still counts the row', async () => {
        mockFindMenuCategories.mockResolvedValue([{ id: 'cat1', name: 'Starters' }]);
        mockParseMenuCsv.mockReturnValue({
            rows: [
                {
                    category: 'Starters',
                    name: 'Paneer Tikka',
                    price: 250,
                    isVeg: true,
                    availability: 'in_stock',
                    images: [],
                    variants: [],
                    addons: [],
                },
            ],
            errors: [],
        });
        // First attempt loses the race (11000); the retry succeeds as an update.
        mockItemUpdateOne
            .mockRejectedValueOnce(dupKeyError())
            .mockResolvedValueOnce({ upsertedCount: 0, matchedCount: 1 });

        const res = await request(makeApp())
            .post('/api/admin/ordering/menu/import')
            .set('Authorization', `Bearer ${OWNER_TOKEN}`)
            .attach('file', Buffer.from('name,category,price\nPaneer Tikka,Starters,250\n'), 'menu.csv');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        // Row resolved as an update (retry path), not a failure.
        expect(res.body.data).toMatchObject({ created: 0, updated: 1, failed: 0 });
        expect(mockItemUpdateOne).toHaveBeenCalledTimes(2);
    });

    test('non-11000 errors are not swallowed by the retry', async () => {
        mockFindMenuCategories.mockResolvedValue([{ id: 'cat1', name: 'Starters' }]);
        mockParseMenuCsv.mockReturnValue({
            rows: [
                {
                    category: 'Starters',
                    name: 'Paneer Tikka',
                    price: 250,
                    isVeg: true,
                    availability: 'in_stock',
                    images: [],
                    variants: [],
                    addons: [],
                },
            ],
            errors: [],
        });
        const other = new MongoServerError({ message: 'boom' });
        other.code = 121;
        mockItemUpdateOne.mockRejectedValueOnce(other);

        const res = await request(makeApp())
            .post('/api/admin/ordering/menu/import')
            .set('Authorization', `Bearer ${OWNER_TOKEN}`)
            .attach('file', Buffer.from('name,category,price\nPaneer Tikka,Starters,250\n'), 'menu.csv');

        expect(res.status).toBe(500);
        expect(mockItemUpdateOne).toHaveBeenCalledTimes(1);
    });
});
