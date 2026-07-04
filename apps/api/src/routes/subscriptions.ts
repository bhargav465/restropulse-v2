import express, { Request, Response } from 'express';
import {
    findCurrentPlans,
    findPlanBySlug,
    findActiveSubscription,
    createSubscription,
    updateSubscription,
    findSubscriptionByRazorpayId,
    findSubscriptionByPendingRazorpayId,
    getWeeklyPostCounts,
    addCredits,
    findCreditPackById,
    createCreditPurchase,
    findCreditPurchaseByOrderId,
    updateCreditPurchase,
    findCouponByCode,
    incrementCouponRedemptions,
    createCouponRedemption,
    hasRestaurantRedeemedCoupon,
    createInvoice,
    findInvoiceByPaymentId,
    findInvoicesByRazorpaySubscriptionId,
    findUserById,
    findUserByRestaurantId,
    updateUser,
} from '@restropulse/db';
import {
    ApiResponse,
    SubscriptionPlan,
    Subscription,
    PlanUsage,
    POST_TYPE_CREDIT_COSTS,
    PLATFORM_POST_TYPES,
    Platform,
} from '@restropulse/shared';
import { handle } from '../middleware/async-handler.js';
import { requireAuth } from '../middleware/auth.js';
import {
    createRazorpaySubscription,
    cancelRazorpaySubscription,
    updateRazorpaySubscription,
    listRazorpaySubscriptionsForCustomer,
    createRazorpayOrder,
    verifyWebhookSignature,
    verifyPaymentSignature,
    verifySubscriptionSignature,
    getRazorpayKeyId,
    isRazorpayConfigured,
    createRazorpayCustomer,
    fetchRazorpayCustomersByContact,
    fetchRazorpayInvoice,
    fetchRazorpaySubscription,
    fetchRazorpayPayment,
} from '../services/razorpay.js';
import { createLogger, trackEvent } from '@restropulse/telemetry/server';
// strategy-sync is no longer called from webhooks — cycle creation is owned
// by the content-engine cycle-sync-processor cron.

const log = createLogger('subscriptions');

const router = express.Router();

// Status rank prevents regression — a webhook may have already advanced
// the DB past what a stale Razorpay read returns.
const SUBSCRIPTION_STATUS_RANK = {
    NONE: 0,
    CREATED: 1,
    AUTHENTICATED: 2,
    ACTIVE: 3,
    PAST_DUE: 3,
    HALTED: 4,
    CANCELLED: 5,
} as const satisfies Record<Subscription['status'], number>;

function mapRazorpayStatus(rzpStatus: string): Subscription['status'] {
    switch (rzpStatus) {
        case 'active': return 'ACTIVE';
        case 'authenticated': return 'AUTHENTICATED';
        case 'pending': return 'PAST_DUE';
        case 'halted': return 'HALTED';
        case 'cancelled':
        case 'completed':
        case 'expired':
            return 'CANCELLED';
        default:
            return 'CREATED';
    }
}

