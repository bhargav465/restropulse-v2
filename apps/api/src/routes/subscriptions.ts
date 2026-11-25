/**
 * Owner-facing subscription routes. Billing is manual (no payment gateway):
 * an owner requests a plan here, the RestroPulse team arranges payment, and a
 * platform admin activates it through /api/platform-admin/billing.
 */
import express, { Request, Response } from 'express';
import {
    findCurrentPlans,
    findPlanBySlug,
    findActiveSubscription,
    updateSubscription,
    getWeeklyPostCounts,
} from '@restropulse/db';
import {
    ApiResponse,
    SubscriptionPlan,
    PlanUsage,
    PLATFORM_POST_TYPES,
    Platform,
} from '@restropulse/shared';
import { handle } from '../middleware/async-handler.js';
import { requireAuth } from '../middleware/auth.js';
import { getEntitlement } from '../lib/entitlement.js';
import { checkCoupon, hasActivePaidPlan, hasLivePaidPlan } from '../services/billing/manual-billing.js';
import { createLogger, trackEvent } from '@restropulse/telemetry/server';

const log = createLogger('subscriptions');

const router = express.Router();

// GET /plans -- public, current plan catalogue
router.get('/plans', handle(async (_req: Request, res: Response<ApiResponse<SubscriptionPlan[]>>) => {
    const plans = await findCurrentPlans();
    res.json({ success: true, data: plans });
}));

// GET /current -- requireAuth, active subscription + weekly usage
router.get('/current', requireAuth, handle(async (req: Request, res: Response<ApiResponse>) => {
    const restaurantId = req.user!.restaurantId;
    const subscription = await findActiveSubscription(restaurantId);

    if (!subscription) {
        return res.json({ success: true, data: { subscription: null, usage: null, entitlement: getEntitlement(null) } });
    }

    let usage: PlanUsage | null = null;
    if (subscription.planSnapshot?.limits) {
        const counts = await getWeeklyPostCounts(restaurantId);
        const weeklyLimits = subscription.planSnapshot.limits.weekly;
        usage = {};
        for (const [platform, typeLimits] of Object.entries(weeklyLimits)) {
            const p = platform as Platform;
            const validTypes = PLATFORM_POST_TYPES[p] || [];
            usage[p] = {};
            for (const postType of validTypes) {
                const limit = typeLimits[postType] ?? 0;
                const used = counts[p]?.[postType] ?? 0;
                usage[p]![postType] = { used, limit };
            }
        }
    }

    res.json({ success: true, data: { subscription, usage, entitlement: getEntitlement(subscription) } });
}));

// POST /subscribe -- requireAuth, request a plan when none is active
router.post('/subscribe', requireAuth, handle(async (req: Request, res: Response<ApiResponse>) => {
    const restaurantId = req.user!.restaurantId;
    const { planSlug, couponCode } = req.body ?? {};

    if (!planSlug || typeof planSlug !== 'string') {
        return res.status(400).json({ success: false, error: 'planSlug is required' });
    }

    const plan = await findPlanBySlug(planSlug);
    if (!plan) {
        return res.status(404).json({ success: false, error: 'Plan not found' });
    }

    if (couponCode !== undefined && couponCode !== null && couponCode !== '') {
        if (typeof couponCode !== 'string') {
            return res.status(400).json({ success: false, error: 'Invalid coupon code' });
        }
        const check = await checkCoupon(couponCode, restaurantId, planSlug);
        if (!check.ok) return res.status(400).json({ success: false, error: check.error });
    }

    const existing = await findActiveSubscription(restaurantId);
    if (!existing) {
        // Every restaurant gets a subscription document at onboarding.
        return res.status(400).json({ success: false, error: 'No subscription record found for this restaurant' });
    }
    if (hasLivePaidPlan(existing) && !existing.cancelAtPeriodEnd) {
        return res.status(409).json({ success: false, error: 'An active subscription already exists. Use change-plan to switch plans.' });
    }

    await updateSubscription(existing.id, {
        pendingPlanId: plan.id,
        pendingPlanSnapshot: plan,
        planRequestedAt: new Date().toISOString(),
        couponCode: couponCode || undefined,
    });

    log.info({ restaurantId, planSlug, couponCode: couponCode || null, previous: existing.pendingPlanSnapshot?.slug ?? null }, 'subscribe: plan requested');
    trackEvent('subscription.requested', { restaurantId, planSlug });

    res.json({ success: true, data: { requested: true, planName: plan.name } });
}));

