/**
 * Manual billing (no payment gateway).
 *
 * An owner *requests* a plan: it is stored on the subscription as
 * pendingPlanId / pendingPlanSnapshot / planRequestedAt. The RestroPulse team
 * arranges payment directly and a platform admin then activates the plan for
 * a number of months. Entitlement ends MANUAL_BILLING_GRACE_DAYS after
 * currentPeriodEnd unless the team renews it (see getEntitlement in shared).
 */
import {
    findCouponByCode,
    hasRestaurantRedeemedCoupon,
    incrementCouponRedemptions,
    createCouponRedemption,
    findUserByRestaurantId,
} from '@restropulse/db';
import { isPlanPeriodOver } from '@restropulse/shared';
import type { Coupon, Subscription, SubscriptionPlan } from '@restropulse/shared';

export type CouponCheck = { ok: true; coupon: Coupon } | { ok: false; error: string };

/** Validate a coupon for a restaurant and plan (local rules only). */
export async function checkCoupon(code: string, restaurantId: string, planSlug: string): Promise<CouponCheck> {
    const coupon = await findCouponByCode(code);
    if (!coupon) return { ok: false, error: 'Invalid coupon code' };
    if (coupon.status !== 'ACTIVE') return { ok: false, error: 'Coupon is not active' };
    if (coupon.validFrom && new Date(coupon.validFrom) > new Date()) return { ok: false, error: 'Coupon is not active yet' };
    if (coupon.validUntil && new Date(coupon.validUntil) < new Date()) return { ok: false, error: 'Coupon has expired' };
    if (coupon.maxRedemptions && coupon.redemptionCount >= coupon.maxRedemptions) {
        return { ok: false, error: 'Coupon has been fully redeemed' };
    }
    if (coupon.assignedTo && coupon.assignedTo !== restaurantId) return { ok: false, error: 'Invalid coupon code' };
    if (coupon.applicablePlans && coupon.applicablePlans.length > 0 && !coupon.applicablePlans.includes(planSlug)) {
        return { ok: false, error: 'Coupon is not applicable to this plan' };
    }
    if (await hasRestaurantRedeemedCoupon(coupon.id, restaurantId)) {
        return { ok: false, error: 'Coupon already redeemed by this restaurant' };
    }
    return { ok: true, coupon };
}

/** Record a coupon redemption once a plan carrying it is activated. Best effort on a vanished coupon. */
export async function recordCouponRedemption(sub: Subscription, plan: SubscriptionPlan, couponCode: string): Promise<void> {
    const coupon = await findCouponByCode(couponCode);
    if (!coupon) return;
    if (await hasRestaurantRedeemedCoupon(coupon.id, sub.restaurantId)) return;
    const pricePaise = plan.pricing?.monthly ?? 0;
    const discountAppliedPaise = coupon.type === 'FLAT' ? coupon.value : Math.round((pricePaise * coupon.value) / 100);
    const owner = await findUserByRestaurantId(sub.restaurantId);
    await incrementCouponRedemptions(coupon.id);
    await createCouponRedemption({
        couponId: coupon.id,
        couponCode: coupon.code,
        restaurantId: sub.restaurantId,
        userId: owner?.id ?? '',
        subscriptionId: sub.id,
        discountAppliedPaise,
        redeemedAt: new Date(),
    });
}

/** True when the subscription has a paid plan switched on (cancelled-at-period-end still counts). */
export function hasActivePaidPlan(sub: Subscription | null | undefined): boolean {
    return !!sub && (sub.status === 'ACTIVE' || sub.status === 'PAST_DUE') && !!sub.planSnapshot;
}

/**
 * A paid plan the owner is still entitled to: switched on and not past its
 * paid period plus the grace days. A lapsed plan can be requested again.
 */
export function hasLivePaidPlan(sub: Subscription | null | undefined, now: Date = new Date()): boolean {
    return hasActivePaidPlan(sub) && !isPlanPeriodOver(sub!, now);
}

/** Add whole calendar months to a date (clamped to the month's last day). */
export function addMonths(from: Date, months: number): Date {
    const d = new Date(from.getTime());
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + months);
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, lastDay));
    return d;
}

/**
 * Work out the new paid period when the team activates or renews a plan.
 * Renewing the same plan before its period runs out extends from the current
 * end; anything else starts now.
 */
export function nextPeriod(sub: Subscription, planSlug: string, months: number, now: Date = new Date()): { start: Date; end: Date } {
    const currentEnd = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;
    const renewingSamePlan = hasActivePaidPlan(sub) && sub.planSnapshot?.slug === planSlug
        && currentEnd !== null && !Number.isNaN(currentEnd.getTime()) && currentEnd > now;
    const start = renewingSamePlan ? currentEnd! : now;
    return { start: renewingSamePlan && sub.currentPeriodStart ? new Date(sub.currentPeriodStart) : start, end: addMonths(start, months) };
}
