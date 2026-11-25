import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// Pure unit tests for the manual-billing helpers (no payment gateway).

const mockFindCouponByCode = vi.fn();
const mockHasRestaurantRedeemedCoupon = vi.fn();
const mockIncrementCouponRedemptions = vi.fn();
const mockCreateCouponRedemption = vi.fn();
const mockFindUserByRestaurantId = vi.fn();

vi.mock('@restropulse/db', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@restropulse/db')>()),
    findCouponByCode: mockFindCouponByCode,
    hasRestaurantRedeemedCoupon: mockHasRestaurantRedeemedCoupon,
    incrementCouponRedemptions: mockIncrementCouponRedemptions,
    createCouponRedemption: mockCreateCouponRedemption,
    findUserByRestaurantId: mockFindUserByRestaurantId,
}));

const {
    addMonths,
    nextPeriod,
    hasActivePaidPlan,
    checkCoupon,
    recordCouponRedemption,
} = await import('../../src/services/billing/manual-billing.js');

type Sub = Parameters<typeof hasActivePaidPlan>[0] & object;
type Plan = Parameters<typeof recordCouponRedemption>[1];

const growthPlan = {
    id: 'plan-growth-v1',
    slug: 'growth',
    version: 1,
    isCurrentVersion: true,
    tier: 'GROWTH',
    name: 'Growth',
    limits: { weekly: {} },
    pricing: { monthly: 999900, annual: 9999000, currency: 'INR' },
    features: [],
} as Plan;

const sub = (overrides: Partial<Sub> = {}): Sub => ({
    id: 'sub-r1',
    restaurantId: 'r1',
    status: 'ACTIVE',
    credits: 0,
    planSnapshot: growthPlan,
    currentPeriodStart: '2026-02-25T00:00:00.000Z',
    currentPeriodEnd: '2026-03-25T00:00:00.000Z',
    ...overrides,
} as Sub);

const coupon = (overrides: Record<string, unknown> = {}) => ({
    id: 'coupon-1',
    code: 'SAVE10',
    type: 'PERCENTAGE',
    value: 10,
    redemptionCount: 0,
    validFrom: '2026-01-01',
    status: 'ACTIVE',
    createdBy: 'admin',
    ...overrides,
});

const iso = (d: Date) => d.toISOString();

describe('addMonths', () => {
    test('adds whole calendar months and keeps the time of day', () => {
        expect(iso(addMonths(new Date('2026-03-15T10:30:00.000Z'), 1))).toBe('2026-04-15T10:30:00.000Z');
        expect(iso(addMonths(new Date('2026-03-15T10:30:00.000Z'), 6))).toBe('2026-09-15T10:30:00.000Z');
    });

    test('clamps Jan 31 + 1 month to the end of February (non-leap and leap years)', () => {
        expect(iso(addMonths(new Date('2026-01-31T00:00:00.000Z'), 1))).toBe('2026-02-28T00:00:00.000Z');
        expect(iso(addMonths(new Date('2028-01-31T00:00:00.000Z'), 1))).toBe('2028-02-29T00:00:00.000Z');
    });

    test('clamps to 30-day months', () => {
        expect(iso(addMonths(new Date('2026-03-31T12:00:00.000Z'), 1))).toBe('2026-04-30T12:00:00.000Z');
        expect(iso(addMonths(new Date('2026-08-31T00:00:00.000Z'), 1))).toBe('2026-09-30T00:00:00.000Z');
    });

    test('does not carry a clamp into later months (Jan 31 + 2 = Mar 31)', () => {
        expect(iso(addMonths(new Date('2026-01-31T00:00:00.000Z'), 2))).toBe('2026-03-31T00:00:00.000Z');
    });

    test('rolls over into the next year', () => {
        expect(iso(addMonths(new Date('2026-11-15T00:00:00.000Z'), 2))).toBe('2027-01-15T00:00:00.000Z');
        expect(iso(addMonths(new Date('2026-12-31T00:00:00.000Z'), 2))).toBe('2027-02-28T00:00:00.000Z');
        expect(iso(addMonths(new Date('2026-03-15T00:00:00.000Z'), 36))).toBe('2029-03-15T00:00:00.000Z');
    });

    test('adding 12 months from Feb 29 lands on Feb 28', () => {
        expect(iso(addMonths(new Date('2028-02-29T00:00:00.000Z'), 12))).toBe('2029-02-28T00:00:00.000Z');
    });

    test('adding 0 months returns the same instant', () => {
        const d = new Date('2026-03-15T10:00:00.000Z');
        expect(addMonths(d, 0).getTime()).toBe(d.getTime());
    });

    test('does not mutate its input', () => {
        const d = new Date('2026-01-31T00:00:00.000Z');
        addMonths(d, 1);
        expect(iso(d)).toBe('2026-01-31T00:00:00.000Z');
    });
});

