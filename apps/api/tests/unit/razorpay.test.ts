import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// Set env vars before importing the module
const ORIGINAL_ENV = { ...process.env };

describe('Razorpay Service', () => {
    let razorpay: typeof import('../../src/services/razorpay.js');

    beforeEach(async () => {
        process.env.RAZORPAY_KEY_ID = 'rzp_test_key123';
        process.env.RAZORPAY_KEY_SECRET = 'rzp_test_secret456';
        process.env.RAZORPAY_WEBHOOK_SECRET = 'webhook_secret_789';
        // Dynamic import to pick up env vars
        razorpay = await import('../../src/services/razorpay.js');
    });

    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        vi.restoreAllMocks();
    });

    describe('getRazorpayKeyId', () => {
        test('should return the configured key ID', () => {
            expect(razorpay.getRazorpayKeyId()).toBe('rzp_test_key123');
        });
    });

    describe('verifyWebhookSignature', () => {
        test('should return true for valid signature', () => {
            const crypto = require('crypto');
            const body = '{"event":"test"}';
            const expectedSig = crypto
                .createHmac('sha256', 'webhook_secret_789')
                .update(body)
                .digest('hex');

            expect(razorpay.verifyWebhookSignature(body, expectedSig)).toBe(true);
        });

        test('should return false for invalid signature', () => {
            // timingSafeEqual requires same-length buffers, so generate a valid-length but wrong signature
            const crypto = require('crypto');
            const wrongSig = crypto
                .createHmac('sha256', 'wrong_secret')
                .update('{"event":"test"}')
                .digest('hex');
            expect(razorpay.verifyWebhookSignature('{"event":"test"}', wrongSig)).toBe(false);
        });
    });

    describe('verifyPaymentSignature', () => {
        test('should return true for valid payment signature', () => {
            const crypto = require('crypto');
            const payload = 'order_123|pay_456';
            const expectedSig = crypto
                .createHmac('sha256', 'rzp_test_secret456')
                .update(payload)
                .digest('hex');

            expect(razorpay.verifyPaymentSignature('order_123', 'pay_456', expectedSig)).toBe(true);
        });

        test('should return false for invalid payment signature', () => {
            const crypto = require('crypto');
            const wrongSig = crypto
                .createHmac('sha256', 'wrong_secret')
                .update('order_123|pay_456')
                .digest('hex');
            expect(razorpay.verifyPaymentSignature('order_123', 'pay_456', wrongSig)).toBe(false);
        });
    });

    describe('verifySubscriptionSignature', () => {
        test('should return true for valid subscription signature (payment_id|subscription_id)', () => {
            const crypto = require('crypto');
            const payload = 'pay_abc|sub_xyz';
            const expectedSig = crypto
                .createHmac('sha256', 'rzp_test_secret456')
                .update(payload)
                .digest('hex');

            expect(razorpay.verifySubscriptionSignature('pay_abc', 'sub_xyz', expectedSig)).toBe(true);
        });

        test('should return false for invalid subscription signature', () => {
            const crypto = require('crypto');
            const wrongSig = crypto
                .createHmac('sha256', 'wrong_secret')
                .update('pay_abc|sub_xyz')
                .digest('hex');
            expect(razorpay.verifySubscriptionSignature('pay_abc', 'sub_xyz', wrongSig)).toBe(false);
        });

        test('should reject a signature built with order-style payload (subscription uses payment_id|subscription_id)', () => {
            const crypto = require('crypto');
            // Order-style payload would be sub_xyz|pay_abc (reverse); reject it.
            const orderStyleSig = crypto
                .createHmac('sha256', 'rzp_test_secret456')
                .update('sub_xyz|pay_abc')
                .digest('hex');
            expect(razorpay.verifySubscriptionSignature('pay_abc', 'sub_xyz', orderStyleSig)).toBe(false);
        });
    });

    describe('fetchRazorpaySubscription', () => {
        test('should call GET /v1/subscriptions/:id', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ id: 'sub_xyz', status: 'active', current_start: 1, current_end: 2, plan_id: 'plan_123' }),
            });
            vi.stubGlobal('fetch', mockFetch);

            const result = await razorpay.fetchRazorpaySubscription('sub_xyz');

            expect(mockFetch).toHaveBeenCalledWith(
                'https://api.razorpay.com/v1/subscriptions/sub_xyz',
                expect.objectContaining({ method: 'GET' }),
            );
            expect(result.status).toBe('active');
        });
    });

    describe('fetchRazorpayPayment', () => {
        test('should call GET /v1/payments/:id', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ id: 'pay_abc', amount: 99900, currency: 'INR', status: 'captured', invoice_id: 'inv_1' }),
            });
            vi.stubGlobal('fetch', mockFetch);

            const result = await razorpay.fetchRazorpayPayment('pay_abc');

            expect(mockFetch).toHaveBeenCalledWith(
                'https://api.razorpay.com/v1/payments/pay_abc',
                expect.objectContaining({ method: 'GET' }),
            );
            expect(result.amount).toBe(99900);
        });
    });

    describe('createRazorpaySubscription', () => {
        test('should call Razorpay subscriptions API', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ id: 'sub_rzp_new', short_url: 'https://rzp.io/sub', status: 'created' }),
            });
            vi.stubGlobal('fetch', mockFetch);

            const result = await razorpay.createRazorpaySubscription('plan_monthly', 120);

            expect(mockFetch).toHaveBeenCalledWith(
                'https://api.razorpay.com/v1/subscriptions',
                expect.objectContaining({ method: 'POST' }),
            );
            expect(result.id).toBe('sub_rzp_new');
        });

        test('should include offer_id when provided', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ id: 'sub_rzp_offer', status: 'created' }),
            });
            vi.stubGlobal('fetch', mockFetch);

            await razorpay.createRazorpaySubscription('plan_monthly', 120, 'offer_123');

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.offer_id).toBe('offer_123');
        });

        test('should throw on API error', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 400,
                json: () => Promise.resolve({ error: { description: 'Bad request' } }),
            });
            vi.stubGlobal('fetch', mockFetch);

            await expect(razorpay.createRazorpaySubscription('plan_bad', 120))
                .rejects.toThrow('Bad request');
        });
    });

    describe('cancelRazorpaySubscription', () => {
        test('should call Razorpay cancel API with cancel_at_cycle_end', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ id: 'sub_123', status: 'cancelled' }),
            });
            vi.stubGlobal('fetch', mockFetch);

            await razorpay.cancelRazorpaySubscription('sub_123', true);

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.cancel_at_cycle_end).toBe(1);
        });

        test('should set cancel_at_cycle_end to 0 when false', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ id: 'sub_123', status: 'cancelled' }),
            });
            vi.stubGlobal('fetch', mockFetch);

            await razorpay.cancelRazorpaySubscription('sub_123', false);

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.cancel_at_cycle_end).toBe(0);
        });
    });

    describe('fetchRazorpayCustomersByContact', () => {
        test('should call customers API with encoded contact and return items', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ items: [{ id: 'cust_recovered_123' }] }),
            });
            vi.stubGlobal('fetch', mockFetch);

            const result = await razorpay.fetchRazorpayCustomersByContact('+91 98765 43210');

            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/customers?contact='),
                expect.objectContaining({ method: 'GET' }),
            );
            expect(result.items[0].id).toBe('cust_recovered_123');
        });

        test('should throw on API error', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 500,
                json: () => Promise.resolve({ error: { description: 'Internal server error' } }),
            });
            vi.stubGlobal('fetch', mockFetch);

            await expect(razorpay.fetchRazorpayCustomersByContact('+91 98765 43210'))
                .rejects.toThrow('Internal server error');
        });
    });

    describe('createRazorpayOrder', () => {
        test('should call Razorpay orders API', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ id: 'order_123', amount: 19900, currency: 'INR', status: 'created' }),
            });
            vi.stubGlobal('fetch', mockFetch);

            const result = await razorpay.createRazorpayOrder(19900, 'receipt_1');

            expect(result.id).toBe('order_123');
            expect(result.amount).toBe(19900);
        });
    });

    describe('createRazorpayOffer', () => {
        test('should call Razorpay offers API', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ id: 'offer_123' }),
            });
            vi.stubGlobal('fetch', mockFetch);

            const result = await razorpay.createRazorpayOffer({
                name: 'TEST', paymentMethod: 'card',
                discountType: 'percentage', discountValue: 10,
            });

            expect(result.id).toBe('offer_123');
        });
    });

    describe('fetchRazorpayInvoice', () => {
        test('should fetch invoice by ID', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    id: 'inv_123', short_url: 'https://rzp.io/inv',
                    status: 'paid', amount: 999900, currency: 'INR',
                }),
            });
            vi.stubGlobal('fetch', mockFetch);

            const result = await razorpay.fetchRazorpayInvoice('inv_123');

            expect(mockFetch).toHaveBeenCalledWith(
                'https://api.razorpay.com/v1/invoices/inv_123',
                expect.objectContaining({ method: 'GET' }),
            );
            expect(result.short_url).toBe('https://rzp.io/inv');
        });
    });

    describe('listRazorpayInvoices', () => {
        test('should list invoices for a subscription', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ items: [{ id: 'inv_1' }, { id: 'inv_2' }] }),
            });
            vi.stubGlobal('fetch', mockFetch);

            const result = await razorpay.listRazorpayInvoices('sub_123');

            expect(result.items).toHaveLength(2);
        });
    });

    describe('Config errors', () => {
        test('should throw when Razorpay keys not configured', async () => {
            delete process.env.RAZORPAY_KEY_ID;
            delete process.env.RAZORPAY_KEY_SECRET;

            expect(() => razorpay.getRazorpayKeyId()).toThrow('Razorpay not configured');
        });

        test('should throw when webhook secret not configured for signature verification', () => {
            delete process.env.RAZORPAY_WEBHOOK_SECRET;

            expect(() => razorpay.verifyWebhookSignature('body', 'sig')).toThrow('RAZORPAY_WEBHOOK_SECRET is not configured');
        });
    });
});
