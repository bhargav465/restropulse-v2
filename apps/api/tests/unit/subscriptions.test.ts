import { describe, test, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Owner-facing subscription routes. Billing is manual (no payment gateway): an
// owner requests a plan, the RestroPulse team arranges payment and a platform
// admin activates it (see platform-billing.test.ts).

// Define Mocks
const mockFindCurrentPlans = vi.fn();
const mockFindPlanBySlug = vi.fn();
const mockFindActiveSubscription = vi.fn();
const mockUpdateSubscription = vi.fn();
const mockGetWeeklyPostCounts = vi.fn();
const mockFindCouponByCode = vi.fn();
const mockHasRestaurantRedeemedCoupon = vi.fn();
const mockIncrementCouponRedemptions = vi.fn();
const mockCreateCouponRedemption = vi.fn();
const mockFindUserByRestaurantId = vi.fn();

vi.mock('@restropulse/db', async (importOriginal) => {
    const actual = await importOriginal() as any;
    return {
        ...actual,
        findCurrentPlans: mockFindCurrentPlans,
        findPlanBySlug: mockFindPlanBySlug,
        findActiveSubscription: mockFindActiveSubscription,
        updateSubscription: mockUpdateSubscription,
        getWeeklyPostCounts: mockGetWeeklyPostCounts,
        findCouponByCode: mockFindCouponByCode,
        hasRestaurantRedeemedCoupon: mockHasRestaurantRedeemedCoupon,
        incrementCouponRedemptions: mockIncrementCouponRedemptions,
        createCouponRedemption: mockCreateCouponRedemption,
        findUserByRestaurantId: mockFindUserByRestaurantId,
    };
});

const { createTestApp, generateAuthToken, mockUser } = await import('../helpers/testHelper.js');

const authToken = generateAuthToken();
const app = createTestApp();

const DAY_MS = 24 * 60 * 60 * 1000;

const mockPlan = {
    id: 'plan-growth-v1',
    slug: 'growth',
    version: 1,
    isCurrentVersion: true,
    tier: 'GROWTH',
    name: 'Growth',
    limits: { weekly: { INSTAGRAM: { IMAGE: 5, STORY: 5, CAROUSEL: 3, REEL: 2, VIDEO: 2 }, FACEBOOK: { IMAGE: 5, CAROUSEL: 3, VIDEO: 2, STORY: 5 } } },
    pricing: { monthly: 999900, annual: 9999000, currency: 'INR' },
    features: ['INSTAGRAM', 'FACEBOOK'],
};

const mockPremiumPlan = {
    ...mockPlan,
    id: 'plan-premium-v1',
    slug: 'premium',
    tier: 'PREMIUM',
    name: 'Premium',
    pricing: { monthly: 1999900, annual: 19999000, currency: 'INR' },
};

const futureEnd = () => new Date(Date.now() + 20 * DAY_MS).toISOString();

/** A restaurant on an active paid Growth plan. */
const activeSub = (overrides: Record<string, unknown> = {}) => ({
    id: 'sub-r1',
    restaurantId: 'r1',
    planId: 'plan-growth-v1',
    planSnapshot: mockPlan,
    billingCycle: 'MONTHLY',
    status: 'ACTIVE',
    credits: 10,
    currentPeriodStart: new Date(Date.now() - 10 * DAY_MS).toISOString(),
    currentPeriodEnd: futureEnd(),
    ...overrides,
});

/** The record every restaurant gets at onboarding: no paid plan yet. */
const noPlanSub = (overrides: Record<string, unknown> = {}) => ({
    id: 'sub-r1',
    restaurantId: 'r1',
    status: 'NONE',
    credits: 0,
    trialEndsAt: new Date(Date.now() + 5 * DAY_MS).toISOString(),
    ...overrides,
});

const validCoupon = (overrides: Record<string, unknown> = {}) => ({
    id: 'coupon-1',
    code: 'SAVE10',
    type: 'PERCENTAGE',
    value: 10,
    redemptionCount: 0,
    validFrom: '2024-01-01',
    status: 'ACTIVE',
    createdBy: 'admin',
    ...overrides,
});

const clearedRequest = { pendingPlanId: undefined, pendingPlanSnapshot: null, planRequestedAt: null };

const auth = (req: request.Test) => req.set('Authorization', `Bearer ${authToken}`);

describe('Subscription Routes (manual billing)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUpdateSubscription.mockImplementation(async (id: string, updates: Record<string, unknown>) => ({ id, ...updates }));
        mockHasRestaurantRedeemedCoupon.mockResolvedValue(false);
        mockFindUserByRestaurantId.mockResolvedValue(mockUser);
    });

    describe('GET /api/subscriptions/plans', () => {
        test('returns the current plans without auth', async () => {
            mockFindCurrentPlans.mockResolvedValue([mockPlan, mockPremiumPlan]);

            const res = await request(app).get('/api/subscriptions/plans');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toHaveLength(2);
            expect(res.body.data.map((p: { slug: string }) => p.slug)).toEqual(['growth', 'premium']);
        });

        test('returns 500 when the plan lookup throws', async () => {
            mockFindCurrentPlans.mockRejectedValue(new Error('db down'));

            const res = await request(app).get('/api/subscriptions/plans');

            expect(res.status).toBe(500);
            expect(res.body.success).toBe(false);
        });
    });

    describe('GET /api/subscriptions/current', () => {
        test('returns 401 without auth', async () => {
            const res = await request(app).get('/api/subscriptions/current');
            expect(res.status).toBe(401);
            expect(mockFindActiveSubscription).not.toHaveBeenCalled();
        });

        test('returns the subscription, weekly usage and entitlement', async () => {
            mockFindActiveSubscription.mockResolvedValue(activeSub());
            mockGetWeeklyPostCounts.mockResolvedValue({
                INSTAGRAM: { IMAGE: 2, CAROUSEL: 1 },
                FACEBOOK: {},
            });

            const res = await auth(request(app).get('/api/subscriptions/current'));

            expect(res.status).toBe(200);
            expect(mockFindActiveSubscription).toHaveBeenCalledWith('r1');
            expect(mockGetWeeklyPostCounts).toHaveBeenCalledWith('r1');
            expect(res.body.data.subscription.status).toBe('ACTIVE');
            expect(res.body.data.usage.INSTAGRAM.IMAGE).toEqual({ used: 2, limit: 5 });
            expect(res.body.data.usage.INSTAGRAM.CAROUSEL).toEqual({ used: 1, limit: 3 });
            expect(res.body.data.usage.INSTAGRAM.REEL).toEqual({ used: 0, limit: 2 });
            // FACEBOOK has no REEL limit in the plan -> limit 0
            expect(res.body.data.usage.FACEBOOK.REEL).toEqual({ used: 0, limit: 0 });
            expect(res.body.data.entitlement).toMatchObject({ entitled: true, activePlan: true });
            // No gateway reconcile: /current never writes
            expect(mockUpdateSubscription).not.toHaveBeenCalled();
        });

        test('returns nulls and a not-entitled state when there is no subscription', async () => {
            mockFindActiveSubscription.mockResolvedValue(null);

            const res = await auth(request(app).get('/api/subscriptions/current'));

            expect(res.status).toBe(200);
            expect(res.body.data.subscription).toBeNull();
            expect(res.body.data.usage).toBeNull();
            expect(res.body.data.entitlement).toEqual({ entitled: false, inTrial: false, activePlan: false, trialDaysLeft: 0 });
            expect(mockGetWeeklyPostCounts).not.toHaveBeenCalled();
        });

        test('returns usage=null when the plan snapshot has no limits', async () => {
            mockFindActiveSubscription.mockResolvedValue(activeSub({ planSnapshot: { slug: 'growth', tier: 'GROWTH' } }));

            const res = await auth(request(app).get('/api/subscriptions/current'));

            expect(res.status).toBe(200);
            expect(res.body.data.subscription).toBeDefined();
            expect(res.body.data.usage).toBeNull();
            expect(mockGetWeeklyPostCounts).not.toHaveBeenCalled();
        });

        test('a trial restaurant with no plan is entitled through its trial', async () => {
            mockFindActiveSubscription.mockResolvedValue(noPlanSub());

            const res = await auth(request(app).get('/api/subscriptions/current'));

            expect(res.status).toBe(200);
            expect(res.body.data.usage).toBeNull();
            expect(res.body.data.entitlement).toMatchObject({ entitled: true, inTrial: true, activePlan: false, trialDaysLeft: 5 });
        });

        test('an ACTIVE plan still entitles inside the 3-day grace after its period end', async () => {
            mockFindActiveSubscription.mockResolvedValue(activeSub({
                currentPeriodEnd: new Date(Date.now() - 2 * DAY_MS).toISOString(),
            }));
            mockGetWeeklyPostCounts.mockResolvedValue({});

            const res = await auth(request(app).get('/api/subscriptions/current'));

            expect(res.body.data.entitlement).toMatchObject({ entitled: true, activePlan: true });
        });

        test('an ACTIVE plan stops entitling once the 3-day grace has passed', async () => {
            mockFindActiveSubscription.mockResolvedValue(activeSub({
                currentPeriodEnd: new Date(Date.now() - 4 * DAY_MS).toISOString(),
            }));
            mockGetWeeklyPostCounts.mockResolvedValue({});

            const res = await auth(request(app).get('/api/subscriptions/current'));

            expect(res.status).toBe(200);
            expect(res.body.data.entitlement).toMatchObject({ entitled: false, activePlan: false });
        });

        test('exposes a pending plan request on the subscription', async () => {
            mockFindActiveSubscription.mockResolvedValue(noPlanSub({
                pendingPlanId: mockPlan.id,
                pendingPlanSnapshot: mockPlan,
                planRequestedAt: '2026-11-20T10:00:00.000Z',
            }));

            const res = await auth(request(app).get('/api/subscriptions/current'));

            expect(res.body.data.subscription.pendingPlanSnapshot.slug).toBe('growth');
            expect(res.body.data.subscription.planRequestedAt).toBe('2026-11-20T10:00:00.000Z');
        });
    });

    describe('POST /api/subscriptions/subscribe', () => {
        test('returns 401 without auth', async () => {
            const res = await request(app).post('/api/subscriptions/subscribe').send({ planSlug: 'growth' });
            expect(res.status).toBe(401);
            expect(mockUpdateSubscription).not.toHaveBeenCalled();
        });

        test('records a plan request on the restaurant subscription', async () => {
            mockFindPlanBySlug.mockResolvedValue(mockPlan);
            mockFindActiveSubscription.mockResolvedValue(noPlanSub());

            const before = Date.now();
            const res = await auth(request(app).post('/api/subscriptions/subscribe')).send({ planSlug: 'growth' });

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ success: true, data: { requested: true, planName: 'Growth' } });
            expect(mockFindPlanBySlug).toHaveBeenCalledWith('growth');
            expect(mockFindActiveSubscription).toHaveBeenCalledWith('r1');
            expect(mockUpdateSubscription).toHaveBeenCalledTimes(1);
            const [id, updates] = mockUpdateSubscription.mock.calls[0];
            expect(id).toBe('sub-r1');
            expect(updates).toEqual({
                pendingPlanId: 'plan-growth-v1',
                pendingPlanSnapshot: mockPlan,
                planRequestedAt: expect.any(String),
                couponCode: undefined,
            });
            expect(new Date(updates.planRequestedAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
            // Never switches a plan on by itself
            expect(updates).not.toHaveProperty('status');
            expect(updates).not.toHaveProperty('planSnapshot');
            expect(mockFindCouponByCode).not.toHaveBeenCalled();
        });

        test('replaces an earlier pending request', async () => {
            mockFindPlanBySlug.mockResolvedValue(mockPremiumPlan);
            mockFindActiveSubscription.mockResolvedValue(noPlanSub({ pendingPlanId: mockPlan.id, pendingPlanSnapshot: mockPlan }));

            const res = await auth(request(app).post('/api/subscriptions/subscribe')).send({ planSlug: 'premium' });

            expect(res.status).toBe(200);
            expect(res.body.data).toEqual({ requested: true, planName: 'Premium' });
            expect(mockUpdateSubscription).toHaveBeenCalledWith('sub-r1', expect.objectContaining({
                pendingPlanId: 'plan-premium-v1',
                pendingPlanSnapshot: mockPremiumPlan,
            }));
        });

        test('stores a valid coupon with the request', async () => {
            mockFindPlanBySlug.mockResolvedValue(mockPlan);
            mockFindActiveSubscription.mockResolvedValue(noPlanSub());
            mockFindCouponByCode.mockResolvedValue(validCoupon({ applicablePlans: ['growth'], assignedTo: 'r1' }));

            const res = await auth(request(app).post('/api/subscriptions/subscribe')).send({ planSlug: 'growth', couponCode: 'SAVE10' });

            expect(res.status).toBe(200);
            expect(mockFindCouponByCode).toHaveBeenCalledWith('SAVE10');
            expect(mockHasRestaurantRedeemedCoupon).toHaveBeenCalledWith('coupon-1', 'r1');
            expect(mockUpdateSubscription).toHaveBeenCalledWith('sub-r1', expect.objectContaining({ couponCode: 'SAVE10' }));
            // Coupons are only redeemed when the team activates the plan
            expect(mockIncrementCouponRedemptions).not.toHaveBeenCalled();
            expect(mockCreateCouponRedemption).not.toHaveBeenCalled();
        });

        test('treats an empty or null couponCode as no coupon', async () => {
            mockFindPlanBySlug.mockResolvedValue(mockPlan);
            mockFindActiveSubscription.mockResolvedValue(noPlanSub());

            for (const couponCode of ['', null]) {
                const res = await auth(request(app).post('/api/subscriptions/subscribe')).send({ planSlug: 'growth', couponCode });
                expect(res.status).toBe(200);
            }
            expect(mockFindCouponByCode).not.toHaveBeenCalled();
            expect(mockUpdateSubscription).toHaveBeenCalledTimes(2);
            for (const call of mockUpdateSubscription.mock.calls) {
                expect(call[1].couponCode).toBeUndefined();
            }
        });

        test('returns 400 when couponCode is not a string', async () => {
            mockFindPlanBySlug.mockResolvedValue(mockPlan);

            const res = await auth(request(app).post('/api/subscriptions/subscribe')).send({ planSlug: 'growth', couponCode: 123 });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Invalid coupon code');
            expect(mockFindCouponByCode).not.toHaveBeenCalled();
            expect(mockUpdateSubscription).not.toHaveBeenCalled();
        });

        test('returns 400 when planSlug is missing', async () => {
            const res = await auth(request(app).post('/api/subscriptions/subscribe')).send({});

            expect(res.status).toBe(400);
            expect(res.body).toEqual({ success: false, error: 'planSlug is required' });
            expect(mockFindPlanBySlug).not.toHaveBeenCalled();
        });

        test('returns 400 when planSlug is not a string', async () => {
            const res = await auth(request(app).post('/api/subscriptions/subscribe')).send({ planSlug: 42 });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('planSlug is required');
        });

        test('returns 404 when the plan does not exist', async () => {
            mockFindPlanBySlug.mockResolvedValue(null);

            const res = await auth(request(app).post('/api/subscriptions/subscribe')).send({ planSlug: 'nonexistent' });

            expect(res.status).toBe(404);
            expect(res.body.error).toBe('Plan not found');
            expect(mockUpdateSubscription).not.toHaveBeenCalled();
        });

        test('returns 400 when the restaurant has no subscription record', async () => {
            mockFindPlanBySlug.mockResolvedValue(mockPlan);
            mockFindActiveSubscription.mockResolvedValue(null);

            const res = await auth(request(app).post('/api/subscriptions/subscribe')).send({ planSlug: 'growth' });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('No subscription record found for this restaurant');
            expect(mockUpdateSubscription).not.toHaveBeenCalled();
        });

        test('returns 409 when a paid plan is active and not set to cancel', async () => {
            mockFindPlanBySlug.mockResolvedValue(mockPremiumPlan);
            mockFindActiveSubscription.mockResolvedValue(activeSub());

            const res = await auth(request(app).post('/api/subscriptions/subscribe')).send({ planSlug: 'premium' });

            expect(res.status).toBe(409);
            expect(res.body.error).toMatch(/change-plan/);
            expect(mockUpdateSubscription).not.toHaveBeenCalled();
        });

        test('allows a new request once the paid plan has lapsed past its grace days', async () => {
            mockFindPlanBySlug.mockResolvedValue(mockPlan);
            mockFindActiveSubscription.mockResolvedValue(activeSub({ currentPeriodEnd: new Date(Date.now() - 4 * DAY_MS).toISOString() }));

            const res = await auth(request(app).post('/api/subscriptions/subscribe')).send({ planSlug: 'growth' });

            expect(res.status).toBe(200);
            expect(res.body.data).toEqual({ requested: true, planName: mockPlan.name });
            expect(mockUpdateSubscription).toHaveBeenCalledWith('sub-r1', expect.objectContaining({ pendingPlanSnapshot: mockPlan }));
        });

        test('returns 409 for a PAST_DUE paid plan too', async () => {
            mockFindPlanBySlug.mockResolvedValue(mockPlan);
            mockFindActiveSubscription.mockResolvedValue(activeSub({ status: 'PAST_DUE' }));

            const res = await auth(request(app).post('/api/subscriptions/subscribe')).send({ planSlug: 'growth' });

            expect(res.status).toBe(409);
        });

        test('allows a request when the active plan is set to cancel at period end', async () => {
            mockFindPlanBySlug.mockResolvedValue(mockPremiumPlan);
            mockFindActiveSubscription.mockResolvedValue(activeSub({ cancelAtPeriodEnd: true }));

            const res = await auth(request(app).post('/api/subscriptions/subscribe')).send({ planSlug: 'premium' });

            expect(res.status).toBe(200);
            expect(res.body.data).toEqual({ requested: true, planName: 'Premium' });
            const updates = mockUpdateSubscription.mock.calls[0][1];
            expect(updates.pendingPlanSnapshot).toEqual(mockPremiumPlan);
            // The active plan is left alone until the team activates the new one
            expect(updates).not.toHaveProperty('cancelAtPeriodEnd');
            expect(updates).not.toHaveProperty('status');
        });

        test('allows a request after the old plan was CANCELLED', async () => {
            mockFindPlanBySlug.mockResolvedValue(mockPlan);
            mockFindActiveSubscription.mockResolvedValue(activeSub({ status: 'CANCELLED' }));

            const res = await auth(request(app).post('/api/subscriptions/subscribe')).send({ planSlug: 'growth' });

            expect(res.status).toBe(200);
            expect(res.body.data.requested).toBe(true);
        });

        test('returns 500 when the update throws', async () => {
            mockFindPlanBySlug.mockResolvedValue(mockPlan);
            mockFindActiveSubscription.mockResolvedValue(noPlanSub());
            mockUpdateSubscription.mockRejectedValue(new Error('write failed'));

            const res = await auth(request(app).post('/api/subscriptions/subscribe')).send({ planSlug: 'growth' });

            expect(res.status).toBe(500);
        });

        describe('coupon validation', () => {
            beforeEach(() => {
                mockFindPlanBySlug.mockResolvedValue(mockPlan);
                mockFindActiveSubscription.mockResolvedValue(noPlanSub());
            });

            const subscribeWith = (couponCode: string) =>
                auth(request(app).post('/api/subscriptions/subscribe')).send({ planSlug: 'growth', couponCode });

            const expectRejected = (res: request.Response, error: string) => {
                expect(res.status).toBe(400);
                expect(res.body).toEqual({ success: false, error });
                expect(mockUpdateSubscription).not.toHaveBeenCalled();
            };

            test('rejects an unknown coupon', async () => {
                mockFindCouponByCode.mockResolvedValue(null);
                expectRejected(await subscribeWith('NOPE'), 'Invalid coupon code');
            });

            test('rejects an inactive coupon', async () => {
                mockFindCouponByCode.mockResolvedValue(validCoupon({ status: 'DISABLED' }));
                expectRejected(await subscribeWith('SAVE10'), 'Coupon is not active');
            });

            test('rejects a coupon that has not started yet', async () => {
                mockFindCouponByCode.mockResolvedValue(validCoupon({ validFrom: new Date(Date.now() + 2 * DAY_MS).toISOString() }));
                expectRejected(await subscribeWith('SAVE10'), 'Coupon is not active yet');
            });

            test('rejects an expired coupon', async () => {
                mockFindCouponByCode.mockResolvedValue(validCoupon({ validUntil: '2020-01-01T00:00:00.000Z' }));
                expectRejected(await subscribeWith('SAVE10'), 'Coupon has expired');
            });

            test('rejects a fully redeemed coupon', async () => {
                mockFindCouponByCode.mockResolvedValue(validCoupon({ maxRedemptions: 5, redemptionCount: 5 }));
                expectRejected(await subscribeWith('SAVE10'), 'Coupon has been fully redeemed');
            });

            test('rejects a coupon assigned to another restaurant (as invalid)', async () => {
                mockFindCouponByCode.mockResolvedValue(validCoupon({ assignedTo: 'r2' }));
                expectRejected(await subscribeWith('SAVE10'), 'Invalid coupon code');
            });

            test('rejects a coupon not applicable to the plan', async () => {
                mockFindCouponByCode.mockResolvedValue(validCoupon({ applicablePlans: ['premium'] }));
                expectRejected(await subscribeWith('SAVE10'), 'Coupon is not applicable to this plan');
            });

            test('rejects a coupon the restaurant already redeemed', async () => {
                mockFindCouponByCode.mockResolvedValue(validCoupon());
                mockHasRestaurantRedeemedCoupon.mockResolvedValue(true);
                expectRejected(await subscribeWith('SAVE10'), 'Coupon already redeemed by this restaurant');
                expect(mockHasRestaurantRedeemedCoupon).toHaveBeenCalledWith('coupon-1', 'r1');
            });

            test('checks the coupon before the 409 active-plan guard', async () => {
                mockFindActiveSubscription.mockResolvedValue(activeSub());
                mockFindCouponByCode.mockResolvedValue(null);

                const res = await subscribeWith('NOPE');

                expect(res.status).toBe(400);
                expect(res.body.error).toBe('Invalid coupon code');
            });
        });
    });

    describe('POST /api/subscriptions/change-plan', () => {
        test('returns 401 without auth', async () => {
            const res = await request(app).post('/api/subscriptions/change-plan').send({ planSlug: 'premium' });
            expect(res.status).toBe(401);
        });

        test('requests a switch to another plan', async () => {
            mockFindActiveSubscription.mockResolvedValue(activeSub());
            mockFindPlanBySlug.mockResolvedValue(mockPremiumPlan);

            const res = await auth(request(app).post('/api/subscriptions/change-plan')).send({ planSlug: 'premium' });

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ success: true, data: { requested: true, planName: 'Premium' } });
            expect(mockUpdateSubscription).toHaveBeenCalledTimes(1);
            expect(mockUpdateSubscription).toHaveBeenCalledWith('sub-r1', {
                pendingPlanId: 'plan-premium-v1',
                pendingPlanSnapshot: mockPremiumPlan,
                planRequestedAt: expect.any(String),
            });
        });

        test('works for a PAST_DUE plan and one set to cancel', async () => {
            mockFindPlanBySlug.mockResolvedValue(mockPremiumPlan);
            for (const sub of [activeSub({ status: 'PAST_DUE' }), activeSub({ cancelAtPeriodEnd: true })]) {
                mockFindActiveSubscription.mockResolvedValueOnce(sub);
                const res = await auth(request(app).post('/api/subscriptions/change-plan')).send({ planSlug: 'premium' });
                expect(res.status).toBe(200);
                expect(res.body.data.requested).toBe(true);
            }
            expect(mockUpdateSubscription).toHaveBeenCalledTimes(2);
        });

        test('asking for the current plan clears a pending request and returns requested:false', async () => {
            mockFindActiveSubscription.mockResolvedValue(activeSub({
                pendingPlanId: mockPremiumPlan.id,
                pendingPlanSnapshot: mockPremiumPlan,
                planRequestedAt: '2026-11-20T10:00:00.000Z',
            }));
            mockFindPlanBySlug.mockResolvedValue(mockPlan);

            const res = await auth(request(app).post('/api/subscriptions/change-plan')).send({ planSlug: 'growth' });

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ success: true, data: { requested: false, planName: 'Growth' } });
            expect(mockUpdateSubscription).toHaveBeenCalledWith('sub-r1', clearedRequest);
        });

        test('asking to renew a lapsed plan records a request', async () => {
            mockFindActiveSubscription.mockResolvedValue(activeSub({ currentPeriodEnd: new Date(Date.now() - 4 * DAY_MS).toISOString() }));
            mockFindPlanBySlug.mockResolvedValue(mockPlan);

            const res = await auth(request(app).post('/api/subscriptions/change-plan')).send({ planSlug: 'growth' });

            expect(res.status).toBe(200);
            expect(res.body.data).toEqual({ requested: true, planName: mockPlan.name });
        });

        test('a plan switch drops a coupon left from an earlier request', async () => {
            mockFindActiveSubscription.mockResolvedValue(activeSub({ couponCode: 'SAVE10' }));
            mockFindPlanBySlug.mockResolvedValue(mockPremiumPlan);

            await auth(request(app).post('/api/subscriptions/change-plan')).send({ planSlug: 'premium' });

            const updates = mockUpdateSubscription.mock.calls[0][1] as Record<string, unknown>;
            expect('couponCode' in updates && updates.couponCode === undefined).toBe(true);
        });

        test('asking for the current plan with nothing pending writes nothing', async () => {
            mockFindActiveSubscription.mockResolvedValue(activeSub());
            mockFindPlanBySlug.mockResolvedValue(mockPlan);

            const res = await auth(request(app).post('/api/subscriptions/change-plan')).send({ planSlug: 'growth' });

            expect(res.status).toBe(200);
            expect(res.body.data).toEqual({ requested: false, planName: 'Growth' });
            expect(mockUpdateSubscription).not.toHaveBeenCalled();
        });

        test('returns 400 when planSlug is missing', async () => {
            const res = await auth(request(app).post('/api/subscriptions/change-plan')).send({});

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('planSlug is required');
            expect(mockFindActiveSubscription).not.toHaveBeenCalled();
        });

        test('returns 400 when there is no subscription', async () => {
            mockFindActiveSubscription.mockResolvedValue(null);

            const res = await auth(request(app).post('/api/subscriptions/change-plan')).send({ planSlug: 'premium' });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('No active subscription to change');
        });

        test('returns 400 when no paid plan is active', async () => {
            for (const sub of [noPlanSub(), activeSub({ status: 'CANCELLED' }), activeSub({ planSnapshot: null })]) {
                mockFindActiveSubscription.mockResolvedValueOnce(sub);
                const res = await auth(request(app).post('/api/subscriptions/change-plan')).send({ planSlug: 'premium' });
                expect(res.status).toBe(400);
                expect(res.body.error).toBe('No active subscription to change');
            }
            expect(mockFindPlanBySlug).not.toHaveBeenCalled();
            expect(mockUpdateSubscription).not.toHaveBeenCalled();
        });

        test('returns 404 when the plan does not exist', async () => {
            mockFindActiveSubscription.mockResolvedValue(activeSub());
            mockFindPlanBySlug.mockResolvedValue(null);

            const res = await auth(request(app).post('/api/subscriptions/change-plan')).send({ planSlug: 'nonexistent' });

            expect(res.status).toBe(404);
            expect(res.body.error).toBe('Plan not found');
            expect(mockUpdateSubscription).not.toHaveBeenCalled();
        });
    });

    describe('POST /api/subscriptions/withdraw-request', () => {
        test('returns 401 without auth', async () => {
            const res = await request(app).post('/api/subscriptions/withdraw-request');
            expect(res.status).toBe(401);
        });

        test('clears a pending request and nothing else', async () => {
            mockFindActiveSubscription.mockResolvedValue(activeSub({ pendingPlanId: mockPremiumPlan.id, pendingPlanSnapshot: mockPremiumPlan }));

            const res = await auth(request(app).post('/api/subscriptions/withdraw-request'));

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ success: true, data: { withdrawn: true } });
            expect(mockUpdateSubscription).toHaveBeenCalledTimes(1);
            expect(mockUpdateSubscription).toHaveBeenCalledWith('sub-r1', clearedRequest);
        });

        test('returns 400 when nothing is pending', async () => {
            mockFindActiveSubscription.mockResolvedValue(activeSub());

            const res = await auth(request(app).post('/api/subscriptions/withdraw-request'));

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('There is no plan request to withdraw');
            expect(mockUpdateSubscription).not.toHaveBeenCalled();
        });

        test('returns 400 when there is no subscription', async () => {
            mockFindActiveSubscription.mockResolvedValue(null);

            const res = await auth(request(app).post('/api/subscriptions/withdraw-request'));

            expect(res.status).toBe(400);
            expect(mockUpdateSubscription).not.toHaveBeenCalled();
        });
    });

    describe('POST /api/subscriptions/cancel', () => {
        test('returns 401 without auth', async () => {
            const res = await request(app).post('/api/subscriptions/cancel');
            expect(res.status).toBe(401);
        });

        test('schedules an active plan to end with its paid period', async () => {
            mockFindActiveSubscription.mockResolvedValue(activeSub());

            const res = await auth(request(app).post('/api/subscriptions/cancel'));

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.message).toBe('Subscription will cancel at the end of the current billing period');
            expect(mockUpdateSubscription).toHaveBeenCalledTimes(1);
            expect(mockUpdateSubscription).toHaveBeenCalledWith('sub-r1', {
                ...clearedRequest,
                cancelAtPeriodEnd: true,
                cancelledAt: expect.any(String),
            });
            // Status stays ACTIVE until the period runs out
            expect(mockUpdateSubscription.mock.calls[0][1]).not.toHaveProperty('status');
        });

        test('also withdraws a pending request when scheduling the cancel', async () => {
            mockFindActiveSubscription.mockResolvedValue(activeSub({ pendingPlanId: mockPremiumPlan.id, pendingPlanSnapshot: mockPremiumPlan }));

            const res = await auth(request(app).post('/api/subscriptions/cancel'));

            expect(res.status).toBe(200);
            expect(mockUpdateSubscription).toHaveBeenCalledWith('sub-r1', expect.objectContaining({
                ...clearedRequest,
                cancelAtPeriodEnd: true,
            }));
        });

        test('is idempotent when already set to cancel with nothing pending', async () => {
            mockFindActiveSubscription.mockResolvedValue(activeSub({ cancelAtPeriodEnd: true }));

            const res = await auth(request(app).post('/api/subscriptions/cancel'));

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Subscription is already scheduled for cancellation');
            expect(mockUpdateSubscription).not.toHaveBeenCalled();
        });

        test('already set to cancel but with a pending request: clears the request', async () => {
            mockFindActiveSubscription.mockResolvedValue(activeSub({
                cancelAtPeriodEnd: true,
                pendingPlanId: mockPremiumPlan.id,
                pendingPlanSnapshot: mockPremiumPlan,
            }));

            const res = await auth(request(app).post('/api/subscriptions/cancel'));

            expect(res.status).toBe(200);
            expect(mockUpdateSubscription).toHaveBeenCalledWith('sub-r1', expect.objectContaining({
                ...clearedRequest,
                cancelAtPeriodEnd: true,
            }));
        });

        test('cancels at once when the active plan has no period end', async () => {
            mockFindActiveSubscription.mockResolvedValue(activeSub({ currentPeriodEnd: undefined }));

            const res = await auth(request(app).post('/api/subscriptions/cancel'));

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Subscription cancelled');
            expect(mockUpdateSubscription).toHaveBeenCalledWith('sub-r1', {
                ...clearedRequest,
                status: 'CANCELLED',
                cancelAtPeriodEnd: false,
                cancelledAt: expect.any(String),
            });
        });

        test('with no active plan, withdraws a pending request', async () => {
            mockFindActiveSubscription.mockResolvedValue(noPlanSub({ pendingPlanId: mockPlan.id, pendingPlanSnapshot: mockPlan }));

            const res = await auth(request(app).post('/api/subscriptions/cancel'));

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Plan request withdrawn');
            expect(mockUpdateSubscription).toHaveBeenCalledWith('sub-r1', clearedRequest);
        });

        test('with no active plan and nothing pending, returns 400', async () => {
            for (const sub of [noPlanSub(), activeSub({ status: 'CANCELLED' })]) {
                mockFindActiveSubscription.mockResolvedValueOnce(sub);
                const res = await auth(request(app).post('/api/subscriptions/cancel'));
                expect(res.status).toBe(400);
                expect(res.body.error).toBe('No active subscription to cancel');
            }
            expect(mockUpdateSubscription).not.toHaveBeenCalled();
        });

        test('returns 400 when there is no subscription', async () => {
            mockFindActiveSubscription.mockResolvedValue(null);

            const res = await auth(request(app).post('/api/subscriptions/cancel'));

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('No active subscription to cancel');
            expect(mockUpdateSubscription).not.toHaveBeenCalled();
        });
    });

    describe('POST /api/subscriptions/reactivate', () => {
        test('returns 401 without auth', async () => {
            const res = await request(app).post('/api/subscriptions/reactivate');
            expect(res.status).toBe(401);
        });

        test('undoes a scheduled cancellation', async () => {
            mockFindActiveSubscription.mockResolvedValue(activeSub({ cancelAtPeriodEnd: true, cancelledAt: '2026-11-20T10:00:00.000Z' }));

            const res = await auth(request(app).post('/api/subscriptions/reactivate'));

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ success: true, data: { reactivated: true } });
            expect(mockUpdateSubscription).toHaveBeenCalledTimes(1);
            expect(mockUpdateSubscription).toHaveBeenCalledWith('sub-r1', { cancelAtPeriodEnd: false, cancelledAt: undefined });
        });

        test('returns 400 when there is no subscription', async () => {
            mockFindActiveSubscription.mockResolvedValue(null);

            const res = await auth(request(app).post('/api/subscriptions/reactivate'));

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Subscription is not pending cancellation');
        });

        test('returns 400 when the active plan is not set to cancel', async () => {
            mockFindActiveSubscription.mockResolvedValue(activeSub({ cancelAtPeriodEnd: false }));

            const res = await auth(request(app).post('/api/subscriptions/reactivate'));

            expect(res.status).toBe(400);
            expect(mockUpdateSubscription).not.toHaveBeenCalled();
        });

        test('returns 400 when no paid plan is active, even if cancelAtPeriodEnd is set', async () => {
            for (const sub of [activeSub({ status: 'CANCELLED', cancelAtPeriodEnd: true }), noPlanSub({ cancelAtPeriodEnd: true })]) {
                mockFindActiveSubscription.mockResolvedValueOnce(sub);
                const res = await auth(request(app).post('/api/subscriptions/reactivate'));
                expect(res.status).toBe(400);
            }
            expect(mockUpdateSubscription).not.toHaveBeenCalled();
        });
    });

    describe('removed payment-gateway routes', () => {
        test.each([
            ['/api/subscriptions/verify'],
            ['/api/subscriptions/webhook'],
            ['/api/subscriptions/credits/purchase'],
            ['/api/subscriptions/credits/verify'],
        ])('POST %s is gone (404)', async (path) => {
            const res = await auth(request(app).post(path)).send({});
            expect(res.status).toBe(404);
            expect(mockUpdateSubscription).not.toHaveBeenCalled();
        });
    });
});
