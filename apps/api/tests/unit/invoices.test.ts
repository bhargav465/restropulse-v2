import { describe, test, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Define Mocks
const mockFindInvoicesByRestaurant = vi.fn();
const mockFindInvoiceById = vi.fn();
const mockFindActiveSubscription = vi.fn();
const mockUpdateInvoice = vi.fn();
const mockCreateInvoice = vi.fn();

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

const { createTestApp, generateAuthToken } = await import('../helpers/testHelper.js');

const authToken = generateAuthToken();
const app = createTestApp();

const mockInvoice = {
    id: 'inv-1',
    restaurantId: 'r1',
    type: 'SUBSCRIPTION' as const,
    amountPaise: 999900,
    currency: 'INR',
    status: 'paid',
    description: 'Growth Plan - Monthly',
    billingPeriodStart: '2024-06-01',
    billingPeriodEnd: '2024-06-30',
    pdfUrl: 'https://example.com/invoices/inv-1.pdf',
    paidAt: '2024-06-01T10:00:00Z',
    createdAt: '2024-06-01T10:00:00Z',
};

const mockCreditInvoice = {
    id: 'inv-2',
    restaurantId: 'r1',
    type: 'CREDIT_PURCHASE' as const,
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
            mockFindInvoiceById.mockResolvedValue({ ...mockInvoice, pdfUrl: undefined });

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

        test('returns the stored record as is (invoices are historical records)', async () => {
            mockFindInvoiceById.mockResolvedValue({ ...mockInvoice });

            const res = await request(app)
                .get('/api/invoices/inv-1')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data.pdfUrl).toBe(mockInvoice.pdfUrl);
            expect(mockUpdateInvoice).not.toHaveBeenCalled();
        });
    });

    describe('GET /api/invoices/subscription/sync', () => {
        test('is gone: there is no gateway to sync from', async () => {
            const res = await request(app)
                .get('/api/invoices/subscription/sync')
                .set('Authorization', `Bearer ${authToken}`);
            // Falls through to GET /:id with id "subscription" -> not found
            expect(res.status).toBe(404);
        });
    });
});
