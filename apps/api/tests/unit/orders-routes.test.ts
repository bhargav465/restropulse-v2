/**
 * Storefront checkout, tracking and the restaurant order routes, end to end
 * through the real order service. Orders are paid in cash (at the counter, at
 * the table or on delivery). @restropulse/db is replaced by an in-memory fake
 * so the flows keep state between calls.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import type { Order, OrderingMenuItem, Offer, Restaurant } from '@restropulse/shared';

// ----- In-memory @restropulse/db -----
const state = {
    restaurants: [] as Restaurant[],
    items: [] as OrderingMenuItem[],
    offers: [] as Offer[],
    orders: [] as Order[],
    seq: 0,
    collideNext: 0,
};
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
class DuplicateRestaurantSlugError extends Error {}
class OrderReferenceCollisionError extends Error {}

const deliveryShipments: Array<Record<string, unknown> & { orderId: string }> = [];
const fakeDb = {
    findShipmentForOrder: vi.fn(async (_rid: string, orderId: string) => clone(deliveryShipments.filter((x) => x.orderId === orderId).at(-1) ?? null)),
    findShipmentsForOrders: vi.fn(async (_rid: string, ids: string[]) => clone(deliveryShipments.filter((x) => ids.includes(x.orderId)))),
    findRestaurantBySlug: vi.fn(async (slug: string) => clone(state.restaurants.find((r) => r.slug === slug) ?? null)),
    findRestaurantById: vi.fn(async (id: string) => clone(state.restaurants.find((r) => r.id === id) ?? null)),
    updateRestaurantOrdering: vi.fn(async (id: string, u: { ordering?: unknown; slug?: string }) => {
        if (u.slug && state.restaurants.some((r) => r.slug === u.slug && r.id !== id)) throw new DuplicateRestaurantSlugError();
        const r = state.restaurants.find((x) => x.id === id);
        if (!r) return null;
        if (u.ordering) r.ordering = u.ordering as Restaurant['ordering'];
        if (u.slug !== undefined) r.slug = u.slug;
        return clone(r);
    }),
    findMenuItems: vi.fn(async (rid: string) => clone(state.items.filter((i) => i.restaurantId === rid && i.availability !== 'hidden'))),
    findMenuCategories: vi.fn(async () => [{ id: 'c1', restaurantId: 'r1', name: 'Mains', sortOrder: 1 }]),
    findSiteOffers: vi.fn(async (rid: string) => clone(state.offers.filter((o) => o.restaurantId === rid && o.status === 'active' && o.showOnSite))),
    findOfferByCode: vi.fn(async (rid: string, code: string) => clone(state.offers.find((o) => o.restaurantId === rid && o.code === code) ?? null)),
    findStorefrontContent: vi.fn(async () => ({ restaurantId: 'r1', draft: { heroImages: [] }, published: { heroImages: [], tagline: 'Hot biryani' }, versions: [] })),
    insertOrder: vi.fn(async (input: Omit<Order, 'id' | 'createdAt' | 'updatedAt'>) => {
        if (state.collideNext > 0) { state.collideNext -= 1; throw new OrderReferenceCollisionError(); }
        const dup = input.idempotencyKey && state.orders.find((o) => o.restaurantId === input.restaurantId && o.idempotencyKey === input.idempotencyKey);
        if (dup) return { order: clone(dup), created: false };
        const now = new Date(Date.now() + state.seq).toISOString();
        const order = { ...clone(input), id: `ord${++state.seq}`, createdAt: now, updatedAt: now } as Order;
        state.orders.push(order);
        return { order: clone(order), created: true };
    }),
    findOrderById: vi.fn(async (rid: string, id: string) => clone(state.orders.find((o) => o.restaurantId === rid && o.id === id) ?? null)),
    findOrders: vi.fn(async (rid: string, opts: { statuses?: string[] } = {}) =>
        clone(state.orders.filter((o) => o.restaurantId === rid && (!opts.statuses || opts.statuses.includes(o.status))))),
    transitionOrder: vi.fn(async (rid: string, id: string, from: string, to: string, entry: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
        const o = state.orders.find((x) => x.restaurantId === rid && x.id === id && x.status === from);
        if (!o) return null;
        Object.assign(o, { status: to, ...extra });
        o.statusHistory.push({ status: to as Order['status'], at: new Date().toISOString(), ...entry } as Order['statusHistory'][number]);
        return clone(o);
    }),
};

vi.mock('@restropulse/db', async (importOriginal) => {
    const actual = await importOriginal() as Record<string, unknown>;
    return { ...actual, ...fakeDb, DuplicateRestaurantSlugError, OrderReferenceCollisionError };
});

vi.mock('@restropulse/telemetry/server', () => {
    const noop = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    return { createLogger: vi.fn(() => noop), trackEvent: vi.fn() };
});

vi.mock('../../src/middleware/rate-limit.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/middleware/rate-limit.js')>();
    const { MemoryStore } = await import('express-rate-limit');
    return {
        ...actual,
        createRateLimiter: (opts: Parameters<typeof actual.createRateLimiter>[0]) =>
            actual.createRateLimiter({ ...opts, store: new MemoryStore() }),
    };
});

const { generateTokens } = await import('../../src/services/jwt.js');
const { default: storefrontRoutes } = await import('../../src/routes/storefront.js');
const { default: adminOrdersRoutes } = await import('../../src/routes/admin-orders.js');
const service = await import('../../src/services/orders/order-service.js');

const app = express();
app.use(express.json());
app.use('/api/storefront', storefrontRoutes);
app.use('/api/admin/orders', adminOrdersRoutes);
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ success: false, error: err.message });
});

const owner = `Bearer ${generateTokens('u1', '+910000000000', 'r1', 'OWNER').accessToken}`;
const otherOwner = `Bearer ${generateTokens('u2', '+910000000001', 'r2', 'OWNER').accessToken}`;

const openSettings = {
    storeOpen: true,
    taxRatePercent: 5,
    delivery: { enabled: true, flatFee: 40, minOrder: 100 },
    pickup: { enabled: true },
    dineIn: { enabled: false },
};

const restaurant = (over: Partial<Restaurant> = {}): Restaurant => ({
    id: 'r1', name: "Bawarchi's Kitchen", cuisine: 'Hyderabadi', slug: 'bawarchi', phone: '+914000000000',
    location: { address: 'Road 1, Hyderabad', lat: 0, lng: 0, mapUrl: '' },
    accountManager: { name: '', phone: '', email: '', avatar: '' }, integrations: { instagram: false },
    ordering: clone(openSettings),
    ...over,
} as Restaurant);

const cart = { orderType: 'pickup', items: [{ menuItemId: 'biryani', qty: 2 }] };
const guest = { customerName: 'Asha', customerPhone: '98765 43210' };

async function placeCash(extra: Record<string, unknown> = {}) {
    const res = await request(app).post('/api/storefront/bawarchi/orders').send({ ...cart, ...guest, ...extra });
    expect(res.status).toBe(201);
    return res.body.data as { order: Order; trackingToken: string };
}

beforeEach(() => {
    state.restaurants = [restaurant(), restaurant({ id: 'r2', slug: 'taken-name', name: 'Other' })];
    state.items = [
        { id: 'biryani', restaurantId: 'r1', categoryId: 'c1', name: 'Biryani', price: 250, isVeg: false, availability: 'in_stock', sortOrder: 1, createdAt: 'x' },
        { id: 'lassi', restaurantId: 'r1', categoryId: 'c1', name: 'Lassi', price: 60, isVeg: true, availability: 'in_stock', sortOrder: 2 },
    ];
    state.offers = [
        { id: 'o1', restaurantId: 'r1', title: 'Flat 50', reward: { kind: 'flat_off', amount: 50 }, scope: { kind: 'all' }, code: 'FLAT50', schedule: { startsAt: '2026-01-01T00:00:00Z' }, showOnSite: true, promoteInContent: false, status: 'active' },
        { id: 'o2', restaurantId: 'r1', title: 'Future', reward: { kind: 'flat_off', amount: 10 }, scope: { kind: 'all' }, schedule: { startsAt: '2099-01-01T00:00:00Z' }, showOnSite: true, promoteInContent: false, status: 'active' },
    ];
    state.orders = [];
    state.seq = 0;
    state.collideNext = 0;
    service._resetOrderListeners();
});

describe('public storefront', () => {
    test('config shows public settings and published content; unknown slugs 404', async () => {
        const res = await request(app).get('/api/storefront/bawarchi');
        expect(res.status).toBe(200);
        expect(res.body.data.restaurant).toMatchObject({ name: "Bawarchi's Kitchen", slug: 'bawarchi', phone: '+914000000000', address: 'Road 1, Hyderabad' });
        expect(res.body.data.ordering).toMatchObject({ storeOpen: true, orderTypes: { delivery: true, pickup: true, dineIn: false }, });
        expect(res.body.data.ordering).not.toHaveProperty('payment');
        expect(res.body.data.content.tagline).toBe('Hot biryani');
        expect((await request(app).get('/api/storefront/nope-nope')).status).toBe(404);
        expect((await request(app).get('/api/storefront/NO')).status).toBe(404);
    });

    test('config omits optional fields and works without content', async () => {
        state.restaurants[0] = restaurant({ phone: undefined, location: undefined as unknown as Restaurant['location'], ordering: { ...openSettings, delivery: { enabled: true, flatFee: 40, minOrder: 0, freeAbove: 500 } } });
        fakeDb.findStorefrontContent.mockResolvedValueOnce(null as never);
        const res = await request(app).get('/api/storefront/bawarchi');
        expect(res.body.data.restaurant).not.toHaveProperty('phone');
        expect(res.body.data.ordering.delivery.freeAbove).toBe(500);
        expect(res.body.data.content).toBeNull();
    });

    test('menu lists items without internal fields and only live site offers', async () => {
        const res = await request(app).get('/api/storefront/bawarchi/menu');
        expect(res.body.data.items[0]).not.toHaveProperty('restaurantId');
        expect(res.body.data.items[0]).not.toHaveProperty('createdAt');
        expect(res.body.data.offers).toEqual([{ id: 'o1', title: 'Flat 50', summary: expect.any(String), code: 'FLAT50' }]);
        expect((await request(app).get('/api/storefront/missing-place/menu')).status).toBe(404);
    });

    test('quote prices server-side and applies a code', async () => {
        const res = await request(app).post('/api/storefront/bawarchi/quote').send({ ...cart, offerCode: 'flat50' });
        expect(res.status).toBe(200);
        expect(res.body.data.totals).toMatchObject({ subtotal: 500, discount: 50, tax: 22.5, total: 472.5 });
        expect(res.body.data.offer.code).toBe('FLAT50');
    });

    test('quote errors are explained', async () => {
        const bad = await request(app).post('/api/storefront/bawarchi/quote').send({ ...cart, offerCode: 'NOPE' });
        expect(bad.status).toBe(400);
        expect(bad.body.code).toBe('OFFER_NOT_FOUND');
        const off = await request(app).post('/api/storefront/bawarchi/quote').send({ ...cart, orderType: 'dine_in' });
        expect(off.body.code).toBe('ORDER_TYPE_DISABLED');
        const gone = await request(app).post('/api/storefront/bawarchi/quote').send({ orderType: 'pickup', items: [{ menuItemId: 'ghost', qty: 1 }] });
        expect(gone.body.code).toBe('ITEM_NOT_FOUND');
        const empty = await request(app).post('/api/storefront/bawarchi/quote').send({ orderType: 'pickup', items: [] });
        expect(empty.body.error).toBe('Add at least one item.');
        expect((await request(app).post('/api/storefront/no-such-place/quote').send(cart)).status).toBe(404);
    });

    test('a cash order goes straight to the kitchen and notifies listeners', async () => {
        const seen: string[] = [];
        service.onOrderStatusChange((o) => { seen.push(o.status); });
        const res = await request(app).post('/api/storefront/bawarchi/orders').send({ ...cart, ...guest, paymentMethod: 'cash', notes: 'Less spicy' });
        expect(res.status).toBe(201);
        expect(res.body.data.order).toMatchObject({ status: 'RECEIVED', paymentMethod: 'cash', orderNumber: expect.stringMatching(/^RP-[A-Z2-9]{6}$/) });
        expect(res.body.data.order).not.toHaveProperty('customerPhone');
        expect(res.body.data.trackingToken).toHaveLength(24);
        expect(res.body.data).not.toHaveProperty('payment');
        expect(state.orders[0]).toMatchObject({ customerPhone: '+919876543210', notes: 'Less spicy' });
        expect(state.orders[0]).not.toHaveProperty('paymentStatus');
        expect(seen).toEqual(['RECEIVED']);
    });

    test('paymentMethod may be omitted and only cash is accepted', async () => {
        const omitted = await placeCash();
        expect(omitted.order).toMatchObject({ status: 'RECEIVED', paymentMethod: 'cash' });
        const online = await request(app).post('/api/storefront/bawarchi/orders').send({ ...cart, ...guest, paymentMethod: 'online' });
        expect(online.status).toBe(400);
        expect(online.body.error).toBe('Orders are paid in cash.');
        expect(state.orders).toHaveLength(1);
    });

    test('an order total of zero is still placed (nothing to collect)', async () => {
        state.offers[0].reward = { kind: 'flat_off', amount: 1000 };
        const placed = await placeCash({ offerCode: 'FLAT50' });
        expect(placed.order.status).toBe('RECEIVED');
    });

    test('a legacy cashAccepted: false setting no longer blocks orders', async () => {
        (state.restaurants[0].ordering as Record<string, unknown>).cashAccepted = false;
        expect((await placeCash()).order.status).toBe('RECEIVED');
    });

    test('checkout validates the customer and the store', async () => {
        const post = (body: object) => request(app).post('/api/storefront/bawarchi/orders').send(body);
        expect((await post({ ...cart, ...guest, customerPhone: '12345', paymentMethod: 'cash' })).body.error).toBe('Enter a 10-digit mobile number.');
        expect((await post({ ...cart, customerPhone: '9876543210', paymentMethod: 'cash' })).body.error).toBe('Add your name.');
        expect((await post({ ...cart, ...guest, orderType: 'delivery', paymentMethod: 'cash' })).body.code).toBe('ADDRESS_REQUIRED');
        state.restaurants[0].ordering!.storeOpen = false;
        const closed = await post({ ...cart, ...guest, paymentMethod: 'cash' });
        expect(closed.status).toBe(409);
        expect(closed.body.code).toBe('STORE_CLOSED');
        expect((await request(app).post('/api/storefront/zz-missing/orders').send({ ...cart, ...guest, paymentMethod: 'cash' })).status).toBe(404);
    });

    test('delivery orders keep the address; dine-in keeps the table', async () => {
        const address = { line1: '12 MG Road', pincode: '500001', city: 'Hyderabad' };
        const d = await request(app).post('/api/storefront/bawarchi/orders').send({ ...cart, ...guest, orderType: 'delivery', paymentMethod: 'cash', address, table: 'T1' });
        expect(d.body.data.order.totals.deliveryFee).toBe(40);
        expect(state.orders[0].address).toEqual(address);
        expect(state.orders[0]).not.toHaveProperty('table');
        state.restaurants[0].ordering!.dineIn = { enabled: true };
        await request(app).post('/api/storefront/bawarchi/orders').send({ ...cart, ...guest, orderType: 'dine_in', paymentMethod: 'cash', table: 'T4', address });
        expect(state.orders[1]).toMatchObject({ table: 'T4' });
        expect(state.orders[1]).not.toHaveProperty('address');
        const badPin = await request(app).post('/api/storefront/bawarchi/orders').send({ ...cart, ...guest, orderType: 'delivery', paymentMethod: 'cash', address: { line1: 'x', pincode: '12' } });
        expect(badPin.body.error).toBe('Enter a 6-digit pincode.');
    });

    test('the same Idempotency-Key returns the first order', async () => {
        const seen: string[] = [];
        service.onOrderStatusChange((o) => { seen.push(o.status); });
        const send = () => request(app).post('/api/storefront/bawarchi/orders').set('Idempotency-Key', 'checkout-abc-123')
            .send({ ...cart, ...guest, paymentMethod: 'cash' });
        const first = await send();
        const second = await send();
        expect(first.status).toBe(201);
        expect(second.status).toBe(200);
        expect(second.body.data.order.id).toBe(first.body.data.order.id);
        expect(second.body.data).not.toHaveProperty('payment');
        expect(state.orders).toHaveLength(1);
        // The kitchen hears about the order once, not on the replay.
        expect(seen).toEqual(['RECEIVED']);
        const bad = await request(app).post('/api/storefront/bawarchi/orders').set('Idempotency-Key', 'short').send({ ...cart, ...guest, paymentMethod: 'cash' });
        expect(bad.status).toBe(400);
    });

    test('a replayed cash checkout returns the order without a payment', async () => {
        const send = () => request(app).post('/api/storefront/bawarchi/orders').set('Idempotency-Key', 'cash-key-0001').send({ ...cart, ...guest, paymentMethod: 'cash' });
        await send();
        const again = await send();
        expect(again.status).toBe(200);
        expect(again.body.data).not.toHaveProperty('payment');
    });

    test('order number collisions are retried, then give up', async () => {
        state.collideNext = 2;
        expect((await request(app).post('/api/storefront/bawarchi/orders').send({ ...cart, ...guest, paymentMethod: 'cash' })).status).toBe(201);
        state.collideNext = 3;
        expect((await request(app).post('/api/storefront/bawarchi/orders').send({ ...cart, ...guest, paymentMethod: 'cash' })).status).toBe(500);
    });

    test('tracking needs the token and hides private fields', async () => {
        const placed = await placeCash();
        const ok = await request(app).get(`/api/storefront/bawarchi/orders/${placed.order.id}`).query({ token: placed.trackingToken });
        expect(ok.status).toBe(200);
        expect(ok.body.data.order).not.toHaveProperty('trackingToken');
        expect(ok.body.data.order).not.toHaveProperty('customerName');
        expect(ok.body.data.order).not.toHaveProperty('paymentStatus');
        expect(ok.body.data.order.paymentMethod).toBe('cash');
        expect((await request(app).get(`/api/storefront/bawarchi/orders/${placed.order.id}`)).status).toBe(404);
        expect((await request(app).get(`/api/storefront/taken-name/orders/${placed.order.id}`).query({ token: placed.trackingToken })).status).toBe(404);
    });
});

describe('restaurant order routes', () => {
    const admin = (method: 'get' | 'post' | 'put', path: string, auth = owner) => request(app)[method](`/api/admin/orders${path}`).set('Authorization', auth);

    test('needs an owner or manager token', async () => {
        expect((await request(app).get('/api/admin/orders')).status).toBe(401);
        const viewer = `Bearer ${generateTokens('u3', '+910000000003', 'r1', 'ADMIN').accessToken}`;
        expect((await admin('get', '', viewer)).status).toBe(403);
    });

    test('feed filters by status and hides customer secrets', async () => {
        await request(app).post('/api/storefront/bawarchi/orders').set('Idempotency-Key', 'feed-key-001').send({ ...cart, ...guest, paymentMethod: 'cash' });
        const second = await placeCash();
        await request(app).post(`/api/admin/orders/${second.order.id}/cancel`).set('Authorization', owner).send({ reason: 'Test' });
        const all = await admin('get', '?status=all');
        expect(all.body.data.orders).toHaveLength(2);
        expect(all.body.data.orders[0]).not.toHaveProperty('trackingToken');
        expect(all.body.data.orders[0]).not.toHaveProperty('idempotencyKey');
        expect(all.body.data.serverTime).toEqual(expect.any(String));
        expect((await admin('get', '?status=active')).body.data.orders).toHaveLength(1);
        expect((await admin('get', '?status=cancelled,received&limit=10&since=2026-01-01T00:00:00Z')).body.data.orders).toHaveLength(2);
        expect((await admin('get', '?status=pending_payment')).status).toBe(400);
        expect((await admin('get', '?status=bogus')).status).toBe(400);
        expect((await admin('get', '?since=yesterday')).status).toBe(400);
        expect((await admin('get', '', otherOwner)).body.data.orders).toHaveLength(0);
    });

    test('delivery orders carry their rider status in the feed and on the tracking page', async () => {
        const address = { line1: '12 MG Road', pincode: '500001', city: 'Hyderabad' };
        const placed = (await request(app).post('/api/storefront/bawarchi/orders').send({ ...cart, ...guest, orderType: 'delivery', paymentMethod: 'cash', address })).body.data;
        await placeCash();
        const track = () => request(app).get(`/api/storefront/bawarchi/orders/${placed.order.id}`).query({ token: placed.trackingToken });
        expect((await track()).body.data.delivery).toBeNull();
        deliveryShipments.length = 0;
        deliveryShipments.push({ orderId: placed.order.id, status: 'PICKED_UP', provider: 'mock', carrier: 'Mock Rider Co', rider: { name: 'Ravi', phone: '+919999999999' } });
        expect((await track()).body.data.delivery).toEqual({ status: 'PICKED_UP', label: 'Picked up', carrier: 'Mock Rider Co', riderName: 'Ravi' });
        const feed = (await admin('get', '?status=all')).body.data.orders as Array<{ id: string; delivery?: unknown }>;
        expect(feed.find((o) => o.id === placed.order.id)?.delivery).toEqual({ status: 'PICKED_UP', provider: 'mock', carrier: 'Mock Rider Co' });
        expect(feed.find((o) => o.id !== placed.order.id)).not.toHaveProperty('delivery');
        deliveryShipments[0] = { orderId: placed.order.id, status: 'BOOKED', provider: 'self' };
        expect((await admin('get', '?status=all')).body.data.orders.find((o: { id: string }) => o.id === placed.order.id).delivery).toEqual({ status: 'BOOKED', provider: 'self' });
        deliveryShipments.length = 0;
    });

    test('moves an order through the kitchen and rejects skips', async () => {
        const seen: string[] = [];
        service.onOrderStatusChange((o, from) => { seen.push(`${from}->${o.status}`); });
        const unsubscribeBroken = service.onOrderStatusChange(() => { throw new Error('listener broke'); });
        const res = await request(app).post('/api/storefront/bawarchi/orders').send({ ...cart, ...guest, orderType: 'delivery', paymentMethod: 'cash', address: { line1: 'Road 2' } });
        const id = res.body.data.order.id;
        unsubscribeBroken();
        unsubscribeBroken();
        expect((await admin('post', `/${id}/status`).send({ to: 'READY' })).body.code).toBe('INVALID_TRANSITION');
        for (const to of ['PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'COMPLETED']) {
            const step = await admin('post', `/${id}/status`).send({ to, note: 'ok' });
            expect(step.status).toBe(200);
            expect(step.body.data.status).toBe(to);
            expect(step.body.data).not.toHaveProperty('trackingToken');
        }
        expect(seen).toEqual(['RECEIVED->RECEIVED', 'RECEIVED->PREPARING', 'PREPARING->READY', 'READY->OUT_FOR_DELIVERY', 'OUT_FOR_DELIVERY->COMPLETED']);
        expect((await admin('post', `/${id}/status`).send({ to: 'CANCELLED' })).body.code).toBe('USE_CANCEL');
        expect((await admin('post', `/${id}/status`).send({ to: 'nope' })).body.error).toBe('Pick a valid status.');
        expect((await admin('get', `/${id}`)).body.data.status).toBe('COMPLETED');
        expect((await admin('get', '/missing')).status).toBe(404);
        expect((await admin('get', `/${id}`, otherOwner)).status).toBe(404);
        expect((await admin('post', '/bad%20id/status').send({ to: 'READY' })).status).toBe(404);
    });

    test('concurrent moves conflict', async () => {
        const placed = await placeCash();
        fakeDb.transitionOrder.mockResolvedValueOnce(null as never);
        const race = await admin('post', `/${placed.order.id}/status`).send({ to: 'PREPARING' });
        expect(race.status).toBe(409);
        expect(race.body.code).toBe('ORDER_CHANGED');
    });

    test('cancelling an order records the reason; there is nothing to refund', async () => {
        const placed = await placeCash();
        const res = await admin('post', `/${placed.order.id}/cancel`).send({ reason: 'Out of rice', refund: true });
        expect(res.status).toBe(200);
        expect(res.body.data).not.toHaveProperty('refund');
        expect(res.body.data.order).toMatchObject({ status: 'CANCELLED', cancelReason: 'Out of rice' });
        expect(res.body.data.order).not.toHaveProperty('trackingToken');
        expect((await admin('post', `/${placed.order.id}/cancel`).send({ reason: 'again' })).body.code).toBe('INVALID_TRANSITION');
        const other = await placeCash();
        expect((await admin('post', `/${other.order.id}/cancel`).send({})).body.error).toBe('Say why the order is cancelled.');
    });

    test('cancel conflicts when the order moved meanwhile', async () => {
        const res = await request(app).post('/api/storefront/bawarchi/orders').send({ ...cart, ...guest, paymentMethod: 'cash' });
        fakeDb.transitionOrder.mockResolvedValueOnce(null as never);
        expect((await admin('post', `/${res.body.data.order.id}/cancel`).send({ reason: 'x' })).body.code).toBe('ORDER_CHANGED');
        expect((await admin('post', '/missing/cancel').send({ reason: 'x' })).status).toBe(404);
    });
});

describe('ordering settings', () => {
    const admin = (method: 'get' | 'put', auth = owner) => request(app)[method]('/api/admin/orders/settings').set('Authorization', auth);
    const body = (over: Record<string, unknown> = {}) => ({ slug: 'bawarchi', ordering: { ...openSettings }, ...over });

    test('reads settings with a slug suggestion', async () => {
        state.restaurants[0] = restaurant({ slug: undefined, ordering: undefined });
        const res = await admin('get');
        expect(res.body.data).toMatchObject({ slug: null, suggestedSlug: 'bawarchis-kitchen', ordering: { storeOpen: false } });
        expect(res.body.data).not.toHaveProperty('onlinePaymentsAvailable');
        expect(res.body.data.ordering).not.toHaveProperty('cashAccepted');
        state.restaurants = [];
        expect((await admin('get')).status).toBe(404);
    });

    test('saves settings and slug', async () => {
        const res = await admin('put').send(body({ slug: 'Bawarchi-HYD', ordering: { ...openSettings, delivery: { enabled: true, flatFee: 30, minOrder: 0, freeAbove: null } } }));
        expect(res.status).toBe(200);
        expect(res.body.data.slug).toBe('bawarchi-hyd');
        expect(state.restaurants[0].ordering!.delivery).toEqual({ enabled: true, flatFee: 30, minOrder: 0 });
        const keepSlug = await admin('put').send({ ordering: { ...openSettings, storeOpen: false } });
        expect(keepSlug.body.data.slug).toBe('bawarchi-hyd');
    });

    test('enforces the rules for opening the store', async () => {
        state.restaurants[0] = restaurant({ slug: undefined });
        expect((await admin('put').send({ ordering: openSettings })).body.error).toBe('Choose a web address before opening for orders.');
        expect((await admin('put').send(body({ ordering: { ...openSettings, delivery: { ...openSettings.delivery, enabled: false }, pickup: { enabled: false } } }))).body.error)
            .toBe('Turn on delivery, pickup or dine-in before opening for orders.');
        // An older dashboard still sending cashAccepted can open the store; the field is dropped.
        const legacy = await admin('put').send(body({ ordering: { ...openSettings, cashAccepted: false } }));
        expect(legacy.status).toBe(200);
        expect(state.restaurants[0].ordering).not.toHaveProperty('cashAccepted');
        expect((await admin('put').send(body({ slug: 'no' }))).status).toBe(400);
        expect((await admin('put').send(body({ ordering: { ...openSettings, taxRatePercent: 40 } }))).body.error).toBe('Tax can be at most 28%.');
    });

    test('a taken slug is a conflict; a missing restaurant is 404', async () => {
        const res = await admin('put').send(body({ slug: 'taken-name' }));
        expect(res.status).toBe(409);
        expect(res.body.error).toBe('That web address is taken. Try another.');
        fakeDb.updateRestaurantOrdering.mockResolvedValueOnce(null as never);
        expect((await admin('put').send(body())).status).toBe(404);
        fakeDb.updateRestaurantOrdering.mockRejectedValueOnce(new Error('boom'));
        expect((await admin('put').send(body())).status).toBe(500);
        state.restaurants = [];
        expect((await admin('put').send(body())).status).toBe(404);
    });
});
