import { describe, test, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Define Mocks
const mockFindInvoicesByRestaurant = vi.fn();
const mockFindInvoiceById = vi.fn();
const mockFindActiveSubscription = vi.fn();
const mockUpdateInvoice = vi.fn();
const mockCreateInvoice = vi.fn();
const mockFetchRazorpayInvoice = vi.fn();

vi.mock('@restropulse/db', async (importOriginal) => {
    const actual = await importOriginal() as any;
    return {
        ...actual,
        findInvoicesByRestaurant: mockFindInvoicesByRestaurant,
        findInvoiceById: mockFindInvoiceById,
        findActiveSubscription: mockFindActiveSubscription,
        updateInvoice: mockUpdateInvoice,
        createInvoice: mockCreateInvoice,
    };
});

vi.mock('../../src/services/razorpay.js', () => ({
    fetchRazorpayInvoice: mockFetchRazorpayInvoice,
    listRazorpayInvoices: vi.fn(),
    createRazorpaySubscription: vi.fn(),
    cancelRazorpaySubscription: vi.fn(),
    createRazorpayOrder: vi.fn(),
    verifyWebhookSignature: vi.fn(),
    verifyPaymentSignature: vi.fn(),
    getRazorpayKeyId: vi.fn().mockReturnValue('rzp_test_key'),
    createRazorpayOffer: vi.fn(),
}));

const { createTestApp, generateAuthToken } = await import('../helpers/testHelper.js');

const authToken = generateAuthToken();
const app = createTestApp();

const mockInvoice = {
    id: 'inv-1',
    restaurantId: 'r1',
    type: 'SUBSCRIPTION' as const,
    razorpayInvoiceId: 'inv_rzp_123',
    razorpayPaymentId: 'pay_123',
    razorpaySubscriptionId: 'sub_123',
    amountPaise: 999900,
    currency: 'INR',
    status: 'paid',
    description: 'Growth Plan - Monthly',
    billingPeriodStart: '2024-06-01',
    billingPeriodEnd: '2024-06-30',
    pdfUrl: 'https://rzp.io/invoice/old',
    paidAt: '2024-06-01T10:00:00Z',
    createdAt: '2024-06-01T10:00:00Z',
};

const mockCreditInvoice = {
    id: 'inv-2',
    restaurantId: 'r1',
    type: 'CREDIT_PURCHASE' as const,
    razorpayOrderId: 'order_123',
    razorpayPaymentId: 'pay_456',
    amountPaise: 19900,
    currency: 'INR',
    status: 'paid',
    description: '20 Credits',
    paidAt: '2024-06-05T10:00:00Z',
    createdAt: '2024-06-05T10:00:00Z',
};

describe('Invoice Routes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default: active subscription mock for plan limits middleware
        mockFindActiveSubscription.mockResolvedValue({
            id: 'sub-r1',
            restaurantId: 'r1',
            status: 'ACTIVE',
            credits: 100,
            planSnapshot: {
                name: 'Growth',
                limits: { weekly: { INSTAGRAM: { IMAGE: 100, STORY: 100, CAROUSEL: 100, REEL: 100, VIDEO: 100 }, FACEBOOK: { IMAGE: 100, CAROUSEL: 100, VIDEO: 100, STORY: 100 } } },
            },
        });
    });

    describe('GET /api/invoices', () => {
        test('should return invoices for authenticated restaurant', async () => {
            mockFindInvoicesByRestaurant.mockResolvedValue([mockInvoice, mockCreditInvoice]);

            const res = await request(app)
                .get('/api/invoices')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toHaveLength(2);
            expect(res.body.data[0].type).toBe('SUBSCRIPTION');
            expect(res.body.data[1].type).toBe('CREDIT_PURCHASE');
            expect(mockFindInvoicesByRestaurant).toHaveBeenCalledWith('r1');
        });

        test('should return empty array when no invoices exist', async () => {
            mockFindInvoicesByRestaurant.mockResolvedValue([]);

            const res = await request(app)
                .get('/api/invoices')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(0);
        });

        test('should return 401 without auth token', async () => {
            const res = await request(app).get('/api/invoices');
            expect(res.status).toBe(401);
        });
    });

    describe('GET /api/invoices/:id', () => {
        test('should return invoice details', async () => {
            mockFindInvoiceById.mockResolvedValue({ ...mockInvoice, razorpayInvoiceId: undefined });

            const res = await request(app)
                .get('/api/invoices/inv-1')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.id).toBe('inv-1');
            expect(res.body.data.description).toBe('Growth Plan - Monthly');
        });

        test('should return 404 for non-existent invoice', async () => {
            mockFindInvoiceById.mockResolvedValue(null);

            const res = await request(app)
                .get('/api/invoices/nonexistent')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(404);
            expect(res.body.error).toBe('Invoice not found');
        });

        test('should return 404 for invoice belonging to different restaurant', async () => {
            mockFindInvoiceById.mockResolvedValue({
                ...mockInvoice,
                restaurantId: 'r999',
            });

            const res = await request(app)
                .get('/api/invoices/inv-1')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(404);
            expect(res.body.error).toBe('Invoice not found');
        });

        test('should refresh PDF URL from Razorpay when razorpayInvoiceId exists', async () => {
            mockFindInvoiceById.mockResolvedValue({ ...mockInvoice });
            mockFetchRazorpayInvoice.mockResolvedValue({
                id: 'inv_rzp_123',
                short_url: 'https://rzp.io/invoice/new-url',
                status: 'paid',
                amount: 999900,
                currency: 'INR',
            });

            const res = await request(app)
                .get('/api/invoices/inv-1')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data.pdfUrl).toBe('https://rzp.io/invoice/new-url');
            expect(mockUpdateInvoice).toHaveBeenCalledWith('inv-1', { pdfUrl: 'https://rzp.io/invoice/new-url' });
        });

        test('should not update PDF URL when it has not changed', async () => {
            mockFindInvoiceById.mockResolvedValue({ ...mockInvoice });
            mockFetchRazorpayInvoice.mockResolvedValue({
                id: 'inv_rzp_123',
                short_url: mockInvoice.pdfUrl,
                status: 'paid',
                amount: 999900,
                currency: 'INR',
            });

            const res = await request(app)
                .get('/api/invoices/inv-1')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(200);
            expect(mockUpdateInvoice).not.toHaveBeenCalled();
        });

        test('should return invoice even when Razorpay fetch fails', async () => {
            mockFindInvoiceById.mockResolvedValue({ ...mockInvoice });
            mockFetchRazorpayInvoice.mockRejectedValue(new Error('Razorpay API error'));

            const res = await request(app)
                .get('/api/invoices/inv-1')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data.pdfUrl).toBe(mockInvoice.pdfUrl);
        });

        test('should not call Razorpay for invoices without razorpayInvoiceId', async () => {
            mockFindInvoiceById.mockResolvedValue({ ...mockCreditInvoice });

            const res = await request(app)
                .get('/api/invoices/inv-2')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(200);
            expect(mockFetchRazorpayInvoice).not.toHaveBeenCalled();
        });
    });

    describe('GET /api/invoices/subscription/sync', () => {
        test('should return sync message when subscription exists', async () => {
            mockFindActiveSubscription.mockResolvedValue({
                id: 'sub-r1',
                restaurantId: 'r1',
                razorpaySubscriptionId: 'sub_rzp_123',
                status: 'ACTIVE',
            });

            const res = await request(app)
                .get('/api/invoices/subscription/sync')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        test('should return synced:0 when no subscription exists', async () => {
            mockFindActiveSubscription.mockResolvedValue(null);

            const res = await request(app)
                .get('/api/invoices/subscription/sync')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data.synced).toBe(0);
        });

        test('should return synced:0 when subscription has no Razorpay ID', async () => {
            mockFindActiveSubscription.mockResolvedValue({
                id: 'sub-r1',
                restaurantId: 'r1',
                status: 'NONE',
            });

            const res = await request(app)
                .get('/api/invoices/subscription/sync')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data.synced).toBe(0);
        });
    });
});
