import { describe, test, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// PUT /api/restaurant/:id must not let the legacy full-menu editor overwrite a
// menu that the CMS catalog owns (restaurant.menu is then a projection).
const findRestaurantById = vi.fn();
const updateRestaurant = vi.fn();

vi.mock('@restropulse/db', async (importOriginal) => {
    const actual = await importOriginal() as Record<string, unknown>;
    return { ...actual, findRestaurantById, updateRestaurant };
});

vi.mock('@restropulse/telemetry/server', () => {
    const noop = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    return { createLogger: vi.fn(() => noop), trackEvent: vi.fn() };
});

const { generateTokens } = await import('../../src/services/jwt.js');
const { default: restaurantRoutes } = await import('../../src/routes/restaurant.js');

const app = express();
app.use(express.json());
app.use('/api/restaurant', restaurantRoutes);

const auth = `Bearer ${generateTokens('u1', '+910000000000', 'r1', 'OWNER').accessToken}`;
const menu = [{ id: 'm1', category: 'Mains', name: 'Dal', isVeg: true, isAvailable: true }];

beforeEach(() => {
    vi.clearAllMocks();
    updateRestaurant.mockImplementation(async (id: string, u: object) => ({ id, ...u }));
});

describe('PUT /api/restaurant/:id menu guard', () => {
    test('drops menu writes once the catalog owns the menu', async () => {
        findRestaurantById.mockResolvedValue({ id: 'r1', menuSource: 'catalog' });
        const res = await request(app).put('/api/restaurant/r1').set('Authorization', auth)
            .send({ name: 'New name', menu, menuLastUpdated: '2026-11-24' });
        expect(res.status).toBe(200);
        expect(updateRestaurant).toHaveBeenCalledWith('r1', { name: 'New name' });
    });

    test('keeps menu writes for restaurants still on the embedded menu', async () => {
        findRestaurantById.mockResolvedValue({ id: 'r1' });
        await request(app).put('/api/restaurant/r1').set('Authorization', auth).send({ menu });
        expect(updateRestaurant).toHaveBeenCalledWith('r1', { menu });
    });

    test('never accepts a client-supplied menuSource and skips the lookup without a menu', async () => {
        await request(app).put('/api/restaurant/r1').set('Authorization', auth).send({ menuSource: 'catalog', cuisine: 'Thai' });
        expect(updateRestaurant).toHaveBeenCalledWith('r1', { cuisine: 'Thai' });
        expect(findRestaurantById).not.toHaveBeenCalled();
    });

    test('never accepts slug or ordering through the generic update', async () => {
        await request(app).put('/api/restaurant/r1').set('Authorization', auth)
            .send({ slug: 'someone-else', ordering: { storeOpen: true }, cuisine: 'Thai' });
        expect(updateRestaurant).toHaveBeenCalledWith('r1', { cuisine: 'Thai' });
    });
});