// Materialize a local subscription record from verified Razorpay state.
// Idempotent: if a doc already exists for this razorpaySubscriptionId, just advances
// status; otherwise archives the existing active doc (if any) and inserts a fresh
// record. This is the ONE place that turns a Razorpay subscription into our DB record;
// /subscribe, /reactivate, and /change-plan upgrade paths intentionally do nothing
// to the DB — they only create the Razorpay subscription and return its ID. The local
// doc is created here, after /verify or the subscription.charged webhook has confirmed
// the payment was authorized. This prevents abandoned/failed checkouts from corrupting
// state (B4) and prevents double-charges from re-clicking Subscribe on a stuck-pending
// subscription (B1).
//
// Notes on the Razorpay subscription should carry:
//   - planSlug: which of our plans this maps to
//   - couponCode (optional): for redemption tracking on subscription.activated
async function materializeSubscriptionFromRazorpay(params: {
    restaurantId: string;
    razorpaySubscriptionId: string;
    rzpSub: { id: string; status: string; current_start: number | null; current_end: number | null; customer_id?: string; plan_id: string; notes?: Record<string, string> };
}): Promise<Subscription> {
    const { restaurantId, razorpaySubscriptionId, rzpSub } = params;

    const periodStart = rzpSub.current_start ? new Date(rzpSub.current_start * 1000).toISOString() : undefined;
    const periodEnd = rzpSub.current_end ? new Date(rzpSub.current_end * 1000).toISOString() : undefined;
    const mappedStatus = mapRazorpayStatus(rzpSub.status);

    // Path A: doc already exists for this Razorpay sub (as the active sub ID) — advance status.
    const existingByRzp = await findSubscriptionByRazorpayId(razorpaySubscriptionId);
    if (existingByRzp) {
        const currentRank = SUBSCRIPTION_STATUS_RANK[existingByRzp.status] ?? 0;
        const mappedRank = SUBSCRIPTION_STATUS_RANK[mappedStatus] ?? 0;
        const finalStatus: Subscription['status'] = mappedRank >= currentRank ? mappedStatus : existingByRzp.status;
        await updateSubscription(existingByRzp.id, {
            status: finalStatus,
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
            razorpayCustomerId: rzpSub.customer_id,
            ...(finalStatus === 'ACTIVE' ? { cancelAtPeriodEnd: false, cancelledAt: undefined } : {}),
        });
        return { ...existingByRzp, status: finalStatus, currentPeriodStart: periodStart, currentPeriodEnd: periodEnd } as Subscription;
    }

    // Path A2: this Razorpay sub is stored as pendingRazorpaySubscriptionId on an active
    // doc (set during a deferred plan change). If it's now ACTIVE (cycle_end charge fired),
    // promote the pending plan to the live plan. If it's still AUTHENTICATED/CREATED
    // (subscription.authenticated webhook racing with /verify), return the doc unchanged.
    const existingByPendingRzp = await findSubscriptionByPendingRazorpayId(razorpaySubscriptionId);
    if (existingByPendingRzp) {
        if (mappedStatus === 'ACTIVE') {
            await updateSubscription(existingByPendingRzp.id, {
                status: 'ACTIVE',
                planId: existingByPendingRzp.pendingPlanId,
                planSnapshot: existingByPendingRzp.pendingPlanSnapshot,
                razorpaySubscriptionId,
                currentPeriodStart: periodStart,
                currentPeriodEnd: periodEnd,
                razorpayCustomerId: rzpSub.customer_id,
                cancelAtPeriodEnd: false,
                cancelledAt: undefined,
                pendingPlanId: undefined,
                pendingPlanSnapshot: null,
                pendingRazorpaySubscriptionId: null,
            });
            log.info(
                { restaurantId, newPlan: existingByPendingRzp.pendingPlanSnapshot?.slug, razorpaySubscriptionId },
                'materialize: deferred plan change charged — promoted pending plan to active',
            );
            return {
                ...existingByPendingRzp,
                status: 'ACTIVE',
                planId: existingByPendingRzp.pendingPlanId,
                planSnapshot: existingByPendingRzp.pendingPlanSnapshot,
                razorpaySubscriptionId,
                currentPeriodStart: periodStart,
                currentPeriodEnd: periodEnd,
                cancelAtPeriodEnd: false,
                pendingPlanId: undefined,
                pendingPlanSnapshot: null,
                pendingRazorpaySubscriptionId: null,
            } as Subscription;
        }
        // Still AUTHENTICATED/CREATED — deferred sub not yet charged; nothing to promote.
        return existingByPendingRzp;
    }

    // Path B: no local doc yet for this Razorpay sub. Resolve the plan from notes.
    const planSlug = rzpSub.notes?.planSlug;
    if (!planSlug) {
        // Razorpay fired the webhook before /subscribe stamped the notes.
        // Return 500 so Razorpay retries; /verify will materialise the doc when
        // the user returns from checkout.
        throw new Error(
            `materialize: Razorpay subscription ${razorpaySubscriptionId} has no planSlug note — ` +
            `webhook may have arrived before /subscribe completed. Razorpay will retry.`
        );
    }
    const plan = await findPlanBySlug(planSlug);
    if (!plan) {
        // Subscription plans not seeded in DB, or slug mismatch.
        // Run: npm run seed --workspace=@restropulse/db-cli to seed plans.
        throw new Error(
            `materialize: plan "${planSlug}" not found in subscriptionPlans collection ` +
            `(isCurrentVersion=true). Ensure plans are seeded via db-cli before accepting subscriptions.`
        );
    }

    const existingActive = await findActiveSubscription(restaurantId);

    // Path B1 — Deferred resubscribe to the SAME plan (Keep-current-plan / /reactivate).
    // The existing local doc holds the user's actual paid period; we MUST preserve it.
    // The new Razorpay sub is the next-cycle billing arrangement (AUTHENTICATED, start_at=period_end).
    // Per the invariant: razorpaySubscriptionId must always point to the sub with an active
    // billing period. The deferred sub has no period yet, so it parks in pendingRazorpaySubscriptionId
    // until subscription.charged fires and Path A2 promotes it. This prevents /cancel from
    // getting the "no billing cycle" error from Razorpay.
    if (existingActive
        && existingActive.cancelAtPeriodEnd
        && existingActive.planSnapshot?.slug === planSlug
        && existingActive.status === 'ACTIVE'
        && (mappedStatus === 'AUTHENTICATED' || mappedStatus === 'CREATED')
    ) {
        await updateSubscription(existingActive.id, {
            pendingRazorpaySubscriptionId: razorpaySubscriptionId,
            razorpayCustomerId: rzpSub.customer_id,
            cancelAtPeriodEnd: false,
            cancelledAt: undefined,
            pendingPlanId: undefined,
            pendingPlanSnapshot: null,
            // razorpaySubscriptionId intentionally NOT updated — still the live billing sub
        });
        log.info(
            { restaurantId, liveRzpId: existingActive.razorpaySubscriptionId, pendingRzpId: razorpaySubscriptionId, planSlug },
            'materialize: same-plan reactivation — parked deferred sub in pending slot (live billing ref preserved)',
        );
        return {
            ...existingActive,
            pendingRazorpaySubscriptionId: razorpaySubscriptionId,
            razorpayCustomerId: rzpSub.customer_id,
            cancelAtPeriodEnd: false,
            cancelledAt: undefined,
            pendingPlanId: undefined,
            pendingPlanSnapshot: null,
        } as Subscription;
    }

    // Path B3 — Deferred plan change to a DIFFERENT plan.
    // Detected by the 'deferred: 1' note stamped by prepareCancelAndFutureSubscribe when
    // mode=cycle_end. Using the note (not cancelAtPeriodEnd in the local doc) is
    // reliable because: (a) the local DB may not yet reflect the Razorpay cancel-at-cycle-end
    // call, and (b) an immediate mode=now upgrade can also briefly be AUTHENTICATED at
    // /verify time — the note is the only unambiguous signal.
    // Preserve the current ACTIVE doc, store the pending plan + deferred Razorpay sub ID,
    // and set cancelAtPeriodEnd=true so the DB matches Razorpay state.
    // When the deferred sub charges at cycle_end, subscription.charged calls this function
    // again and Path A2 promotes the pending plan to the active plan.
    if (existingActive
        && existingActive.status === 'ACTIVE'
        && existingActive.planSnapshot?.slug !== planSlug
        && (mappedStatus === 'AUTHENTICATED' || mappedStatus === 'CREATED')
        && rzpSub.notes?.deferred === '1'
    ) {
        await updateSubscription(existingActive.id, {
            pendingPlanId: plan.id,
            pendingPlanSnapshot: plan,
            pendingRazorpaySubscriptionId: razorpaySubscriptionId,
            cancelAtPeriodEnd: true,
            razorpayCustomerId: rzpSub.customer_id ?? existingActive.razorpayCustomerId,
        });
        log.info(
            { restaurantId, currentPlan: existingActive.planSnapshot?.slug, pendingPlan: planSlug, pendingRzpId: razorpaySubscriptionId },
            'materialize: deferred plan change — stored pending plan on existing active doc',
        );
        return {
            ...existingActive,
            pendingPlanId: plan.id,
            pendingPlanSnapshot: plan,
            pendingRazorpaySubscriptionId: razorpaySubscriptionId,
            cancelAtPeriodEnd: true,
        } as Subscription;
    }

    // Path B4 — Different plan or fresh subscription. Archive the existing active sub
    // (if any) and insert a fresh record reflecting the new Razorpay state.
    const preservedCredits = existingActive && existingActive.status !== 'NONE' ? (existingActive.credits ?? 0) : 0;
    const couponCode = rzpSub.notes?.couponCode || undefined;

    const now = new Date();
    if (existingActive) {
        await updateSubscription(existingActive.id, { endedAt: now.toISOString() });
    }
    const fresh = await createSubscription({
        restaurantId,
        planId: plan.id,
        planSnapshot: plan,
        billingCycle: 'MONTHLY',
        status: mappedStatus,
        razorpaySubscriptionId,
        razorpayCustomerId: rzpSub.customer_id,
        credits: preservedCredits,
        couponCode,
        currentPeriodStart: periodStart || now.toISOString(),
        currentPeriodEnd: periodEnd,
    } as Omit<Subscription, 'id'>);

    log.info(
        { restaurantId, razorpaySubscriptionId, planSlug, mappedStatus, archivedId: existingActive?.id ?? null },
        'materialize: local subscription record created from verified Razorpay state',
    );
    return fresh;
}

// Reconcile a transitional subscription against live Razorpay state.
// Returns the (possibly updated) subscription. Idempotent and safe to call from /current.
async function reconcileSubscriptionWithRazorpay(sub: Subscription): Promise<Subscription> {
    const isTransitional = sub.status === 'CREATED' || sub.status === 'AUTHENTICATED';
    if (!isTransitional || !sub.razorpaySubscriptionId) {
        return sub;
    }

    let rzpSub;
    try {
        rzpSub = await fetchRazorpaySubscription(sub.razorpaySubscriptionId);
    } catch (err) {
        // Don't fail /current on Razorpay outages — return the stale DB state
        // and let the UI keep polling.
        log.warn(
            { err, razorpaySubscriptionId: sub.razorpaySubscriptionId, subscriptionId: sub.id },
            'reconcile: Razorpay fetch failed, returning DB state',
        );
        return sub;
    }

    const mappedStatus = mapRazorpayStatus(rzpSub.status);
    const currentRank = SUBSCRIPTION_STATUS_RANK[sub.status] ?? 0;
    const mappedRank = SUBSCRIPTION_STATUS_RANK[mappedStatus] ?? 0;
    if (mappedRank <= currentRank) {
        return sub;
    }

    const periodStart = rzpSub.current_start ? new Date(rzpSub.current_start * 1000).toISOString() : undefined;
    // For deferred subs (authenticated, start_at in future), current_end is null.
    // Derive currentPeriodEnd from start_at so the change-plan gate has a value
    // and the UI can show "renews on {date}" instead of nothing.
    const periodEnd = rzpSub.current_end
        ? new Date(rzpSub.current_end * 1000).toISOString()
        : rzpSub.start_at
            ? new Date(rzpSub.start_at * 1000).toISOString()
            : undefined;
    const update: Partial<Subscription> = {
        status: mappedStatus,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        razorpayCustomerId: rzpSub.customer_id,
        ...(mappedStatus === 'ACTIVE' ? { cancelAtPeriodEnd: false, cancelledAt: undefined } : {}),
    };
    await updateSubscription(sub.id, update);
    log.info(
        { subscriptionId: sub.id, from: sub.status, to: mappedStatus },
        'reconcile: subscription status advanced via /current',
    );

    return { ...sub, ...update } as Subscription;
}

