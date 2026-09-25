import { describe, test, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Define Mocks
const mockFindCouponByCode = vi.fn();
const mockCreateCoupon = vi.fn();
const mockUpdateCoupon = vi.fn();
const mockFindAllCoupons = vi.fn();
const mockFindCouponById = vi.fn();
const mockHasRestaurantRedeemedCoupon = vi.fn();
const mockFindActiveSubscription = vi.fn();

vi.mock('@restropulse/db', async (importOriginal) => {
    const actual = await importOriginal() as any;
    return {
        ...actual,
        findCouponByCode: mockFindCouponByCode,
        createCoupon: mockCreateCoupon,
        updateCoupon: mockUpdateCoupon,
        findAllCoupons: mockFindAllCoupons,
        findCouponById: mockFindCouponById,
        hasRestaurantRedeemedCoupon: mockHasRestaurantRedeemedCoupon,
        findActiveSubscription: mockFindActiveSubscription,
    };
});

vi.mock('../../src/services/razorpay.js', () => ({
    createRazorpayOffer: vi.fn().mockResolvedValue({ id: 'offer_rzp_1' }),
    createRazorpaySubscription: vi.fn(),
    cancelRazorpaySubscription: vi.fn(),
    createRazorpayOrder: vi.fn(),
    verifyWebhookSignature: vi.fn(),
    verifyPaymentSignature: vi.fn(),
    getRazorpayKeyId: vi.fn().mockReturnValue('rzp_test_key'),
    fetchRazorpayInvoice: vi.fn(),
    listRazorpayInvoices: vi.fn(),
}));

const { createTestApp, generateAuthToken, generateAdminAuthToken } = await import('../helpers/testHelper.js');

const authToken = generateAuthToken();
const adminToken = generateAdminAuthToken();
const app = createTestApp();

describe('Coupon Routes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFindActiveSubscription.mockResolvedValue({
            id: 'sub-r1', restaurantId: 'r1', status: 'ACTIVE', credits: 100,
            planSnapshot: { limits: { weekly: { INSTAGRAM: { IMAGE: 100, STORY: 100, CAROUSEL: 100, REEL: 100, VIDEO: 100 }, FACEBOOK: { IMAGE: 100, CAROUSEL: 100, VIDEO: 100, STORY: 100 } } } },
        });
    });

    describe('POST /api/coupons', () => {
        test('should create coupon as admin', async () => {
            mockFindCouponByCode.mockResolvedValue(null);
            mockCreateCoupon.mockResolvedValue({
                id: 'c1', code: 'TESTCODE1', type: 'PERCENTAGE', value: 10,
                status: 'ACTIVE', redemptionCount: 0,
            });

            const res = await request(app)
                .post('/api/coupons')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    code: 'TESTCODE1',
                    type: 'PERCENTAGE',
                    value: 10,
                    validFrom: '2024-01-01',
                });

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data.code).toBe('TESTCODE1');
        });

        test('should return 403 for non-admin user', async () => {
            const res = await request(app)
                .post('/api/coupons')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    code: 'TESTCODE1',
                    type: 'PERCENTAGE',
                    value: 10,
                    validFrom: '2024-01-01',
                });

            expect(res.status).toBe(403);
        });

        test('should return 400 for short coupon code', async () => {
            const res = await request(app)
                .post('/api/coupons')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    code: 'SHORT',
                    type: 'FLAT',
                    value: 10000,
                    validFrom: '2024-01-01',
                });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('at least 8 characters');
        });

        test('should return 400 for missing required fields', async () => {
            const res = await request(app)
                .post('/api/coupons')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ code: 'TESTCODE1' });

            expect(res.status).toBe(400);
        });

        test('should return 400 for invalid percentage value', async () => {
            const res = await request(app)
                .post('/api/coupons')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    code: 'TESTCODE1',
                    type: 'PERCENTAGE',
                    value: 150,
                    validFrom: '2024-01-01',
                });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('between 0 and 100');
        });

        test('should return 409 for duplicate code', async () => {
            mockFindCouponByCode.mockResolvedValue({ id: 'existing', code: 'TESTCODE1' });

            const res = await request(app)
                .post('/api/coupons')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    code: 'TESTCODE1',
                    type: 'FLAT',
                    value: 5000,
                    validFrom: '2024-01-01',
                });

            expect(res.status).toBe(409);
        });

        test('should normalize code to uppercase alphanumeric', async () => {
            mockFindCouponByCode.mockResolvedValue(null);
            mockCreateCoupon.mockImplementation(async (data: any) => ({ id: 'c1', ...data }));

            await request(app)
                .post('/api/coupons')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    code: 'test-code-123!',
                    type: 'FLAT',
                    value: 5000,
                    validFrom: '2024-01-01',
                });

            expect(mockCreateCoupon).toHaveBeenCalledWith(
                expect.objectContaining({ code: 'TESTCODE123' }),
            );
        });
    });

    describe('GET /api/coupons', () => {
        test('should list coupons as admin', async () => {
            mockFindAllCoupons.mockResolvedValue([
                { id: 'c1', code: 'COUPON01', type: 'FLAT', value: 5000 },
            ]);

            const res = await request(app)
                .get('/api/coupons')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
        });

        test('should return 403 for non-admin', async () => {
            const res = await request(app)
                .get('/api/coupons')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(403);
        });
    });

    describe('PATCH /api/coupons/:id', () => {
        test('should update coupon status as admin', async () => {
            mockUpdateCoupon.mockResolvedValue({
                id: 'c1', code: 'COUPON01', status: 'DISABLED',
            });

            const res = await request(app)
                .patch('/api/coupons/c1')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ status: 'DISABLED' });

            expect(res.status).toBe(200);
            expect(mockUpdateCoupon).toHaveBeenCalledWith('c1', { status: 'DISABLED' });
        });

        test('should return 400 when no valid fields provided', async () => {
            const res = await request(app)
                .patch('/api/coupons/c1')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ code: 'NEWCODE' }); // code is not an allowed field

            expect(res.status).toBe(400);
        });

        test('should return 404 when coupon not found', async () => {
            mockUpdateCoupon.mockResolvedValue(null);

            const res = await request(app)
                .patch('/api/coupons/nonexistent')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ status: 'DISABLED' });

            expect(res.status).toBe(404);
        });
    });

    describe('POST /api/coupons/validate', () => {
        test('should validate a valid coupon', async () => {
            mockFindCouponByCode.mockResolvedValue({
                id: 'c1', code: 'VALIDCODE', status: 'ACTIVE', type: 'PERCENTAGE',
                value: 20, redemptionCount: 0, maxRedemptions: 10,
                validFrom: new Date('2024-01-01'),
            });
            mockHasRestaurantRedeemedCoupon.mockResolvedValue(false);

            const res = await request(app)
                .post('/api/coupons/validate')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ code: 'VALIDCODE' });

            expect(res.status).toBe(200);
            expect(res.body.data.valid).toBe(true);
            expect(res.body.data.type).toBe('PERCENTAGE');
            expect(res.body.data.value).toBe(20);
        });

        test('should return invalid for non-existent coupon', async () => {
            mockFindCouponByCode.mockResolvedValue(null);

            const res = await request(app)
                .post('/api/coupons/validate')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ code: 'NONEXIST' });

            expect(res.status).toBe(200);
            expect(res.body.data.valid).toBe(false);
        });

        test('should return invalid for disabled coupon', async () => {
            mockFindCouponByCode.mockResolvedValue({
                id: 'c1', code: 'DISABLED', status: 'DISABLED',
            });

            const res = await request(app)
                .post('/api/coupons/validate')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ code: 'DISABLED' });

            expect(res.body.data.valid).toBe(false);
            expect(res.body.data.reason).toContain('not active');
        });

        test('should return invalid for expired coupon', async () => {
            mockFindCouponByCode.mockResolvedValue({
                id: 'c1', code: 'EXPIRED1', status: 'ACTIVE',
                validUntil: new Date('2023-01-01'),
            });

            const res = await request(app)
                .post('/api/coupons/validate')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ code: 'EXPIRED1' });

            expect(res.body.data.valid).toBe(false);
            expect(res.body.data.reason).toContain('expired');
        });

        test('should return invalid for exhausted coupon', async () => {
            mockFindCouponByCode.mockResolvedValue({
                id: 'c1', code: 'MAXEDOUT', status: 'ACTIVE',
                maxRedemptions: 5, redemptionCount: 5,
            });

            const res = await request(app)
                .post('/api/coupons/validate')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ code: 'MAXEDOUT' });

            expect(res.body.data.valid).toBe(false);
            expect(res.body.data.reason).toContain('fully redeemed');
        });

        test('should return invalid when assigned to different restaurant', async () => {
            mockFindCouponByCode.mockResolvedValue({
                id: 'c1', code: 'PERSONAL', status: 'ACTIVE',
                assignedTo: 'r999', redemptionCount: 0,
            });

            const res = await request(app)
                .post('/api/coupons/validate')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ code: 'PERSONAL' });

            expect(res.body.data.valid).toBe(false);
        });

        test('should return invalid when already redeemed by restaurant', async () => {
            mockFindCouponByCode.mockResolvedValue({
                id: 'c1', code: 'USED1234', status: 'ACTIVE',
                redemptionCount: 1, maxRedemptions: 10,
            });
            mockHasRestaurantRedeemedCoupon.mockResolvedValue(true);

            const res = await request(app)
                .post('/api/coupons/validate')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ code: 'USED1234' });

            expect(res.body.data.valid).toBe(false);
            expect(res.body.data.reason).toContain('already redeemed');
        });

        test('should return invalid when plan not applicable', async () => {
            mockFindCouponByCode.mockResolvedValue({
                id: 'c1', code: 'PLANONLY', status: 'ACTIVE',
                applicablePlans: ['premium'], redemptionCount: 0,
            });
            mockHasRestaurantRedeemedCoupon.mockResolvedValue(false);

            const res = await request(app)
                .post('/api/coupons/validate')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ code: 'PLANONLY', planSlug: 'starter' });

            expect(res.body.data.valid).toBe(false);
            expect(res.body.data.reason).toContain('not applicable to this plan');
        });

        test('should return invalid when billing cycle not applicable', async () => {
            mockFindCouponByCode.mockResolvedValue({
                id: 'c1', code: 'ANNUAL12', status: 'ACTIVE',
                applicableCycles: ['ANNUAL'], redemptionCount: 0,
            });
            mockHasRestaurantRedeemedCoupon.mockResolvedValue(false);

            const res = await request(app)
                .post('/api/coupons/validate')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ code: 'ANNUAL12', billingCycle: 'MONTHLY' });

            expect(res.body.data.valid).toBe(false);
            expect(res.body.data.reason).toContain('not applicable to this billing cycle');
        });

        test('should return 400 when code missing', async () => {
            const res = await request(app)
                .post('/api/coupons/validate')
                .set('Authorization', `Bearer ${authToken}`)
                .send({});

            expect(res.status).toBe(400);
        });
    });
});
