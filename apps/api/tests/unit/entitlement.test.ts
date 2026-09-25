import { describe, test, expect, vi, beforeEach } from 'vitest';
import { getEntitlement, isEntitled } from '../../src/lib/entitlement.js';

const inDays = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();

describe('entitlement helper', () => {
    test('a missing subscription is not entitled', () => {
        const e = getEntitlement(null);
        expect(e).toEqual({ entitled: false, inTrial: false, activePlan: false, trialDaysLeft: 0 });
        expect(isEntitled(undefined)).toBe(false);
    });

    test('an ACTIVE plan is entitled (not via trial)', () => {
        const e = getEntitlement({ status: 'ACTIVE' } as any);
        expect(e.entitled).toBe(true);
        expect(e.activePlan).toBe(true);
        expect(e.inTrial).toBe(false);
    });

    test('PAST_DUE is still entitled', () => {
        expect(isEntitled({ status: 'PAST_DUE' } as any)).toBe(true);
    });

    test('NONE within the trial window is entitled and reports days left', () => {
        const e = getEntitlement({ status: 'NONE', trialEndsAt: inDays(3) } as any);
        expect(e.entitled).toBe(true);
        expect(e.inTrial).toBe(true);
        expect(e.activePlan).toBe(false);
        expect(e.trialDaysLeft).toBeGreaterThan(0);
        expect(e.trialDaysLeft).toBeLessThanOrEqual(3);
    });

    test('an expired trial is not entitled', () => {
        const e = getEntitlement({ status: 'NONE', trialEndsAt: inDays(-1) } as any);
        expect(e.entitled).toBe(false);
        expect(e.inTrial).toBe(false);
        expect(e.trialDaysLeft).toBe(0);
    });

    test('CANCELLED without a trial is not entitled', () => {
        expect(isEntitled({ status: 'CANCELLED' } as any)).toBe(false);
    });
});

// --- requireEntitlement middleware ---
const mockFindActiveSubscription = vi.fn();
vi.mock('@restropulse/db', async (importOriginal) => {
    const actual = await importOriginal() as any;
    return { ...actual, findActiveSubscription: mockFindActiveSubscription };
});
const { requireEntitlement } = await import('../../src/middleware/require-entitlement.js');

function mockRes() {
    const res: any = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res;
}

// requireEntitlement is typed as a (void-returning) RequestHandler but is async;
// wrap so the returned promise is awaited before assertions run.
const run = (req: any, res: any, next: any): Promise<void> =>
    Promise.resolve(requireEntitlement(req, res, next) as unknown as Promise<void>);

describe('requireEntitlement middleware', () => {
    beforeEach(() => vi.clearAllMocks());

    test('calls next() when the plan is active', async () => {
        mockFindActiveSubscription.mockResolvedValue({ status: 'ACTIVE' });
        const req: any = { user: { restaurantId: 'r1' } };
        const res = mockRes();
        const next = vi.fn();
        await run(req, res, next);
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
    });

    test('calls next() during an active trial', async () => {
        mockFindActiveSubscription.mockResolvedValue({ status: 'NONE', trialEndsAt: inDays(1) });
        const req: any = { user: { restaurantId: 'r1' } };
        const res = mockRes();
        const next = vi.fn();
        await run(req, res, next);
        expect(next).toHaveBeenCalledTimes(1);
    });

    test('returns 403 UPGRADE_REQUIRED when neither trialing nor subscribed', async () => {
        mockFindActiveSubscription.mockResolvedValue({ status: 'NONE', trialEndsAt: inDays(-1) });
        const req: any = { user: { restaurantId: 'r1' } };
        const res = mockRes();
        const next = vi.fn();
        await run(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'UPGRADE_REQUIRED' }));
        expect(next).not.toHaveBeenCalled();
    });
});