// POST /change-plan -- requireAuth, request a switch from the active plan
router.post('/change-plan', requireAuth, handle(async (req: Request, res: Response<ApiResponse>) => {
    const restaurantId = req.user!.restaurantId;
    const { planSlug } = req.body ?? {};

    if (!planSlug || typeof planSlug !== 'string') {
        return res.status(400).json({ success: false, error: 'planSlug is required' });
    }

    const existing = await findActiveSubscription(restaurantId);
    if (!existing || !hasActivePaidPlan(existing)) {
        return res.status(400).json({ success: false, error: 'No active subscription to change' });
    }
    const lapsed = !hasLivePaidPlan(existing);

    const plan = await findPlanBySlug(planSlug);
    if (!plan) {
        return res.status(404).json({ success: false, error: 'Plan not found' });
    }

    if (existing.planSnapshot?.slug === plan.slug && !lapsed) {
        // Asking for the plan they're on clears any other request.
        if (existing.pendingPlanSnapshot) {
            await updateSubscription(existing.id, { pendingPlanId: undefined, pendingPlanSnapshot: null, planRequestedAt: null, couponCode: undefined });
        }
        return res.json({ success: true, data: { requested: false, planName: plan.name } });
    }

    // A coupon from an earlier request doesn't carry over to a plan switch.
    await updateSubscription(existing.id, {
        pendingPlanId: plan.id,
        pendingPlanSnapshot: plan,
        planRequestedAt: new Date().toISOString(),
        couponCode: undefined,
    });

    log.info({ restaurantId, from: existing.planSnapshot?.slug, to: plan.slug }, 'change-plan: switch requested');
    trackEvent('subscription.change_requested', { restaurantId, from: existing.planSnapshot?.slug ?? '', to: plan.slug });

    res.json({ success: true, data: { requested: true, planName: plan.name } });
}));

// POST /withdraw-request -- requireAuth, drop a pending plan request and nothing else
router.post('/withdraw-request', requireAuth, handle(async (req: Request, res: Response<ApiResponse>) => {
    const restaurantId = req.user!.restaurantId;
    const existing = await findActiveSubscription(restaurantId);
    if (!existing || !existing.pendingPlanSnapshot) {
        return res.status(400).json({ success: false, error: 'There is no plan request to withdraw' });
    }
    await updateSubscription(existing.id, { pendingPlanId: undefined, pendingPlanSnapshot: null, planRequestedAt: null, couponCode: undefined });
    log.info({ restaurantId, withdrawn: existing.pendingPlanSnapshot.slug }, 'withdraw-request: plan request withdrawn');
    res.json({ success: true, data: { withdrawn: true } });
}));

// POST /cancel -- requireAuth. An active plan ends with its paid period; any
// pending request is withdrawn. With no active plan, withdraws the request.
router.post('/cancel', requireAuth, handle(async (req: Request, res: Response<ApiResponse>) => {
    const restaurantId = req.user!.restaurantId;
    const subscription = await findActiveSubscription(restaurantId);

    if (!subscription) {
        return res.status(400).json({ success: false, error: 'No active subscription to cancel' });
    }

    const clearRequest = { pendingPlanId: undefined, pendingPlanSnapshot: null, planRequestedAt: null, couponCode: undefined };

    if (!hasActivePaidPlan(subscription)) {
        if (!subscription.pendingPlanSnapshot) {
            return res.status(400).json({ success: false, error: 'No active subscription to cancel' });
        }
        await updateSubscription(subscription.id, clearRequest);
        log.info({ restaurantId }, 'cancel: plan request withdrawn');
        return res.json({ success: true, message: 'Plan request withdrawn' });
    }

    if (subscription.cancelAtPeriodEnd && !subscription.pendingPlanSnapshot) {
        return res.json({ success: true, message: 'Subscription is already scheduled for cancellation' });
    }

    if (!subscription.currentPeriodEnd) {
        await updateSubscription(subscription.id, {
            ...clearRequest,
            status: 'CANCELLED',
            cancelAtPeriodEnd: false,
            cancelledAt: new Date().toISOString(),
        });
        log.info({ restaurantId }, 'cancel: no paid period, cancelled now');
        return res.json({ success: true, message: 'Subscription cancelled' });
    }

    await updateSubscription(subscription.id, {
        ...clearRequest,
        cancelAtPeriodEnd: true,
        cancelledAt: new Date().toISOString(),
    });
    log.info({ restaurantId, periodEnd: subscription.currentPeriodEnd }, 'cancel: scheduled at period end');
    trackEvent('subscription.cancel_scheduled', { restaurantId });

    res.json({ success: true, message: 'Subscription will cancel at the end of the current billing period' });
}));

// POST /reactivate -- requireAuth, undo a scheduled cancellation
router.post('/reactivate', requireAuth, handle(async (req: Request, res: Response<ApiResponse>) => {
    const restaurantId = req.user!.restaurantId;
    const existing = await findActiveSubscription(restaurantId);

    if (!existing || !hasActivePaidPlan(existing) || !existing.cancelAtPeriodEnd) {
        return res.status(400).json({ success: false, error: 'Subscription is not pending cancellation' });
    }

    await updateSubscription(existing.id, { cancelAtPeriodEnd: false, cancelledAt: undefined });
    log.info({ restaurantId }, 'reactivate: scheduled cancellation undone');
    res.json({ success: true, data: { reactivated: true } });
}));

export default router;