// GET /plans -- public, list current plans
router.get('/plans', handle(async (_req: Request, res: Response<ApiResponse<SubscriptionPlan[]>>) => {
    const plans = await findCurrentPlans();
    res.json({ success: true, data: plans });
}));

// GET /current -- requireAuth, active subscription + weekly usage
router.get('/current', requireAuth, handle(async (req: Request, res: Response<ApiResponse>) => {
    const restaurantId = req.user!.restaurantId;
    const stored = await findActiveSubscription(restaurantId);

    if (!stored) {
        return res.json({ success: true, data: { subscription: null, usage: null } });
    }

    // Reconcile transitional state against Razorpay so the UI never gets stuck on
    // "Activating..." when a webhook is delayed or doesn't land (local dev, downtime).
    const subscription = await reconcileSubscriptionWithRazorpay(stored);

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

    res.json({ success: true, data: { subscription, usage } });
}));

// POST /subscribe -- requireAuth, create Razorpay subscription
router.post('/subscribe', requireAuth, handle(async (req: Request, res: Response<ApiResponse>) => {
    if (!isRazorpayConfigured()) {
        return res.status(503).json({ success: false, error: 'Payment service is not configured' });
    }

    const restaurantId = req.user!.restaurantId;
    const { planSlug, couponCode } = req.body;
    const billingCycle = 'MONTHLY';

    if (!planSlug) {
        return res.status(400).json({ success: false, error: 'planSlug is required' });
    }

    const plan = await findPlanBySlug(planSlug);
    if (!plan) {
        return res.status(404).json({ success: false, error: 'Plan not found' });
    }

    const razorpayPlanId = plan.razorpayPlanIds.monthly;

    if (!razorpayPlanId) {
        return res.status(400).json({ success: false, error: 'Razorpay plan not configured' });
    }

    // Validate coupon if provided
    let offerId: string | undefined;
    if (couponCode) {
        const coupon = await findCouponByCode(couponCode);
        if (!coupon) {
            return res.status(400).json({ success: false, error: 'Invalid coupon code' });
        }

        if (coupon.status !== 'ACTIVE') {
            return res.status(400).json({ success: false, error: 'Coupon is not active' });
        }

        if (coupon.validUntil && new Date(coupon.validUntil) < new Date()) {
            return res.status(400).json({ success: false, error: 'Coupon has expired' });
        }

        if (coupon.maxRedemptions && coupon.redemptionCount >= coupon.maxRedemptions) {
            return res.status(400).json({ success: false, error: 'Coupon has been fully redeemed' });
        }

        if (coupon.assignedTo && coupon.assignedTo !== restaurantId) {
            return res.status(400).json({ success: false, error: 'Invalid coupon code' });
        }

        if (coupon.applicablePlans && coupon.applicablePlans.length > 0 && !coupon.applicablePlans.includes(planSlug)) {
            return res.status(400).json({ success: false, error: 'Coupon is not applicable to this plan' });
        }

        const alreadyRedeemed = await hasRestaurantRedeemedCoupon(coupon.id, restaurantId);
        if (alreadyRedeemed) {
            return res.status(400).json({ success: false, error: 'Coupon already redeemed by this restaurant' });
        }

        offerId = coupon.razorpayOfferId;
    }

    // Duplicate-subscription guard. /subscribe is for moving from "no plan" to "any plan",
    // or for re-subscribing after a CANCELLED state. Active subs use /change-plan to switch.
    //
    // B1 fix: AUTHENTICATED is no longer treated as "unpaid checkout safe to replace".
    // Razorpay's `authenticated` status means the first charge has been (or will imminently
    // be) attempted, so destroying it could orphan a paid subscription. We only allow
    // replacement when there are NO paid invoices for the existing Razorpay sub.
    const existingCheck = await findActiveSubscription(restaurantId);
    if (existingCheck && ['ACTIVE', 'PAST_DUE'].includes(existingCheck.status) && !existingCheck.cancelAtPeriodEnd) {
        return res.status(409).json({ success: false, error: 'An active subscription already exists. Use change-plan to switch plans.' });
    }
    if (existingCheck && (existingCheck.status === 'CREATED' || existingCheck.status === 'AUTHENTICATED') && existingCheck.razorpaySubscriptionId) {
        // In-flight checkout. If any invoices were paid for that Razorpay sub, refuse —
        // the user has been billed and the prior /subscribe shouldn't be replaced.
        const paidInvoices = await findInvoicesByRazorpaySubscriptionId(existingCheck.razorpaySubscriptionId);
        if (paidInvoices.some((i: any) => i.status === 'paid')) {
            return res.status(409).json({ success: false, error: 'Existing subscription has been billed. Please refresh the page.' });
        }
        // Otherwise the prior checkout was abandoned/failed. Cancel that stale Razorpay
        // sub so it doesn't sit orphaned in Razorpay forever.
        try {
            await cancelRazorpaySubscription(existingCheck.razorpaySubscriptionId, false);
        } catch (cancelErr) {
            const msg = ((cancelErr as Error).message || '').toLowerCase();
            const alreadyTerminal = msg.includes('already cancelled') || msg.includes('completed') || msg.includes('not in an active state');
            if (!alreadyTerminal) {
                log.warn({ err: cancelErr, razorpaySubscriptionId: existingCheck.razorpaySubscriptionId }, 'Could not cancel stale Razorpay sub; proceeding');
            }
        }
    }

    const totalCount = 120;

    // Reuse existing Razorpay customer (created at onboarding); create one if missing
    const user = await findUserById(req.user!.userId);
    let customerId: string | undefined = user?.razorpayCustomerId;
    if (!customerId && user?.email) {
        try {
            const customer = await createRazorpayCustomer(user.name, user.email, user.phone);
            customerId = customer.id;
            await updateUser(req.user!.userId, { razorpayCustomerId: customerId });
        } catch (customerErr) {
            const errMsg = (customerErr as Error).message || '';
            if (errMsg.includes('Customer already exists') && user.phone) {
                // Customer exists in Razorpay but not linked in our DB — recover the ID
                try {
                    const existing = await fetchRazorpayCustomersByContact(user.phone);
                    if (existing.items?.[0]?.id) {
                        customerId = existing.items[0].id;
                        await updateUser(req.user!.userId, { razorpayCustomerId: customerId });
                    }
                } catch (fetchErr) {
                    log.warn({ err: fetchErr, userId: req.user!.userId }, 'Failed to fetch existing Razorpay customer; proceeding without customer_id');
                }
            } else {
                log.warn({ err: customerErr, userId: req.user!.userId }, 'Failed to create Razorpay customer; proceeding without customer_id');
            }
        }
    }

    // For re-subscribe from cancelAtPeriodEnd, defer the new sub's first charge until
    // the current paid period ends. Otherwise we'd double-charge during the existing
    // already-paid window.
    const startAt = (existingCheck?.cancelAtPeriodEnd && existingCheck?.currentPeriodEnd)
        ? Math.floor(new Date(existingCheck.currentPeriodEnd).getTime() / 1000)
        : undefined;

    const notes: Record<string, string> = { planSlug, restaurantId, userId: req.user!.userId };
    if (couponCode) notes.couponCode = couponCode;

    log.info(
        {
            restaurantId,
            planSlug,
            billingCycle,
            razorpayPlanId,
            existingStatus: existingCheck?.status ?? 'none',
            pendingPlan: existingCheck?.pendingPlanSnapshot?.slug,
            couponCode: couponCode ?? null,
        },
        'subscribe: creating Razorpay subscription',
    );

    const razorpaySub = await createRazorpaySubscription(razorpayPlanId, totalCount, offerId, customerId, startAt, notes);

    log.info(
        { restaurantId, planSlug, rzpSubId: razorpaySub.id, startAt },
        'subscribe: Razorpay subscription created',
    );

    // B4 fix: do NOT touch the DB here. The local subscription record (which holds
    // free credits, plan metadata, period info) is left alone until /verify or the
    // subscription.charged webhook confirms payment and runs materializeSubscriptionFromRazorpay.
    // If the user closes checkout, no harm done — their existing state is untouched.

    log.info({ restaurantId, planSlug, razorpaySubscriptionId: razorpaySub.id, deferredStartAt: startAt }, 'subscribe: Razorpay subscription created, awaiting checkout completion');

    res.json({
        success: true,
        data: {
            subscriptionId: razorpaySub.id,
            keyId: getRazorpayKeyId(),
        },
    });
}));

