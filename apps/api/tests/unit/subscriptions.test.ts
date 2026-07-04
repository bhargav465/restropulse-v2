import { describe, test, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Define Mocks
const mockFindCurrentPlans = vi.fn();
const mockFindPlanBySlug = vi.fn();
const mockFindActiveSubscription = vi.fn();
const mockCreateSubscription = vi.fn();
const mockUpdateSubscription = vi.fn();
const mockFindSubscriptionByRazorpayId = vi.fn();
const mockFindSubscriptionByPendingRazorpayId = vi.fn();
const mockGetWeeklyPostCounts = vi.fn();
const mockAddCredits = vi.fn();
const mockFindCreditPackById = vi.fn();
const mockCreateCreditPurchase = vi.fn();
const mockFindCreditPurchaseByOrderId = vi.fn();
const mockUpdateCreditPurchase = vi.fn();
const mockFindCouponByCode = vi.fn();
const mockIncrementCouponRedemptions = vi.fn();
const mockCreateCouponRedemption = vi.fn();
const mockHasRestaurantRedeemedCoupon = vi.fn();
const mockCreateInvoice = vi.fn();
const mockFindInvoiceByPaymentId = vi.fn();
const mockFindInvoicesByRazorpaySubscriptionId = vi.fn().mockResolvedValue([]);
const mockFindUserById = vi.fn();
const mockFindUserByRestaurantId = vi.fn();

vi.mock('@restropulse/db', async (importOriginal) => {
    const actual = await importOriginal() as any;
    return {
        ...actual,
        findCurrentPlans: mockFindCurrentPlans,
        findPlanBySlug: mockFindPlanBySlug,
        findActiveSubscription: mockFindActiveSubscription,
        createSubscription: mockCreateSubscription,
        updateSubscription: mockUpdateSubscription,
        findSubscriptionByRazorpayId: mockFindSubscriptionByRazorpayId,
        findSubscriptionByPendingRazorpayId: mockFindSubscriptionByPendingRazorpayId,
        getWeeklyPostCounts: mockGetWeeklyPostCounts,
        addCredits: mockAddCredits,
        findCreditPackById: mockFindCreditPackById,
        createCreditPurchase: mockCreateCreditPurchase,
        findCreditPurchaseByOrderId: mockFindCreditPurchaseByOrderId,
        updateCreditPurchase: mockUpdateCreditPurchase,
        findCouponByCode: mockFindCouponByCode,
        incrementCouponRedemptions: mockIncrementCouponRedemptions,
        createCouponRedemption: mockCreateCouponRedemption,
        hasRestaurantRedeemedCoupon: mockHasRestaurantRedeemedCoupon,
        createInvoice: mockCreateInvoice,
        findInvoiceByPaymentId: mockFindInvoiceByPaymentId,
        findInvoicesByRazorpaySubscriptionId: mockFindInvoicesByRazorpaySubscriptionId,
        findUserById: mockFindUserById,
        findUserByRestaurantId: mockFindUserByRestaurantId,
    };
});

const mockCreateRazorpaySubscription = vi.fn();
const mockCancelRazorpaySubscription = vi.fn();
const mockUpdateRazorpaySubscription = vi.fn();
const mockCreateRazorpayOrder = vi.fn();
const mockVerifyWebhookSignature = vi.fn();
const mockVerifyPaymentSignature = vi.fn();
const mockVerifySubscriptionSignature = vi.fn();
const mockGetRazorpayKeyId = vi.fn().mockReturnValue('rzp_test_key');
const mockCreateRazorpayCustomer = vi.fn();
const mockFetchRazorpayCustomersByContact = vi.fn();
const mockFetchRazorpayInvoice = vi.fn();
const mockFetchRazorpaySubscription = vi.fn();
const mockFetchRazorpayPayment = vi.fn();

const mockListRazorpaySubscriptionsForCustomer = vi.fn().mockResolvedValue({ items: [] });

vi.mock('../../src/services/razorpay.js', () => ({
    createRazorpaySubscription: mockCreateRazorpaySubscription,
    cancelRazorpaySubscription: mockCancelRazorpaySubscription,
    updateRazorpaySubscription: mockUpdateRazorpaySubscription,
    createRazorpayOrder: mockCreateRazorpayOrder,
    verifyWebhookSignature: mockVerifyWebhookSignature,
    verifyPaymentSignature: mockVerifyPaymentSignature,
    verifySubscriptionSignature: mockVerifySubscriptionSignature,
    getRazorpayKeyId: mockGetRazorpayKeyId,
    createRazorpayOffer: vi.fn(),
    fetchRazorpayInvoice: mockFetchRazorpayInvoice,
    fetchRazorpaySubscription: mockFetchRazorpaySubscription,
    fetchRazorpayPayment: mockFetchRazorpayPayment,
    listRazorpayInvoices: vi.fn(),
    listRazorpaySubscriptionsForCustomer: mockListRazorpaySubscriptionsForCustomer,
    createRazorpayCustomer: mockCreateRazorpayCustomer,
    fetchRazorpayCustomersByContact: mockFetchRazorpayCustomersByContact,
    isRazorpayConfigured: vi.fn().mockReturnValue(true),
}));

const { createTestApp, generateAuthToken, mockUser } = await import('../helpers/testHelper.js');

const authToken = generateAuthToken();
const app = createTestApp();

const mockPlan = {
    id: 'plan-growth-v1',
    slug: 'growth',
    version: 1,
    isCurrentVersion: true,
    tier: 'GROWTH',
    name: 'Growth',
    limits: { weekly: { INSTAGRAM: { IMAGE: 5, STORY: 5, CAROUSEL: 3, REEL: 2, VIDEO: 2 }, FACEBOOK: { IMAGE: 5, CAROUSEL: 3, VIDEO: 2, STORY: 5 } } },
    pricing: { monthly: 999900, annual: 9999000, currency: 'INR' },
    razorpayPlanIds: { monthly: 'plan_monthly_growth', annual: 'plan_annual_growth' },
    features: ['INSTAGRAM', 'FACEBOOK'],
};

const mockSubscription = {
    id: 'sub-r1',
    restaurantId: 'r1',
    planId: 'plan-growth-v1',
    planSnapshot: mockPlan,
    billingCycle: 'MONTHLY',
    status: 'ACTIVE',
    razorpaySubscriptionId: 'sub_rzp_123',
    credits: 10,
    currentPeriodStart: '2024-06-01',
    currentPeriodEnd: '2024-06-30',
};

describe('Subscription Routes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default: user lookup succeeds with email, customer creation succeeds
        mockFindUserById.mockResolvedValue(mockUser);
        mockFindUserByRestaurantId.mockResolvedValue(mockUser);
        mockCreateRazorpayCustomer.mockResolvedValue({ id: 'cust_rzp_u1' });
        mockFetchRazorpayInvoice.mockResolvedValue({ id: 'inv_rzp_123', short_url: 'https://rzp.io/i/test', status: 'paid', amount: 49900, currency: 'INR' });
        mockUpdateRazorpaySubscription.mockResolvedValue({ id: 'sub_test', status: 'active', plan_id: 'plan_test' });
        // Default: no pending-Razorpay sub lookup match
        mockFindSubscriptionByPendingRazorpayId.mockResolvedValue(null);
    });

    describe('GET /api/subscriptions/plans', () => {
        test('should return current plans (no auth required)', async () => {
            mockFindCurrentPlans.mockResolvedValue([mockPlan]);

            const res = await request(app).get('/api/subscriptions/plans');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toHaveLength(1);
            expect(res.body.data[0].slug).toBe('growth');
        });
    });

    describe('GET /api/subscriptions/current', () => {
        test('should return current subscription with usage', async () => {
            mockFindActiveSubscription.mockResolvedValue(mockSubscription);
            mockGetWeeklyPostCounts.mockResolvedValue({
                INSTAGRAM: { IMAGE: 2, VIDEO: 0, STORY: 0, CAROUSEL: 1, REEL: 0 },
                FACEBOOK: { IMAGE: 0, VIDEO: 0, STORY: 0, CAROUSEL: 0 },
            });

            const res = await request(app)
                .get('/api/subscriptions/current')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data.subscription.status).toBe('ACTIVE');
            expect(res.body.data.usage.INSTAGRAM.IMAGE.used).toBe(2);
            expect(res.body.data.usage.INSTAGRAM.CAROUSEL.used).toBe(1);
        });

        test('should return null when no subscription exists', async () => {
            mockFindActiveSubscription.mockResolvedValue(null);

            const res = await request(app)
                .get('/api/subscriptions/current')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data.subscription).toBeNull();
            expect(res.body.data.usage).toBeNull();
        });

        test('should return usage=null when subscription has no planSnapshot limits (covers line 62 false branch)', async () => {
            // planSnapshot exists but without limits -> usage remains null
            mockFindActiveSubscription.mockResolvedValue({
                ...mockSubscription,
                planSnapshot: { slug: 'growth', tier: 'GROWTH' }, // no limits
            });

            const res = await request(app)
                .get('/api/subscriptions/current')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data.subscription).toBeDefined();
            expect(res.body.data.usage).toBeNull();
        });

        test('should return 401 without auth', async () => {
            const res = await request(app).get('/api/subscriptions/current');
            expect(res.status).toBe(401);
        });

        // Reconciliation tests — when the DB holds a transitional state (CREATED/AUTHENTICATED)
        // for a subscription with a razorpaySubscriptionId, /current should fetch the live
        // Razorpay state and advance the DB before responding. This unblocks the
        // "stuck on Activating..." UI when the subscription.charged webhook never lands
        // (local dev without ngrok, network failure, etc.).
        describe('Razorpay reconciliation', () => {
            test('reconciles AUTHENTICATED -> ACTIVE when Razorpay shows active', async () => {
                const stuck = {
                    ...mockSubscription,
                    status: 'AUTHENTICATED' as const,
                    razorpaySubscriptionId: 'sub_rzp_stuck',
                };
                mockFindActiveSubscription.mockResolvedValue(stuck);
                mockFetchRazorpaySubscription.mockResolvedValue({
                    id: 'sub_rzp_stuck',
                    status: 'active',
                    current_start: 1717200000,
                    current_end: 1719792000,
                    customer_id: 'cust_rzp_u1',
                    plan_id: 'plan_monthly_growth',
                });
                mockGetWeeklyPostCounts.mockResolvedValue({
                    INSTAGRAM: { IMAGE: 0, VIDEO: 0, STORY: 0, CAROUSEL: 0, REEL: 0 },
                    FACEBOOK: { IMAGE: 0, VIDEO: 0, STORY: 0, CAROUSEL: 0 },
                });

                const res = await request(app)
                    .get('/api/subscriptions/current')
                    .set('Authorization', `Bearer ${authToken}`);

                expect(res.status).toBe(200);
                expect(mockFetchRazorpaySubscription).toHaveBeenCalledWith('sub_rzp_stuck');
                expect(mockUpdateSubscription).toHaveBeenCalledWith(
                    'sub-r1',
                    expect.objectContaining({ status: 'ACTIVE' }),
                );
                expect(res.body.data.subscription.status).toBe('ACTIVE');
                expect(res.body.data.subscription.currentPeriodStart).toBeDefined();
                expect(res.body.data.subscription.currentPeriodEnd).toBeDefined();
            });

            test('reconciles CREATED -> AUTHENTICATED when Razorpay shows authenticated', async () => {
                const stuck = {
                    ...mockSubscription,
                    status: 'CREATED' as const,
                    razorpaySubscriptionId: 'sub_rzp_auth',
                };
                mockFindActiveSubscription.mockResolvedValue(stuck);
                mockFetchRazorpaySubscription.mockResolvedValue({
                    id: 'sub_rzp_auth',
                    status: 'authenticated',
                    current_start: null,
                    current_end: null,
                    customer_id: 'cust_rzp_u1',
                    plan_id: 'plan_monthly_growth',
                });
                mockGetWeeklyPostCounts.mockResolvedValue({
                    INSTAGRAM: { IMAGE: 0, VIDEO: 0, STORY: 0, CAROUSEL: 0, REEL: 0 },
                    FACEBOOK: { IMAGE: 0, VIDEO: 0, STORY: 0, CAROUSEL: 0 },
                });

                const res = await request(app)
                    .get('/api/subscriptions/current')
                    .set('Authorization', `Bearer ${authToken}`);

                expect(res.status).toBe(200);
                expect(mockUpdateSubscription).toHaveBeenCalledWith(
                    'sub-r1',
                    expect.objectContaining({ status: 'AUTHENTICATED' }),
                );
                expect(res.body.data.subscription.status).toBe('AUTHENTICATED');
            });

            test('does NOT call Razorpay when DB status is already ACTIVE', async () => {
                mockFindActiveSubscription.mockResolvedValue(mockSubscription);
                mockGetWeeklyPostCounts.mockResolvedValue({
                    INSTAGRAM: { IMAGE: 0, VIDEO: 0, STORY: 0, CAROUSEL: 0, REEL: 0 },
                    FACEBOOK: { IMAGE: 0, VIDEO: 0, STORY: 0, CAROUSEL: 0 },
                });

                await request(app)
                    .get('/api/subscriptions/current')
                    .set('Authorization', `Bearer ${authToken}`);

                expect(mockFetchRazorpaySubscription).not.toHaveBeenCalled();
                expect(mockUpdateSubscription).not.toHaveBeenCalled();
            });

            test('does NOT call Razorpay when subscription has no razorpaySubscriptionId', async () => {
                mockFindActiveSubscription.mockResolvedValue({
                    ...mockSubscription,
                    status: 'AUTHENTICATED' as const,
                    razorpaySubscriptionId: undefined,
                });
                mockGetWeeklyPostCounts.mockResolvedValue({
                    INSTAGRAM: { IMAGE: 0, VIDEO: 0, STORY: 0, CAROUSEL: 0, REEL: 0 },
                    FACEBOOK: { IMAGE: 0, VIDEO: 0, STORY: 0, CAROUSEL: 0 },
                });

                await request(app)
                    .get('/api/subscriptions/current')
                    .set('Authorization', `Bearer ${authToken}`);

                expect(mockFetchRazorpaySubscription).not.toHaveBeenCalled();
            });

            test('skips Razorpay fetch when DB status is already non-transitional (ACTIVE)', async () => {
                // Early-exit: if DB is already ACTIVE, we don't need to talk to Razorpay.
                mockFindActiveSubscription.mockResolvedValue({
                    ...mockSubscription,
                    status: 'ACTIVE' as const,
                    razorpaySubscriptionId: 'sub_rzp_123',
                });
                mockGetWeeklyPostCounts.mockResolvedValue({
                    INSTAGRAM: { IMAGE: 0, VIDEO: 0, STORY: 0, CAROUSEL: 0, REEL: 0 },
                    FACEBOOK: { IMAGE: 0, VIDEO: 0, STORY: 0, CAROUSEL: 0 },
                });

                const res = await request(app)
                    .get('/api/subscriptions/current')
                    .set('Authorization', `Bearer ${authToken}`);

                expect(mockFetchRazorpaySubscription).not.toHaveBeenCalled();
                expect(res.body.data.subscription.status).toBe('ACTIVE');
            });

            test('does NOT regress status when Razorpay returns a lower-rank state', async () => {
                // Rank guard: DB is AUTHENTICATED (rank 2), Razorpay briefly returns
                // 'created' (rank 1) from a stale read. We must not regress.
                mockFindActiveSubscription.mockResolvedValue({
                    ...mockSubscription,
                    status: 'AUTHENTICATED' as const,
                    razorpaySubscriptionId: 'sub_rzp_lower',
                });
                mockFetchRazorpaySubscription.mockResolvedValue({
                    id: 'sub_rzp_lower',
                    status: 'created',
                    current_start: null,
                    current_end: null,
                    customer_id: 'cust_rzp_u1',
                    plan_id: 'plan_monthly_growth',
                });
                mockGetWeeklyPostCounts.mockResolvedValue({
                    INSTAGRAM: { IMAGE: 0, VIDEO: 0, STORY: 0, CAROUSEL: 0, REEL: 0 },
                    FACEBOOK: { IMAGE: 0, VIDEO: 0, STORY: 0, CAROUSEL: 0 },
                });

                const res = await request(app)
                    .get('/api/subscriptions/current')
                    .set('Authorization', `Bearer ${authToken}`);

                expect(mockFetchRazorpaySubscription).toHaveBeenCalled();
                expect(mockUpdateSubscription).not.toHaveBeenCalled();
                expect(res.body.data.subscription.status).toBe('AUTHENTICATED');
            });

            test('does not fail /current when Razorpay fetch errors out', async () => {
                const stuck = {
                    ...mockSubscription,
                    status: 'AUTHENTICATED' as const,
                    razorpaySubscriptionId: 'sub_rzp_err',
                };
                mockFindActiveSubscription.mockResolvedValue(stuck);
                mockFetchRazorpaySubscription.mockRejectedValue(new Error('Razorpay 503'));
                mockGetWeeklyPostCounts.mockResolvedValue({
                    INSTAGRAM: { IMAGE: 0, VIDEO: 0, STORY: 0, CAROUSEL: 0, REEL: 0 },
                    FACEBOOK: { IMAGE: 0, VIDEO: 0, STORY: 0, CAROUSEL: 0 },
                });

                const res = await request(app)
                    .get('/api/subscriptions/current')
                    .set('Authorization', `Bearer ${authToken}`);

                expect(res.status).toBe(200);
                expect(res.body.success).toBe(true);
                // Returns the unreconciled DB state — UI will keep polling
                expect(res.body.data.subscription.status).toBe('AUTHENTICATED');
                expect(mockUpdateSubscription).not.toHaveBeenCalled();
            });

            test('reconciles AUTHENTICATED -> CANCELLED when Razorpay shows cancelled', async () => {
                // Production scenario: webhook missed, user's payment auto-cancelled on Razorpay's side.
                // Same shape as the "stuck in Activating" bug, but the terminal state is CANCELLED.
                const stuck = {
                    ...mockSubscription,
                    status: 'AUTHENTICATED' as const,
                    razorpaySubscriptionId: 'sub_rzp_cancelled',
                };
                mockFindActiveSubscription.mockResolvedValue(stuck);
                mockFetchRazorpaySubscription.mockResolvedValue({
                    id: 'sub_rzp_cancelled',
                    status: 'cancelled',
                    current_start: null,
                    current_end: null,
                    customer_id: 'cust_rzp_u1',
                    plan_id: 'plan_monthly_growth',
                });
                mockGetWeeklyPostCounts.mockResolvedValue({
                    INSTAGRAM: { IMAGE: 0, VIDEO: 0, STORY: 0, CAROUSEL: 0, REEL: 0 },
                    FACEBOOK: { IMAGE: 0, VIDEO: 0, STORY: 0, CAROUSEL: 0 },
                });

                const res = await request(app)
                    .get('/api/subscriptions/current')
                    .set('Authorization', `Bearer ${authToken}`);

                expect(res.status).toBe(200);
                expect(mockFetchRazorpaySubscription).toHaveBeenCalledWith('sub_rzp_cancelled');
                expect(mockUpdateSubscription).toHaveBeenCalledWith(
                    'sub-r1',
                    expect.objectContaining({ status: 'CANCELLED' }),
                );
                expect(res.body.data.subscription.status).toBe('CANCELLED');
            });

            test('reconciles AUTHENTICATED -> HALTED when Razorpay shows halted', async () => {
                // Production scenario: webhook missed, user's payment retries exhausted on Razorpay's side.
                const stuck = {
                    ...mockSubscription,
                    status: 'AUTHENTICATED' as const,
                    razorpaySubscriptionId: 'sub_rzp_halted',
                };
                mockFindActiveSubscription.mockResolvedValue(stuck);
                mockFetchRazorpaySubscription.mockResolvedValue({
                    id: 'sub_rzp_halted',
                    status: 'halted',
                    current_start: null,
                    current_end: null,
                    customer_id: 'cust_rzp_u1',
                    plan_id: 'plan_monthly_growth',
                });
                mockGetWeeklyPostCounts.mockResolvedValue({
                    INSTAGRAM: { IMAGE: 0, VIDEO: 0, STORY: 0, CAROUSEL: 0, REEL: 0 },
                    FACEBOOK: { IMAGE: 0, VIDEO: 0, STORY: 0, CAROUSEL: 0 },
                });

                const res = await request(app)
                    .get('/api/subscriptions/current')
                    .set('Authorization', `Bearer ${authToken}`);

                expect(res.status).toBe(200);
                expect(mockFetchRazorpaySubscription).toHaveBeenCalledWith('sub_rzp_halted');
                expect(mockUpdateSubscription).toHaveBeenCalledWith(
                    'sub-r1',
                    expect.objectContaining({ status: 'HALTED' }),
                );
                expect(res.body.data.subscription.status).toBe('HALTED');
            });
        });
    });

    describe('POST /api/subscriptions/subscribe', () => {
        test('should create a Razorpay subscription', async () => {
            mockFindPlanBySlug.mockResolvedValue(mockPlan);
            mockFindActiveSubscription.mockResolvedValue(null);
            mockCreateSubscription.mockResolvedValue({ id: 'sub-new' });
            mockCreateRazorpaySubscription.mockResolvedValue({ id: 'sub_rzp_new' });

            const res = await request(app)
                .post('/api/subscriptions/subscribe')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ planSlug: 'growth', billingCycle: 'MONTHLY' });

            expect(res.status).toBe(200);
            expect(res.body.data.subscriptionId).toBe('sub_rzp_new');
            expect(res.body.data.keyId).toBe('rzp_test_key');
        });

        test('should return 400 when planSlug is missing', async () => {
            const res = await request(app)
                .post('/api/subscriptions/subscribe')
                .set('Authorization', `Bearer ${authToken}`)
                .send({});

            expect(res.status).toBe(400);
        });

        test('should return 404 when plan not found', async () => {
            mockFindPlanBySlug.mockResolvedValue(null);

            const res = await request(app)
                .post('/api/subscriptions/subscribe')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ planSlug: 'nonexistent', billingCycle: 'MONTHLY' });

            expect(res.status).toBe(404);
        });

        test('should apply coupon when provided', async () => {
            mockFindPlanBySlug.mockResolvedValue(mockPlan);
            mockFindCouponByCode.mockResolvedValue({
                id: 'c1', code: 'TESTCODE', status: 'ACTIVE', type: 'PERCENTAGE',
                value: 10, redemptionCount: 0, maxRedemptions: 5,
                razorpayOfferId: 'offer_rzp_1',
                validFrom: new Date('2024-01-01'),
            });
            mockHasRestaurantRedeemedCoupon.mockResolvedValue(false);
            mockFindActiveSubscription.mockResolvedValue(null);
            mockCreateSubscription.mockResolvedValue({ id: 'sub-new' });
            mockCreateRazorpaySubscription.mockResolvedValue({ id: 'sub_rzp_coupon' });

            const res = await request(app)
                .post('/api/subscriptions/subscribe')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ planSlug: 'growth', billingCycle: 'MONTHLY', couponCode: 'TESTCODE' });

            expect(res.status).toBe(200);
            expect(mockCreateRazorpaySubscription).toHaveBeenCalledWith(
                'plan_monthly_growth', 120, 'offer_rzp_1', 'cust_rzp_u1',
                undefined,
                expect.objectContaining({ planSlug: 'growth', restaurantId: 'r1', couponCode: 'TESTCODE', userId: 'u1' }),
            );
        });

        test('should reject invalid coupon code', async () => {
            mockFindPlanBySlug.mockResolvedValue(mockPlan);
            mockFindCouponByCode.mockResolvedValue(null);

            const res = await request(app)
                .post('/api/subscriptions/subscribe')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ planSlug: 'growth', billingCycle: 'MONTHLY', couponCode: 'BADCODE' });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Invalid coupon code');
        });

        test('should reject expired coupon', async () => {
            mockFindPlanBySlug.mockResolvedValue(mockPlan);
            mockFindCouponByCode.mockResolvedValue({
                id: 'c1', code: 'EXPIRED8', status: 'ACTIVE', type: 'FLAT',
                value: 10000, redemptionCount: 0,
                validFrom: new Date('2023-01-01'),
                validUntil: new Date('2023-12-31'),
            });

            const res = await request(app)
                .post('/api/subscriptions/subscribe')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ planSlug: 'growth', billingCycle: 'MONTHLY', couponCode: 'EXPIRED8' });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Coupon has expired');
        });

        test('should return 409 when an active subscription already exists', async () => {
            mockFindPlanBySlug.mockResolvedValue(mockPlan);
            mockFindActiveSubscription.mockResolvedValue(mockSubscription);

            const res = await request(app)
                .post('/api/subscriptions/subscribe')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ planSlug: 'growth' });

            expect(res.status).toBe(409);
            expect(res.body.error).toMatch(/active subscription already exists/i);
            expect(mockCreateSubscription).not.toHaveBeenCalled();
        });

        test('should create Razorpay customer with user name, email, and phone', async () => {
            mockFindPlanBySlug.mockResolvedValue(mockPlan);
            mockFindActiveSubscription.mockResolvedValue(null);
            mockCreateSubscription.mockResolvedValue({ id: 'sub-new' });
            mockCreateRazorpaySubscription.mockResolvedValue({ id: 'sub_rzp_new' });

            await request(app)
                .post('/api/subscriptions/subscribe')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ planSlug: 'growth', billingCycle: 'MONTHLY' });

            expect(mockCreateRazorpayCustomer).toHaveBeenCalledWith(
                mockUser.name,
                mockUser.email,
                mockUser.phone,
            );
        });

        test('should pass customer_id to createRazorpaySubscription', async () => {
            mockFindPlanBySlug.mockResolvedValue(mockPlan);
            mockFindActiveSubscription.mockResolvedValue(null);
            mockCreateSubscription.mockResolvedValue({ id: 'sub-new' });
            mockCreateRazorpaySubscription.mockResolvedValue({ id: 'sub_rzp_new' });

            await request(app)
                .post('/api/subscriptions/subscribe')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ planSlug: 'growth', billingCycle: 'MONTHLY' });

            expect(mockCreateRazorpaySubscription).toHaveBeenCalledWith(
                'plan_monthly_growth', 120, undefined, 'cust_rzp_u1',
                undefined,
                expect.objectContaining({ planSlug: 'growth', restaurantId: 'r1' }),
            );
        });

        test('should proceed with subscription even if customer creation fails', async () => {
            mockCreateRazorpayCustomer.mockRejectedValue(new Error('Razorpay customer API error'));
            mockFindPlanBySlug.mockResolvedValue(mockPlan);
            mockFindActiveSubscription.mockResolvedValue(null);
            mockCreateSubscription.mockResolvedValue({ id: 'sub-new' });
            mockCreateRazorpaySubscription.mockResolvedValue({ id: 'sub_rzp_no_cust' });

            const res = await request(app)
                .post('/api/subscriptions/subscribe')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ planSlug: 'growth', billingCycle: 'MONTHLY' });

            expect(res.status).toBe(200);
            expect(res.body.data.subscriptionId).toBe('sub_rzp_no_cust');
            // customer_id should be undefined when creation fails
            expect(mockCreateRazorpaySubscription).toHaveBeenCalledWith(
                'plan_monthly_growth', 120, undefined, undefined,
                undefined,
                expect.objectContaining({ planSlug: 'growth', restaurantId: 'r1' }),
            );
        });

        test('should proceed with subscription when user has no email', async () => {
            mockFindUserById.mockResolvedValue({ ...mockUser, email: undefined });
            mockFindPlanBySlug.mockResolvedValue(mockPlan);
            mockFindActiveSubscription.mockResolvedValue(null);
            mockCreateSubscription.mockResolvedValue({ id: 'sub-new' });
            mockCreateRazorpaySubscription.mockResolvedValue({ id: 'sub_rzp_no_email' });

            const res = await request(app)
                .post('/api/subscriptions/subscribe')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ planSlug: 'growth', billingCycle: 'MONTHLY' });

            expect(res.status).toBe(200);
            expect(mockCreateRazorpayCustomer).not.toHaveBeenCalled();
            expect(mockCreateRazorpaySubscription).toHaveBeenCalledWith(
                'plan_monthly_growth', 120, undefined, undefined,
                undefined,
                expect.objectContaining({ planSlug: 'growth', restaurantId: 'r1' }),
            );
        });

        // Re-subscribe scenarios: /subscribe never touches the DB; archive + insert is
        // deferred to /verify (or the subscription.charged webhook) so that abandoned/
        // failed checkouts cannot destroy free credits or orphan paid subscriptions (B4).

        test('should NOT archive or insert any local doc on subscribe (B4 fix)', async () => {
            // Critical regression: prior to the B4 fix, /subscribe immediately archived
            // the existing NONE doc and inserted a CREATED doc with credits=0. If the
            // user's payment failed, they lost their free credits. Now /subscribe is
            // pure: it only creates the Razorpay sub. /verify does the archive+insert.
            const noneSubscription = { id: 'sub-none', restaurantId: 'r1', status: 'NONE', credits: 100 };
            mockFindPlanBySlug.mockResolvedValue(mockPlan);
            mockFindActiveSubscription.mockResolvedValue(noneSubscription);
            mockCreateRazorpaySubscription.mockResolvedValue({ id: 'sub_rzp_new' });

            const res = await request(app)
                .post('/api/subscriptions/subscribe')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ planSlug: 'growth', billingCycle: 'MONTHLY' });

            expect(res.status).toBe(200);
            expect(res.body.data.subscriptionId).toBe('sub_rzp_new');
            expect(mockCreateSubscription).not.toHaveBeenCalled();
            expect(mockUpdateSubscription).not.toHaveBeenCalled();
        });

        test('should pass restaurantId+planSlug as Razorpay notes so webhook+verify can materialize the doc', async () => {
            mockFindPlanBySlug.mockResolvedValue(mockPlan);
            mockFindActiveSubscription.mockResolvedValue(null);
            mockCreateRazorpaySubscription.mockResolvedValue({ id: 'sub_rzp_new' });

            await request(app)
                .post('/api/subscriptions/subscribe')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ planSlug: 'growth', billingCycle: 'MONTHLY' });

            const callArgs = mockCreateRazorpaySubscription.mock.calls[0] as any[];
            expect(callArgs[5]).toEqual(expect.objectContaining({ restaurantId: 'r1', planSlug: 'growth' }));
        });

        test('should defer first charge to currentPeriodEnd when re-subscribing from cancelAtPeriodEnd', async () => {
            const pendingCancelSub = {
                id: 'sub-pending', restaurantId: 'r1', status: 'ACTIVE', credits: 0,
                cancelAtPeriodEnd: true, currentPeriodEnd: '2026-05-15T00:00:00.000Z',
            };
            mockFindPlanBySlug.mockResolvedValue(mockPlan);
            mockFindActiveSubscription.mockResolvedValue(pendingCancelSub);
            mockCreateRazorpaySubscription.mockResolvedValue({ id: 'sub_rzp_def' });

            await request(app)
                .post('/api/subscriptions/subscribe')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ planSlug: 'growth', billingCycle: 'MONTHLY' });

            const expectedStartAt = Math.floor(new Date('2026-05-15T00:00:00.000Z').getTime() / 1000);
            expect(mockCreateRazorpaySubscription).toHaveBeenCalledWith(
                'plan_monthly_growth', 120, undefined, 'cust_rzp_u1',
                expectedStartAt,
                expect.any(Object),
            );
            expect(mockCreateSubscription).not.toHaveBeenCalled();
            expect(mockUpdateSubscription).not.toHaveBeenCalled();
        });

        // Razorpay customer recovery scenarios

        test('should recover existing Razorpay customer ID when creation fails with already-exists error', async () => {
            mockCreateRazorpayCustomer.mockRejectedValue(new Error('Customer already exists for the merchant'));
            mockFetchRazorpayCustomersByContact.mockResolvedValue({ items: [{ id: 'cust_recovered_123' }] });
            mockFindPlanBySlug.mockResolvedValue(mockPlan);
            mockFindActiveSubscription.mockResolvedValue(null);
            mockCreateSubscription.mockResolvedValue({ id: 'sub-new' });
            mockCreateRazorpaySubscription.mockResolvedValue({ id: 'sub_rzp_new' });

            const res = await request(app)
                .post('/api/subscriptions/subscribe')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ planSlug: 'growth', billingCycle: 'MONTHLY' });

            expect(res.status).toBe(200);
            expect(mockFetchRazorpayCustomersByContact).toHaveBeenCalledWith(mockUser.phone);
            expect(mockCreateRazorpaySubscription).toHaveBeenCalledWith(
                'plan_monthly_growth', 120, undefined, 'cust_recovered_123',
                undefined,
                expect.objectContaining({ planSlug: 'growth', restaurantId: 'r1' }),
            );
        });

        test('should proceed without customer ID when creation fails with already-exists and recovery also fails', async () => {
            mockCreateRazorpayCustomer.mockRejectedValue(new Error('Customer already exists for the merchant'));
            mockFetchRazorpayCustomersByContact.mockRejectedValue(new Error('Razorpay API unavailable'));
            mockFindPlanBySlug.mockResolvedValue(mockPlan);
            mockFindActiveSubscription.mockResolvedValue(null);
            mockCreateSubscription.mockResolvedValue({ id: 'sub-new' });
            mockCreateRazorpaySubscription.mockResolvedValue({ id: 'sub_rzp_new' });

            const res = await request(app)
                .post('/api/subscriptions/subscribe')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ planSlug: 'growth', billingCycle: 'MONTHLY' });

            expect(res.status).toBe(200);
            expect(mockCreateRazorpaySubscription).toHaveBeenCalledWith(
                'plan_monthly_growth', 120, undefined, undefined,
                undefined,
                expect.objectContaining({ planSlug: 'growth', restaurantId: 'r1' }),
            );
        });

        // cancelAtPeriodEnd re-subscribe: with the B4/B7 fix, /subscribe no longer
        // cancels the existing Razorpay sub or archives the local doc. The old sub
        // is left to expire naturally; the new one is scheduled with start_at set
        // to currentPeriodEnd so the user is not double-charged. /verify performs
        // the archive+swap when payment is confirmed.

        test('should NOT call cancelRazorpaySubscription on cancelAtPeriodEnd re-subscribe', async () => {
            const activePendingCancel = {
                id: 'sub-active-cancel',
                restaurantId: 'r1',
                status: 'ACTIVE',
                razorpaySubscriptionId: 'sub_rzp_cancel',
                cancelAtPeriodEnd: true,
                credits: 20,
                currentPeriodEnd: '2026-05-15T00:00:00.000Z',
            };
            mockFindPlanBySlug.mockResolvedValue(mockPlan);
            mockFindActiveSubscription.mockResolvedValue(activePendingCancel);
            mockCreateRazorpaySubscription.mockResolvedValue({ id: 'sub_rzp_new' });

            const res = await request(app)
                .post('/api/subscriptions/subscribe')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ planSlug: 'growth', billingCycle: 'MONTHLY' });

            expect(res.status).toBe(200);
            expect(mockCancelRazorpaySubscription).not.toHaveBeenCalled();
            expect(mockUpdateSubscription).not.toHaveBeenCalled();
            expect(mockCreateSubscription).not.toHaveBeenCalled();
            expect(mockCreateRazorpaySubscription).toHaveBeenCalledWith(
                'plan_monthly_growth', 120, undefined, 'cust_rzp_u1',
                Math.floor(new Date('2026-05-15T00:00:00.000Z').getTime() / 1000),
                expect.any(Object),
            );
        });

        test.skip('legacy: should proceed when Razorpay cancel returns already-in-terminal-state error on cancelAtPeriodEnd re-subscribe', async () => {
            const activePendingCancel = {
                id: 'sub-active-cancel',
                restaurantId: 'r1',
                status: 'ACTIVE',
                razorpaySubscriptionId: 'sub_rzp_already_done',
                cancelAtPeriodEnd: true,
                credits: 20,
            };
            mockFindPlanBySlug.mockResolvedValue(mockPlan);
            mockFindActiveSubscription.mockResolvedValue(activePendingCancel);
            mockCancelRazorpaySubscription.mockRejectedValue(new Error('Subscription not in an active state'));
            mockUpdateSubscription.mockResolvedValue({ ...activePendingCancel, endedAt: expect.any(String) });
            mockCreateSubscription.mockResolvedValue({ id: 'sub-new' });
            mockCreateRazorpaySubscription.mockResolvedValue({ id: 'sub_rzp_new' });

            const res = await request(app)
                .post('/api/subscriptions/subscribe')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ planSlug: 'growth', billingCycle: 'MONTHLY' });

            expect(res.status).toBe(200);
            expect(mockUpdateSubscription).toHaveBeenCalledWith(
                'sub-active-cancel',
                expect.objectContaining({ status: 'CANCELLED', endedAt: expect.any(String) }),
            );
            expect(mockCreateSubscription).toHaveBeenCalledWith(expect.objectContaining({ status: 'CREATED' }));
        });

        test('should sweep a stale CREATED Razorpay sub (unpaid checkout) and create a new one', async () => {
            // B1+B4 fix: when there's an in-flight CREATED checkout with NO paid invoices,
            // /subscribe cancels the stale Razorpay sub and creates a fresh one. The
            // local DB doc is intentionally NOT touched here — /verify materializes it.
            const createdSub = { ...mockSubscription, id: 'sub-created', status: 'CREATED', cancelAtPeriodEnd: false, razorpaySubscriptionId: 'sub_rzp_created' };
            mockFindPlanBySlug.mockResolvedValue(mockPlan);
            mockFindActiveSubscription.mockResolvedValue(createdSub);
            mockFindInvoicesByRazorpaySubscriptionId.mockResolvedValue([]);
            mockCancelRazorpaySubscription.mockResolvedValue({});
            mockCreateRazorpaySubscription.mockResolvedValue({ id: 'sub_rzp_new' });

            const res = await request(app)
                .post('/api/subscriptions/subscribe')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ planSlug: 'growth', billingCycle: 'MONTHLY' });

            expect(res.status).toBe(200);
            expect(mockCancelRazorpaySubscription).toHaveBeenCalledWith('sub_rzp_created', false);
            expect(mockUpdateSubscription).not.toHaveBeenCalled();
            expect(mockCreateSubscription).not.toHaveBeenCalled();
            expect(res.body.data.subscriptionId).toBe('sub_rzp_new');
        });

        test('should refuse to replace a CREATED/AUTHENTICATED subscription that has paid invoices (B1 safety net)', async () => {
            // B1 fix: even though the DB still says CREATED/AUTHENTICATED (a webhook race
            // could leave it stuck there), if we see paid invoices for that Razorpay sub
            // ID, the user has been billed. Refuse to replace — surface a 409 so the
            // user can refresh and let reconcile advance the state.
            const authenticatedSub = { ...mockSubscription, id: 'sub-auth', status: 'AUTHENTICATED', cancelAtPeriodEnd: false, razorpaySubscriptionId: 'sub_rzp_paid' };
            mockFindPlanBySlug.mockResolvedValue(mockPlan);
            mockFindActiveSubscription.mockResolvedValue(authenticatedSub);
            mockFindInvoicesByRazorpaySubscriptionId.mockResolvedValue([
                { id: 'inv-1', razorpaySubscriptionId: 'sub_rzp_paid', status: 'paid' } as any,
            ]);

            const res = await request(app)
                .post('/api/subscriptions/subscribe')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ planSlug: 'growth' });

            expect(res.status).toBe(409);
            expect(mockCancelRazorpaySubscription).not.toHaveBeenCalled();
            expect(mockCreateRazorpaySubscription).not.toHaveBeenCalled();
        });

        test('should still return 409 for ACTIVE subscription without cancelAtPeriodEnd (regression guard)', async () => {
            mockFindPlanBySlug.mockResolvedValue(mockPlan);
            mockFindActiveSubscription.mockResolvedValue({ ...mockSubscription, status: 'ACTIVE', cancelAtPeriodEnd: false });

            const res = await request(app)
                .post('/api/subscriptions/subscribe')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ planSlug: 'growth', billingCycle: 'MONTHLY' });

            expect(res.status).toBe(409);
            expect(mockCreateSubscription).not.toHaveBeenCalled();
        });
    });

    describe('POST /api/subscriptions/cancel', () => {
        test('should cancel active subscription at cycle end', async () => {
            mockFindActiveSubscription.mockResolvedValue(mockSubscription);
            mockCancelRazorpaySubscription.mockResolvedValue({});

            const res = await request(app)
                .post('/api/subscriptions/cancel')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(200);
            expect(mockCancelRazorpaySubscription).toHaveBeenCalledWith('sub_rzp_123', true);
            expect(mockUpdateSubscription).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    cancelAtPeriodEnd: true,
                    pendingPlanId: undefined,
                    pendingPlanSnapshot: null,
                }),
            );
        });

        test('cancels pendingRazorpaySubscriptionId immediately when present (reactivation case)', async () => {
            // When a deferred next-cycle sub exists (parked in pendingRazorpaySubscriptionId),
            // "Cancel plan" should cancel THAT sub immediately and let the current paid period
            // run to its natural end — not attempt cancel_at_cycle_end on the live billing sub
            // (which would succeed) but leave the deferred renewal in place.
            mockFindActiveSubscription.mockResolvedValue({
                ...mockSubscription,
                cancelAtPeriodEnd: false,
                pendingRazorpaySubscriptionId: 'rzp_sub_deferred_next',
            });
            mockCancelRazorpaySubscription.mockResolvedValue({});

            const res = await request(app)
                .post('/api/subscriptions/cancel')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(200);
            // Cancels the deferred sub immediately, not the live one
            expect(mockCancelRazorpaySubscription).toHaveBeenCalledWith('rzp_sub_deferred_next', false);
            expect(mockCancelRazorpaySubscription).not.toHaveBeenCalledWith('sub_rzp_123', expect.anything());
            // Clears pending slot, marks period as ending
            expect(mockUpdateSubscription).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    pendingRazorpaySubscriptionId: null,
                    cancelAtPeriodEnd: true,
                }),
            );
        });

        test('should be idempotent when already cancelAtPeriodEnd=true and no pending sub', async () => {
            mockFindActiveSubscription.mockResolvedValue({ ...mockSubscription, cancelAtPeriodEnd: true });
            const res = await request(app)
                .post('/api/subscriptions/cancel')
                .set('Authorization', `Bearer ${authToken}`);
            expect(res.status).toBe(200);
            expect(mockCancelRazorpaySubscription).not.toHaveBeenCalled();
        });

        test('should return 400 when no active subscription', async () => {
            mockFindActiveSubscription.mockResolvedValue(null);

            const res = await request(app)
                .post('/api/subscriptions/cancel')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(400);
        });

        test('should return 400 when subscription is not active', async () => {
            mockFindActiveSubscription.mockResolvedValue({
                ...mockSubscription, status: 'CANCELLED',
            });

            const res = await request(app)
                .post('/api/subscriptions/cancel')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(400);
        });

        test('returns 200 (not 500) when Razorpay sub is already in a terminal/cancelled state', async () => {
            // Regression for: after a plan-change flow, the OLD razorpaySubscriptionId
            // is already cancelled in Razorpay. cancel-at-cycle-end throws
            // "Subscription is not cancellable in cancelled status" which previously
            // propagated as a 500.
            mockFindActiveSubscription.mockResolvedValue(mockSubscription);
            mockCancelRazorpaySubscription.mockRejectedValue(
                new Error('Subscription is not cancellable in cancelled status'),
            );

            const res = await request(app)
                .post('/api/subscriptions/cancel')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(200);
            // DB updated to reflect terminal state
            expect(mockUpdateSubscription).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ cancelAtPeriodEnd: false, status: 'CANCELLED' }),
            );
        });

        test('cancels AUTHENTICATED subscription immediately (no billing cycle, so immediate path)', async () => {
            // Regression for: user stuck in AUTHENTICATED state with no period fields.
            // Previously the status guard blocked this with 400 ("Subscription is not active").
            mockFindActiveSubscription.mockResolvedValue({
                ...mockSubscription,
                status: 'AUTHENTICATED',
                cancelAtPeriodEnd: false,
            });
            mockCancelRazorpaySubscription
                .mockRejectedValueOnce(new Error('no billing cycle is going on'))
                .mockResolvedValueOnce({});

            const res = await request(app)
                .post('/api/subscriptions/cancel')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(200);
            // Immediate cancel path triggered
            expect(mockCancelRazorpaySubscription).toHaveBeenCalledWith('sub_rzp_123', false);
            expect(mockUpdateSubscription).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ status: 'CANCELLED', cancelAtPeriodEnd: false }),
            );
        });
    });

    describe('POST /api/subscriptions/change-plan', () => {
        const mockActiveSub = {
            id: 'sub1',
            restaurantId: 'r1',
            status: 'ACTIVE',
            razorpaySubscriptionId: 'rzp_sub_123',
            billingCycle: 'MONTHLY',
            cancelAtPeriodEnd: false,
            planSnapshot: {
                slug: 'starter',
                pricing: { monthly: 49900, annual: 499000 },
                razorpayPlanIds: { monthly: 'plan_starter_m', annual: 'plan_starter_a' },
            },
            currentPeriodEnd: '2026-05-01T00:00:00.000Z',
        };

        const mockGrowthPlan = {
            id: 'plan_growth_id',
            slug: 'growth',
            name: 'Growth',
            pricing: { monthly: 99900, annual: 999000 },
            razorpayPlanIds: { monthly: 'plan_growth_m', annual: 'plan_growth_a' },
        };

        const mockStarterPlan = {
            id: 'plan_starter_id',
            slug: 'starter',
            name: 'Starter',
            pricing: { monthly: 49900, annual: 499000 },
            razorpayPlanIds: { monthly: 'plan_starter_m', annual: 'plan_starter_a' },
        };

        beforeEach(() => {
            mockFindActiveSubscription.mockResolvedValue(mockActiveSub);
            mockFindPlanBySlug.mockResolvedValue(mockGrowthPlan);
            mockUpdateRazorpaySubscription.mockResolvedValue({ id: 'rzp_sub_123', status: 'active', plan_id: 'plan_growth_m' });
            mockUpdateSubscription.mockResolvedValue(undefined);
        });

        test('upgrade default mode (cycle_end) — schedules deferred Growth, ₹5 mandate auth on checkout', async () => {
            // Unified flow: every plan change cancels-at-cycle-end the active sub
            // and creates a new sub with start_at=cycle_end. User is charged ₹5
            // mandate auth today; the full new-plan amount fires at cycle_end.
            mockCancelRazorpaySubscription.mockResolvedValue({});
            mockCreateRazorpaySubscription.mockResolvedValue({ id: 'rzp_sub_new', status: 'created' });

            const res = await request(app)
                .post('/api/subscriptions/change-plan')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ planSlug: 'growth' });

            expect(res.status).toBe(200);
            expect(res.body.data.effective).toBe('cycle_end');
            expect(res.body.data.requiresCheckout).toBe(true);
            expect(res.body.data.subscriptionId).toBe('rzp_sub_new');
            // Active sub cancel-at-cycle-end (idempotent step 1)
            expect(mockCancelRazorpaySubscription).toHaveBeenCalledWith('rzp_sub_123', true);
            // New deferred sub created with start_at = currentPeriodEnd (May 1)
            const expectedStartAt = Math.floor(new Date('2026-05-01T00:00:00.000Z').getTime() / 1000);
            expect(mockCreateRazorpaySubscription).toHaveBeenCalledWith(
                'plan_growth_m', 120, undefined, undefined, expectedStartAt,
                expect.objectContaining({ planSlug: 'growth', restaurantId: 'r1' }),
            );
            // No legacy PATCH attempts
            expect(mockUpdateRazorpaySubscription).not.toHaveBeenCalled();
            // Early DB store for webhook lookup — pendingRazorpaySubscriptionId written immediately
            expect(mockUpdateSubscription).toHaveBeenCalledWith('sub1', expect.objectContaining({
                pendingRazorpaySubscriptionId: 'rzp_sub_new',
            }));
            expect(mockCreateSubscription).not.toHaveBeenCalled();
        });

        test('upgrade with mode=now — cancels old, creates immediate-charge sub for full new-plan amount', async () => {
            // For "Upgrade now" the user explicitly opts in to immediate switching:
            // start_at omitted → Razorpay charges the full new-plan amount today.
            mockCancelRazorpaySubscription.mockResolvedValue({});
            mockCreateRazorpaySubscription.mockResolvedValue({ id: 'rzp_sub_new', status: 'created' });

            const res = await request(app)
                .post('/api/subscriptions/change-plan')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ planSlug: 'growth', mode: 'now' });

            expect(res.status).toBe(200);
            expect(res.body.data.effective).toBe('immediate');
            expect(res.body.data.requiresCheckout).toBe(true);
            expect(res.body.data.subscriptionId).toBe('rzp_sub_new');
            expect(mockCancelRazorpaySubscription).toHaveBeenCalledWith('rzp_sub_123', true);
            // start_at undefined for immediate
            expect(mockCreateRazorpaySubscription).toHaveBeenCalledWith(
                'plan_growth_m', 120, undefined, undefined, undefined,
                expect.objectContaining({ planSlug: 'growth', restaurantId: 'r1' }),
            );
            expect(mockUpdateRazorpaySubscription).not.toHaveBeenCalled();
            expect(mockUpdateSubscription).not.toHaveBeenCalled();
            expect(mockCreateSubscription).not.toHaveBeenCalled();
        });

        test('mode=now is ignored for downgrades (forced to cycle_end)', async () => {
            // 'now' is only meaningful for upgrades. Downgrade with mode='now' is
            // demoted to mode='cycle_end' silently — UI cannot expose "downgrade now".
            mockFindActiveSubscription.mockResolvedValue({
                ...mockActiveSub,
                planSnapshot: { slug: 'growth', pricing: { monthly: 99900, annual: 999000 }, razorpayPlanIds: { monthly: 'plan_growth_m', annual: 'plan_growth_a' } },
            });
            mockFindPlanBySlug.mockResolvedValue(mockStarterPlan);
            mockCancelRazorpaySubscription.mockResolvedValue({});
            mockCreateRazorpaySubscription.mockResolvedValue({ id: 'rzp_sub_starter_def', status: 'created' });

            const res = await request(app)
                .post('/api/subscriptions/change-plan')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ planSlug: 'starter', mode: 'now' });

            expect(res.status).toBe(200);
            expect(res.body.data.effective).toBe('cycle_end');
            // Should still create a deferred sub (start_at present), not immediate
            const expectedStartAt = Math.floor(new Date('2026-05-01T00:00:00.000Z').getTime() / 1000);
            expect(mockCreateRazorpaySubscription).toHaveBeenCalledWith(
                'plan_starter_m', 120, undefined, undefined, expectedStartAt,
                expect.objectContaining({ planSlug: 'starter', restaurantId: 'r1' }),
            );
        });

        test('B13 — upgrade fallback sweeps orphan in-flight Razorpay subs before creating a new one', async () => {
            // The user has a Razorpay customer ID — required for the sweep to fire.
            mockFindUserById.mockResolvedValue({ ...mockUser, razorpayCustomerId: 'cust_rzp_u1' });
            mockUpdateRazorpaySubscription.mockRejectedValue(
                new Error('Only offers can be updated for subscriptions when payment mode is domestic card.'),
            );
            // Two prior abandoned upgrade attempts left orphan subs; the active sub
            // matches existing.razorpaySubscriptionId and must NOT be cancelled.
            mockListRazorpaySubscriptionsForCustomer.mockResolvedValue({
                items: [
                    { id: 'rzp_orphan_a', status: 'created', plan_id: 'plan_growth_m' },
                    { id: 'rzp_orphan_b', status: 'authenticated', plan_id: 'plan_growth_m' },
                    { id: 'sub_rzp_123', status: 'active', plan_id: 'plan_starter_m' }, // current active sub
                    { id: 'rzp_old_paid', status: 'cancelled', plan_id: 'plan_starter_m' },
                ],
            });
            // Orphan lookups return null (no local doc); the active sub returns its doc.
            mockFindSubscriptionByRazorpayId.mockImplementation(async (id: string) => {
                if (id === 'sub_rzp_123') return mockSubscription;
                return null;
            });
            mockCreateRazorpaySubscription.mockResolvedValue({ id: 'rzp_sub_new', status: 'created' });

            const res = await request(app)
                .post('/api/subscriptions/change-plan')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ planSlug: 'growth', billingCycle: 'MONTHLY' });

            expect(res.status).toBe(200);
            expect(res.body.data.subscriptionId).toBe('rzp_sub_new');
            // Both orphans cancelled, active sub left alone
            expect(mockCancelRazorpaySubscription).toHaveBeenCalledWith('rzp_orphan_a', false);
            expect(mockCancelRazorpaySubscription).toHaveBeenCalledWith('rzp_orphan_b', false);
            expect(mockCancelRazorpaySubscription).not.toHaveBeenCalledWith('sub_rzp_123', expect.anything());
            expect(mockCancelRazorpaySubscription).not.toHaveBeenCalledWith('rzp_old_paid', expect.anything());
        });

        test('downgrade — cancel active sub + create deferred sub on lower plan (unified flow)', async () => {
            // Unified flow: every plan change cancels-at-cycle-end the active sub
            // and creates a new deferred sub. Downgrade specifically: target plan
            // is cheaper, mode forced to cycle_end, ₹5 mandate auth on checkout,
            // real charge of new (lower) plan amount fires at cycle_end.
            mockFindActiveSubscription.mockResolvedValue({
                ...mockActiveSub,
                planSnapshot: { slug: 'growth', pricing: { monthly: 99900, annual: 999000 }, razorpayPlanIds: { monthly: 'plan_growth_m', annual: 'plan_growth_a' } },
            });
            mockFindPlanBySlug.mockResolvedValue(mockStarterPlan);
            mockCancelRazorpaySubscription.mockResolvedValue({});
            mockCreateRazorpaySubscription.mockResolvedValue({ id: 'rzp_sub_starter_def', status: 'created' });

            const res = await request(app)
                .post('/api/subscriptions/change-plan')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ planSlug: 'starter' });

            expect(res.status).toBe(200);
            expect(res.body.data.effective).toBe('cycle_end');
            expect(res.body.data.requiresCheckout).toBe(true);
            expect(res.body.data.subscriptionId).toBe('rzp_sub_starter_def');
            expect(mockCancelRazorpaySubscription).toHaveBeenCalledWith('rzp_sub_123', true);
            const expectedStartAt = Math.floor(new Date('2026-05-01T00:00:00.000Z').getTime() / 1000);
            expect(mockCreateRazorpaySubscription).toHaveBeenCalledWith(
                'plan_starter_m', 120, undefined, undefined, expectedStartAt,
                expect.objectContaining({ planSlug: 'starter', restaurantId: 'r1' }),
            );
            expect(mockUpdateRazorpaySubscription).not.toHaveBeenCalled();
            expect(mockCreateSubscription).not.toHaveBeenCalled();
            // Early DB store for webhook lookup — pendingRazorpaySubscriptionId written immediately
            expect(mockUpdateSubscription).toHaveBeenCalledWith('sub1', expect.objectContaining({
                pendingRazorpaySubscriptionId: 'rzp_sub_starter_def',
            }));
        });

        test('should return 400 when no active subscription exists', async () => {
            mockFindActiveSubscription.mockResolvedValue(null);

            const res = await request(app)
                .post('/api/subscriptions/change-plan')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ planSlug: 'growth', billingCycle: 'MONTHLY' });

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/no active subscription/i);
        });

        test('should return 400 when subscription status is CREATED', async () => {
            mockFindActiveSubscription.mockResolvedValue({ ...mockActiveSub, status: 'CREATED' });

            const res = await request(app)
                .post('/api/subscriptions/change-plan')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ planSlug: 'growth', billingCycle: 'MONTHLY' });

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/must be active/i);
        });

        test('should return 404 when plan not found', async () => {
            mockFindPlanBySlug.mockResolvedValue(null);

            const res = await request(app)
                .post('/api/subscriptions/change-plan')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ planSlug: 'nonexistent', billingCycle: 'MONTHLY' });

            expect(res.status).toBe(404);
        });

        test('should return 400 when planSlug is missing', async () => {
            const res = await request(app)
                .post('/api/subscriptions/change-plan')
                .set('Authorization', `Bearer ${authToken}`)
                .send({});

            expect(res.status).toBe(400);
        });

        test('should return 401 without auth', async () => {
            const res = await request(app)
                .post('/api/subscriptions/change-plan')
                .send({ planSlug: 'growth', billingCycle: 'MONTHLY' });
            expect(res.status).toBe(401);
        });
    });

    describe('POST /api/subscriptions/change-plan amending pending change', () => {
        // Restaurant is on Premium with a pending downgrade to Growth already scheduled
        // (cancelAtPeriodEnd=true from the prior domestic-card downgrade path).
        const mockPremiumPlan = {
            id: 'plan_premium_id',
            slug: 'premium',
            name: 'Premium',
            pricing: { monthly: 299900, annual: 2999000 },
            razorpayPlanIds: { monthly: 'plan_premium_m', annual: 'plan_premium_a' },
        };
        const mockGrowthPlan = {
            id: 'plan_growth_id',
            slug: 'growth',
            name: 'Growth',
            pricing: { monthly: 99900, annual: 999000 },
            razorpayPlanIds: { monthly: 'plan_growth_m', annual: 'plan_growth_a' },
        };
        const mockStarterPlan = {
            id: 'plan_starter_id',
            slug: 'starter',
            name: 'Starter',
            pricing: { monthly: 49900, annual: 499000 },
            razorpayPlanIds: { monthly: 'plan_starter_m', annual: 'plan_starter_a' },
        };
        const mockEnterprisePlan = {
            id: 'plan_enterprise_id',
            slug: 'enterprise',
            name: 'Enterprise',
            pricing: { monthly: 499900, annual: 4999000 },
            razorpayPlanIds: { monthly: 'plan_enterprise_m', annual: 'plan_enterprise_a' },
        };
        const mockPremiumPendingGrowth = {
            id: 'sub1',
            restaurantId: 'r1',
            status: 'ACTIVE',
            razorpaySubscriptionId: 'rzp_sub_premium',
            billingCycle: 'MONTHLY',
            cancelAtPeriodEnd: true,
            cancelledAt: '2026-04-10T00:00:00.000Z',
            planSnapshot: mockPremiumPlan,
            pendingPlanId: mockGrowthPlan.id,
            pendingPlanSnapshot: mockGrowthPlan,
            currentPeriodEnd: '2026-05-01T00:00:00.000Z',
        };

        beforeEach(() => {
            mockFindActiveSubscription.mockResolvedValue(mockPremiumPendingGrowth);
            mockUpdateSubscription.mockResolvedValue(undefined);
            mockCancelRazorpaySubscription.mockResolvedValue({ id: 'rzp_sub_premium', status: 'active' });
            mockUpdateRazorpaySubscription.mockResolvedValue({ id: 'rzp_sub_premium', status: 'active', plan_id: 'plan_enterprise_m' });
        });

        test('Case A — clicking current plan from pending-state creates deferred sub on current plan (keep-current via unified flow)', async () => {
            // "Keep current" goes through the unified flow with target = current plan.
            // The active sub is already cancel-at-cycle-end-scheduled (idempotent
            // step skips re-cancellation). A new deferred-Premium sub is created
            // with start_at = currentPeriodEnd. ₹5 mandate auth on checkout. After
            // /verify, materialize Path B1 (deferred-resubscribe-same-plan) merges
            // into the existing doc and clears the pending fields.
            mockFindPlanBySlug.mockResolvedValue(mockPremiumPlan);
            mockCreateRazorpaySubscription.mockResolvedValue({ id: 'rzp_sub_premium_new', status: 'created' });

            const res = await request(app)
                .post('/api/subscriptions/change-plan')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ planSlug: 'premium' });

            expect(res.status).toBe(200);
            expect(res.body.data.effective).toBe('cycle_end');
            expect(res.body.data.requiresCheckout).toBe(true);
            expect(res.body.data.subscriptionId).toBe('rzp_sub_premium_new');
            // Active sub already cancel-at-cycle-end-scheduled — idempotent step skips
            expect(mockCancelRazorpaySubscription).not.toHaveBeenCalledWith('rzp_sub_premium', true);
            expect(mockUpdateRazorpaySubscription).not.toHaveBeenCalled();
            const expectedStartAt = Math.floor(new Date('2026-05-01T00:00:00.000Z').getTime() / 1000);
            expect(mockCreateRazorpaySubscription).toHaveBeenCalledWith(
                'plan_premium_m', 120, undefined, undefined, expectedStartAt,
                expect.objectContaining({ planSlug: 'premium', restaurantId: 'r1' }),
            );
            expect(mockCreateSubscription).not.toHaveBeenCalled();
            // Early DB store: pendingRazorpaySubscriptionId written immediately for webhook lookup
            expect(mockUpdateSubscription).toHaveBeenCalledWith('sub1', expect.objectContaining({
                pendingRazorpaySubscriptionId: 'rzp_sub_premium_new',
            }));
        });

        test('Case B — clicking pending plan is a no-op success', async () => {
            mockFindPlanBySlug.mockResolvedValue(mockGrowthPlan);

            const res = await request(app)
                .post('/api/subscriptions/change-plan')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ planSlug: 'growth' });

            expect(res.status).toBe(200);
            expect(res.body.data.effective).toBe('cycle_end');
            expect(res.body.data.planName).toBe('Growth');
            expect(mockCancelRazorpaySubscription).not.toHaveBeenCalled();
            expect(mockUpdateRazorpaySubscription).not.toHaveBeenCalled();
            expect(mockCreateRazorpaySubscription).not.toHaveBeenCalled();
            expect(mockUpdateSubscription).not.toHaveBeenCalled();
        });

        test('Case C — amending pending downgrade to a different lower plan creates a fresh deferred sub on new target', async () => {
            // Unified flow: every amendment to a pending change creates a fresh
            // deferred Razorpay sub for the new target plan and sweeps the prior
            // deferred sub via the customer-list-and-cancel sweep. ₹5 mandate auth
            // on each amendment — the user pays for the flexibility.
            mockFindPlanBySlug.mockResolvedValue(mockStarterPlan);
            mockCreateRazorpaySubscription.mockResolvedValue({ id: 'rzp_sub_starter_def', status: 'created' });

            const res = await request(app)
                .post('/api/subscriptions/change-plan')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ planSlug: 'starter' });

            expect(res.status).toBe(200);
            expect(res.body.data.effective).toBe('cycle_end');
            expect(res.body.data.requiresCheckout).toBe(true);
            expect(res.body.data.subscriptionId).toBe('rzp_sub_starter_def');
            // Active sub already cancel-scheduled (idempotent skip)
            expect(mockCancelRazorpaySubscription).not.toHaveBeenCalledWith('rzp_sub_premium', true);
            const expectedStartAt = Math.floor(new Date('2026-05-01T00:00:00.000Z').getTime() / 1000);
            expect(mockCreateRazorpaySubscription).toHaveBeenCalledWith(
                'plan_starter_m', 120, undefined, undefined, expectedStartAt,
                expect.objectContaining({ planSlug: 'starter', restaurantId: 'r1' }),
            );
            // Early DB store for webhook lookup — pendingRazorpaySubscriptionId written immediately
            expect(mockUpdateSubscription).toHaveBeenCalledWith('sub1', expect.objectContaining({
                pendingRazorpaySubscriptionId: 'rzp_sub_starter_def',
            }));
            expect(mockCreateSubscription).not.toHaveBeenCalled();
            expect(mockUpdateRazorpaySubscription).not.toHaveBeenCalled();
        });

        test('Case D — pending-downgrade + click higher plan uses default cycle_end mode (deferred upgrade)', async () => {
            mockFindPlanBySlug.mockResolvedValue(mockEnterprisePlan);
            mockCreateRazorpaySubscription.mockResolvedValue({ id: 'rzp_sub_enterprise_def', status: 'created' });

            const res = await request(app)
                .post('/api/subscriptions/change-plan')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ planSlug: 'enterprise' });

            expect(res.status).toBe(200);
            expect(res.body.data.effective).toBe('cycle_end');
            expect(res.body.data.requiresCheckout).toBe(true);
            expect(res.body.data.subscriptionId).toBe('rzp_sub_enterprise_def');
            const expectedStartAt = Math.floor(new Date('2026-05-01T00:00:00.000Z').getTime() / 1000);
            expect(mockCreateRazorpaySubscription).toHaveBeenCalledWith(
                'plan_enterprise_m', 120, undefined, undefined, expectedStartAt,
                expect.objectContaining({ planSlug: 'enterprise', restaurantId: 'r1' }),
            );
            expect(mockUpdateRazorpaySubscription).not.toHaveBeenCalled();
            // Early DB store for webhook lookup — pendingRazorpaySubscriptionId written immediately
            expect(mockUpdateSubscription).toHaveBeenCalledWith('sub1', expect.objectContaining({
                pendingRazorpaySubscriptionId: 'rzp_sub_enterprise_def',
            }));
            expect(mockCreateSubscription).not.toHaveBeenCalled();
        });

        test('Case D — pending-downgrade + click higher plan with mode=now creates immediate-charge sub on target', async () => {
            mockFindPlanBySlug.mockResolvedValue(mockEnterprisePlan);
            mockCreateRazorpaySubscription.mockResolvedValue({ id: 'rzp_sub_enterprise_immed', status: 'created' });

            const res = await request(app)
                .post('/api/subscriptions/change-plan')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ planSlug: 'enterprise', mode: 'now' });

            expect(res.status).toBe(200);
            expect(res.body.data.effective).toBe('immediate');
            expect(res.body.data.requiresCheckout).toBe(true);
            expect(res.body.data.subscriptionId).toBe('rzp_sub_enterprise_immed');
            // start_at undefined for immediate
            expect(mockCreateRazorpaySubscription).toHaveBeenCalledWith(
                'plan_enterprise_m', 120, undefined, undefined, undefined,
                expect.objectContaining({ planSlug: 'enterprise', restaurantId: 'r1' }),
            );
            expect(mockUpdateRazorpaySubscription).not.toHaveBeenCalled();
        });
    });

    describe('POST /api/subscriptions/reactivate', () => {
        const mockCancelledEndSub = {
            id: 'sub1',
            restaurantId: 'r1',
            status: 'ACTIVE',
            razorpaySubscriptionId: 'rzp_sub_123',
            cancelAtPeriodEnd: true,
            billingCycle: 'MONTHLY',
            credits: 10,
            currentPeriodEnd: '2026-05-01T00:00:00.000Z',
            planSnapshot: {
                id: 'plan_growth_id',
                slug: 'growth',
                name: 'Growth',
                pricing: { monthly: 99900, annual: 999000 },
                razorpayPlanIds: { monthly: 'plan_growth_m', annual: 'plan_growth_a' },
            },
        };

        beforeEach(() => {
            mockFindActiveSubscription.mockResolvedValue(mockCancelledEndSub);
            mockCancelRazorpaySubscription.mockResolvedValue({});
            mockUpdateSubscription.mockResolvedValue(undefined);
            mockCreateRazorpaySubscription.mockResolvedValue({ id: 'rzp_sub_new', status: 'created' });
            mockCreateSubscription.mockResolvedValue({ id: 'sub-reactivated' });
        });

        test('should create deferred resubscribe Razorpay sub and NOT touch the DB (B7 fix)', async () => {
            const res = await request(app)
                .post('/api/subscriptions/reactivate')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data.requiresCheckout).toBe(true);
            expect(res.body.data.subscriptionId).toBe('rzp_sub_new');
            expect(res.body.data.keyId).toBe('rzp_test_key');
            // Old sub NOT cancelled immediately — left to expire at cycle_end
            expect(mockCancelRazorpaySubscription).not.toHaveBeenCalled();
            // New sub created with start_at=cycle_end (deferred first charge)
            const expectedStartAt = Math.floor(new Date('2026-05-01T00:00:00.000Z').getTime() / 1000);
            expect(mockCreateRazorpaySubscription).toHaveBeenCalledWith(
                'plan_growth_m', 120, undefined, undefined, expectedStartAt,
                expect.objectContaining({ planSlug: 'growth', restaurantId: 'r1' }),
            );
            // B7 fix: DB is NOT updated until /verify confirms payment
            expect(mockCreateSubscription).not.toHaveBeenCalled();
            expect(mockUpdateSubscription).not.toHaveBeenCalled();
        });

        test('should return 400 when no subscription exists', async () => {
            mockFindActiveSubscription.mockResolvedValue(null);

            const res = await request(app)
                .post('/api/subscriptions/reactivate')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/no subscription/i);
        });

        test('should return 400 when cancelAtPeriodEnd is false', async () => {
            mockFindActiveSubscription.mockResolvedValue({ ...mockCancelledEndSub, cancelAtPeriodEnd: false });

            const res = await request(app)
                .post('/api/subscriptions/reactivate')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/not pending cancellation/i);
        });

        test('should return 400 when subscription is fully CANCELLED', async () => {
            mockFindActiveSubscription.mockResolvedValue({ ...mockCancelledEndSub, status: 'CANCELLED', cancelAtPeriodEnd: true });

            const res = await request(app)
                .post('/api/subscriptions/reactivate')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(400);
        });

        test('should return 400 when plan configuration missing', async () => {
            mockFindActiveSubscription.mockResolvedValue({
                ...mockCancelledEndSub,
                planSnapshot: { id: 'plan_growth_id', slug: 'growth', name: 'Growth', razorpayPlanIds: {} },
            });

            const res = await request(app)
                .post('/api/subscriptions/reactivate')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/plan configuration missing/i);
        });
    });

    describe('POST /api/subscriptions/credits/purchase', () => {
        test('should create a Razorpay order for credit pack', async () => {
            mockFindCreditPackById.mockResolvedValue({
                id: 'pack-1', name: '20 Credits', credits: 20,
                priceInPaise: 19900, isActive: true,
            });
            mockCreateRazorpayOrder.mockResolvedValue({
                id: 'order_123', amount: 19900, currency: 'INR',
            });
            mockCreateCreditPurchase.mockResolvedValue({ id: 'cp-1' });

            const res = await request(app)
                .post('/api/subscriptions/credits/purchase')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ creditPackId: 'pack-1' });

            expect(res.status).toBe(200);
            expect(res.body.data.orderId).toBe('order_123');
            expect(res.body.data.credits).toBe(20);
        });

        test('should return 400 when creditPackId missing', async () => {
            const res = await request(app)
                .post('/api/subscriptions/credits/purchase')
                .set('Authorization', `Bearer ${authToken}`)
                .send({});

            expect(res.status).toBe(400);
        });

        test('should return 404 for inactive credit pack', async () => {
            mockFindCreditPackById.mockResolvedValue({
                id: 'pack-1', isActive: false,
            });

            const res = await request(app)
                .post('/api/subscriptions/credits/purchase')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ creditPackId: 'pack-1' });

            expect(res.status).toBe(404);
        });
    });

    describe('POST /api/subscriptions/credits/verify', () => {
        test('should verify payment and add credits', async () => {
            mockVerifyPaymentSignature.mockReturnValue(true);
            mockFindCreditPurchaseByOrderId.mockResolvedValue({
                id: 'cp-1', restaurantId: 'r1', creditsAdded: 20,
                amountPaise: 19900, status: 'PENDING',
            });
            mockFindActiveSubscription.mockResolvedValue({ id: 'sub-r1' });

            const res = await request(app)
                .post('/api/subscriptions/credits/verify')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    razorpayOrderId: 'order_123',
                    razorpayPaymentId: 'pay_456',
                    razorpaySignature: 'sig_valid',
                });

            expect(res.status).toBe(200);
            expect(mockAddCredits).toHaveBeenCalledWith('sub-r1', 20);
            expect(mockCreateInvoice).toHaveBeenCalledWith(
                expect.objectContaining({
                    restaurantId: 'r1',
                    type: 'CREDIT_PURCHASE',
                    amountPaise: 19900,
                    description: '20 Credits',
                }),
            );
        });

        test('should create invoice for credit purchase', async () => {
            mockVerifyPaymentSignature.mockReturnValue(true);
            mockFindCreditPurchaseByOrderId.mockResolvedValue({
                id: 'cp-1', restaurantId: 'r1', creditsAdded: 50,
                amountPaise: 44900, status: 'PENDING',
            });
            mockFindActiveSubscription.mockResolvedValue({ id: 'sub-r1' });

            await request(app)
                .post('/api/subscriptions/credits/verify')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    razorpayOrderId: 'order_456',
                    razorpayPaymentId: 'pay_789',
                    razorpaySignature: 'sig_ok',
                });

            expect(mockCreateInvoice).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'CREDIT_PURCHASE',
                    razorpayOrderId: 'order_456',
                    razorpayPaymentId: 'pay_789',
                    description: '50 Credits',
                }),
            );
        });

        test('should return 400 for invalid signature', async () => {
            mockVerifyPaymentSignature.mockReturnValue(false);

            const res = await request(app)
                .post('/api/subscriptions/credits/verify')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    razorpayOrderId: 'order_123',
                    razorpayPaymentId: 'pay_456',
                    razorpaySignature: 'bad_sig',
                });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Payment signature verification failed');
        });

        test('should return 400 when fields missing', async () => {
            const res = await request(app)
                .post('/api/subscriptions/credits/verify')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ razorpayOrderId: 'order_123' });

            expect(res.status).toBe(400);
        });

        test('should skip if already paid', async () => {
            mockVerifyPaymentSignature.mockReturnValue(true);
            mockFindCreditPurchaseByOrderId.mockResolvedValue({
                id: 'cp-1', restaurantId: 'r1', creditsAdded: 20,
                amountPaise: 19900, status: 'PAID',
            });

            const res = await request(app)
                .post('/api/subscriptions/credits/verify')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    razorpayOrderId: 'order_123',
                    razorpayPaymentId: 'pay_456',
                    razorpaySignature: 'sig_valid',
                });

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Credits already added');
            expect(mockAddCredits).not.toHaveBeenCalled();
        });
    });

    describe('POST /api/subscriptions/webhook', () => {
        test('should handle subscription.charged and create invoice with Razorpay auto-generated invoice', async () => {
            mockVerifyWebhookSignature.mockReturnValue(true);
            mockFindSubscriptionByRazorpayId.mockResolvedValue({
                ...mockSubscription,
                id: 'sub-r1',
                razorpayCustomerId: 'cust_db_123',
            });
            mockFindInvoiceByPaymentId.mockResolvedValue(null);

            const res = await request(app)
                .post('/api/subscriptions/webhook')
                .set('x-razorpay-signature', 'valid_signature')
                .send({
                    event: 'subscription.charged',
                    payload: {
                        subscription: {
                            entity: {
                                id: 'sub_rzp_123',
                                customer_id: 'cust_payload_123',
                                current_start: Math.floor(Date.now() / 1000),
                                current_end: Math.floor(Date.now() / 1000) + 30 * 86400,
                            },
                        },
                        payment: {
                            entity: {
                                id: 'pay_webhook_1',
                                invoice_id: 'inv_rzp_webhook',
                                amount: 999900,
                                currency: 'INR',
                            },
                        },
                    },
                });

            expect(res.status).toBe(200);
            expect(mockUpdateSubscription).toHaveBeenCalledWith('sub-r1', expect.objectContaining({ status: 'ACTIVE' }));
            // Fetches the auto-generated Razorpay invoice to get its PDF URL
            expect(mockFetchRazorpayInvoice).toHaveBeenCalledWith('inv_rzp_webhook');
            // Internal invoice stored with Razorpay invoice id + short_url
            expect(mockCreateInvoice).toHaveBeenCalledWith(expect.objectContaining({
                restaurantId: 'r1',
                type: 'SUBSCRIPTION',
                razorpayInvoiceId: 'inv_rzp_webhook',
                razorpayPaymentId: 'pay_webhook_1',
                amountPaise: 999900,
                pdfUrl: 'https://rzp.io/i/test',
            }));
        });

        test('should still create internal invoice if Razorpay invoice fetch fails', async () => {
            mockVerifyWebhookSignature.mockReturnValue(true);
            mockFindSubscriptionByRazorpayId.mockResolvedValue({ ...mockSubscription, id: 'sub-r1', razorpayCustomerId: 'cust_db_123' });
            mockFindInvoiceByPaymentId.mockResolvedValue(null);
            mockFetchRazorpayInvoice.mockRejectedValue(new Error('Razorpay API error'));

            const res = await request(app)
                .post('/api/subscriptions/webhook')
                .set('x-razorpay-signature', 'valid_signature')
                .send({
                    event: 'subscription.charged',
                    payload: {
                        subscription: { entity: { id: 'sub_rzp_123', current_start: 0, current_end: 0 } },
                        payment: { entity: { id: 'pay_err_1', invoice_id: 'inv_err_123', amount: 999900, currency: 'INR' } },
                    },
                });

            expect(res.status).toBe(200);
            expect(mockCreateInvoice).toHaveBeenCalledOnce();
            // pdfUrl is undefined when invoice fetch fails
            expect(mockCreateInvoice).toHaveBeenCalledWith(expect.objectContaining({ pdfUrl: undefined }));
        });

        test('should skip invoice PDF fetch when payment has no invoice_id', async () => {
            mockVerifyWebhookSignature.mockReturnValue(true);
            mockFindSubscriptionByRazorpayId.mockResolvedValue({
                ...mockSubscription,
                id: 'sub-r1',
            });
            mockFindInvoiceByPaymentId.mockResolvedValue(null);

            const res = await request(app)
                .post('/api/subscriptions/webhook')
                .set('x-razorpay-signature', 'valid_signature')
                .send({
                    event: 'subscription.charged',
                    payload: {
                        subscription: { entity: { id: 'sub_rzp_123', current_start: 0, current_end: 0 } },
                        payment: { entity: { id: 'pay_no_inv', amount: 999900, currency: 'INR' } },
                    },
                });

            expect(res.status).toBe(200);
            expect(mockFetchRazorpayInvoice).not.toHaveBeenCalled();
            expect(mockCreateInvoice).toHaveBeenCalledOnce();
        });

        test('subscription.charged should clear stale cancelAtPeriodEnd and cancelledAt', async () => {
            mockVerifyWebhookSignature.mockReturnValue(true);
            mockFindSubscriptionByRazorpayId.mockResolvedValue({
                ...mockSubscription,
                id: 'sub-r1',
                razorpayCustomerId: 'cust_db_123',
            });
            mockFindInvoiceByPaymentId.mockResolvedValue(null);

            await request(app)
                .post('/api/subscriptions/webhook')
                .set('x-razorpay-signature', 'valid_signature')
                .send({
                    event: 'subscription.charged',
                    payload: {
                        subscription: {
                            entity: {
                                id: 'sub_rzp_123',
                                customer_id: 'cust_db_123',
                                current_start: Math.floor(Date.now() / 1000),
                                current_end: Math.floor(Date.now() / 1000) + 30 * 86400,
                            },
                        },
                        payment: { entity: { id: 'pay_clear_test', amount: 999900, currency: 'INR' } },
                    },
                });

            expect(mockUpdateSubscription).toHaveBeenCalledWith(
                'sub-r1',
                expect.objectContaining({ cancelAtPeriodEnd: false, cancelledAt: undefined }),
            );
        });

        test('should handle subscription.cancelled', async () => {
            mockVerifyWebhookSignature.mockReturnValue(true);
            mockFindSubscriptionByRazorpayId.mockResolvedValue({ ...mockSubscription });

            const res = await request(app)
                .post('/api/subscriptions/webhook')
                .set('x-razorpay-signature', 'valid_sig')
                .send({
                    event: 'subscription.cancelled',
                    payload: { subscription: { entity: { id: 'sub_rzp_123' } } },
                });

            expect(res.status).toBe(200);
            expect(mockUpdateSubscription).toHaveBeenCalledWith(mockSubscription.id, expect.objectContaining({
                status: 'CANCELLED',
            }));
        });

        test('subscription.cancelled should reset cancelAtPeriodEnd to false', async () => {
            mockVerifyWebhookSignature.mockReturnValue(true);
            mockFindSubscriptionByRazorpayId.mockResolvedValue({ ...mockSubscription });

            await request(app)
                .post('/api/subscriptions/webhook')
                .set('x-razorpay-signature', 'valid_sig')
                .send({
                    event: 'subscription.cancelled',
                    payload: { subscription: { entity: { id: 'sub_rzp_123' } } },
                });

            expect(mockUpdateSubscription).toHaveBeenCalledWith(
                mockSubscription.id,
                expect.objectContaining({
                    status: 'CANCELLED',
                    cancelledAt: expect.any(String),
                    cancelAtPeriodEnd: false,
                }),
            );
        });

        test('should handle subscription.halted', async () => {
            mockVerifyWebhookSignature.mockReturnValue(true);
            mockFindSubscriptionByRazorpayId.mockResolvedValue({ ...mockSubscription });

            const res = await request(app)
                .post('/api/subscriptions/webhook')
                .set('x-razorpay-signature', 'valid_sig')
                .send({
                    event: 'subscription.halted',
                    payload: { subscription: { entity: { id: 'sub_rzp_123' } } },
                });

            expect(res.status).toBe(200);
            expect(mockUpdateSubscription).toHaveBeenCalledWith(mockSubscription.id, { status: 'HALTED' });
        });

        test('should handle subscription.pending', async () => {
            mockVerifyWebhookSignature.mockReturnValue(true);
            mockFindSubscriptionByRazorpayId.mockResolvedValue({ ...mockSubscription });

            const res = await request(app)
                .post('/api/subscriptions/webhook')
                .set('x-razorpay-signature', 'valid_sig')
                .send({
                    event: 'subscription.pending',
                    payload: { subscription: { entity: { id: 'sub_rzp_123' } } },
                });

            expect(res.status).toBe(200);
            expect(mockUpdateSubscription).toHaveBeenCalledWith(mockSubscription.id, { status: 'PAST_DUE' });
        });

        test('should return 400 when signature header missing', async () => {
            const res = await request(app)
                .post('/api/subscriptions/webhook')
                .send({ event: 'test' });

            expect(res.status).toBe(400);
        });

        test('should return 401 when signature is invalid', async () => {
            mockVerifyWebhookSignature.mockReturnValue(false);

            const res = await request(app)
                .post('/api/subscriptions/webhook')
                .set('x-razorpay-signature', 'invalid')
                .send({ event: 'test' });

            expect(res.status).toBe(401);
        });

        test('should handle subscription.authenticated — advances CREATED to AUTHENTICATED', async () => {
            mockVerifyWebhookSignature.mockReturnValue(true);
            // CREATED (rank 1) → AUTHENTICATED (rank 2): rank check passes, update fires
            mockFindSubscriptionByRazorpayId.mockResolvedValue({ ...mockSubscription, status: 'CREATED' });

            const res = await request(app)
                .post('/api/subscriptions/webhook')
                .set('x-razorpay-signature', 'valid_sig')
                .send({
                    event: 'subscription.authenticated',
                    payload: { subscription: { entity: { id: 'sub_rzp_123' } } },
                });

            expect(res.status).toBe(200);
            expect(mockUpdateSubscription).toHaveBeenCalledWith(mockSubscription.id, { status: 'AUTHENTICATED' });
        });

        test('subscription.authenticated rank guard: does NOT downgrade ACTIVE to AUTHENTICATED', async () => {
            // Regression for: /verify created Premium ACTIVE via Path B4, then the late-arriving
            // subscription.authenticated webhook tried to downgrade it back to AUTHENTICATED,
            // causing the "no active plan" stuck state after an immediate upgrade.
            mockVerifyWebhookSignature.mockReturnValue(true);
            // ACTIVE (rank 3) → AUTHENTICATED (rank 2): rank check fails, update is skipped
            mockFindSubscriptionByRazorpayId.mockResolvedValue({ ...mockSubscription, status: 'ACTIVE' });
            mockFindSubscriptionByPendingRazorpayId.mockResolvedValue(null);

            const res = await request(app)
                .post('/api/subscriptions/webhook')
                .set('x-razorpay-signature', 'valid_sig')
                .send({
                    event: 'subscription.authenticated',
                    payload: { subscription: { entity: { id: 'sub_rzp_123' } } },
                });

            expect(res.status).toBe(200);
            expect(mockUpdateSubscription).not.toHaveBeenCalled();
        });

        test('should handle subscription.activated with FLAT coupon redemption, resolving userId from restaurant when notes lack it', async () => {
            mockVerifyWebhookSignature.mockReturnValue(true);
            mockFindSubscriptionByRazorpayId.mockResolvedValue({
                ...mockSubscription, couponCode: 'TESTCODE',
            });
            mockFindCouponByCode.mockResolvedValue({
                id: 'c1', code: 'TESTCODE', type: 'FLAT', value: 50000,
            });
            mockFindUserByRestaurantId.mockResolvedValue(mockUser);

            const res = await request(app)
                .post('/api/subscriptions/webhook')
                .set('x-razorpay-signature', 'valid_sig')
                .send({
                    event: 'subscription.activated',
                    payload: {
                        subscription: {
                            entity: {
                                id: 'sub_rzp_123',
                                current_end: Math.floor(Date.now() / 1000) + 30 * 86400,
                                customer_id: 'cust_123',
                                // no notes.userId -- must fall back to a restaurant lookup
                            },
                        },
                    },
                });

            expect(res.status).toBe(200);
            expect(mockUpdateSubscription).toHaveBeenCalledWith(mockSubscription.id, expect.objectContaining({
                status: 'ACTIVE',
                razorpayCustomerId: 'cust_123',
            }));
            expect(mockIncrementCouponRedemptions).toHaveBeenCalledWith('c1');
            expect(mockFindUserByRestaurantId).toHaveBeenCalledWith('r1');
            expect(mockCreateCouponRedemption).toHaveBeenCalledWith(expect.objectContaining({
                userId: 'u1',
                discountAppliedPaise: 50000,
            }));
        });

        test('should prefer notes.userId over restaurant lookup when recording coupon redemption', async () => {
            mockVerifyWebhookSignature.mockReturnValue(true);
            mockFindSubscriptionByRazorpayId.mockResolvedValue({
                ...mockSubscription, couponCode: 'TESTCODE',
            });
            mockFindCouponByCode.mockResolvedValue({
                id: 'c1', code: 'TESTCODE', type: 'FLAT', value: 50000,
            });

            const res = await request(app)
                .post('/api/subscriptions/webhook')
                .set('x-razorpay-signature', 'valid_sig')
                .send({
                    event: 'subscription.activated',
                    payload: {
                        subscription: {
                            entity: {
                                id: 'sub_rzp_123',
                                customer_id: 'cust_123',
                                notes: { userId: 'u-from-notes' },
                            },
                        },
                    },
                });

            expect(res.status).toBe(200);
            expect(mockFindUserByRestaurantId).not.toHaveBeenCalled();
            expect(mockCreateCouponRedemption).toHaveBeenCalledWith(expect.objectContaining({
                userId: 'u-from-notes',
            }));
        });

        test('should compute proportional discount for PERCENTAGE coupon redemption', async () => {
            mockVerifyWebhookSignature.mockReturnValue(true);
            mockFindSubscriptionByRazorpayId.mockResolvedValue({
                ...mockSubscription, couponCode: 'TESTCODE', // planSnapshot.pricing.monthly = 999900
            });
            mockFindCouponByCode.mockResolvedValue({
                id: 'c1', code: 'TESTCODE', type: 'PERCENTAGE', value: 10,
            });

            const res = await request(app)
                .post('/api/subscriptions/webhook')
                .set('x-razorpay-signature', 'valid_sig')
                .send({
                    event: 'subscription.activated',
                    payload: {
                        subscription: {
                            entity: { id: 'sub_rzp_123', customer_id: 'cust_123', notes: { userId: 'u1' } },
                        },
                    },
                });

            expect(res.status).toBe(200);
            expect(mockCreateCouponRedemption).toHaveBeenCalledWith(expect.objectContaining({
                discountAppliedPaise: 99990, // 10% of 999900
            }));
        });

        test('should handle subscription.activated without coupon', async () => {
            mockVerifyWebhookSignature.mockReturnValue(true);
            mockFindSubscriptionByRazorpayId.mockResolvedValue({
                ...mockSubscription, couponCode: undefined,
            });

            const res = await request(app)
                .post('/api/subscriptions/webhook')
                .set('x-razorpay-signature', 'valid_sig')
                .send({
                    event: 'subscription.activated',
                    payload: {
                        subscription: {
                            entity: { id: 'sub_rzp_123', customer_id: 'cust_456' },
                        },
                    },
                });

            expect(res.status).toBe(200);
            expect(mockIncrementCouponRedemptions).not.toHaveBeenCalled();
        });

        test('should handle unrecognized event gracefully', async () => {
            mockVerifyWebhookSignature.mockReturnValue(true);

            const res = await request(app)
                .post('/api/subscriptions/webhook')
                .set('x-razorpay-signature', 'valid_sig')
                .send({ event: 'payment.captured', payload: {} });

            expect(res.status).toBe(200);
        });

        test('should skip invoice creation when subscription.charged is a duplicate (idempotency)', async () => {
            mockVerifyWebhookSignature.mockReturnValue(true);
            mockFindSubscriptionByRazorpayId.mockResolvedValue({ ...mockSubscription, id: 'sub-r1' });
            // Simulate existing invoice for this payment
            mockFindInvoiceByPaymentId.mockResolvedValue({ id: 'inv-existing', razorpayPaymentId: 'pay_dup_1' });

            const res = await request(app)
                .post('/api/subscriptions/webhook')
                .set('x-razorpay-signature', 'valid_signature')
                .send({
                    event: 'subscription.charged',
                    payload: {
                        subscription: {
                            entity: {
                                id: 'sub_rzp_123',
                                current_start: Math.floor(Date.now() / 1000),
                                current_end: Math.floor(Date.now() / 1000) + 30 * 86400,
                            },
                        },
                        payment: {
                            entity: {
                                id: 'pay_dup_1',
                                invoice_id: 'inv_rzp_dup',
                                amount: 999900,
                                currency: 'INR',
                            },
                        },
                    },
                });

            expect(res.status).toBe(200);
            expect(mockUpdateSubscription).toHaveBeenCalledWith('sub-r1', expect.objectContaining({ status: 'ACTIVE' }));
            // Invoice must NOT be created again
            expect(mockCreateInvoice).not.toHaveBeenCalled();
        });

        test('should create invoice on first subscription.charged (non-duplicate)', async () => {
            mockVerifyWebhookSignature.mockReturnValue(true);
            mockFindSubscriptionByRazorpayId.mockResolvedValue({ ...mockSubscription, id: 'sub-r1' });
            // No existing invoice
            mockFindInvoiceByPaymentId.mockResolvedValue(null);

            const res = await request(app)
                .post('/api/subscriptions/webhook')
                .set('x-razorpay-signature', 'valid_signature')
                .send({
                    event: 'subscription.charged',
                    payload: {
                        subscription: {
                            entity: {
                                id: 'sub_rzp_123',
                                current_start: Math.floor(Date.now() / 1000),
                                current_end: Math.floor(Date.now() / 1000) + 30 * 86400,
                            },
                        },
                        payment: {
                            entity: {
                                id: 'pay_new_1',
                                invoice_id: 'inv_rzp_new',
                                amount: 999900,
                                currency: 'INR',
                            },
                        },
                    },
                });

            expect(res.status).toBe(200);
            expect(mockCreateInvoice).toHaveBeenCalledOnce();
            expect(mockCreateInvoice).toHaveBeenCalledWith(expect.objectContaining({
                razorpayPaymentId: 'pay_new_1',
                type: 'SUBSCRIPTION',
            }));
        });

        test('should promote pending plan snapshot when subscription.charged fires for a new cycle', async () => {
            mockVerifyWebhookSignature.mockReturnValue(true);
            const pendingPlanSnapshot = { name: 'Starter', slug: 'starter', pricing: { monthly: 49900, annual: 499000 } };
            const subWithPending = {
                ...mockSubscription,
                id: 'sub-r1',
                razorpayCustomerId: 'cust_db_123',
                pendingPlanId: 'plan_starter_id',
                pendingPlanSnapshot,
            };
            mockFindSubscriptionByRazorpayId.mockResolvedValue(subWithPending);
            mockFindInvoiceByPaymentId.mockResolvedValue(null);

            const res = await request(app)
                .post('/api/subscriptions/webhook')
                .set('x-razorpay-signature', 'valid_signature')
                .send({
                    event: 'subscription.charged',
                    payload: {
                        subscription: {
                            entity: {
                                id: 'sub_rzp_123',
                                customer_id: 'cust_db_123',
                                current_start: Math.floor(Date.now() / 1000),
                                current_end: Math.floor(Date.now() / 1000) + 30 * 86400,
                            },
                        },
                        payment: {
                            entity: {
                                id: 'pay_pending_promote',
                                amount: 49900,
                                currency: 'INR',
                            },
                        },
                    },
                });

            expect(res.status).toBe(200);
            expect(mockUpdateSubscription).toHaveBeenCalledWith('sub-r1', expect.objectContaining({
                planId: 'plan_starter_id',
                planSnapshot: pendingPlanSnapshot,
                billingCycle: 'MONTHLY',
                pendingPlanId: undefined,
                pendingPlanSnapshot: null,
            }));
        });
    });

    describe('Subscribe - additional coupon validation', () => {
        test('should reject inactive coupon', async () => {
            mockFindPlanBySlug.mockResolvedValue(mockPlan);
            mockFindCouponByCode.mockResolvedValue({
                id: 'c1', code: 'INACTIVE', status: 'DISABLED', type: 'FLAT', value: 10000,
            });

            const res = await request(app)
                .post('/api/subscriptions/subscribe')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ planSlug: 'growth', billingCycle: 'MONTHLY', couponCode: 'INACTIVE' });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Coupon is not active');
        });

        test('should reject fully redeemed coupon', async () => {
            mockFindPlanBySlug.mockResolvedValue(mockPlan);
            mockFindCouponByCode.mockResolvedValue({
                id: 'c1', code: 'MAXED123', status: 'ACTIVE', type: 'FLAT', value: 10000,
                maxRedemptions: 5, redemptionCount: 5,
                validFrom: new Date('2024-01-01'),
            });

            const res = await request(app)
                .post('/api/subscriptions/subscribe')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ planSlug: 'growth', billingCycle: 'MONTHLY', couponCode: 'MAXED123' });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Coupon has been fully redeemed');
        });

        test('should reject coupon assigned to different restaurant', async () => {
            mockFindPlanBySlug.mockResolvedValue(mockPlan);
            mockFindCouponByCode.mockResolvedValue({
                id: 'c1', code: 'PERSONAL', status: 'ACTIVE', type: 'FLAT', value: 10000,
                assignedTo: 'r999', redemptionCount: 0,
                validFrom: new Date('2024-01-01'),
            });

            const res = await request(app)
                .post('/api/subscriptions/subscribe')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ planSlug: 'growth', billingCycle: 'MONTHLY', couponCode: 'PERSONAL' });

            expect(res.status).toBe(400);
        });

        test('should reject coupon not applicable to plan', async () => {
            mockFindPlanBySlug.mockResolvedValue(mockPlan);
            mockFindCouponByCode.mockResolvedValue({
                id: 'c1', code: 'PREMIUM8', status: 'ACTIVE', type: 'FLAT', value: 10000,
                applicablePlans: ['premium'], redemptionCount: 0,
                validFrom: new Date('2024-01-01'),
            });

            const res = await request(app)
                .post('/api/subscriptions/subscribe')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ planSlug: 'growth', billingCycle: 'MONTHLY', couponCode: 'PREMIUM8' });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Coupon is not applicable to this plan');
        });

        test('should reject coupon already redeemed by restaurant', async () => {
            mockFindPlanBySlug.mockResolvedValue(mockPlan);
            mockFindCouponByCode.mockResolvedValue({
                id: 'c1', code: 'USED1234', status: 'ACTIVE', type: 'FLAT', value: 10000,
                redemptionCount: 1, maxRedemptions: 10,
                validFrom: new Date('2024-01-01'),
            });
            mockHasRestaurantRedeemedCoupon.mockResolvedValue(true);

            const res = await request(app)
                .post('/api/subscriptions/subscribe')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ planSlug: 'growth', billingCycle: 'MONTHLY', couponCode: 'USED1234' });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Coupon already redeemed by this restaurant');
        });

        test('should return 400 when Razorpay plan ID not configured', async () => {
            mockFindPlanBySlug.mockResolvedValue({
                ...mockPlan,
                razorpayPlanIds: { monthly: '', annual: 'plan_annual' },
            });

            const res = await request(app)
                .post('/api/subscriptions/subscribe')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ planSlug: 'growth', billingCycle: 'MONTHLY' });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('Razorpay plan not configured');
        });
    });

    describe('Credits verify - edge cases', () => {
        test('should return 404 when purchase not found', async () => {
            mockVerifyPaymentSignature.mockReturnValue(true);
            mockFindCreditPurchaseByOrderId.mockResolvedValue(null);

            const res = await request(app)
                .post('/api/subscriptions/credits/verify')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    razorpayOrderId: 'order_nonexistent',
                    razorpayPaymentId: 'pay_456',
                    razorpaySignature: 'sig_valid',
                });

            expect(res.status).toBe(404);
        });

        test('should add credits without active subscription (subscription is null)', async () => {
            // Covers the branch at line 469: if (subscription) -> false path
            mockVerifyPaymentSignature.mockReturnValue(true);
            mockFindCreditPurchaseByOrderId.mockResolvedValue({
                id: 'cp-no-sub', restaurantId: 'r1', creditsAdded: 10,
                amountPaise: 9900, status: 'PENDING',
            });
            // No active subscription
            mockFindActiveSubscription.mockResolvedValue(null);

            const res = await request(app)
                .post('/api/subscriptions/credits/verify')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    razorpayOrderId: 'order_nosub',
                    razorpayPaymentId: 'pay_nosub',
                    razorpaySignature: 'sig_nosub',
                });

            expect(res.status).toBe(200);
            // addCredits should NOT have been called since there's no subscription
            expect(mockAddCredits).not.toHaveBeenCalled();
            expect(mockCreateInvoice).toHaveBeenCalled();
        });
    });

    describe('POST /api/subscriptions/webhook - when subscription not found in DB', () => {
        // These tests cover the false branches of "if (sub)" inside each webhook case
        // when findSubscriptionByRazorpayId returns null (subscription not in our DB)
        const webhookNoSubBase = {
            'x-razorpay-signature': 'valid_sig',
        };

        test('should handle subscription.authenticated when sub not found in DB', async () => {
            mockVerifyWebhookSignature.mockReturnValue(true);
            mockFindSubscriptionByRazorpayId.mockResolvedValue(null);

            const res = await request(app)
                .post('/api/subscriptions/webhook')
                .set(webhookNoSubBase)
                .send({
                    event: 'subscription.authenticated',
                    payload: { subscription: { entity: { id: 'sub_rzp_unknown' } } },
                });

            expect(res.status).toBe(200);
            expect(mockUpdateSubscription).not.toHaveBeenCalled();
        });

        test('should handle subscription.activated when sub not found in DB', async () => {
            mockVerifyWebhookSignature.mockReturnValue(true);
            mockFindSubscriptionByRazorpayId.mockResolvedValue(null);

            const res = await request(app)
                .post('/api/subscriptions/webhook')
                .set(webhookNoSubBase)
                .send({
                    event: 'subscription.activated',
                    payload: { subscription: { entity: { id: 'sub_rzp_unknown', customer_id: 'c1' } } },
                });

            expect(res.status).toBe(200);
            expect(mockUpdateSubscription).not.toHaveBeenCalled();
        });

        test('should handle subscription.charged when sub not found in DB', async () => {
            mockVerifyWebhookSignature.mockReturnValue(true);
            mockFindSubscriptionByRazorpayId.mockResolvedValue(null);

            const res = await request(app)
                .post('/api/subscriptions/webhook')
                .set(webhookNoSubBase)
                .send({
                    event: 'subscription.charged',
                    payload: {
                        subscription: { entity: { id: 'sub_rzp_unknown' } },
                        payment: { entity: { id: 'pay_unknown', amount: 100 } },
                    },
                });

            expect(res.status).toBe(200);
            expect(mockUpdateSubscription).not.toHaveBeenCalled();
        });

        test('should handle subscription.pending when sub not found in DB', async () => {
            mockVerifyWebhookSignature.mockReturnValue(true);
            mockFindSubscriptionByRazorpayId.mockResolvedValue(null);

            const res = await request(app)
                .post('/api/subscriptions/webhook')
                .set(webhookNoSubBase)
                .send({
                    event: 'subscription.pending',
                    payload: { subscription: { entity: { id: 'sub_rzp_unknown' } } },
                });

            expect(res.status).toBe(200);
            expect(mockUpdateSubscription).not.toHaveBeenCalled();
        });

        test('should handle subscription.halted when sub not found in DB', async () => {
            mockVerifyWebhookSignature.mockReturnValue(true);
            mockFindSubscriptionByRazorpayId.mockResolvedValue(null);

            const res = await request(app)
                .post('/api/subscriptions/webhook')
                .set(webhookNoSubBase)
                .send({
                    event: 'subscription.halted',
                    payload: { subscription: { entity: { id: 'sub_rzp_unknown' } } },
                });

            expect(res.status).toBe(200);
            expect(mockUpdateSubscription).not.toHaveBeenCalled();
        });

        test('should handle subscription.cancelled when sub not found in DB', async () => {
            mockVerifyWebhookSignature.mockReturnValue(true);
            mockFindSubscriptionByRazorpayId.mockResolvedValue(null);

            const res = await request(app)
                .post('/api/subscriptions/webhook')
                .set(webhookNoSubBase)
                .send({
                    event: 'subscription.cancelled',
                    payload: { subscription: { entity: { id: 'sub_rzp_unknown' } } },
                });

            expect(res.status).toBe(200);
            expect(mockUpdateSubscription).not.toHaveBeenCalled();
        });
    });

    describe('POST /api/subscriptions/webhook - error path', () => {
        test('should return 500 when webhook processing throws an unexpected error', async () => {
            mockVerifyWebhookSignature.mockReturnValue(true);
            // Make the subscription lookup throw to trigger the catch block (lines 358-360)
            mockFindSubscriptionByRazorpayId.mockRejectedValue(new Error('DB connection lost'));

            const res = await request(app)
                .post('/api/subscriptions/webhook')
                .set('x-razorpay-signature', 'valid_sig')
                .send({
                    event: 'subscription.charged',
                    payload: {
                        subscription: { entity: { id: 'sub_rzp_error' } },
                        payment: { entity: { id: 'pay_err', amount: 100, currency: 'INR' } },
                    },
                });

            expect(res.status).toBe(500);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toBe('Webhook processing failed');
        });

        test('should handle subscription.charged when entity has no current_end or current_start (undefined branches)', async () => {
            // Covers the ternary branches for periodEnd and periodStart being undefined
            // and planSnapshot?.name fallback to 'Subscription'
            mockVerifyWebhookSignature.mockReturnValue(true);
            mockFindSubscriptionByRazorpayId.mockResolvedValue({
                ...mockSubscription,
                // Omit planSnapshot.name to exercise fallback
                planSnapshot: { ...mockSubscription.planSnapshot, name: undefined },
                billingCycle: undefined,
            });

            const res = await request(app)
                .post('/api/subscriptions/webhook')
                .set('x-razorpay-signature', 'valid_sig')
                .send({
                    event: 'subscription.charged',
                    payload: {
                        subscription: {
                            // No current_start or current_end fields -> periodStart/periodEnd = undefined
                            entity: { id: 'sub_rzp_123' },
                        },
                        payment: {
                            entity: {
                                id: 'pay_no_periods',
                                invoice_id: undefined,
                                amount: 500,
                                currency: 'INR',
                            },
                        },
                    },
                });

            expect(res.status).toBe(200);
            expect(mockUpdateSubscription).toHaveBeenCalledWith(mockSubscription.id, expect.objectContaining({
                status: 'ACTIVE',
                currentPeriodStart: undefined,
                currentPeriodEnd: undefined,
            }));
        });

        test('should handle subscription.activated when entity has no current_end (periodEnd undefined)', async () => {
            // Covers the ternary branch for periodEnd being undefined in subscription.activated
            mockVerifyWebhookSignature.mockReturnValue(true);
            mockFindSubscriptionByRazorpayId.mockResolvedValue({
                ...mockSubscription, couponCode: undefined,
            });

            const res = await request(app)
                .post('/api/subscriptions/webhook')
                .set('x-razorpay-signature', 'valid_sig')
                .send({
                    event: 'subscription.activated',
                    payload: {
                        subscription: {
                            // No current_end -> periodEnd = undefined
                            entity: { id: 'sub_rzp_123', customer_id: 'cust_789' },
                        },
                    },
                });

            expect(res.status).toBe(200);
            expect(mockUpdateSubscription).toHaveBeenCalledWith(mockSubscription.id, expect.objectContaining({
                status: 'ACTIVE',
                currentPeriodEnd: undefined,
            }));
        });
    });


    // ---------------------------------------------------------------------------
    // /verify — reconcile subscription state from Razorpay after checkout handler
    // ---------------------------------------------------------------------------
    describe('POST /api/subscriptions/verify', () => {
        const newSubDoc = {
            id: 'sub_new_doc',
            restaurantId: 'r1',
            status: 'CREATED',
            razorpaySubscriptionId: 'rzp_sub_new',
            billingCycle: 'MONTHLY',
            planSnapshot: { name: 'Premium', pricing: { monthly: 199900, annual: 1999000 } },
        };

        beforeEach(() => {
            mockVerifySubscriptionSignature.mockReturnValue(true);
            mockFindSubscriptionByRazorpayId.mockResolvedValue(newSubDoc);
            mockFetchRazorpaySubscription.mockResolvedValue({
                id: 'rzp_sub_new',
                status: 'active',
                current_start: 1735689600, // Jan 1 2025
                current_end: 1738281600,   // Jan 30 2025
                customer_id: 'cust_123',
                plan_id: 'plan_premium_m',
            });
            mockFetchRazorpayPayment.mockResolvedValue({
                id: 'pay_abc',
                amount: 199900,
                currency: 'INR',
                status: 'captured',
                invoice_id: 'inv_rzp_1',
            });
            mockFetchRazorpayInvoice.mockResolvedValue({ id: 'inv_rzp_1', short_url: 'https://rzp.io/i/abc', status: 'paid', amount: 199900, currency: 'INR' });
            mockFindInvoiceByPaymentId.mockResolvedValue(null);
            mockUpdateSubscription.mockResolvedValue(undefined);
            mockCreateInvoice.mockResolvedValue({ id: 'inv_1' });
        });

        test('returns 400 when any field is missing', async () => {
            const res = await request(app)
                .post('/api/subscriptions/verify')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ razorpayPaymentId: 'pay_abc', razorpaySubscriptionId: 'rzp_sub_new' });

            expect(res.status).toBe(400);
        });

        test('returns 400 when signature is invalid', async () => {
            mockVerifySubscriptionSignature.mockReturnValue(false);

            const res = await request(app)
                .post('/api/subscriptions/verify')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ razorpayPaymentId: 'pay_abc', razorpaySubscriptionId: 'rzp_sub_new', razorpaySignature: 'bad' });

            expect(res.status).toBe(400);
        });

        test('returns 500 when no local doc exists AND Razorpay notes are missing planSlug (cannot materialize)', async () => {
            // After the B4/B7 refactor, /verify materializes the local doc from Razorpay
            // notes when no local doc exists yet. If the notes are missing the planSlug
            // we set at /subscribe time (e.g. someone hand-crafted a Razorpay sub bypass-
            // ing our flow), materialization fails — fall through to the global 500.
            mockFindSubscriptionByRazorpayId.mockResolvedValue(null);
            mockFetchRazorpaySubscription.mockResolvedValue({
                id: 'rzp_sub_unknown',
                status: 'active',
                current_start: null,
                current_end: null,
                plan_id: 'plan_unknown',
                // notes intentionally missing
            });

            const res = await request(app)
                .post('/api/subscriptions/verify')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ razorpayPaymentId: 'pay_abc', razorpaySubscriptionId: 'rzp_sub_unknown', razorpaySignature: 'sig' });

            expect(res.status).toBe(500);
        });

        test('returns 403 when subscription belongs to a different restaurant', async () => {
            mockFindSubscriptionByRazorpayId.mockResolvedValue({ ...newSubDoc, restaurantId: 'different_restaurant' });

            const res = await request(app)
                .post('/api/subscriptions/verify')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ razorpayPaymentId: 'pay_abc', razorpaySubscriptionId: 'rzp_sub_new', razorpaySignature: 'sig' });

            expect(res.status).toBe(403);
        });

        test('updates DB to ACTIVE when Razorpay says active (webhook-independent path)', async () => {
            // This is the primary fix for the "Activating..." stuck bug:
            // handler → verify → fetch live Razorpay state → update DB, without waiting for webhooks.
            const res = await request(app)
                .post('/api/subscriptions/verify')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ razorpayPaymentId: 'pay_abc', razorpaySubscriptionId: 'rzp_sub_new', razorpaySignature: 'sig' });

            expect(res.status).toBe(200);
            expect(res.body.data.status).toBe('ACTIVE');
            expect(mockUpdateSubscription).toHaveBeenCalledWith('sub_new_doc', expect.objectContaining({
                status: 'ACTIVE',
                razorpayCustomerId: 'cust_123',
                cancelAtPeriodEnd: false,
            }));
        });

        test('creates an invoice when activating for the first time', async () => {
            await request(app)
                .post('/api/subscriptions/verify')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ razorpayPaymentId: 'pay_abc', razorpaySubscriptionId: 'rzp_sub_new', razorpaySignature: 'sig' });

            expect(mockCreateInvoice).toHaveBeenCalledWith(expect.objectContaining({
                type: 'SUBSCRIPTION',
                razorpayPaymentId: 'pay_abc',
                razorpaySubscriptionId: 'rzp_sub_new',
                amountPaise: 199900,
                status: 'paid',
                pdfUrl: 'https://rzp.io/i/abc',
            }));
        });

        test('is idempotent with the webhook invoice creation (skips duplicate)', async () => {
            mockFindInvoiceByPaymentId.mockResolvedValue({ id: 'inv_existing' });

            const res = await request(app)
                .post('/api/subscriptions/verify')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ razorpayPaymentId: 'pay_abc', razorpaySubscriptionId: 'rzp_sub_new', razorpaySignature: 'sig' });

            expect(res.status).toBe(200);
            expect(mockCreateInvoice).not.toHaveBeenCalled();
        });

        test('maps Razorpay "authenticated" to AUTHENTICATED without creating invoice', async () => {
            mockFetchRazorpaySubscription.mockResolvedValue({
                id: 'rzp_sub_new', status: 'authenticated', current_start: null, current_end: null, customer_id: 'cust_123', plan_id: 'plan_premium_m',
            });

            const res = await request(app)
                .post('/api/subscriptions/verify')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ razorpayPaymentId: 'pay_abc', razorpaySubscriptionId: 'rzp_sub_new', razorpaySignature: 'sig' });

            expect(res.status).toBe(200);
            expect(res.body.data.status).toBe('AUTHENTICATED');
            expect(mockCreateInvoice).not.toHaveBeenCalled();
        });

        test('maps Razorpay "halted" to HALTED', async () => {
            mockFetchRazorpaySubscription.mockResolvedValue({
                id: 'rzp_sub_new', status: 'halted', current_start: null, current_end: null, plan_id: 'plan_premium_m',
            });

            const res = await request(app)
                .post('/api/subscriptions/verify')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ razorpayPaymentId: 'pay_abc', razorpaySubscriptionId: 'rzp_sub_new', razorpaySignature: 'sig' });

            expect(res.body.data.status).toBe('HALTED');
        });

        test('does not regress an already-ACTIVE DB state back to AUTHENTICATED', async () => {
            // The webhook arrived first and set ACTIVE. Verify then fetches Razorpay
            // which is still reporting 'authenticated' due to eventual consistency.
            // Verify must not clobber the advanced state.
            mockFindSubscriptionByRazorpayId.mockResolvedValue({ ...newSubDoc, status: 'ACTIVE' });
            mockFetchRazorpaySubscription.mockResolvedValue({
                id: 'rzp_sub_new', status: 'authenticated', current_start: null, current_end: null, plan_id: 'plan_premium_m',
            });

            const res = await request(app)
                .post('/api/subscriptions/verify')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ razorpayPaymentId: 'pay_abc', razorpaySubscriptionId: 'rzp_sub_new', razorpaySignature: 'sig' });

            expect(res.status).toBe(200);
            expect(res.body.data.status).toBe('ACTIVE');
            // updateSubscription call should preserve ACTIVE, not downgrade to AUTHENTICATED
            const updateCalls = mockUpdateSubscription.mock.calls;
            const lastUpdate = updateCalls[updateCalls.length - 1];
            expect(lastUpdate[1].status).toBe('ACTIVE');
        });

        test('Keep-current-plan flow (Path B1): parks deferred sub in pendingRazorpaySubscriptionId, live billing ref preserved', async () => {
            // Invariant: razorpaySubscriptionId must always point to the sub with an active
            // billing period. The deferred keep-current sub has no period yet (start_at=future),
            // so it parks in pendingRazorpaySubscriptionId. razorpaySubscriptionId is NOT
            // overwritten. This prevents /cancel from getting "no billing cycle" from Razorpay.
            mockFindSubscriptionByRazorpayId.mockResolvedValue(null);
            mockFindSubscriptionByPendingRazorpayId.mockResolvedValue(null);
            mockFindActiveSubscription.mockResolvedValue({
                id: 'sub_premium_active',
                restaurantId: 'r1',
                status: 'ACTIVE',
                razorpaySubscriptionId: 'rzp_sub_old_premium',
                planSnapshot: { slug: 'premium', name: 'Premium', pricing: { monthly: 1699900, annual: 16999000 } },
                currentPeriodStart: '2026-04-01T00:00:00.000Z',
                currentPeriodEnd: '2026-05-01T00:00:00.000Z',
                cancelAtPeriodEnd: true,
                cancelledAt: '2026-04-15T00:00:00.000Z',
                pendingPlanId: 'plan-starter-id',
                pendingPlanSnapshot: { slug: 'starter', name: 'Starter', pricing: { monthly: 299900, annual: 2999000 } },
                billingCycle: 'MONTHLY',
                credits: 0,
            });
            mockFindPlanBySlug.mockResolvedValue({
                id: 'plan-premium-id',
                slug: 'premium',
                name: 'Premium',
                pricing: { monthly: 1699900, annual: 16999000 },
                razorpayPlanIds: { monthly: 'plan_premium_m' },
            });
            mockFetchRazorpaySubscription.mockResolvedValue({
                id: 'rzp_sub_keep_current',
                status: 'authenticated',
                current_start: null,
                current_end: null,
                customer_id: 'cust_123',
                plan_id: 'plan_premium_m',
                notes: { planSlug: 'premium', restaurantId: 'r1' },
            });

            const res = await request(app)
                .post('/api/subscriptions/verify')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ razorpayPaymentId: 'pay_keep', razorpaySubscriptionId: 'rzp_sub_keep_current', razorpaySignature: 'sig' });

            expect(res.status).toBe(200);
            // Deferred sub stored as pendingRazorpaySubscriptionId, NOT overwriting the live ref
            expect(mockUpdateSubscription).toHaveBeenCalledWith('sub_premium_active', expect.objectContaining({
                pendingRazorpaySubscriptionId: 'rzp_sub_keep_current',
                cancelAtPeriodEnd: false,
                cancelledAt: undefined,
                pendingPlanId: undefined,
                pendingPlanSnapshot: null,
            }));
            // razorpaySubscriptionId NOT in the update call (live billing ref preserved)
            const updateCall = mockUpdateSubscription.mock.calls.find((c) => c[0] === 'sub_premium_active');
            expect(updateCall?.[1]).not.toHaveProperty('razorpaySubscriptionId');
            // No archive and no fresh insert
            const archiveCall = mockUpdateSubscription.mock.calls.find((c) => c[1]?.endedAt);
            expect(archiveCall).toBeUndefined();
            expect(mockCreateSubscription).not.toHaveBeenCalled();
        });

        test('deferred different-plan upgrade (Path B3): preserves ACTIVE doc, stores pending info, no archive', async () => {
            // Regression for: Starter → cancel → reactivate → click Premium (cycle_end)
            // → completes ₹5 checkout → stuck on "Activating..." because the old Path B2
            // archived the Starter doc and created a fresh AUTHENTICATED Premium doc.
            //
            // Fix: Path B3 detects the 'deferred: 1' note (stamped by prepareCancelAndFutureSubscribe
            // for mode=cycle_end) and stores pendingPlanSnapshot on the existing ACTIVE doc.
            // The local doc does NOT need cancelAtPeriodEnd=true going in — it gets set by the update.
            mockFindSubscriptionByRazorpayId.mockResolvedValue(null); // new Razorpay sub not seen before
            mockFindSubscriptionByPendingRazorpayId.mockResolvedValue(null); // not yet tracked as pending
            mockFindActiveSubscription.mockResolvedValue({
                id: 'sub_starter_active',
                restaurantId: 'r1',
                status: 'ACTIVE',
                razorpaySubscriptionId: 'rzp_sub_old_starter',
                planSnapshot: { slug: 'starter', name: 'Starter', pricing: { monthly: 299900, annual: 2999000 } },
                currentPeriodStart: '2026-04-01T00:00:00.000Z',
                currentPeriodEnd: '2026-05-01T00:00:00.000Z',
                cancelAtPeriodEnd: false, // local DB not yet updated by the Razorpay cancel-at-cycle-end call
                billingCycle: 'MONTHLY',
                credits: 100,
            });
            mockFindPlanBySlug.mockResolvedValue({
                id: 'plan-premium-id',
                slug: 'premium',
                name: 'Premium',
                pricing: { monthly: 1699900, annual: 16999000 },
                razorpayPlanIds: { monthly: 'plan_premium_m' },
            });
            mockFetchRazorpaySubscription.mockResolvedValue({
                id: 'rzp_sub_deferred_premium',
                status: 'authenticated',
                current_start: null,
                current_end: null,
                customer_id: 'cust_123',
                plan_id: 'plan_premium_m',
                notes: { planSlug: 'premium', restaurantId: 'r1', deferred: '1' }, // set by prepareCancelAndFutureSubscribe
            });

            const res = await request(app)
                .post('/api/subscriptions/verify')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ razorpayPaymentId: 'pay_5_rupees', razorpaySubscriptionId: 'rzp_sub_deferred_premium', razorpaySignature: 'sig' });

            expect(res.status).toBe(200);
            // Returns ACTIVE (still on Starter), not AUTHENTICATED
            expect(res.body.data.status).toBe('ACTIVE');
            // Existing Starter doc updated with pending info + cancelAtPeriodEnd synced to Razorpay state
            expect(mockUpdateSubscription).toHaveBeenCalledWith('sub_starter_active', expect.objectContaining({
                pendingPlanSnapshot: expect.objectContaining({ slug: 'premium' }),
                pendingRazorpaySubscriptionId: 'rzp_sub_deferred_premium',
                cancelAtPeriodEnd: true,
            }));
            // Starter doc NOT archived and NO fresh doc created
            const archiveCall = mockUpdateSubscription.mock.calls.find((c) => c[1]?.endedAt);
            expect(archiveCall).toBeUndefined();
            expect(mockCreateSubscription).not.toHaveBeenCalled();
            // No ₹5 auth invoice created (only real plan charges get invoices)
            expect(mockCreateInvoice).not.toHaveBeenCalled();
        });

        test('tolerates failed invoice backfill gracefully (status update still succeeds)', async () => {
            // Razorpay payment lookup failed — must not fail the whole verify;
            // the webhook will retry the invoice creation.
            mockFetchRazorpayPayment.mockRejectedValue(new Error('Razorpay timeout'));

            const res = await request(app)
                .post('/api/subscriptions/verify')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ razorpayPaymentId: 'pay_abc', razorpaySubscriptionId: 'rzp_sub_new', razorpaySignature: 'sig' });

            expect(res.status).toBe(200);
            expect(res.body.data.status).toBe('ACTIVE');
            expect(mockUpdateSubscription).toHaveBeenCalledWith('sub_new_doc', expect.objectContaining({ status: 'ACTIVE' }));
        });

        test('requires authentication', async () => {
            const res = await request(app)
                .post('/api/subscriptions/verify')
                .send({ razorpayPaymentId: 'pay_abc', razorpaySubscriptionId: 'rzp_sub_new', razorpaySignature: 'sig' });

            expect(res.status).toBe(401);
        });
    });
});