describe('hasActivePaidPlan', () => {
    test('true for ACTIVE and PAST_DUE with a plan', () => {
        expect(hasActivePaidPlan(sub({ status: 'ACTIVE' }))).toBe(true);
        expect(hasActivePaidPlan(sub({ status: 'PAST_DUE' }))).toBe(true);
    });

    test('still true when set to cancel at period end', () => {
        expect(hasActivePaidPlan(sub({ cancelAtPeriodEnd: true }))).toBe(true);
    });

    test('false without a plan snapshot', () => {
        expect(hasActivePaidPlan(sub({ planSnapshot: null }))).toBe(false);
        expect(hasActivePaidPlan(sub({ planSnapshot: undefined }))).toBe(false);
    });

    test.each(['NONE', 'CREATED', 'AUTHENTICATED', 'CANCELLED', 'HALTED'] as const)('false for status %s', (status) => {
        expect(hasActivePaidPlan(sub({ status }))).toBe(false);
    });

    test('false for null / undefined', () => {
        expect(hasActivePaidPlan(null)).toBe(false);
        expect(hasActivePaidPlan(undefined)).toBe(false);
    });
});

describe('nextPeriod', () => {
    const now = new Date('2026-03-15T10:00:00.000Z');

    test('renewing the same active plan extends from the current end and keeps the start', () => {
        const { start, end } = nextPeriod(sub(), 'growth', 3, now);
        expect(iso(start)).toBe('2026-02-25T00:00:00.000Z');
        expect(iso(end)).toBe('2026-06-25T00:00:00.000Z');
    });

    test('renewal without a recorded start starts at the current end', () => {
        const { start, end } = nextPeriod(sub({ currentPeriodStart: undefined }), 'growth', 1, now);
        expect(iso(start)).toBe('2026-03-25T00:00:00.000Z');
        expect(iso(end)).toBe('2026-04-25T00:00:00.000Z');
    });

    test('renewal accepts Date values as well as strings', () => {
        const { end } = nextPeriod(sub({
            currentPeriodStart: new Date('2026-02-25T00:00:00.000Z'),
            currentPeriodEnd: new Date('2026-03-25T00:00:00.000Z'),
        }), 'growth', 1, now);
        expect(iso(end)).toBe('2026-04-25T00:00:00.000Z');
    });

    test('a different plan starts now', () => {
        const { start, end } = nextPeriod(sub(), 'premium', 2, now);
        expect(iso(start)).toBe(iso(now));
        expect(iso(end)).toBe('2026-05-15T10:00:00.000Z');
    });

    test('the same plan after its period ended starts now', () => {
        const { start, end } = nextPeriod(sub({ currentPeriodEnd: '2026-03-10T00:00:00.000Z' }), 'growth', 1, now);
        expect(iso(start)).toBe(iso(now));
        expect(iso(end)).toBe('2026-04-15T10:00:00.000Z');
    });

    test('a period ending exactly now starts now', () => {
        const { start } = nextPeriod(sub({ currentPeriodEnd: iso(now) }), 'growth', 1, now);
        expect(iso(start)).toBe(iso(now));
    });

    test('the same plan on a non-active subscription starts now', () => {
        for (const status of ['CANCELLED', 'NONE', 'HALTED'] as const) {
            const { start, end } = nextPeriod(sub({ status }), 'growth', 1, now);
            expect(iso(start)).toBe(iso(now));
            expect(iso(end)).toBe('2026-04-15T10:00:00.000Z');
        }
    });

    test('a first activation with no plan or period starts now', () => {
        const { start, end } = nextPeriod(sub({
            status: 'NONE', planSnapshot: null, currentPeriodStart: undefined, currentPeriodEnd: undefined,
        }), 'growth', 12, now);
        expect(iso(start)).toBe(iso(now));
        expect(iso(end)).toBe('2027-03-15T10:00:00.000Z');
    });

    test('an unparseable current end starts now', () => {
        const { start } = nextPeriod(sub({ currentPeriodEnd: 'not-a-date' }), 'growth', 1, now);
        expect(iso(start)).toBe(iso(now));
    });

    test('defaults now to the current time', () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            vi.setSystemTime(now);
            const { start } = nextPeriod(sub(), 'premium', 1);
            expect(iso(start)).toBe(iso(now));
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('checkCoupon', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockHasRestaurantRedeemedCoupon.mockResolvedValue(false);
    });

    test('accepts a valid coupon', async () => {
        const c = coupon();
        mockFindCouponByCode.mockResolvedValue(c);

        const result = await checkCoupon('SAVE10', 'r1', 'growth');

        expect(result).toEqual({ ok: true, coupon: c });
        expect(mockFindCouponByCode).toHaveBeenCalledWith('SAVE10');
        expect(mockHasRestaurantRedeemedCoupon).toHaveBeenCalledWith('coupon-1', 'r1');
    });

    test('accepts a coupon assigned to this restaurant, for a listed plan, in date, under its cap', async () => {
        mockFindCouponByCode.mockResolvedValue(coupon({
            assignedTo: 'r1',
            applicablePlans: ['starter', 'growth'],
            validUntil: new Date(Date.now() + 86_400_000).toISOString(),
            maxRedemptions: 5,
            redemptionCount: 4,
        }));

        expect((await checkCoupon('SAVE10', 'r1', 'growth')).ok).toBe(true);
    });

    test('an empty applicablePlans list means any plan', async () => {
        mockFindCouponByCode.mockResolvedValue(coupon({ applicablePlans: [] }));
        expect((await checkCoupon('SAVE10', 'r1', 'premium')).ok).toBe(true);
    });

    test('maxRedemptions of 0 means unlimited', async () => {
        mockFindCouponByCode.mockResolvedValue(coupon({ maxRedemptions: 0, redemptionCount: 50 }));
        expect((await checkCoupon('SAVE10', 'r1', 'growth')).ok).toBe(true);
    });

    test.each([
        ['unknown', null, 'Invalid coupon code'],
        ['inactive', coupon({ status: 'DISABLED' }), 'Coupon is not active'],
        ['marked expired', coupon({ status: 'EXPIRED' }), 'Coupon is not active'],
        ['past validUntil', coupon({ validUntil: '2020-01-01T00:00:00.000Z' }), 'Coupon has expired'],
        ['fully redeemed', coupon({ maxRedemptions: 3, redemptionCount: 3 }), 'Coupon has been fully redeemed'],
        ['assigned to another restaurant', coupon({ assignedTo: 'r2' }), 'Invalid coupon code'],
        ['not applicable to the plan', coupon({ applicablePlans: ['premium'] }), 'Coupon is not applicable to this plan'],
    ])('rejects a coupon that is %s', async (_label, found, error) => {
        mockFindCouponByCode.mockResolvedValue(found);

        expect(await checkCoupon('SAVE10', 'r1', 'growth')).toEqual({ ok: false, error });
        expect(mockHasRestaurantRedeemedCoupon).not.toHaveBeenCalled();
    });

    test('rejects a coupon the restaurant already redeemed', async () => {
        mockFindCouponByCode.mockResolvedValue(coupon());
        mockHasRestaurantRedeemedCoupon.mockResolvedValue(true);

        expect(await checkCoupon('SAVE10', 'r1', 'growth')).toEqual({ ok: false, error: 'Coupon already redeemed by this restaurant' });
    });
});