// POST /verify -- requireAuth, materialize the local subscription record after a
// successful Razorpay checkout. /subscribe, /reactivate, and /change-plan upgrade paths
// only create the Razorpay subscription; the local DB is left untouched until this
// endpoint (or the subscription.charged webhook) confirms payment.
router.post('/verify', requireAuth, handle(async (req: Request, res: Response<ApiResponse>) => {
    const { razorpayPaymentId, razorpaySubscriptionId, razorpaySignature } = req.body;

    if (!razorpayPaymentId || !razorpaySubscriptionId || !razorpaySignature) {
        return res.status(400).json({ success: false, error: 'Missing payment verification fields' });
    }

    if (!verifySubscriptionSignature(razorpayPaymentId, razorpaySubscriptionId, razorpaySignature)) {
        return res.status(400).json({ success: false, error: 'Payment signature verification failed' });
    }

    const restaurantId = req.user!.restaurantId;

    // Fetch live Razorpay state
    const rzpSub = await fetchRazorpaySubscription(razorpaySubscriptionId);

    // Authorization: the Razorpay subscription's notes must reference this restaurant
    // (this is how we tie a Razorpay sub back to a tenant when the local doc doesn't
    // exist yet). Existing docs are also cross-checked.
    const notedRestaurantId = rzpSub.notes?.restaurantId;
    const existingByRzp = await findSubscriptionByRazorpayId(razorpaySubscriptionId);
    if (existingByRzp && existingByRzp.restaurantId !== restaurantId) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    if (!existingByRzp && notedRestaurantId && notedRestaurantId !== restaurantId) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    const sub = await materializeSubscriptionFromRazorpay({
        restaurantId,
        razorpaySubscriptionId,
        rzpSub,
    });

    // If subscription is now active AND this payment is for the live (non-deferred)
    // Razorpay sub, make sure an invoice exists. Skip when razorpaySubscriptionId is
    // a pending deferred sub (₹5 mandate auth) — that charge has no billing-period
    // invoice; the real invoice is created by subscription.charged at cycle_end.
    if (sub.status === 'ACTIVE' && razorpaySubscriptionId === sub.razorpaySubscriptionId) {
        const existingInvoice = await findInvoiceByPaymentId(razorpayPaymentId);
        if (!existingInvoice) {
            try {
                const payment = await fetchRazorpayPayment(razorpayPaymentId);
                const planName = sub.planSnapshot?.name ?? 'Subscription';
                const cycle = sub.billingCycle || 'MONTHLY';
                const cycleLabel = cycle.charAt(0) + cycle.slice(1).toLowerCase();

                let rzpInvoicePdfUrl: string | undefined;
                if (payment.invoice_id) {
                    try {
                        const rzpInvoice = await fetchRazorpayInvoice(payment.invoice_id);
                        rzpInvoicePdfUrl = rzpInvoice.short_url;
                    } catch (invoiceErr) {
                        log.warn({ err: invoiceErr, rzpInvoiceId: payment.invoice_id }, 'verify: Razorpay invoice PDF fetch failed');
                    }
                }

                await createInvoice({
                    restaurantId: sub.restaurantId,
                    type: 'SUBSCRIPTION',
                    razorpayInvoiceId: payment.invoice_id || undefined,
                    razorpayPaymentId: payment.id,
                    razorpaySubscriptionId,
                    amountPaise: payment.amount || 0,
                    currency: payment.currency || 'INR',
                    status: 'paid',
                    description: `${planName} Plan - ${cycleLabel}`,
                    billingPeriodStart: sub.currentPeriodStart,
                    billingPeriodEnd: sub.currentPeriodEnd,
                    pdfUrl: rzpInvoicePdfUrl,
                    paidAt: new Date(),
                });
            } catch (payErr) {
                // Don't fail verify just because invoice backfill failed — the webhook
                // will eventually create it, and the user's status is already correct.
                log.warn({ err: payErr, razorpayPaymentId }, 'verify: invoice backfill failed (webhook will retry)');
            }
        }

        trackEvent('subscription.verified', {
            subscriptionId: sub.id,
            restaurantId: sub.restaurantId,
            razorpaySubscriptionId,
        });
    }

    res.json({
        success: true,
        data: { status: sub.status, subscriptionId: sub.id },
    });
}));

