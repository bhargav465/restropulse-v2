/**
 * Route-level tests for the storefront Razorpay payment step:
 *   - POST /api/storefront/:slug/payments/intent   (idempotency + E11000 race)
 *   - POST /api/storefront/:slug/payments/verify    (valid + tampered signature)
 *   - POST /api/payments/webhook                     (valid + tampered signature,
 *                                                     reconciliation, race replay)
 *
 * The DB layer and the Razorpay service are mocked so the tests exercise the
 * route logic (state transitions, rank-safety, event emission) deterministically.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { MongoServerError } from 'mongodb';

// ----- DB mock -----
const mockFindRestaurantBySlug = vi.fn();
const mockFindCustomerById = vi.fn();
const mockFindOrderById = vi.fn();
const mockFindPaymentByOrderId = vi.fn();
const mockFindPaymentByProviderOrderId = vi.fn();
const mockInsertAnalyticsEvent = vi.fn().mockResolvedValue(undefined);

const mockPaymentInsertOne = vi.fn();
const mockPaymentUpdateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
const mockOrderFindOneAndUpdate = vi.fn();

vi.mock('@restropulse/db', async (importOriginal) => {
    const actual = await importOriginal() as any;
    return {
        ...actual,
        findRestaurantBySlug: mockFindRestaurantBySlug,
        findCustomerById: mockFindCustomerById,
        findOrderById: mockFindOrderById,
        findPaymentByOrderId: mockFindPaymentByOrderId,
        findPaymentByProviderOrderId: mockFindPaymentByProviderOrderId,
        insertAnalyticsEvent: mockInsertAnalyticsEvent,
        getPaymentsCollection: () => ({ insertOne: mockPaymentInsertOne, updateOne: mockPaymentUpdateOne }),
        getOrdersCollection: () => ({ findOneAndUpdate: mockOrderFindOneAndUpdate }),
        toApiFormat: (d: any) => d,
        toObjectId: (id: string) => id,
    };
});

// ----- Razorpay service mock -----
const mockCreateRazorpayOrder = vi.fn();
const mockVerifyPaymentSignature = vi.fn();
const mockVerifyWebhookSignature = vi.fn();
const mockGetRazorpayKeyId = vi.fn().mockReturnValue('rzp_test_key');
const mockIsRazorpayConfigured = vi.fn().mockReturnValue(true);

vi.mock('../../src/services/razorpay.js', () => ({
    createRazorpayOrder: mockCreateRazorpayOrder,
    verifyPaymentSignature: mockVerifyPaymentSignature,
    verifyWebhookSignature: mockVerifyWebhookSignature,
    getRazorpayKeyId: mockGetRazorpayKeyId,
    isRazorpayConfigured: mockIsRazorpayConfigured,
}));

const { default: storefrontRoutes } = await import('../../src/routes/storefront.js');
const { default: paymentsWebhookRoutes } = await import('../../src/routes/payments-webhook.js');
const { generateCustomerTokens } = await import('../../src/services/jwt.js');

const RESTAURANT = { id: 'r1', name: 'Test Kitchen', slug: 'test' };
const CUSTOMER_TOKEN = generateCustomerTokens('cust1', 'c@example.com', 'r1').accessToken;

function baseOrder(overrides: Record<string, unknown> = {}) {
    return {
        id: 'ord1',
        restaurantId: 'r1',
        customerId: 'cust1',
        orderNumber: 'ORD-TEST1',
        orderType: 'pickup',
        items: [{ menuItemId: 'm1', name: 'Dish', qty: 1, unitPrice: 100, lineTotal: 100 }],
        totals: { subtotal: 100, tax: 0, deliveryFee: 0, discount: 0, total: 100 },
        status: 'PENDING_PAYMENT',
        statusHistory: [{ status: 'PENDING_PAYMENT', at: new Date().toISOString(), note: 'Awaiting payment' }],
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    };
}

function makeApp() {
    const app = express();
    app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
    app.use(express.json());
    app.use('/api/storefront/:slug', storefrontRoutes);
    app.use('/api/payments', paymentsWebhookRoutes);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        res.status(500).json({ success: false, error: 'Internal server error' });
    });
    return app;
}

const app = makeApp();

function emittedEventNames(): string[] {
    return mockInsertAnalyticsEvent.mock.calls.map((c) => (c[0] as { name: string }).name);
}

beforeEach(() => {
    vi.clearAllMocks();
    mockFindRestaurantBySlug.mockResolvedValue(RESTAURANT);
    mockFindCustomerById.mockResolvedValue({ id: 'cust1', name: 'Cathy', phone: '+91 90000 00000' });
    mockGetRazorpayKeyId.mockReturnValue('rzp_test_key');
    mockIsRazorpayConfigured.mockReturnValue(true);
    mockPaymentUpdateOne.mockResolvedValue({ matchedCount: 1 });
});

describe('POST /payments/intent', () => {
    test('503 when Razorpay is not configured', async () => {
        mockIsRazorpayConfigured.mockReturnValue(false);
        mockFindOrderById.mockResolvedValue(baseOrder());
        const res = await request(app)
            .post('/api/storefront/test/payments/intent')
            .set('Authorization', `Bearer ${CUSTOMER_TOKEN}`)
            .send({ orderId: 'ord1' });
        expect(res.status).toBe(503);
    });

    test('first call creates one Razorpay order; server computes paise from order total', async () => {
        mockFindOrderById.mockResolvedValue(baseOrder());
        mockFindPaymentByOrderId.mockResolvedValue(null);
        mockCreateRazorpayOrder.mockResolvedValue({ id: 'order_rzp_1', amount: 10000, currency: 'INR', status: 'created' });
        mockPaymentInsertOne.mockResolvedValue({ insertedId: 'pay1' });

        const res = await request(app)
            .post('/api/storefront/test/payments/intent')
            .set('Authorization', `Bearer ${CUSTOMER_TOKEN}`)
            .send({ orderId: 'ord1' });

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ providerOrderId: 'order_rzp_1', keyId: 'rzp_test_key', amount: 10000, currency: 'INR' });
        expect(mockCreateRazorpayOrder).toHaveBeenCalledTimes(1);
        expect(mockCreateRazorpayOrder).toHaveBeenCalledWith(10000, 'ORD-TEST1');
    });

    test('idempotent: a second call reuses the existing Razorpay order (no new order created)', async () => {
        mockFindOrderById.mockResolvedValue(baseOrder());
        mockFindPaymentByOrderId.mockResolvedValue({
            id: 'pay1', restaurantId: 'r1', orderId: 'ord1', providerOrderId: 'order_rzp_1', amount: 10000, status: 'created',
        });

        const res = await request(app)
            .post('/api/storefront/test/payments/intent')
            .set('Authorization', `Bearer ${CUSTOMER_TOKEN}`)
            .send({ orderId: 'ord1' });

        expect(res.status).toBe(200);
        expect(res.body.data.providerOrderId).toBe('order_rzp_1');
        expect(mockCreateRazorpayOrder).not.toHaveBeenCalled();
    });

    test('E11000 insert race re-reads and returns the winning payment', async () => {
        mockFindOrderById.mockResolvedValue(baseOrder());
        mockFindPaymentByOrderId
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ id: 'pay1', restaurantId: 'r1', orderId: 'ord1', providerOrderId: 'order_rzp_winner', amount: 10000, status: 'created' });
        mockCreateRazorpayOrder.mockResolvedValue({ id: 'order_rzp_loser', amount: 10000, currency: 'INR', status: 'created' });
        const dup = new MongoServerError({ message: 'E11000 duplicate key' });
        (dup as any).code = 11000;
        mockPaymentInsertOne.mockRejectedValue(dup);

        const res = await request(app)
            .post('/api/storefront/test/payments/intent')
            .set('Authorization', `Bearer ${CUSTOMER_TOKEN}`)
            .send({ orderId: 'ord1' });

        expect(res.status).toBe(200);
        expect(res.body.data.providerOrderId).toBe('order_rzp_winner');
    });

    test('409 when the order is already paid (captured payment exists)', async () => {
        mockFindOrderById.mockResolvedValue(baseOrder({ status: 'RECEIVED' }));
        // status must be PENDING_PAYMENT/PAYMENT_FAILED to reach payment logic
        const res = await request(app)
            .post('/api/storefront/test/payments/intent')
            .set('Authorization', `Bearer ${CUSTOMER_TOKEN}`)
            .send({ orderId: 'ord1' });
        expect(res.status).toBe(409);
    });

    test("404 when the order belongs to a different customer", async () => {
        mockFindOrderById.mockResolvedValue(baseOrder({ customerId: 'someone-else' }));
        const res = await request(app)
            .post('/api/storefront/test/payments/intent')
            .set('Authorization', `Bearer ${CUSTOMER_TOKEN}`)
            .send({ orderId: 'ord1' });
        expect(res.status).toBe(404);
    });
});

describe('POST /payments/verify', () => {
    const verifyBody = {
        orderId: 'ord1',
        razorpayPaymentId: 'pay_1',
        razorpayOrderId: 'order_rzp_1',
        razorpaySignature: 'sig_valid',
    };

    test('valid signature captures the payment and confirms the order + 3 funnel events', async () => {
        mockFindPaymentByOrderId.mockResolvedValue({ id: 'pay1', restaurantId: 'r1', orderId: 'ord1', providerOrderId: 'order_rzp_1', amount: 10000, status: 'created' });
        mockFindOrderById.mockResolvedValue(baseOrder());
        mockVerifyPaymentSignature.mockReturnValue(true);
        mockOrderFindOneAndUpdate.mockResolvedValue(baseOrder({ status: 'RECEIVED' }));

        const res = await request(app)
            .post('/api/storefront/test/payments/verify')
            .set('Authorization', `Bearer ${CUSTOMER_TOKEN}`)
            .send(verifyBody);

        expect(res.status).toBe(200);
        expect(res.body.data.order.status).toBe('RECEIVED');
        expect(mockOrderFindOneAndUpdate).toHaveBeenCalledTimes(1);
        const names = emittedEventNames();
        expect(names).toEqual(expect.arrayContaining(['order_status_changed', 'order_placed', 'payment_succeeded']));
    });

    test('tampered signature is rejected (400), no order transition, no funnel events', async () => {
        mockFindPaymentByOrderId.mockResolvedValue({ id: 'pay1', restaurantId: 'r1', orderId: 'ord1', providerOrderId: 'order_rzp_1', amount: 10000, status: 'created' });
        mockFindOrderById.mockResolvedValue(baseOrder());
        mockVerifyPaymentSignature.mockReturnValue(false);

        const res = await request(app)
            .post('/api/storefront/test/payments/verify')
            .set('Authorization', `Bearer ${CUSTOMER_TOKEN}`)
            .send(verifyBody);

        expect(res.status).toBe(400);
        expect(mockOrderFindOneAndUpdate).not.toHaveBeenCalled();
        expect(emittedEventNames()).toHaveLength(0);
        // A verify_failed audit event is appended to the payment doc, status untouched.
        expect(mockPaymentUpdateOne).toHaveBeenCalledTimes(1);
    });

    test('400 when razorpayOrderId does not match the payment', async () => {
        mockFindPaymentByOrderId.mockResolvedValue({ id: 'pay1', restaurantId: 'r1', orderId: 'ord1', providerOrderId: 'order_rzp_other', amount: 10000, status: 'created' });
        mockFindOrderById.mockResolvedValue(baseOrder());

        const res = await request(app)
            .post('/api/storefront/test/payments/verify')
            .set('Authorization', `Bearer ${CUSTOMER_TOKEN}`)
            .send(verifyBody);

        expect(res.status).toBe(400);
        expect(mockVerifyPaymentSignature).not.toHaveBeenCalled();
    });

    test('replay after webhook capture returns 200 with no duplicate events or signature check', async () => {
        mockFindPaymentByOrderId.mockResolvedValue({ id: 'pay1', restaurantId: 'r1', orderId: 'ord1', providerOrderId: 'order_rzp_1', amount: 10000, status: 'captured' });
        mockFindOrderById.mockResolvedValue(baseOrder({ status: 'RECEIVED' }));

        const res = await request(app)
            .post('/api/storefront/test/payments/verify')
            .set('Authorization', `Bearer ${CUSTOMER_TOKEN}`)
            .send(verifyBody);

        expect(res.status).toBe(200);
        expect(res.body.data.order.status).toBe('RECEIVED');
        expect(mockVerifyPaymentSignature).not.toHaveBeenCalled();
        expect(mockOrderFindOneAndUpdate).not.toHaveBeenCalled();
        expect(emittedEventNames()).toHaveLength(0);
    });
});

describe('POST /api/payments/webhook', () => {
    function post(body: unknown, sig = 'sig') {
        return request(app)
            .post('/api/payments/webhook')
            .set('x-razorpay-signature', sig)
            .set('Content-Type', 'application/json')
            .send(JSON.stringify(body));
    }

    const capturedEvent = { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', order_id: 'order_rzp_1' } } } };
    const failedEvent = { event: 'payment.failed', payload: { payment: { entity: { id: 'pay_1', order_id: 'order_rzp_1', error_code: 'BAD_CARD', error_description: 'Card declined' } } } };

    test('401 on tampered signature — no reconciliation lookup happens', async () => {
        mockVerifyWebhookSignature.mockReturnValue(false);
        const res = await post(capturedEvent);
        expect(res.status).toBe(401);
        expect(mockFindPaymentByProviderOrderId).not.toHaveBeenCalled();
    });

    test('400 when the signature header is missing', async () => {
        const res = await request(app)
            .post('/api/payments/webhook')
            .set('Content-Type', 'application/json')
            .send(JSON.stringify(capturedEvent));
        expect(res.status).toBe(400);
    });

    test('valid payment.captured confirms the order and emits 3 events', async () => {
        mockVerifyWebhookSignature.mockReturnValue(true);
        mockFindPaymentByProviderOrderId.mockResolvedValue({ id: 'pay1', restaurantId: 'r1', orderId: 'ord1', providerOrderId: 'order_rzp_1', status: 'created' });
        mockFindOrderById.mockResolvedValue(baseOrder());
        mockOrderFindOneAndUpdate.mockResolvedValue(baseOrder({ status: 'RECEIVED' }));

        const res = await post(capturedEvent);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(mockOrderFindOneAndUpdate).toHaveBeenCalledTimes(1);
        expect(emittedEventNames()).toEqual(expect.arrayContaining(['order_status_changed', 'order_placed', 'payment_succeeded']));
    });

    test('unknown provider order (e.g. a subscription payment) is ignored with 200', async () => {
        mockVerifyWebhookSignature.mockReturnValue(true);
        mockFindPaymentByProviderOrderId.mockResolvedValue(null);

        const res = await post(capturedEvent);

        expect(res.status).toBe(200);
        expect(mockOrderFindOneAndUpdate).not.toHaveBeenCalled();
        expect(emittedEventNames()).toHaveLength(0);
    });

    test('captured webhook does not regress an already-captured payment (no re-emit)', async () => {
        mockVerifyWebhookSignature.mockReturnValue(true);
        mockFindPaymentByProviderOrderId.mockResolvedValue({ id: 'pay1', restaurantId: 'r1', orderId: 'ord1', providerOrderId: 'order_rzp_1', status: 'captured' });

        const res = await post(capturedEvent);

        expect(res.status).toBe(200);
        expect(mockOrderFindOneAndUpdate).not.toHaveBeenCalled();
        expect(emittedEventNames()).toHaveLength(0);
    });

    test('payment.failed marks the order PAYMENT_FAILED and emits payment_failed', async () => {
        mockVerifyWebhookSignature.mockReturnValue(true);
        mockFindPaymentByProviderOrderId.mockResolvedValue({ id: 'pay1', restaurantId: 'r1', orderId: 'ord1', providerOrderId: 'order_rzp_1', status: 'created' });
        mockFindOrderById.mockResolvedValue(baseOrder());
        mockOrderFindOneAndUpdate.mockResolvedValue(baseOrder({ status: 'PAYMENT_FAILED' }));

        const res = await post(failedEvent);

        expect(res.status).toBe(200);
        expect(mockOrderFindOneAndUpdate).toHaveBeenCalledTimes(1);
        const names = emittedEventNames();
        expect(names).toEqual(expect.arrayContaining(['order_status_changed', 'payment_failed']));
        expect(names).not.toContain('payment_succeeded');
    });
});
