/**
 * Delivery (Phase 2 M4): admin dispatch routes, partner webhooks and the
 * order-status hook that queues rider bookings. @restropulse/db is an
 * in-memory fake; partners come from @restropulse/delivery (self + mock).
 */
import { describe, test, expect, vi, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import type { DeliveryJob, Order, Restaurant, Shipment } from '@restropulse/shared';

const state = {
    restaurants: [] as Restaurant[],
    orders: [] as Order[],
    shipments: [] as Shipment[],
    jobs: [] as Array<DeliveryJob & { openKey?: string }>,
    receipts: new Set<string>(),
    seq: 0,
};
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const fakeDb = {
    findRestaurantById: vi.fn(async (id: string) => clone(state.restaurants.find((r) => r.id === id) ?? null)),
    findOrderById: vi.fn(async (rid: string, id: string) => clone(state.orders.find((o) => o.restaurantId === rid && o.id === id) ?? null)),
    updateRestaurantDeliverySettings: vi.fn(async (rid: string, settings: unknown) => {
        const r = state.restaurants.find((x) => x.id === rid);
        if (!r) return null;
        r.deliverySettings = settings as Restaurant['deliverySettings'];
        return clone(r);
    }),
    enqueueDeliveryJob: vi.fn(async (input: { type: 'dispatch' | 'cancel'; restaurantId: string; orderId: string; reason?: string; dedupeKey?: string }) => {
        if (input.dedupeKey && state.jobs.some((j) => j.openKey === input.dedupeKey)) return null;
        const job = {
            id: `j${++state.seq}`, type: input.type, restaurantId: input.restaurantId, orderId: input.orderId, reason: input.reason,
            status: 'pending', attempts: 0, nextRunAt: new Date().toISOString(), createdAt: new Date().toISOString(), updatedAt: '', openKey: input.dedupeKey,
        } as DeliveryJob & { openKey?: string };
        state.jobs.push(job);
        return clone(job);
    }),
    findLatestDeliveryJob: vi.fn(async (_rid: string, orderId: string) => clone(state.jobs.filter((j) => j.orderId === orderId).at(-1) ?? null)),
    findShipmentForOrder: vi.fn(async (_rid: string, orderId: string) => clone(state.shipments.filter((s) => s.orderId === orderId).at(-1) ?? null)),
    findShipmentByProviderId: vi.fn(async (p: string, id: string) => clone(state.shipments.find((s) => s.provider === p && s.providerShipmentId === id) ?? null)),
    insertShipment: vi.fn(async (s: Omit<Shipment, 'id' | 'createdAt' | 'updatedAt'>) => {
        const row = { ...clone(s), id: `s${++state.seq}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Shipment;
        state.shipments.push(row);
        return clone(row);
    }),
    recordDeliveryWebhookEvent: vi.fn(async (p: string, id: string) => {
        if (state.receipts.has(`${p}:${id}`)) return false;
        state.receipts.add(`${p}:${id}`);
        return true;
    }),
    forgetDeliveryWebhookEvent: vi.fn(async (p: string, id: string) => { state.receipts.delete(`${p}:${id}`); }),
};

const store = {
    findOrder: (rid: string, id: string) => fakeDb.findOrderById(rid, id),
    moveOrder: vi.fn(async (rid: string, id: string, from: string, to: string) => {
        const o = state.orders.find((x) => x.restaurantId === rid && x.id === id && x.status === from);
        if (!o) return null;
        o.status = to as Order['status'];
        return clone(o);
    }),
    updateShipment: vi.fn(async (id: string, expected: string, patch: Partial<Shipment>) => {
        const s = state.shipments.find((x) => x.id === id && x.status === expected);
        if (!s) return null;
        Object.assign(s, clone(patch));
        return clone(s);
    }),
    findShipmentByProviderId: (p: string, id: string) => fakeDb.findShipmentByProviderId(p, id),
};

vi.mock('@restropulse/db', async (importOriginal) => {
    const actual = await importOriginal() as Record<string, unknown>;
    return { ...actual, ...fakeDb, mongoDeliveryStore: store };
});

const telemetry = vi.hoisted(() => ({ trackEvent: vi.fn(), logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@restropulse/telemetry/server', () => ({ createLogger: vi.fn(() => telemetry.logger), trackEvent: telemetry.trackEvent }));

const { generateTokens } = await import('../../src/services/jwt.js');
const { default: adminDeliveryRoutes } = await import('../../src/routes/admin-delivery.js');
const { default: deliveryWebhookRoutes } = await import('../../src/routes/delivery-webhooks.js');
const { _setDeliveryRegistry, getDeliveryRegistry } = await import('../../src/services/delivery/registry.js');
const { handleOrderStatusForDelivery, registerDeliveryDispatch } = await import('../../src/services/delivery/dispatch-hook.js');
const orderService = await import('../../src/services/orders/order-service.js');
const { createDeliveryRegistry, createMockProvider, createSelfProvider, mockSignature } = await import('@restropulse/delivery');

const SECRET = 'mock-secret';
_setDeliveryRegistry(createDeliveryRegistry([createSelfProvider(), createMockProvider({ webhookSecret: SECRET })]));
afterAll(() => _setDeliveryRegistry(null));

const app = express();
app.use('/api/webhooks/delivery', express.raw({ type: () => true }));
app.use(express.json());
app.use('/api/admin/delivery', adminDeliveryRoutes);
app.use('/api/webhooks/delivery', deliveryWebhookRoutes);
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ success: false, error: err.message });
});

const owner = `Bearer ${generateTokens('u1', '+910000000000', 'r1', 'OWNER').accessToken}`;
const viewer = `Bearer ${generateTokens('u2', '+910000000001', 'r1', 'VIEWER' as never).accessToken}`;
const admin = (method: 'get' | 'post' | 'put', path: string, auth = owner) => request(app)[method](`/api/admin/delivery${path}`).set('Authorization', auth);

function order(over: Partial<Order> = {}): Order {
    return {
        id: 'o1', restaurantId: 'r1', orderNumber: 'RP-ABC234', trackingToken: 't'.repeat(24), orderType: 'delivery', items: [],
        totals: { subtotal: 400, discount: 0, deliveryFee: 30, deliveryDiscount: 0, tax: 20, total: 450 },
        status: 'READY', statusHistory: [], paymentMethod: 'cash',
        customerName: 'Asha', customerPhone: '+919800000000', address: { line1: '12 MG Road', pincode: '560001' },
        createdAt: '', updatedAt: '', ...over,
    };
}

function shipment(over: Partial<Shipment> = {}): Shipment {
    return { id: 's-x', restaurantId: 'r1', orderId: 'o1', provider: 'self', providerShipmentId: 'self_o1_a', status: 'BOOKED', events: [], createdAt: '', updatedAt: '', ...over };
}

beforeEach(() => {
    state.restaurants = [{ id: 'r1', name: '[SAMPLE] Spice Route', deliverySettings: { dispatchEnabled: true, providers: ['mock', 'self'] } } as Restaurant];
    state.orders = [order(), order({ id: 'o2', orderType: 'pickup' })];
    state.shipments = [];
    state.jobs = [];
    state.receipts = new Set();
    vi.clearAllMocks();
});

describe('delivery settings', () => {
    test('needs a manager or owner', async () => {
        expect((await request(app).get('/api/admin/delivery/settings')).status).toBe(401);
        expect((await admin('get', '/settings', viewer)).status).toBe(403);
    });

    test('lists the partners available here and hides ones that are not', async () => {
        state.restaurants[0].deliverySettings = { dispatchEnabled: true, providers: ['rapido', 'mock', 'self'] };
        const res = await admin('get', '/settings');
        expect(res.body.data.settings).toEqual({ dispatchEnabled: true, dispatchAt: 'READY', strategy: 'preferred', providers: ['mock', 'self'] });
        expect(res.body.data.providers.map((p: { id: string }) => p.id)).toEqual(['self', 'mock']);
    });

    test('saves valid settings and refuses partners this server lacks', async () => {
        const body = { dispatchEnabled: true, dispatchAt: 'PREPARING', strategy: 'cheapest', providers: ['mock', 'self'] };
        const ok = await admin('put', '/settings').send(body);
        expect(ok.status).toBe(200);
        expect(state.restaurants[0].deliverySettings).toEqual(body);
        expect(telemetry.trackEvent).toHaveBeenCalledWith('delivery_settings_saved', { restaurantId: 'r1', dispatchEnabled: 'true', providers: 'mock,self' });
        const rapido = await admin('put', '/settings').send({ ...body, providers: ['rapido'] });
        expect(rapido.status).toBe(400);
        expect(rapido.body.error).toBe("rapido isn't available yet.");
        expect((await admin('put', '/settings').send({ ...body, providers: [] })).status).toBe(400);
        expect((await admin('put', '/settings').send({ ...body, strategy: 'random' })).status).toBe(400);
    });

    test('404s for a missing restaurant', async () => {
        state.restaurants = [];
        expect((await admin('get', '/settings')).status).toBe(404);
        expect((await admin('put', '/settings').send({ dispatchEnabled: false, dispatchAt: 'READY', strategy: 'preferred', providers: ['self'] })).status).toBe(404);
    });
});

describe('an order\'s rider', () => {
    test('shows nothing booked, then a queued job, then a failure', async () => {
        expect((await admin('get', '/orders/o1')).body.data).toEqual({ shipment: null, queued: null, lastError: null });
        await admin('post', '/orders/o1/dispatch');
        expect((await admin('get', '/orders/o1')).body.data.queued).toBe('dispatch');
        state.jobs[0].status = 'failed';
        expect((await admin('get', '/orders/o1')).body.data).toMatchObject({ queued: null, lastError: 'Could not reach the delivery partner.' });
        state.jobs[0].lastError = 'No address';
        expect((await admin('get', '/orders/o1')).body.data.lastError).toBe('No address');
    });

    test('only delivery orders, and only real ones', async () => {
        expect((await admin('get', '/orders/o2')).status).toBe(400);
        expect((await admin('get', '/orders/nope')).status).toBe(404);
        expect((await admin('get', '/orders/bad%20id')).status).toBe(404);
    });

    test('finding a rider queues one job and refuses when it is too late or already booked', async () => {
        const res = await admin('post', '/orders/o1/dispatch');
        expect(res.status).toBe(202);
        expect(res.body.data.queued).toBe('dispatch');
        await admin('post', '/orders/o1/dispatch');
        expect(state.jobs).toHaveLength(1);
        state.shipments.push(shipment());
        expect((await admin('post', '/orders/o1/dispatch')).status).toBe(409);
        state.orders[0].status = 'OUT_FOR_DELIVERY';
        expect((await admin('post', '/orders/o1/dispatch')).status).toBe(409);
    });

    test('hands an order to own riders without calling any partner', async () => {
        const res = await admin('post', '/orders/o1/own-rider');
        expect(res.status).toBe(201);
        expect(res.body.data.shipment).toMatchObject({ provider: 'self', status: 'BOOKED', carrier: 'Own rider' });
        expect((await admin('post', '/orders/o1/own-rider')).status).toBe(409);
    });

    test('own riders need a dispatchable order with an address', async () => {
        state.orders[0].address = undefined;
        expect((await admin('post', '/orders/o1/own-rider')).status).toBe(400);
        state.orders[0].status = 'COMPLETED';
        expect((await admin('post', '/orders/o1/own-rider')).status).toBe(409);
    });

    test('own riders move the shipment and the order', async () => {
        state.shipments.push(shipment());
        const assigned = await admin('post', '/orders/o1/rider').send({ status: 'RIDER_ASSIGNED', riderName: 'Ravi', riderPhone: '+91 98000 00000' });
        expect(assigned.status).toBe(200);
        expect(assigned.body.data.shipment).toMatchObject({ status: 'RIDER_ASSIGNED', rider: { name: 'Ravi', phone: '+91 98000 00000' } });
        const picked = await admin('post', '/orders/o1/rider').send({ status: 'PICKED_UP' });
        expect(picked.body.data.orderStatus).toBe('OUT_FOR_DELIVERY');
        expect((await admin('post', '/orders/o1/rider').send({ status: 'RIDER_ASSIGNED' })).status).toBe(409);
        const done = await admin('post', '/orders/o1/rider').send({ status: 'DELIVERED' });
        expect(done.body.data.orderStatus).toBe('COMPLETED');
        expect(state.orders[0].status).toBe('COMPLETED');
    });

    test('own-rider updates are refused for partner bookings, bad input and lost races', async () => {
        expect((await admin('post', '/orders/o1/rider').send({ status: 'PICKED_UP' })).status).toBe(409);
        state.shipments.push(shipment({ provider: 'mock', providerShipmentId: 'mock_o1_a' }));
        expect((await admin('post', '/orders/o1/rider').send({ status: 'PICKED_UP' })).status).toBe(409);
        state.shipments = [shipment()];
        expect((await admin('post', '/orders/o1/rider').send({ status: 'BOOKED' })).status).toBe(400);
        expect((await admin('post', '/orders/o1/rider').send({ status: 'PICKED_UP', riderPhone: 'call me' })).status).toBe(400);
        store.updateShipment.mockResolvedValueOnce(null);
        fakeDb.findShipmentByProviderId.mockResolvedValueOnce(null);
        expect((await admin('post', '/orders/o1/rider').send({ status: 'PICKED_UP' })).status).toBe(409);
    });

    test('cancelling queues a job before pickup only', async () => {
        expect((await admin('post', '/orders/o1/cancel').send({ reason: 'Customer called' })).status).toBe(409);
        state.shipments.push(shipment({ status: 'RIDER_ASSIGNED' }));
        const ok = await admin('post', '/orders/o1/cancel').send({ reason: 'Customer called' });
        expect(ok.status).toBe(202);
        expect(state.jobs[0]).toMatchObject({ type: 'cancel', reason: 'Customer called' });
        state.shipments[0].status = 'PICKED_UP';
        expect((await admin('post', '/orders/o1/cancel').send({ reason: 'Customer called' })).status).toBe(409);
        expect((await admin('post', '/orders/o1/cancel').send({ reason: '' })).status).toBe(400);
        state.shipments[0].status = 'DELIVERED';
        expect((await admin('post', '/orders/o1/cancel').send({ reason: 'Customer called' })).status).toBe(409);
    });
});

describe('partner webhooks', () => {
    const send = (provider: string, body: unknown, secret: string | null = SECRET) => {
        const raw = JSON.stringify(body);
        const r = request(app).post(`/api/webhooks/delivery/${provider}`).set('Content-Type', 'application/json');
        return (secret ? r.set('x-mock-signature', mockSignature(secret, raw)) : r).send(raw);
    };

    beforeEach(() => {
        state.shipments = [shipment({ id: 's1', provider: 'mock', providerShipmentId: 'mock_o1_a' })];
    });

    test('applies signed events and moves the order', async () => {
        const res = await send('mock', { events: [{ id: 'e1', shipmentId: 'mock_o1_a', status: 'PICKED_UP', riderName: 'Ravi' }] });
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ received: 1, applied: 1, duplicates: 0, unknown: 0 });
        expect(state.shipments[0]).toMatchObject({ status: 'PICKED_UP', rider: { name: 'Ravi' } });
        expect(state.orders[0].status).toBe('OUT_FOR_DELIVERY');
    });

    test('skips redeliveries and events for shipments we never booked', async () => {
        await send('mock', { events: [{ id: 'e1', shipmentId: 'mock_o1_a', status: 'RIDER_ASSIGNED' }] });
        const again = await send('mock', { events: [{ id: 'e1', shipmentId: 'mock_o1_a', status: 'RIDER_ASSIGNED' }, { id: 'e2', shipmentId: 'mock_zz', status: 'DELIVERED' }] });
        expect(again.body.data).toEqual({ received: 2, applied: 0, duplicates: 1, unknown: 1 });
    });

    test('rejects bad signatures and unknown partners', async () => {
        expect((await send('mock', { events: [] }, 'wrong')).status).toBe(401);
        expect((await send('mock', { events: [] }, null)).status).toBe(401);
        expect((await send('rapido', { events: [] })).status).toBe(404);
        expect((await send('zomato', { events: [] })).status).toBe(404);
        expect((await send('self', { events: [] })).status).toBe(401);
    });

    test('forgets the receipt and asks for a retry when applying fails', async () => {
        fakeDb.findShipmentByProviderId.mockRejectedValueOnce(new Error('db down'));
        const res = await send('mock', { events: [{ id: 'e9', shipmentId: 'mock_o1_a', status: 'PICKED_UP' }] });
        expect(res.status).toBe(500);
        expect(state.receipts.has('mock:e9')).toBe(false);
        fakeDb.recordDeliveryWebhookEvent.mockRejectedValueOnce(new Error('db down'));
        expect((await send('mock', { events: [{ id: 'e10', shipmentId: 'mock_o1_a', status: 'PICKED_UP' }] })).status).toBe(500);
        expect(fakeDb.forgetDeliveryWebhookEvent).toHaveBeenCalledTimes(1);
    });

    test('accepts a non-buffer body as empty', async () => {
        const plain = express();
        plain.use(express.json());
        plain.use('/hook', deliveryWebhookRoutes);
        expect((await request(plain).post('/hook/mock').send({ events: [] })).status).toBe(401);
    });
});

describe('dispatch hook', () => {
    test('queues a booking when a delivery order reaches the dispatch point', async () => {
        await handleOrderStatusForDelivery(order({ status: 'READY' }), 'PREPARING');
        expect(state.jobs).toHaveLength(1);
        expect(state.jobs[0]).toMatchObject({ type: 'dispatch', openKey: 'dispatch:o1' });
        await handleOrderStatusForDelivery(order({ status: 'READY' }), 'PREPARING');
        expect(state.jobs).toHaveLength(1);
        expect(telemetry.trackEvent).toHaveBeenCalledTimes(1);
    });

    test('respects the PREPARING head start, the switch and order type', async () => {
        state.restaurants[0].deliverySettings = { dispatchEnabled: true, dispatchAt: 'PREPARING', providers: ['mock'] };
        await handleOrderStatusForDelivery(order({ status: 'READY' }), 'PREPARING');
        expect(state.jobs).toHaveLength(0);
        await handleOrderStatusForDelivery(order({ status: 'PREPARING' }), 'RECEIVED');
        expect(state.jobs).toHaveLength(1);
        state.restaurants[0].deliverySettings = { dispatchEnabled: false };
        await handleOrderStatusForDelivery(order({ id: 'o3', status: 'READY' }), 'PREPARING');
        await handleOrderStatusForDelivery(order({ id: 'o4', orderType: 'pickup', status: 'READY' }), 'PREPARING');
        state.restaurants = [];
        await handleOrderStatusForDelivery(order({ id: 'o5', status: 'READY' }), 'PREPARING');
        expect(state.jobs).toHaveLength(1);
    });

    test('queues a cancel when an order with a live booking is cancelled', async () => {
        await handleOrderStatusForDelivery(order({ status: 'CANCELLED' }), 'READY');
        expect(state.jobs).toHaveLength(0);
        state.shipments.push(shipment({ status: 'RIDER_ASSIGNED' }));
        await handleOrderStatusForDelivery(order({ status: 'CANCELLED', cancelReason: 'Out of stock' }), 'READY');
        expect(state.jobs[0]).toMatchObject({ type: 'cancel', reason: 'Out of stock' });
        await handleOrderStatusForDelivery(order({ status: 'CANCELLED' }), 'READY');
        expect(state.jobs).toHaveLength(1);
        state.jobs = [];
        await handleOrderStatusForDelivery(order({ id: 'o1', status: 'CANCELLED' }), 'READY');
        expect(state.jobs[0].reason).toBe('Order cancelled');
        state.jobs = [];
        state.shipments[0].status = 'PICKED_UP';
        await handleOrderStatusForDelivery(order({ status: 'CANCELLED' }), 'READY');
        expect(state.jobs).toHaveLength(0);
    });

    test('registers once on the order service and can be removed', async () => {
        orderService._resetOrderListeners();
        const spy = vi.spyOn(orderService, 'onOrderStatusChange');
        const off = registerDeliveryDispatch();
        registerDeliveryDispatch();
        off();
        expect(() => registerDeliveryDispatch()()).not.toThrow();
        spy.mockRestore();
    });

    test('the registry is built from the environment by default', () => {
        _setDeliveryRegistry(null);
        expect(getDeliveryRegistry().has('self')).toBe(true);
        _setDeliveryRegistry(createDeliveryRegistry([createSelfProvider(), createMockProvider({ webhookSecret: SECRET })]));
    });
});