// POST /webhook -- Razorpay webhook handler (no auth, signature verification)
router.post('/webhook', async (req: Request, res: Response) => {
    try {
        const signature = req.headers['x-razorpay-signature'] as string;

        if (!signature) {
            return res.status(400).json({ success: false, error: 'Missing signature' });
        }

        // express.raw() always gives a Buffer — pass it directly so HMAC is computed
        // over the original bytes, not JSON.stringify(buffer) which produces garbage.
        const rawBody = req.body as Buffer;

        if (!verifyWebhookSignature(rawBody, signature)) {
            return res.status(401).json({ success: false, error: 'Invalid signature' });
        }

        const event = JSON.parse(rawBody.toString('utf8'));
        const eventType = event.event;
        const payload = event.payload;

        log.info({ eventType }, 'Razorpay webhook received');
        trackEvent('webhook.received', { eventType });

        switch (eventType) {
            case 'subscription.authenticated': {
                const subId = payload?.subscription?.entity?.id;
                if (subId) {
                    const sub = await findSubscriptionByRazorpayId(subId)
                        ?? await findSubscriptionByPendingRazorpayId(subId);
                    log.info(
                        {
                            rzpSubId: subId,
                            paymentId: payload?.payment?.entity?.id ?? null,
                            paymentAmount: payload?.payment?.entity?.amount ?? null,
                            subFound: !!sub,
                            subStatus: sub?.status ?? null,
                        },
                        'webhook: subscription.authenticated',
                    );
                    if (sub) {
                        // Rank guard: subscription.authenticated can arrive AFTER the sub is
                        // already ACTIVE (e.g., /verify ran first and Path B4 created an ACTIVE
                        // doc, then this webhook arrives late). Without the guard, we'd downgrade
                        // ACTIVE → AUTHENTICATED, causing the "no active plan" stuck state.
                        const currentRank = SUBSCRIPTION_STATUS_RANK[sub.status] ?? 0;
                        if (SUBSCRIPTION_STATUS_RANK['AUTHENTICATED'] >= currentRank) {
                            await updateSubscription(sub.id, { status: 'AUTHENTICATED' });
                        }
                    }
                    // If sub doesn't exist locally yet, /verify will materialize it
                    // (or subscription.activated/charged will arrive next and do so).
                }
                break;
            }

            case 'subscription.activated': {
                const subId = payload?.subscription?.entity?.id;
                if (subId) {
                    const entity = payload.subscription.entity;
                    const restaurantIdFromNotes = entity.notes?.restaurantId;

                    // Find or look up the restaurant. If the local sub doesn't exist yet
                    // (e.g. user closed the browser before /verify could fire), use the
                    // notes we set at /subscribe time to materialize the doc.
                    let resolvedRestaurantId: string | undefined;
                    const existingByRzp = await findSubscriptionByRazorpayId(subId);
                    if (existingByRzp) {
                        resolvedRestaurantId = existingByRzp.restaurantId;
                    } else if (restaurantIdFromNotes) {
                        resolvedRestaurantId = restaurantIdFromNotes;
                    }

                    if (resolvedRestaurantId) {
                        const sub = await materializeSubscriptionFromRazorpay({
                            restaurantId: resolvedRestaurantId,
                            razorpaySubscriptionId: subId,
                            rzpSub: {
                                id: subId,
                                status: entity.status || 'active',
                                current_start: entity.current_start ?? null,
                                current_end: entity.current_end ?? null,
                                customer_id: entity.customer_id,
                                plan_id: entity.plan_id,
                                notes: entity.notes,
                            },
                        });

                        trackEvent('subscription.activated', {
                            subscriptionId: sub.id,
                            restaurantId: sub.restaurantId,
                            razorpaySubscriptionId: subId,
                        });

                        // Record coupon redemption if applicable
                        if (sub.couponCode) {
                            const coupon = await findCouponByCode(sub.couponCode);
                            if (coupon) {
                                const redeemingUserId = entity.notes?.userId
                                    || (await findUserByRestaurantId(sub.restaurantId))?.id
                                    || '';
                                const planPricePaise = sub.planSnapshot?.pricing?.monthly ?? 0;
                                const discountAppliedPaise = coupon.type === 'FLAT'
                                    ? coupon.value
                                    : Math.round((planPricePaise * coupon.value) / 100);
                                await incrementCouponRedemptions(coupon.id);
                                await createCouponRedemption({
                                    couponId: coupon.id,
                                    couponCode: coupon.code,
                                    restaurantId: sub.restaurantId,
                                    userId: redeemingUserId,
                                    subscriptionId: sub.id,
                                    discountAppliedPaise,
                                    redeemedAt: new Date(),
                                });
                            }
                        }

                        // StrategyCycle creation is handled by the content-engine
                        // cycle-sync-processor cron (runs every ~2 min). No direct
                        // call needed here — decouples billing events from content lifecycle.
                    }
                }
                break;
            }

            case 'subscription.charged': {
                const subId = payload?.subscription?.entity?.id;
                if (subId) {
                    const entity = payload.subscription.entity;
                    const restaurantIdFromNotes = entity.notes?.restaurantId;

                    log.info(
                        {
                            rzpSubId: subId,
                            paymentId: payload?.payment?.entity?.id ?? null,
                            paymentAmount: payload?.payment?.entity?.amount ?? null,
                            rzpStatus: entity.status,
                            resolvedRestaurantId: restaurantIdFromNotes ?? 'not-in-notes',
                        },
                        'webhook: subscription.charged',
                    );

                    // Find or look up the restaurant. If the local sub doesn't exist
                    // yet, materialize from notes.
                    let resolvedRestaurantId: string | undefined;
                    const existingByRzp = await findSubscriptionByRazorpayId(subId);
                    if (existingByRzp) {
                        resolvedRestaurantId = existingByRzp.restaurantId;
                    } else if (restaurantIdFromNotes) {
                        resolvedRestaurantId = restaurantIdFromNotes;
                    }

                    if (resolvedRestaurantId) {
                        const sub = await materializeSubscriptionFromRazorpay({
                            restaurantId: resolvedRestaurantId,
                            razorpaySubscriptionId: subId,
                            rzpSub: {
                                id: subId,
                                status: entity.status || 'active',
                                current_start: entity.current_start ?? null,
                                current_end: entity.current_end ?? null,
                                customer_id: entity.customer_id,
                                plan_id: entity.plan_id,
                                notes: entity.notes,
                            },
                        });

                        trackEvent('payment.completed', {
                            subscriptionId: sub.id,
                            restaurantId: sub.restaurantId,
                            razorpaySubscriptionId: subId,
                            amountPaise: String(payload?.payment?.entity?.amount || 0),
                        });

                        // Create invoice record from payment (idempotent: skip if already exists for this payment)
                        const payment = payload?.payment?.entity;
                        if (payment) {
                            const existingInvoice = await findInvoiceByPaymentId(payment.id);
                            if (!existingInvoice) {
                                // Capture plan name before pending promotion so invoice reflects what was charged
                                const planName = sub.pendingPlanSnapshot?.name ?? sub.planSnapshot?.name ?? 'Subscription';
                                const cycle = sub.billingCycle || 'MONTHLY';
                                const cycleLabel = cycle.charAt(0) + cycle.slice(1).toLowerCase();

                                // Fetch the auto-generated Razorpay subscription invoice to get its PDF URL.
                                // This is the post-payment receipt Razorpay creates for every charge cycle.
                                const rzpInvoiceId: string | undefined = payment.invoice_id || undefined;
                                let rzpInvoicePdfUrl: string | undefined;

                                if (rzpInvoiceId) {
                                    try {
                                        const rzpInvoice = await fetchRazorpayInvoice(rzpInvoiceId);
                                        rzpInvoicePdfUrl = rzpInvoice.short_url;
                                    } catch (invoiceErr) {
                                        log.warn({ err: invoiceErr, rzpInvoiceId }, 'Failed to fetch Razorpay invoice PDF url — continuing without pdf link');
                                    }
                                }

                                await createInvoice({
                                    restaurantId: sub.restaurantId,
                                    type: 'SUBSCRIPTION',
                                    razorpayInvoiceId: rzpInvoiceId,
                                    razorpayPaymentId: payment.id,
                                    razorpaySubscriptionId: subId,
                                    amountPaise: payment.amount || 0,
                                    currency: payment.currency || 'INR',
                                    status: 'paid',
                                    description: `${planName} Plan - ${cycleLabel}`,
                                    billingPeriodStart: sub.currentPeriodStart,
                                    billingPeriodEnd: sub.currentPeriodEnd,
                                    pdfUrl: rzpInvoicePdfUrl,
                                    paidAt: new Date(),
                                });

                                log.info(
                                    { paymentId: payment.id, rzpInvoiceId: rzpInvoiceId ?? null },
                                    'Subscription charged: invoice record created',
                                );
                            } else {
                                log.info({ razorpayPaymentId: payment.id }, 'Skipping duplicate subscription.charged invoice');
                            }
                        }

                        // Promote scheduled downgrade if the new cycle has started
                        if (sub.pendingPlanId && sub.pendingPlanSnapshot) {
                            await updateSubscription(sub.id, {
                                planId: sub.pendingPlanId,
                                planSnapshot: sub.pendingPlanSnapshot,
                                billingCycle: 'MONTHLY',
                                pendingPlanId: undefined,
                                pendingPlanSnapshot: null,
                            });
                            const updatedSub = await findSubscriptionByRazorpayId(subId);
                            if (updatedSub) Object.assign(sub, updatedSub);
                        }

                        // StrategyCycle creation is handled by the content-engine
                        // cycle-sync-processor cron (runs every ~2 min).
                    }
                }
                break;
            }

            case 'subscription.pending': {
                const subId = payload?.subscription?.entity?.id;
                if (subId) {
                    const sub = await findSubscriptionByRazorpayId(subId);
                    if (sub) {
                        const currentRank = SUBSCRIPTION_STATUS_RANK[sub.status] ?? 0;
                        if (SUBSCRIPTION_STATUS_RANK['PAST_DUE'] >= currentRank) {
                            await updateSubscription(sub.id, { status: 'PAST_DUE' });
                        }
                    }
                }
                break;
            }

            case 'subscription.halted': {
                const subId = payload?.subscription?.entity?.id;
                if (subId) {
                    const sub = await findSubscriptionByRazorpayId(subId);
                    log.info(
                        { rzpSubId: subId, subFound: !!sub, subStatus: sub?.status ?? null },
                        'webhook: subscription.halted',
                    );
                    if (sub) {
                        const currentRank = SUBSCRIPTION_STATUS_RANK[sub.status] ?? 0;
                        if (SUBSCRIPTION_STATUS_RANK['HALTED'] >= currentRank) {
                            await updateSubscription(sub.id, { status: 'HALTED' });
                        }
                    }
                }
                break;
            }

            case 'subscription.cancelled': {
                const subId = payload?.subscription?.entity?.id;
                if (subId) {
                    const sub = await findSubscriptionByRazorpayId(subId);
                    log.info(
                        { rzpSubId: subId, subFound: !!sub, subStatus: sub?.status ?? null },
                        'webhook: subscription.cancelled',
                    );
                    if (sub) {
                        await updateSubscription(sub.id, {
                            status: 'CANCELLED',
                            cancelledAt: new Date().toISOString(),
                            // Cancellation is now complete — clear the pending flag so
                            // re-subscribe logic and the UI do not see a stale "pending
                            // cancellation" state on a fully cancelled subscription.
                            cancelAtPeriodEnd: false,
                        });
                    }
                }
                break;
            }

            default:
                log.warn({ eventType }, 'Unhandled Razorpay webhook event');
        }

        res.json({ success: true });
    } catch (error) {
        log.error({ err: error }, 'Razorpay webhook processing error');
        res.status(500).json({ success: false, error: 'Webhook processing failed' });
    }
});