describe('recordCouponRedemption', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockHasRestaurantRedeemedCoupon.mockResolvedValue(false);
        mockFindUserByRestaurantId.mockResolvedValue({ id: 'u1', restaurantId: 'r1' });
        mockIncrementCouponRedemptions.mockResolvedValue(undefined);
        mockCreateCouponRedemption.mockResolvedValue({ id: 'red-1' });
    });

    test('records a PERCENTAGE coupon against the monthly price', async () => {
        mockFindCouponByCode.mockResolvedValue(coupon({ type: 'PERCENTAGE', value: 15 }));

        await recordCouponRedemption(sub(), growthPlan, 'SAVE10');

        expect(mockFindCouponByCode).toHaveBeenCalledWith('SAVE10');
        expect(mockHasRestaurantRedeemedCoupon).toHaveBeenCalledWith('coupon-1', 'r1');
        expect(mockFindUserByRestaurantId).toHaveBeenCalledWith('r1');
        expect(mockIncrementCouponRedemptions).toHaveBeenCalledWith('coupon-1');
        expect(mockCreateCouponRedemption).toHaveBeenCalledWith({
            couponId: 'coupon-1',
            couponCode: 'SAVE10',
            restaurantId: 'r1',
            userId: 'u1',
            subscriptionId: 'sub-r1',
            discountAppliedPaise: 149985, // round(999900 * 15 / 100)
            redeemedAt: expect.any(Date),
        });
    });

    test('rounds a PERCENTAGE discount to whole paise', async () => {
        mockFindCouponByCode.mockResolvedValue(coupon({ type: 'PERCENTAGE', value: 33 }));
        const plan = { ...growthPlan, pricing: { ...growthPlan.pricing, monthly: 1001 } };

        await recordCouponRedemption(sub(), plan, 'SAVE10');

        expect(mockCreateCouponRedemption.mock.calls[0][0].discountAppliedPaise).toBe(330); // 330.33 -> 330
    });

    test('records a FLAT coupon at its face value', async () => {
        mockFindCouponByCode.mockResolvedValue(coupon({ type: 'FLAT', value: 50000 }));

        await recordCouponRedemption(sub(), growthPlan, 'SAVE10');

        expect(mockCreateCouponRedemption.mock.calls[0][0].discountAppliedPaise).toBe(50000);
    });

    test('a plan without pricing gives a 0 percentage discount', async () => {
        mockFindCouponByCode.mockResolvedValue(coupon({ type: 'PERCENTAGE', value: 10 }));
        const plan = { ...growthPlan, pricing: undefined } as unknown as Plan;

        await recordCouponRedemption(sub(), plan, 'SAVE10');

        expect(mockCreateCouponRedemption.mock.calls[0][0].discountAppliedPaise).toBe(0);
    });

    test('uses an empty userId when the restaurant has no owner user', async () => {
        mockFindCouponByCode.mockResolvedValue(coupon());
        mockFindUserByRestaurantId.mockResolvedValue(null);

        await recordCouponRedemption(sub(), growthPlan, 'SAVE10');

        expect(mockCreateCouponRedemption.mock.calls[0][0].userId).toBe('');
    });

    test('does nothing when the coupon has vanished', async () => {
        mockFindCouponByCode.mockResolvedValue(null);

        await recordCouponRedemption(sub(), growthPlan, 'GONE');

        expect(mockHasRestaurantRedeemedCoupon).not.toHaveBeenCalled();
        expect(mockIncrementCouponRedemptions).not.toHaveBeenCalled();
        expect(mockCreateCouponRedemption).not.toHaveBeenCalled();
    });

    test('does nothing when the restaurant already redeemed it (idempotent)', async () => {
        mockFindCouponByCode.mockResolvedValue(coupon());
        mockHasRestaurantRedeemedCoupon.mockResolvedValue(true);

        await recordCouponRedemption(sub(), growthPlan, 'SAVE10');

        expect(mockIncrementCouponRedemptions).not.toHaveBeenCalled();
        expect(mockCreateCouponRedemption).not.toHaveBeenCalled();
    });

    test('propagates a db error to the caller', async () => {
        mockFindCouponByCode.mockResolvedValue(coupon());
        mockIncrementCouponRedemptions.mockRejectedValue(new Error('db down'));

        await expect(recordCouponRedemption(sub(), growthPlan, 'SAVE10')).rejects.toThrow('db down');
        expect(mockCreateCouponRedemption).not.toHaveBeenCalled();
    });
});

afterEach(() => {
    vi.useRealTimers();
});
