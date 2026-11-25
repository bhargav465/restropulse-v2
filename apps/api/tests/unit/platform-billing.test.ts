import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';

// Platform admin billing routes (manual billing, no payment gateway), mounted
// at /api/platform-admin/billing in server.ts.

// Define Mocks
const mockAddCredits = vi.fn();
const mockFindActiveSubscription = vi.fn();
const mockFindPlanBySlug = vi.fn();
const mockFindSubscriptionsWithPendingPlan = vi.fn();
const mockUpdateSubscription = vi.fn();
const mockFindCouponByCode = vi.fn();
const mockHasRestaurantRedeemedCoupon = vi.fn();
const mockIncrementCouponRedemptions = vi.fn();
const mockCreateCouponRedemption = vi.fn();
const mockFindUserByRestaurantId = vi.fn();

vi.mock('@restropulse/db', async (importOriginal) => {
    const actual = await importOriginal() as any;
    return {
        ...actual,
        addCredits: mockAddCredits,
        findActiveSubscription: mockFindActiveSubscription,
        findPlanBySlug: mockFindPlanBySlug,
        findSubscriptionsWithPendingPlan: mockFindSubscriptionsWithPendingPlan,
        updateSubscription: mockUpdateSubscription,
        findCouponByCode: mockFindCouponByCode,
        hasRestaurantRedeemedCoupon: mockHasRestaurantRedeemedCoupon,
        incrementCouponRedemptions: mockIncrementCouponRedemptions,
        createCouponRedemption: mockCreateCouponRedemption,
        findUserByRestaurantId: mockFindUserByRestaurantId,
    };
});

const { generateAuthToken, generateAdminAuthToken, mockUser } = await import('../helpers/testHelper.js');
const { default: platformBillingRoutes } = await import('../../src/routes/platform-billing.js');

// Mirror server.ts mounting; testHelper's app does not mount this router.
function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/platform-admin/billing', platformBillingRoutes);
    app.use((_err: Error, _req: Request, res: Response, _next: NextFunction) => {
        res.status(500).json({ success: false, error: 'Internal server error' });
    });
    return app;
}

const app = createApp();
const ownerToken = generateAuthToken();
const adminToken = generateAdminAuthToken();

const BASE = '/api/platform-admin/billing';
const NOW = new Date('2026-03-15T10:00:00.000Z');

const growthPlan = {
    id: 'plan-growth-v1',
    slug: 'growth',
    version: 1,
    isCurrentVersion: true,
    tier: 'GROWTH',
    name: 'Growth',
    limits: { weekly: { INSTAGRAM: { IMAGE: 5 } } },
    pricing: { monthly: 999900, annual: 9999000, currency: 'INR' },
    features: ['INSTAGRAM'],
};

const premiumPlan = {
    ...growthPlan,
    id: 'plan-premium-v1',
    slug: 'premium',
    tier: 'PREMIUM',
    name: 'Premium',
    pricing: { monthly: 1999900, annual: 19999000, currency: 'INR' },
};

const plansBySlug: Record<string, unknown> = { growth: growthPlan, premium: premiumPlan };

/** Onboarding record with an owner's Growth request (and coupon) waiting. */
const requestedSub = (overrides: Record<string, unknown> = {}) => ({
    id: 'sub-r9',
    restaurantId: 'r9',
    status: 'NONE',
    credits: 0,
    pendingPlanId: growthPlan.id,
    pendingPlanSnapshot: growthPlan,
    planRequestedAt: '2026-03-14T08:00:00.000Z',
    couponCode: 'SAVE10',
    ...overrides,
});

/** Active Growth plan, 10 days left. */
const activeSub = (overrides: Record<string, unknown> = {}) => ({
    id: 'sub-r9',
    restaurantId: 'r9',
    planId: growthPlan.id,
    planSnapshot: growthPlan,
    billingCycle: 'MONTHLY',
    status: 'ACTIVE',
    credits: 25,
    currentPeriodStart: '2026-02-25T00:00:00.000Z',
    currentPeriodEnd: '2026-03-25T00:00:00.000Z',
    ...overrides,
});

const coupon = {
    id: 'coupon-1',
    code: 'SAVE10',
    type: 'PERCENTAGE',
    value: 10,
    redemptionCount: 0,
    validFrom: '2026-01-01',
    status: 'ACTIVE',
    createdBy: 'admin',
};