// Unified plan-change helper.
//
// Razorpay's domestic-card e-mandate platform refuses to PATCH plan_id on an
// active subscription ("Only offers can be updated for subscriptions when
// payment mode is domestic card"). The only operations supported are:
//   - cancel-at-cycle-end (one-way)
//   - cancel immediately
//   - create a new subscription (with optional start_at)
//
// Therefore EVERY plan change becomes the same shape:
//   1. cancel-at-cycle-end the active sub (idempotent)
//   2. sweep + cancel any prior in-flight deferred sub for this customer
//   3. create a new sub on the target plan with start_at = currentPeriodEnd
//      (deferred — ₹5 verify charge today, real charge at cycle_end), or
//      omitted (immediate — full new-plan amount today) for "Upgrade now".
//   4. return checkout details; local DB stays untouched until /verify
//
// This collapses the legacy upgrade/downgrade/keep-current/Case-A/B/C/D
// branches into one dispatch.
async function prepareCancelAndFutureSubscribe(params: {
    existing: Subscription & { razorpaySubscriptionId: string };
    targetPlan: SubscriptionPlan;
    mode: 'now' | 'cycle_end';
    restaurantId: string;
    userId: string;
}): Promise<{ razorpaySubscriptionId: string; keyId: string; effective: 'immediate' | 'cycle_end' }> {
    const { existing, targetPlan, mode, restaurantId, userId } = params;

    log.info(
        {
            restaurantId,
            targetPlan: targetPlan.slug,
            targetMonthlyPaise: targetPlan.pricing.monthly,
            mode,
            currentRzpSubId: existing.razorpaySubscriptionId,
            currentPlan: existing.planSnapshot?.slug,
            currentStatus: existing.status,
            periodEnd: existing.currentPeriodEnd,
            pendingPlan: existing.pendingPlanSnapshot?.slug,
            pendingRzpSubId: existing.pendingRazorpaySubscriptionId,
            cancelAtPeriodEnd: existing.cancelAtPeriodEnd,
        },
        'plan-change: prepareCancelAndFutureSubscribe entry',
    );

    const targetRazorpayPlanId = targetPlan.razorpayPlanIds.monthly;
    if (!targetRazorpayPlanId) {
        throw new Error('Target plan has no Razorpay plan ID configured');
    }

    // Step 1: cancel-at-cycle-end the active sub (idempotent)
    if (!existing.cancelAtPeriodEnd) {
        log.info(
            { rzpSubId: existing.razorpaySubscriptionId, restaurantId },
            'plan-change: cancelling active sub at cycle end',
        );
        try {
            await cancelRazorpaySubscription(existing.razorpaySubscriptionId, true);
        } catch (cancelErr) {
            const cancelMsg = ((cancelErr as Error).message || '').toLowerCase();
            const alreadyTerminal = cancelMsg.includes('already cancelled') || cancelMsg.includes('completed') || cancelMsg.includes('not in an active state');
            if (!alreadyTerminal) {
                log.warn({ err: cancelErr, razorpaySubscriptionId: existing.razorpaySubscriptionId }, 'plan-change: cancel-at-cycle-end failed (non-terminal); proceeding anyway');
            }
        }
    }

    // Step 1b: cancel any existing pending deferred sub before creating the new one
    if (existing.pendingRazorpaySubscriptionId) {
        try {
            await cancelRazorpaySubscription(existing.pendingRazorpaySubscriptionId, false);
            log.info({ pendingRzpId: existing.pendingRazorpaySubscriptionId, restaurantId }, 'plan-change: cancelled prior pending sub');
        } catch (err) {
            log.warn({ err, pendingRzpId: existing.pendingRazorpaySubscriptionId }, 'plan-change: failed to cancel prior pending sub (non-fatal)');
        }
    }

    // Step 2: sweep any prior in-flight deferred sub for this customer (B13)
    // Also checks pendingRazorpaySubscriptionId so we don't re-cancel a known pending sub.
    const user = await findUserById(userId);
    const customerId = user?.razorpayCustomerId;
    if (customerId) {
        try {
            const customerSubs = await listRazorpaySubscriptionsForCustomer(customerId);
            const cleanupCandidates = (customerSubs.items || []).filter(s =>
                (s.status === 'created' || s.status === 'authenticated') &&
                s.id !== existing.razorpaySubscriptionId,
            );
            for (const orphan of cleanupCandidates) {
                const localDoc = await findSubscriptionByRazorpayId(orphan.id);
                const pendingDoc = !localDoc ? await findSubscriptionByPendingRazorpayId(orphan.id) : null;
                if (!localDoc && !pendingDoc) {
                    try {
                        await cancelRazorpaySubscription(orphan.id, false);
                        log.info({ orphanRzpId: orphan.id, restaurantId }, 'plan-change-sweep: cancelled orphan Razorpay sub');
                    } catch (cancelErr) {
                        log.warn({ err: cancelErr, orphanRzpId: orphan.id }, 'plan-change-sweep: failed to cancel orphan Razorpay sub');
                    }
                }
            }
        } catch (listErr) {
            log.warn({ err: listErr, customerId }, 'plan-change-sweep: failed to list customer subs; proceeding without sweep');
        }
    }

    // Step 3: create the new sub
    const startAt = mode === 'cycle_end' && existing.currentPeriodEnd
        ? Math.floor(new Date(existing.currentPeriodEnd).getTime() / 1000)
        : undefined;
    // 'deferred: 1' in notes lets materializeSubscriptionFromRazorpay distinguish a
    // cycle_end plan-change (Path B3) from an immediate upgrade (Path B4), even when
    // both have status=authenticated at /verify time.
    const notes: Record<string, string> = {
        planSlug: targetPlan.slug,
        restaurantId,
        ...(mode === 'cycle_end' ? { deferred: '1' } : {}),
    };
    const newSub = await createRazorpaySubscription(targetRazorpayPlanId, 120, undefined, customerId, startAt, notes);

    log.info(
        { restaurantId, planSlug: targetPlan.slug, mode, startAt, newRzpId: newSub.id, replacingRzpId: existing.razorpaySubscriptionId },
        'plan-change: deferred resubscribe created, awaiting checkout completion',
    );

    // For cycle_end mode: store the new pending sub ID in the DB immediately so that
    // the subscription.authenticated webhook (which fires before /verify is called)
    // can find the subscription and record the rs.5 mandate auth invoice.
    if (mode === 'cycle_end') {
        await updateSubscription(existing.id, {
            pendingRazorpaySubscriptionId: newSub.id,
            pendingPlanId: targetPlan.id,
            pendingPlanSnapshot: targetPlan,
        });
        log.info(
            { restaurantId, pendingRzpId: newSub.id, pendingPlan: targetPlan.slug },
            'plan-change: stored pendingRazorpaySubscriptionId early for webhook lookup',
        );
    }

    return {
        razorpaySubscriptionId: newSub.id,
        keyId: getRazorpayKeyId(),
        effective: mode === 'now' ? 'immediate' : 'cycle_end',
    };
}

