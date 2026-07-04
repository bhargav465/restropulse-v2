import { describe, test, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Define Mocks
const mockFindActiveCreditPacks = vi.fn();
const mockFindAllCoupons = vi.fn();
const mockFindActiveSubscription = vi.fn();
const mockCreateCreditPack = vi.fn();
const mockFindCouponByCode = vi.fn();
const mockHasRestaurantRedeemedCoupon = vi.fn();

vi.mock('@restropulse/db', async (importOriginal) => {
    const actual = await importOriginal() as any;
    return {
        ...actual,
        findActiveCreditPacks: mockFindActiveCreditPacks,
        findAllCoupons: mockFindAllCoupons,
        findActiveSubscription: mockFindActiveSubscription,
        createCreditPack: mockCreateCreditPack,
        findCouponByCode: mockFindCouponByCode,
        hasRestaurantRedeemedCoupon: mockHasRestaurantRedeemedCoupon,
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

const authToken = generateAuthToken();  // OWNER role
const adminToken = generateAdminAuthToken();  // ADMIN role
const app = createTestApp();

describe('requireRole Middleware', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFindActiveSubscription.mockResolvedValue({
            id: 'sub-r1', restaurantId: 'r1', status: 'ACTIVE', credits: 100,
            planSnapshot: { limits: { weekly: { INSTAGRAM: { IMAGE: 100, STORY: 100, CAROUSEL: 100, REEL: 100, VIDEO: 100 }, FACEBOOK: { IMAGE: 100, CAROUSEL: 100, VIDEO: 100, STORY: 100 } } } },
        });
    });

    describe('Admin-only endpoints', () => {
        test('should allow ADMIN to access admin-only coupon routes', async () => {
            mockFindAllCoupons.mockResolvedValue([]);

            const res = await request(app)
                .get('/api/coupons')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
        });

        test('should reject OWNER from admin-only coupon routes', async () => {
            const res = await request(app)
                .get('/api/coupons')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(403);
            expect(res.body.error).toContain('insufficient role');
        });

        test('should allow ADMIN to access admin-only credit pack create', async () => {
            mockCreateCreditPack.mockResolvedValue({
                id: 'pack-1', name: 'Test', credits: 10, priceInPaise: 9900, isActive: true,
            });

            const res = await request(app)
                .post('/api/credit-packs')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ name: 'Test', credits: 10, priceInPaise: 9900 });

            expect(res.status).toBe(201);
        });

        test('should reject OWNER from credit pack create', async () => {
            const res = await request(app)
                .post('/api/credit-packs')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ name: 'Test', credits: 10, priceInPaise: 9900 });

            expect(res.status).toBe(403);
        });
    });

    describe('Non-admin endpoints still accessible', () => {
        test('OWNER should access coupon validate (non-admin route)', async () => {
            mockFindCouponByCode.mockResolvedValue(null);

            const res = await request(app)
                .post('/api/coupons/validate')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ code: 'TESTCODE' });

            expect(res.status).toBe(200);
        });

        test('OWNER should access credit pack listing (non-admin route)', async () => {
            mockFindActiveCreditPacks.mockResolvedValue([]);

            const res = await request(app)
                .get('/api/credit-packs')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(200);
        });
    });

    describe('Without authentication', () => {
        test('should return 401 before reaching role check', async () => {
            const res = await request(app).get('/api/coupons');
            expect(res.status).toBe(401);
        });
    });
});
