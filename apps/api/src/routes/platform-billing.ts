/**
 * Platform admin billing (manual, no payment gateway). RestroPulse staff with
 * the ADMIN role see plan requests, switch a plan on once payment has been
 * arranged with the restaurant, and add credit top-ups.
 *
 *   GET  /requests                              plan requests waiting, oldest first
 *   POST /restaurants/:restaurantId/activate    { planSlug?, months? } switch a plan on / renew
 *   POST /restaurants/:restaurantId/credits     { credits } add credits
 */
import express, { Request, Response } from 'express';
import {
    addCredits,
    findActiveSubscription,
    findPlanBySlug,
    findSubscriptionsWithPendingPlan,
    updateSubscription,
} from '@restropulse/db';
import type { ApiResponse } from '@restropulse/shared';
import { handle } from '../middleware/async-handler.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/require-role.js';
import { checkCoupon, nextPeriod, recordCouponRedemption } from '../services/billing/manual-billing.js';
import { createLogger, trackEvent } from '@restropulse/telemetry/server';

const log = createLogger('platform-billing');
const router = express.Router();

router.use(requireAuth, requireRole('ADMIN'));

const MAX_MONTHS = 36;
const MAX_CREDITS = 100_000;

router.get('/requests', handle(async (_req: Request, res: Response<ApiResponse>) => {
    const subs = await findSubscriptionsWithPendingPlan();
    res.json({
        success: true,
        data: subs.map((s) => ({
            restaurantId: s.restaurantId,
            subscriptionId: s.id,
            status: s.status,
            currentPlan: s.planSnapshot ? { slug: s.planSnapshot.slug, name: s.planSnapshot.name } : null,
            currentPeriodEnd: s.currentPeriodEnd ?? null,
            requestedPlan: s.pendingPlanSnapshot
                ? { slug: s.pendingPlanSnapshot.slug, name: s.pendingPlanSnapshot.name, monthlyPaise: s.pendingPlanSnapshot.pricing?.monthly ?? 0 }
                : null,
            couponCode: s.couponCode ?? null,
            requestedAt: s.planRequestedAt ?? null,
        })),
    });
}));

router.post('/restaurants/:restaurantId/activate', handle(async (req: Request, res: Response<ApiResponse>) => {
    const { restaurantId } = req.params;
    const { planSlug, months: rawMonths } = req.body ?? {};
    const months = rawMonths === undefined ? 1 : Number(rawMonths);
    if (!Number.isInteger(months) || months < 1 || months > MAX_MONTHS) {
        return res.status(400).json({ success: false, error: `months must be a whole number from 1 to ${MAX_MONTHS}` });
    }
    if (planSlug !== undefined && typeof planSlug !== 'string') {
        return res.status(400).json({ success: false, error: 'planSlug must be a string' });
    }

    const sub = await findActiveSubscription(restaurantId);
    if (!sub) return res.status(404).json({ success: false, error: 'No subscription for this restaurant' });

    const slug = planSlug || sub.pendingPlanSnapshot?.slug || sub.planSnapshot?.slug;
    if (!slug) {
        return res.status(400).json({ success: false, error: 'No plan requested; pass planSlug' });
    }
    const plan = await findPlanBySlug(slug);
    if (!plan) return res.status(404).json({ success: false, error: 'Plan not found' });

    const { start, end } = nextPeriod(sub, plan.slug, months);
    // The owner's coupon applies only to the plan they asked for, and only if
    // it is still valid now.
    let couponCode: string | undefined;
    if (sub.couponCode && sub.pendingPlanSnapshot?.slug === plan.slug) {
        const check = await checkCoupon(sub.couponCode, restaurantId, plan.slug);
        if (check.ok) couponCode = sub.couponCode;
        else log.warn({ restaurantId, couponCode: sub.couponCode, reason: check.error }, 'activate: coupon no longer valid, not applied');
    }

    const updated = await updateSubscription(sub.id, {
        planId: plan.id,
        planSnapshot: plan,
        billingCycle: 'MONTHLY',
        status: 'ACTIVE',
        currentPeriodStart: start.toISOString(),
        currentPeriodEnd: end.toISOString(),
        cancelAtPeriodEnd: false,
        cancelledAt: undefined,
        pendingPlanId: undefined,
        pendingPlanSnapshot: null,
        planRequestedAt: null,
        couponCode,
    });
    if (!updated) return res.status(409).json({ success: false, error: 'The subscription changed while activating. Try again.' });

    if (couponCode) {
        try {
            await recordCouponRedemption(updated, plan, couponCode);
        } catch (err) {
            log.warn({ err, restaurantId, couponCode }, 'activate: coupon redemption not recorded');
        }
    }

    log.info({ restaurantId, planSlug: plan.slug, months, periodEnd: end.toISOString(), by: req.user!.userId }, 'activate: plan switched on');
    trackEvent('subscription.activated', { restaurantId, planSlug: plan.slug, months: String(months) });
    res.json({ success: true, data: { subscription: updated } });
}));

router.post('/restaurants/:restaurantId/credits', handle(async (req: Request, res: Response<ApiResponse>) => {
    const { restaurantId } = req.params;
    const credits = Number(req.body?.credits);
    if (!Number.isInteger(credits) || credits < 1 || credits > MAX_CREDITS) {
        return res.status(400).json({ success: false, error: `credits must be a whole number from 1 to ${MAX_CREDITS}` });
    }
    const sub = await findActiveSubscription(restaurantId);
    if (!sub) return res.status(404).json({ success: false, error: 'No subscription for this restaurant' });

    const ok = await addCredits(sub.id, credits);
    if (!ok) return res.status(500).json({ success: false, error: 'Could not add credits' });

    log.info({ restaurantId, credits, by: req.user!.userId }, 'credits: added');
    trackEvent('credits.added', { restaurantId, credits: String(credits) });
    const fresh = await findActiveSubscription(restaurantId);
    res.json({ success: true, data: { credits: fresh?.credits ?? (sub.credits ?? 0) + credits } });
}));

export default router;