// POST /change-plan -- requireAuth, upgrade/downgrade/keep-current.
// All plan changes use the unified prepareCancelAndFutureSubscribe helper.
// Body: { planSlug: string, mode?: 'now' | 'cycle_end' }
//   - mode='now' (only valid for upgrades): cancel old immediately, charge full
//     new-plan amount today, immediate switch.
//   - mode='cycle_end' (default): keep the already-paid period running, ₹5
//     verify charge today, full new-plan charges at cycle_end.
router.post('/change-plan', requireAuth, handle(async (req: Request, res: Response<ApiResponse>) => {
    if (!isRazorpayConfigured()) {
        return res.status(503).json({ success: false, error: 'Payment service is not configured' });
    }

    const restaurantId = req.user!.restaurantId;
    const { planSlug, mode: rawMode } = req.body;

    if (!planSlug) {
        return res.status(400).json({ success: false, error: 'planSlug is required' });
    }
    const requestedMode: 'now' | 'cycle_end' = rawMode === 'now' ? 'now' : 'cycle_end';

    const stored = await findActiveSubscription(restaurantId);
    if (!stored || !stored.razorpaySubscriptionId) {
        return res.status(400).json({ success: false, error: 'No active subscription to change' });
    }

    // B11 fix: reconcile transient AUTHENTICATED → ACTIVE before the status check.
    const reconciled = await reconcileSubscriptionWithRazorpay(stored);
    const existing = reconciled as Subscription & { razorpaySubscriptionId: string };

    if (existing.status !== 'ACTIVE' && existing.status !== 'PAST_DUE') {
        log.warn(
            { restaurantId, subscriptionId: existing.id, observedStatus: existing.status, razorpaySubscriptionId: existing.razorpaySubscriptionId },
            'change-plan: rejected with status not active/past_due',
        );
        return res.status(400).json({ success: false, error: 'Subscription must be active to change plan' });
    }

    const plan = await findPlanBySlug(planSlug);
    if (!plan) {
        return res.status(404).json({ success: false, error: 'Plan not found' });
    }
    if (!plan.razorpayPlanIds.monthly) {
        return res.status(400).json({ success: false, error: 'Razorpay plan not configured' });
    }

    const currentSlug = existing.planSnapshot?.slug;
    const pendingSlug = existing.pendingPlanSnapshot?.slug;
    const currentMonthlyPrice = existing.planSnapshot?.pricing.monthly ?? 0;
    const isPlanUpgrade = plan.pricing.monthly > currentMonthlyPrice;

    log.info(
        {
            restaurantId,
            requestedPlan: planSlug,
            requestedMode: rawMode,
            effectiveMode: requestedMode === 'now' && isPlanUpgrade ? 'now' : 'cycle_end',
            currentPlan: currentSlug,
            currentStatus: existing.status,
            currentMonthlyPaise: currentMonthlyPrice,
            targetMonthlyPaise: plan.pricing.monthly,
            pendingPlan: pendingSlug,
            periodEnd: existing.currentPeriodEnd,
            cancelAtPeriodEnd: existing.cancelAtPeriodEnd,
            isPlanUpgrade,
        },
        'change-plan: request resolved',
    );

    // No-op echoes ---------------------------------------------------------
    // Same plan as currently active, no pending change, and NOT a reactivation
    // (cancelAtPeriodEnd=true means the user cancelled but is now re-subscribing —
    // that must proceed to prepareCancelAndFutureSubscribe to create the deferred sub).
    if (planSlug === currentSlug && !pendingSlug && !existing.cancelAtPeriodEnd) {
        return res.json({ success: true, data: { effective: 'immediate', planName: plan.name, requiresCheckout: false } });
    }
    // Same plan as already-pending → echo success without re-checkout.
    if (planSlug === pendingSlug) {
        return res.json({
            success: true,
            data: { effective: 'cycle_end', planName: plan.name, currentPeriodEnd: existing.currentPeriodEnd, requiresCheckout: false },
        });
    }

    // Determine effective mode -------------------------------------------------
    // 'now' is only valid for upgrades (price strictly greater than current).
    // For downgrades, keep-current, and amend-pending, mode is forced to 'cycle_end'.
    const isKeepCurrent = planSlug === currentSlug && !!pendingSlug;
    const effectiveMode: 'now' | 'cycle_end' =
        requestedMode === 'now' && isPlanUpgrade && !isKeepCurrent ? 'now' : 'cycle_end';

    if (rawMode === 'now' && effectiveMode !== 'now') {
        log.info(
            { restaurantId, planSlug, currentSlug, pendingSlug, isPlanUpgrade, isKeepCurrent },
            'change-plan: requested mode=now ignored (only valid for upgrades)',
        );
    }

    if (effectiveMode === 'cycle_end' && !existing.currentPeriodEnd) {
        return res.status(400).json({ success: false, error: 'Cannot determine current billing period. Please try again.' });
    }

    // Single dispatch — handles upgrade-now, upgrade-scheduled, downgrade,
    // keep-current, and amend-pending uniformly.
    const result = await prepareCancelAndFutureSubscribe({
        existing,
        targetPlan: plan,
        mode: effectiveMode,
        restaurantId,
        userId: req.user!.userId,
    });

    return res.json({
        success: true,
        data: {
            effective: result.effective,
            planName: plan.name,
            requiresCheckout: true,
            subscriptionId: result.razorpaySubscriptionId,
            keyId: result.keyId,
            currentPeriodEnd: existing.currentPeriodEnd,
        },
    });
}));

// POST /reactivate -- requireAuth, undo a pending cycle-end cancellation
router.post('/reactivate', requireAuth, handle(async (req: Request, res: Response<ApiResponse>) => {
    const restaurantId = req.user!.restaurantId;
    const existing = await findActiveSubscription(restaurantId);

    log.info(
        {
            restaurantId,
            currentPlan: existing?.planSnapshot?.slug,
            currentStatus: existing?.status,
            cancelAtPeriodEnd: existing?.cancelAtPeriodEnd,
            periodEnd: existing?.currentPeriodEnd,
            rzpSubId: existing?.razorpaySubscriptionId,
        },
        'reactivate: request received',
    );

    if (!existing || !existing.razorpaySubscriptionId) {
        return res.status(400).json({ success: false, error: 'No subscription to reactivate' });
    }

    if ((existing.status !== 'ACTIVE' && existing.status !== 'PAST_DUE') || !existing.cancelAtPeriodEnd) {
        return res.status(400).json({ success: false, error: 'Subscription is not pending cancellation' });
    }

    const plan = existing.planSnapshot;
    if (!plan?.razorpayPlanIds?.monthly) {
        return res.status(400).json({ success: false, error: 'Plan configuration missing' });
    }

    if (!existing.currentPeriodEnd) {
        return res.status(400).json({ success: false, error: 'Cannot determine current billing period. Please try again.' });
    }

    // Create a new Razorpay subscription scheduled to start when the current one ends.
    // The existing subscription is left to expire naturally (cancel_at_cycle_end=1 already
    // set). Razorpay authorises the mandate during checkout but defers the first charge to
    // start_at — user pays only once per cycle.
    //
    // B7 fix: do NOT update the local DB until /verify confirms checkout. If the user
    // closes the modal without paying, the cancellation flags stay set on the existing
    // doc, the new Razorpay sub gets cancelled later (via the stale-checkout sweep in
    // /subscribe), and the user remains in their original cancelled-but-active state
    // — no silent subscription loss.
    const startAt = Math.floor(new Date(existing.currentPeriodEnd).getTime() / 1000);
    const user = await findUserById(req.user!.userId);
    const notes: Record<string, string> = { planSlug: plan.slug, restaurantId };
    const rzpSub = await createRazorpaySubscription(plan.razorpayPlanIds.monthly, 120, undefined, user?.razorpayCustomerId, startAt, notes);

    log.info({ restaurantId, startAt, razorpaySubscriptionId: rzpSub.id }, 'reactivate: deferred resubscribe created, awaiting checkout completion');
    res.json({
        success: true,
        data: {
            requiresCheckout: true,
            subscriptionId: rzpSub.id,
            keyId: getRazorpayKeyId(),
        },
    });
}));

