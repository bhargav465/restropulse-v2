import { describe, test, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Define Mocks
const mockFindActiveCreditPacks = vi.fn();
const mockCreateCreditPack = vi.fn();
const mockUpdateCreditPack = vi.fn();
const mockFindCreditPackById = vi.fn();
const mockFindActiveSubscription = vi.fn();

vi.mock('@restropulse/db', async (importOriginal) => {
    const actual = await importOriginal() as any;
    return {
        ...actual,
        findActiveCreditPacks: mockFindActiveCreditPacks,
        createCreditPack: mockCreateCreditPack,
        updateCreditPack: mockUpdateCreditPack,
        findCreditPackById: mockFindCreditPackById,
        findActiveSubscription: mockFindActiveSubscription,
    };
});

vi.mock('../../src/services/razorpay.js', () => ({
    createRazorpaySubscription: vi.fn(),
    cancelRazorpaySubscription: vi.fn(),
    createRazorpayOrder: vi.fn(),
    verifyWebhookSignature: vi.fn(),
    verifyPaymentSignature: vi.fn(),
    getRazorpayKeyId: vi.fn().mockReturnValue('rzp_test_key'),
    createRazorpayOffer: vi.fn(),
    fetchRazorpayInvoice: vi.fn(),
    listRazorpayInvoices: vi.fn(),
}));

const { createTestApp, generateAuthToken, generateAdminAuthToken } = await import('../helpers/testHelper.js');

const authToken = generateAuthToken();
const adminToken = generateAdminAuthToken();
const app = createTestApp();

describe('Credit Pack Routes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFindActiveSubscription.mockResolvedValue({
            id: 'sub-r1', restaurantId: 'r1', status: 'ACTIVE', credits: 100,
            planSnapshot: { limits: { weekly: { INSTAGRAM: { IMAGE: 100, STORY: 100, CAROUSEL: 100, REEL: 100, VIDEO: 100 }, FACEBOOK: { IMAGE: 100, CAROUSEL: 100, VIDEO: 100, STORY: 100 } } } },
        });
    });

    describe('GET /api/credit-packs', () => {
        test('should return active credit packs', async () => {
            mockFindActiveCreditPacks.mockResolvedValue([
                { id: 'pack-1', name: '20 Credits', credits: 20, priceInPaise: 19900, isActive: true },
                { id: 'pack-2', name: '50 Credits', credits: 50, priceInPaise: 44900, isActive: true },
            ]);

            const res = await request(app)
                .get('/api/credit-packs')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(2);
            expect(res.body.data[0].credits).toBe(20);
        });

        test('should return 401 without auth', async () => {
            const res = await request(app).get('/api/credit-packs');
            expect(res.status).toBe(401);
        });
    });

    describe('POST /api/credit-packs', () => {
        test('should create credit pack as admin', async () => {
            mockCreateCreditPack.mockResolvedValue({
                id: 'pack-new', name: '200 Credits', credits: 200,
                priceInPaise: 149900, isActive: true, sortOrder: 4,
            });

            const res = await request(app)
                .post('/api/credit-packs')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ name: '200 Credits', credits: 200, priceInPaise: 149900, sortOrder: 4 });

            expect(res.status).toBe(201);
            expect(res.body.data.credits).toBe(200);
        });

        test('should return 403 for non-admin', async () => {
            const res = await request(app)
                .post('/api/credit-packs')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ name: '200 Credits', credits: 200, priceInPaise: 149900 });

            expect(res.status).toBe(403);
        });

        test('should return 400 when required fields missing', async () => {
            const res = await request(app)
                .post('/api/credit-packs')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ name: '200 Credits' });

            expect(res.status).toBe(400);
        });
    });

    describe('PATCH /api/credit-packs/:id', () => {
        test('should update credit pack as admin', async () => {
            mockUpdateCreditPack.mockResolvedValue({
                id: 'pack-1', name: '25 Credits', credits: 25, priceInPaise: 22900, isActive: true,
            });

            const res = await request(app)
                .patch('/api/credit-packs/pack-1')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ name: '25 Credits', credits: 25 });

            expect(res.status).toBe(200);
        });

        test('should deactivate credit pack', async () => {
            mockUpdateCreditPack.mockResolvedValue({
                id: 'pack-1', isActive: false,
            });

            const res = await request(app)
                .patch('/api/credit-packs/pack-1')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ isActive: false });

            expect(res.status).toBe(200);
            expect(mockUpdateCreditPack).toHaveBeenCalledWith('pack-1', { isActive: false });
        });

        test('should return 400 when no valid fields', async () => {
            const res = await request(app)
                .patch('/api/credit-packs/pack-1')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ invalidField: 'test' });

            expect(res.status).toBe(400);
        });

        test('should return 404 when pack not found', async () => {
            mockUpdateCreditPack.mockResolvedValue(null);

            const res = await request(app)
                .patch('/api/credit-packs/nonexistent')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ isActive: false });

            expect(res.status).toBe(404);
        });

        test('should return 403 for non-admin', async () => {
            const res = await request(app)
                .patch('/api/credit-packs/pack-1')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ isActive: false });

            expect(res.status).toBe(403);
        });
    });
});