const asAdmin = (req: request.Test) => req.set('Authorization', `Bearer ${adminToken}`);
const activate = (restaurantId: string, body: Record<string, unknown> = {}) =>
    asAdmin(request(app).post(`${BASE}/restaurants/${restaurantId}/activate`)).send(body);
const addCreditsReq = (restaurantId: string, body: Record<string, unknown>) =>
    asAdmin(request(app).post(`${BASE}/restaurants/${restaurantId}/credits`)).send(body);

describe('Platform admin billing routes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW);
        mockFindPlanBySlug.mockImplementation(async (slug: string) => plansBySlug[slug] ?? null);
        mockUpdateSubscription.mockImplementation(async (id: string, updates: Record<string, unknown>) => {
            const current = await mockFindActiveSubscription.mock.results.at(-1)?.value;
            return { ...(current ?? {}), id, ...updates };
        });
        mockFindCouponByCode.mockResolvedValue(coupon);
        mockHasRestaurantRedeemedCoupon.mockResolvedValue(false);
        mockFindUserByRestaurantId.mockResolvedValue(mockUser);
        mockIncrementCouponRedemptions.mockResolvedValue(undefined);
        mockCreateCouponRedemption.mockImplementation(async (r: Record<string, unknown>) => ({ id: 'red-1', ...r }));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('access control', () => {
        const routes: Array<[string, string]> = [
            ['get', `${BASE}/requests`],
            ['post', `${BASE}/restaurants/r9/activate`],
            ['post', `${BASE}/restaurants/r9/credits`],
        ];

        test.each(routes)('%s %s returns 401 without a token', async (method, path) => {
            const res = await (request(app) as any)[method](path).send({ credits: 5 });
            expect(res.status).toBe(401);
        });

        test.each(routes)('%s %s returns 401 with a bad token', async (method, path) => {
            const res = await (request(app) as any)[method](path).set('Authorization', 'Bearer not-a-token').send({ credits: 5 });
            expect(res.status).toBe(401);
        });

        test.each(routes)('%s %s returns 403 for a restaurant owner', async (method, path) => {
            const res = await (request(app) as any)[method](path).set('Authorization', `Bearer ${ownerToken}`).send({ credits: 5 });
            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
        });

        test('touches no data for a non-admin', async () => {
            await request(app).post(`${BASE}/restaurants/r9/activate`).set('Authorization', `Bearer ${ownerToken}`).send({});
            await request(app).post(`${BASE}/restaurants/r9/credits`).set('Authorization', `Bearer ${ownerToken}`).send({ credits: 5 });
            await request(app).get(`${BASE}/requests`).set('Authorization', `Bearer ${ownerToken}`);
            expect(mockFindActiveSubscription).not.toHaveBeenCalled();
            expect(mockFindSubscriptionsWithPendingPlan).not.toHaveBeenCalled();
            expect(mockUpdateSubscription).not.toHaveBeenCalled();
            expect(mockAddCredits).not.toHaveBeenCalled();
        });
    });

    describe('GET /requests', () => {
        test('lists plan requests with current and requested plan', async () => {
            mockFindSubscriptionsWithPendingPlan.mockResolvedValue([
                requestedSub(),
                activeSub({
                    id: 'sub-r7',
                    restaurantId: 'r7',
                    pendingPlanId: premiumPlan.id,
                    pendingPlanSnapshot: premiumPlan,
                    planRequestedAt: '2026-03-15T09:00:00.000Z',
                }),
            ]);

            const res = await asAdmin(request(app).get(`${BASE}/requests`));

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toEqual([
                {
                    restaurantId: 'r9',
                    subscriptionId: 'sub-r9',
                    status: 'NONE',
                    currentPlan: null,
                    currentPeriodEnd: null,
                    requestedPlan: { slug: 'growth', name: 'Growth', monthlyPaise: 999900 },
                    couponCode: 'SAVE10',
                    requestedAt: '2026-03-14T08:00:00.000Z',
                },
                {
                    restaurantId: 'r7',
                    subscriptionId: 'sub-r7',
                    status: 'ACTIVE',
                    currentPlan: { slug: 'growth', name: 'Growth' },
                    currentPeriodEnd: '2026-03-25T00:00:00.000Z',
                    requestedPlan: { slug: 'premium', name: 'Premium', monthlyPaise: 1999900 },
                    couponCode: null,
                    requestedAt: '2026-03-15T09:00:00.000Z',
                },
            ]);
        });

        test('fills missing fields with null / 0', async () => {
            mockFindSubscriptionsWithPendingPlan.mockResolvedValue([
                { id: 'sub-x', restaurantId: 'rx', status: 'NONE', credits: 0, pendingPlanSnapshot: { slug: 'odd', name: 'Odd' } },
                { id: 'sub-y', restaurantId: 'ry', status: 'NONE', credits: 0, pendingPlanSnapshot: null },
            ]);

            const res = await asAdmin(request(app).get(`${BASE}/requests`));

            expect(res.status).toBe(200);
            expect(res.body.data[0]).toEqual({
                restaurantId: 'rx',
                subscriptionId: 'sub-x',
                status: 'NONE',
                currentPlan: null,
                currentPeriodEnd: null,
                requestedPlan: { slug: 'odd', name: 'Odd', monthlyPaise: 0 },
                couponCode: null,
                requestedAt: null,
            });
            expect(res.body.data[1].requestedPlan).toBeNull();
        });

        test('returns an empty list when nothing is waiting', async () => {
            mockFindSubscriptionsWithPendingPlan.mockResolvedValue([]);

            const res = await asAdmin(request(app).get(`${BASE}/requests`));

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ success: true, data: [] });
        });

        test('returns 500 when the lookup throws', async () => {
            mockFindSubscriptionsWithPendingPlan.mockRejectedValue(new Error('db down'));

            const res = await asAdmin(request(app).get(`${BASE}/requests`));

            expect(res.status).toBe(500);
        });
    });

    describe('POST /restaurants/:restaurantId/activate', () => {
        test('activates the requested plan for 1 month by default, starting now', async () => {
            mockFindActiveSubscription.mockResolvedValue(requestedSub());

            const res = await activate('r9');

            expect(res.status).toBe(200);
            expect(mockFindActiveSubscription).toHaveBeenCalledWith('r9');
            expect(mockFindPlanBySlug).toHaveBeenCalledWith('growth');
            expect(mockUpdateSubscription).toHaveBeenCalledTimes(1);
            expect(mockUpdateSubscription).toHaveBeenCalledWith('sub-r9', {
                planId: 'plan-growth-v1',
                planSnapshot: growthPlan,
                billingCycle: 'MONTHLY',
                status: 'ACTIVE',
                currentPeriodStart: '2026-03-15T10:00:00.000Z',
                currentPeriodEnd: '2026-04-15T10:00:00.000Z',
                cancelAtPeriodEnd: false,
                cancelledAt: undefined,
                pendingPlanId: undefined,
                pendingPlanSnapshot: null,
                planRequestedAt: null,
                couponCode: 'SAVE10',
            });
            expect(res.body.success).toBe(true);
            expect(res.body.data.subscription).toMatchObject({
                id: 'sub-r9',
                status: 'ACTIVE',
                currentPeriodEnd: '2026-04-15T10:00:00.000Z',
                pendingPlanSnapshot: null,
            });
        });

        test('records the coupon redemption when the requested plan is activated', async () => {
            mockFindActiveSubscription.mockResolvedValue(requestedSub());

            const res = await activate('r9', { months: 3 });

            expect(res.status).toBe(200);
            expect(mockFindCouponByCode).toHaveBeenCalledWith('SAVE10');
            expect(mockHasRestaurantRedeemedCoupon).toHaveBeenCalledWith('coupon-1', 'r9');
            expect(mockIncrementCouponRedemptions).toHaveBeenCalledWith('coupon-1');
            expect(mockCreateCouponRedemption).toHaveBeenCalledWith({
                couponId: 'coupon-1',
                couponCode: 'SAVE10',
                restaurantId: 'r9',
                userId: 'u1',
                subscriptionId: 'sub-r9',
                discountAppliedPaise: 99990, // 10% of 999900
                redeemedAt: expect.any(Date),
            });
        });

        test('an explicit planSlug overrides the request and skips the coupon', async () => {
            mockFindActiveSubscription.mockResolvedValue(requestedSub());

            const res = await activate('r9', { planSlug: 'premium' });

            expect(res.status).toBe(200);
            expect(mockFindPlanBySlug).toHaveBeenCalledWith('premium');
            expect(mockUpdateSubscription).toHaveBeenCalledWith('sub-r9', expect.objectContaining({
                planId: 'plan-premium-v1',
                planSnapshot: premiumPlan,
                pendingPlanSnapshot: null,
            }));
            expect(mockFindCouponByCode).not.toHaveBeenCalled();
            expect(mockCreateCouponRedemption).not.toHaveBeenCalled();
        });

        test('an explicit planSlug equal to the requested plan still records the coupon', async () => {
            mockFindActiveSubscription.mockResolvedValue(requestedSub());

            const res = await activate('r9', { planSlug: 'growth' });

            expect(res.status).toBe(200);
            expect(mockCreateCouponRedemption).toHaveBeenCalledTimes(1);
        });

        test('an empty planSlug falls back to the requested plan', async () => {
            mockFindActiveSubscription.mockResolvedValue(requestedSub());

            const res = await activate('r9', { planSlug: '' });

            expect(res.status).toBe(200);
            expect(mockFindPlanBySlug).toHaveBeenCalledWith('growth');
        });

        test('records no coupon when the request carried none', async () => {
            mockFindActiveSubscription.mockResolvedValue(requestedSub({ couponCode: undefined }));

            const res = await activate('r9');

            expect(res.status).toBe(200);
            expect(mockFindCouponByCode).not.toHaveBeenCalled();
        });

        test('records no coupon on a plain renewal with nothing requested', async () => {
            mockFindActiveSubscription.mockResolvedValue(activeSub({ couponCode: 'SAVE10' }));

            const res = await activate('r9');

            expect(res.status).toBe(200);
            expect(mockFindCouponByCode).not.toHaveBeenCalled();
        });

        test('returns 409 and records no coupon when the update finds nothing', async () => {
            mockFindActiveSubscription.mockResolvedValue(requestedSub());
            mockUpdateSubscription.mockResolvedValue(null);

            const res = await activate('r9');

            expect(res.status).toBe(409);
            expect(res.body.success).toBe(false);
            expect(mockIncrementCouponRedemptions).not.toHaveBeenCalled();
            expect(mockCreateCouponRedemption).not.toHaveBeenCalled();
        });

        test('drops a coupon that is no longer valid instead of redeeming it', async () => {
            mockFindActiveSubscription.mockResolvedValue(requestedSub());
            mockFindCouponByCode.mockResolvedValue({ ...coupon, validUntil: '2026-03-01T00:00:00.000Z' });

            const res = await activate('r9');

            expect(res.status).toBe(200);
            expect(mockUpdateSubscription).toHaveBeenCalledWith('sub-r9', expect.objectContaining({ couponCode: undefined }));
            expect(mockCreateCouponRedemption).not.toHaveBeenCalled();
        });

        test('still activates when recording the coupon fails', async () => {
            mockFindActiveSubscription.mockResolvedValue(requestedSub());
            mockIncrementCouponRedemptions.mockRejectedValue(new Error('db hiccup'));

            const res = await activate('r9');

            expect(res.status).toBe(200);
            expect(res.body.data.subscription.status).toBe('ACTIVE');
        });

        test('renewing the same active plan extends from the current end', async () => {
            mockFindActiveSubscription.mockResolvedValue(activeSub());

            const res = await activate('r9', { months: 3 });

            expect(res.status).toBe(200);
            // No planSlug and nothing requested -> the current plan
            expect(mockFindPlanBySlug).toHaveBeenCalledWith('growth');
            expect(mockUpdateSubscription).toHaveBeenCalledWith('sub-r9', expect.objectContaining({
                planSnapshot: growthPlan,
                status: 'ACTIVE',
                // the paid period keeps its start and runs 3 months past the old end
                currentPeriodStart: '2026-02-25T00:00:00.000Z',
                currentPeriodEnd: '2026-06-25T00:00:00.000Z',
            }));
        });

        test('renewing the same plan with an explicit planSlug also extends', async () => {
            mockFindActiveSubscription.mockResolvedValue(activeSub());

            await activate('r9', { planSlug: 'growth', months: 1 });

            expect(mockUpdateSubscription).toHaveBeenCalledWith('sub-r9', expect.objectContaining({
                currentPeriodEnd: '2026-04-25T00:00:00.000Z',
            }));
        });

        test('renewing a plan whose period already ran out starts now', async () => {
            mockFindActiveSubscription.mockResolvedValue(activeSub({
                currentPeriodStart: '2026-01-10T00:00:00.000Z',
                currentPeriodEnd: '2026-03-10T00:00:00.000Z',
            }));

            await activate('r9', { months: 2 });

            expect(mockUpdateSubscription).toHaveBeenCalledWith('sub-r9', expect.objectContaining({
                currentPeriodStart: NOW.toISOString(),
                currentPeriodEnd: '2026-05-15T10:00:00.000Z',
            }));
        });

        test('switching to a different plan starts now', async () => {
            mockFindActiveSubscription.mockResolvedValue(activeSub({
                pendingPlanId: premiumPlan.id,
                pendingPlanSnapshot: premiumPlan,
                planRequestedAt: '2026-03-14T08:00:00.000Z',
            }));

            const res = await activate('r9', { months: 2 });

            expect(res.status).toBe(200);
            expect(mockFindPlanBySlug).toHaveBeenCalledWith('premium');
            expect(mockUpdateSubscription).toHaveBeenCalledWith('sub-r9', expect.objectContaining({
                planId: 'plan-premium-v1',
                planSnapshot: premiumPlan,
                currentPeriodStart: NOW.toISOString(),
                currentPeriodEnd: '2026-05-15T10:00:00.000Z',
                pendingPlanId: undefined,
                pendingPlanSnapshot: null,
                planRequestedAt: null,
            }));
        });

        test('clears a scheduled cancellation and the pending request', async () => {
            mockFindActiveSubscription.mockResolvedValue(activeSub({
                cancelAtPeriodEnd: true,
                cancelledAt: '2026-03-01T00:00:00.000Z',
                pendingPlanId: premiumPlan.id,
                pendingPlanSnapshot: premiumPlan,
                planRequestedAt: '2026-03-14T08:00:00.000Z',
            }));

            await activate('r9');

            const updates = mockUpdateSubscription.mock.calls[0][1];
            expect(updates.cancelAtPeriodEnd).toBe(false);
            expect(updates).toHaveProperty('cancelledAt', undefined);
            expect(updates).toHaveProperty('pendingPlanId', undefined);
            expect(updates.pendingPlanSnapshot).toBeNull();
            expect(updates.planRequestedAt).toBeNull();
        });

        test('reactivates a CANCELLED subscription on its old plan', async () => {
            mockFindActiveSubscription.mockResolvedValue(activeSub({ status: 'CANCELLED', currentPeriodEnd: '2026-03-20T00:00:00.000Z' }));

            await activate('r9');

            // A cancelled plan is not "active", so the new period starts now
            expect(mockUpdateSubscription).toHaveBeenCalledWith('sub-r9', expect.objectContaining({
                status: 'ACTIVE',
                currentPeriodStart: NOW.toISOString(),
                currentPeriodEnd: '2026-04-15T10:00:00.000Z',
            }));
        });

        test('accepts months as a numeric string and the 36-month maximum', async () => {
            mockFindActiveSubscription.mockResolvedValue(requestedSub({ couponCode: undefined }));

            const res1 = await activate('r9', { months: '6' });
            const res2 = await activate('r9', { months: 36 });

            expect(res1.status).toBe(200);
            expect(res2.status).toBe(200);
            expect(mockUpdateSubscription.mock.calls[0][1].currentPeriodEnd).toBe('2026-09-15T10:00:00.000Z');
            expect(mockUpdateSubscription.mock.calls[1][1].currentPeriodEnd).toBe('2029-03-15T10:00:00.000Z');
        });

        test.each([[0], [37], [1.5], ['abc'], [-1], [null]])('returns 400 for months=%j', async (months) => {
            mockFindActiveSubscription.mockResolvedValue(requestedSub());

            const res = await activate('r9', { months });

            expect(res.status).toBe(400);
            expect(res.body).toEqual({ success: false, error: 'months must be a whole number from 1 to 36' });
            expect(mockFindActiveSubscription).not.toHaveBeenCalled();
            expect(mockUpdateSubscription).not.toHaveBeenCalled();
        });

        test('returns 400 when planSlug is not a string', async () => {
            const res = await activate('r9', { planSlug: 7 });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('planSlug must be a string');
            expect(mockUpdateSubscription).not.toHaveBeenCalled();
        });

        test('returns 404 when the restaurant has no subscription', async () => {
            mockFindActiveSubscription.mockResolvedValue(null);

            const res = await activate('r404');

            expect(res.status).toBe(404);
            expect(res.body.error).toBe('No subscription for this restaurant');
            expect(mockUpdateSubscription).not.toHaveBeenCalled();
        });

        test('returns 404 for an unknown plan', async () => {
            mockFindActiveSubscription.mockResolvedValue(requestedSub());

            const res = await activate('r9', { planSlug: 'platinum' });

            expect(res.status).toBe(404);
            expect(res.body.error).toBe('Plan not found');
            expect(mockUpdateSubscription).not.toHaveBeenCalled();
        });

        test('returns 400 when there is nothing to activate', async () => {
            mockFindActiveSubscription.mockResolvedValue({ id: 'sub-r9', restaurantId: 'r9', status: 'NONE', credits: 0 });

            const res = await activate('r9');

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('No plan requested; pass planSlug');
            expect(mockFindPlanBySlug).not.toHaveBeenCalled();
            expect(mockUpdateSubscription).not.toHaveBeenCalled();
        });

        test('returns 500 when the update throws', async () => {
            mockFindActiveSubscription.mockResolvedValue(requestedSub());
            mockUpdateSubscription.mockRejectedValue(new Error('write failed'));

            const res = await activate('r9');

            expect(res.status).toBe(500);
            expect(mockCreateCouponRedemption).not.toHaveBeenCalled();
        });
    });

    describe('POST /restaurants/:restaurantId/credits', () => {
        test('adds credits and returns the new balance', async () => {
            mockFindActiveSubscription
                .mockResolvedValueOnce(activeSub({ credits: 25 }))
                .mockResolvedValueOnce(activeSub({ credits: 75 }));
            mockAddCredits.mockResolvedValue(true);

            const res = await addCreditsReq('r9', { credits: 50 });

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ success: true, data: { credits: 75 } });
            expect(mockFindActiveSubscription).toHaveBeenCalledWith('r9');
            expect(mockAddCredits).toHaveBeenCalledWith('sub-r9', 50);
            // Credits never touch the plan
            expect(mockUpdateSubscription).not.toHaveBeenCalled();
        });

        test('works for a restaurant with no paid plan and accepts a numeric string', async () => {
            mockFindActiveSubscription
                .mockResolvedValueOnce(requestedSub({ credits: 0 }))
                .mockResolvedValueOnce(null);
            mockAddCredits.mockResolvedValue(true);

            const res = await addCreditsReq('r9', { credits: '10' });

            expect(res.status).toBe(200);
            expect(res.body.data.credits).toBe(10);
            expect(mockAddCredits).toHaveBeenCalledWith('sub-r9', 10);
        });

        test('accepts the 100,000 maximum', async () => {
            mockFindActiveSubscription.mockResolvedValue(activeSub({ credits: 0 }));
            mockAddCredits.mockResolvedValue(true);

            const res = await addCreditsReq('r9', { credits: 100_000 });

            expect(res.status).toBe(200);
            expect(mockAddCredits).toHaveBeenCalledWith('sub-r9', 100_000);
        });

        test.each([[0], [-5], [1.5], ['abc'], [100_001], [null], [undefined]])('returns 400 for credits=%j', async (credits) => {
            const res = await addCreditsReq('r9', credits === undefined ? {} : { credits });

            expect(res.status).toBe(400);
            expect(res.body).toEqual({ success: false, error: 'credits must be a whole number from 1 to 100000' });
            expect(mockFindActiveSubscription).not.toHaveBeenCalled();
            expect(mockAddCredits).not.toHaveBeenCalled();
        });

        test('returns 404 when the restaurant has no subscription', async () => {
            mockFindActiveSubscription.mockResolvedValue(null);

            const res = await addCreditsReq('r404', { credits: 5 });

            expect(res.status).toBe(404);
            expect(res.body.error).toBe('No subscription for this restaurant');
            expect(mockAddCredits).not.toHaveBeenCalled();
        });

        test('returns 500 when addCredits reports no change', async () => {
            mockFindActiveSubscription.mockResolvedValue(activeSub());
            mockAddCredits.mockResolvedValue(false);

            const res = await addCreditsReq('r9', { credits: 5 });

            expect(res.status).toBe(500);
            expect(res.body).toEqual({ success: false, error: 'Could not add credits' });
        });

        test('returns 500 when addCredits throws', async () => {
            mockFindActiveSubscription.mockResolvedValue(activeSub());
            mockAddCredits.mockRejectedValue(new Error('db down'));

            const res = await addCreditsReq('r9', { credits: 5 });

            expect(res.status).toBe(500);
        });
    });
});