// POST /cancel -- requireAuth, cancel at cycle end
router.post('/cancel', requireAuth, handle(async (req: Request, res: Response<ApiResponse>) => {
    const restaurantId = req.user!.restaurantId;
    const subscription = await findActiveSubscription(restaurantId);

    log.info(
        {
            restaurantId,
            currentPlan: subscription?.planSnapshot?.slug,
            currentStatus: subscription?.status,
            cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd,
            periodEnd: subscription?.currentPeriodEnd,
            rzpSubId: subscription?.razorpaySubscriptionId,
        },
        'cancel: request received',
    );

    if (!subscription || !subscription.razorpaySubscriptionId) {
        return res.status(400).json({ success: false, error: 'No active subscription to cancel' });
    }

    if (subscription.status !== 'ACTIVE' && subscription.status !== 'PAST_DUE' && subscription.status !== 'AUTHENTICATED') {
        return res.status(400).json({ success: false, error: 'Subscription is not active' });
    }

    // Idempotency: already scheduled with no pending renewal, no action needed
    if (subscription.cancelAtPeriodEnd && !subscription.pendingRazorpaySubscriptionId) {
        return res.json({ success: true, message: 'Subscription is already scheduled for cancellation' });
    }

    // If there is a deferred next-cycle sub, the user wants to cancel their RENEWAL, not
    // their current paid period. Cancel the pending sub immediately and mark the period
    // as ending — the current service continues until currentPeriodEnd naturally.
    if (subscription.pendingRazorpaySubscriptionId) {
        try {
            await cancelRazorpaySubscription(subscription.pendingRazorpaySubscriptionId, false);
        } catch (cancelErr) {
            const msg = ((cancelErr as Error).message || '').toLowerCase();
            if (!(msg.includes('cancelled') || msg.includes('completed') || msg.includes('already') || msg.includes('not in an active state'))) {
                log.warn({ err: cancelErr, pendingRzpId: subscription.pendingRazorpaySubscriptionId }, '/cancel: failed to cancel pending sub');
            }
        }
        await updateSubscription(subscription.id, {
            pendingRazorpaySubscriptionId: null,
            pendingPlanId: undefined,
            pendingPlanSnapshot: null,
            cancelAtPeriodEnd: true,
            cancelledAt: new Date().toISOString(),
        });
        return res.json({
            success: true,
            message: 'Scheduled renewal cancelled. Your current plan continues until end of billing period.',
        });
    }

    // Prefer cancel-at-cycle-end (graceful). Razorpay rejects this with
    // "no billing cycle is going on" when the subscription is still in
    // authenticated/created state (first charge hasn't fired yet — no period
    // has started). In that case fall back to immediate cancel.
    let cancelledImmediately = false;
    try {
        await cancelRazorpaySubscription(subscription.razorpaySubscriptionId, true);
    } catch (cancelErr) {
        const msg = ((cancelErr as Error).message || '').toLowerCase();
        if (msg.includes('no billing cycle') || msg.includes('billing cycle is going on')) {
            // Sub is authenticated/created — no period yet. Fall back to immediate cancel.
            await cancelRazorpaySubscription(subscription.razorpaySubscriptionId, false);
            cancelledImmediately = true;
        } else if (msg.includes('cancelled') || msg.includes('not cancellable') || msg.includes('already')) {
            // Razorpay sub is already in a terminal state (cancelled by a prior plan-change
            // step or webhook). Local DB was out of sync. Treat as success — the user's
            // cancel intent is already achieved; just update the local doc below.
            cancelledImmediately = true;
        } else {
            throw cancelErr;
        }
    }

    await updateSubscription(subscription.id, {
        cancelledAt: new Date().toISOString(),
        cancelAtPeriodEnd: !cancelledImmediately,
        pendingPlanId: undefined,
        pendingPlanSnapshot: null,
        ...(cancelledImmediately ? { status: 'CANCELLED' } : {}),
    });

    res.json({
        success: true,
        message: cancelledImmediately
            ? 'Subscription cancelled immediately (no active billing period)'
            : 'Subscription will cancel at the end of the current billing period',
    });
}));

// POST /credits/purchase -- requireAuth, create Razorpay Order for credit pack
router.post('/credits/purchase', requireAuth, handle(async (req: Request, res: Response<ApiResponse>) => {
    if (!isRazorpayConfigured()) {
        return res.status(503).json({ success: false, error: 'Payment service is not configured' });
    }

    const { creditPackId } = req.body;

    if (!creditPackId) {
        return res.status(400).json({ success: false, error: 'creditPackId is required' });
    }

    const pack = await findCreditPackById(creditPackId);
    if (!pack || !pack.isActive) {
        return res.status(404).json({ success: false, error: 'Credit pack not found' });
    }

    const receipt = `cr_${req.user!.restaurantId.slice(-8)}_${Date.now()}`;
    const order = await createRazorpayOrder(pack.priceInPaise, receipt);

    await createCreditPurchase({
        restaurantId: req.user!.restaurantId,
        userId: req.user!.userId,
        creditPackId: pack.id,
        creditsAdded: pack.credits,
        amountPaise: pack.priceInPaise,
        razorpayOrderId: order.id,
        status: 'PENDING',
    });

    res.json({
        success: true,
        data: {
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
            keyId: getRazorpayKeyId(),
            credits: pack.credits,
        },
    });
}));

// POST /credits/verify -- requireAuth, verify payment and add credits
router.post('/credits/verify', requireAuth, handle(async (req: Request, res: Response<ApiResponse>) => {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
        return res.status(400).json({ success: false, error: 'Missing payment verification fields' });
    }

    if (!verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature)) {
        return res.status(400).json({ success: false, error: 'Payment signature verification failed' });
    }

    const purchase = await findCreditPurchaseByOrderId(razorpayOrderId);
    if (!purchase) {
        return res.status(404).json({ success: false, error: 'Purchase not found' });
    }

    if (purchase.status === 'PAID') {
        return res.json({ success: true, message: 'Credits already added' });
    }

    // Update purchase status
    await updateCreditPurchase(purchase.id, {
        status: 'PAID',
        razorpayPaymentId,
    });

    // Add credits to subscription
    const subscription = await findActiveSubscription(purchase.restaurantId);
    if (subscription) {
        await addCredits(subscription.id, purchase.creditsAdded);
    }

    // Create invoice for credit purchase
    await createInvoice({
        restaurantId: purchase.restaurantId,
        type: 'CREDIT_PURCHASE',
        razorpayOrderId: razorpayOrderId,
        razorpayPaymentId: razorpayPaymentId,
        amountPaise: purchase.amountPaise,
        currency: 'INR',
        status: 'paid',
        description: `${purchase.creditsAdded} Credits`,
        paidAt: new Date(),
    });

    res.json({ success: true, message: `${purchase.creditsAdded} credits added successfully` });
}));

export default router;
