/**
 * Growth-campaign cohort computation (pure functions — unit-testable without
 * a database). The route layer fetches raw rows from the events / orders /
 * customers collections and hands them here.
 *
 * Cohort definitions (v1):
 *   - drop_off_cart : sessions with an add_to_cart or begin_checkout event in
 *                     the last 7 days and no order_placed event in the same
 *                     window (session-scoped — anonymous carts count too).
 *   - non_transacted: customers with zero orders, ever.
 *   - lapsed_30d    : customers whose most recent order is older than 30 days.
 */

import type { CohortId, CustomerCohort } from '@restropulse/shared';

export const DROP_OFF_WINDOW_DAYS = 7;
export const LAPSED_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Minimal event shape needed for cohort math (subset of AnalyticsEvent). */
export interface CohortEventRow {
    name: string;
    sessionId: string;
    ts: string | Date;
}

/** Minimal order shape needed for cohort math. */
export interface CohortOrderRow {
    customerId: string;
    createdAt: string | Date;
}

/** Minimal customer shape needed for cohort math. */
export interface CohortCustomerRow {
    id: string;
}

export interface CohortCounts {
    drop_off_cart: number;
    non_transacted: number;
    lapsed_30d: number;
}

const CART_INTENT_EVENTS = new Set(['add_to_cart', 'begin_checkout']);

/**
 * Compute all three cohort counts from raw rows.
 * `events` should already be limited to the drop-off window (the function
 * re-filters by timestamp anyway, so over-fetching is safe).
 */
export function computeCohorts(
    events: CohortEventRow[],
    orders: CohortOrderRow[],
    customers: CohortCustomerRow[],
    now: Date = new Date(),
): CohortCounts {
    const windowStart = now.getTime() - DROP_OFF_WINDOW_DAYS * DAY_MS;

    // --- drop_off_cart: cart/checkout sessions with no order in the window ---
    const cartSessions = new Set<string>();
    const orderedSessions = new Set<string>();
    for (const ev of events) {
        const ts = new Date(ev.ts).getTime();
        if (Number.isNaN(ts) || ts < windowStart || ts > now.getTime()) continue;
        if (!ev.sessionId) continue;
        if (CART_INTENT_EVENTS.has(ev.name)) cartSessions.add(ev.sessionId);
        if (ev.name === 'order_placed') orderedSessions.add(ev.sessionId);
    }
    let dropOff = 0;
    for (const sessionId of cartSessions) {
        if (!orderedSessions.has(sessionId)) dropOff += 1;
    }

    // --- per-customer latest order ---
    const latestOrderAt = new Map<string, number>();
    for (const order of orders) {
        if (!order.customerId) continue;
        const ts = new Date(order.createdAt).getTime();
        if (Number.isNaN(ts)) continue;
        const prev = latestOrderAt.get(order.customerId);
        if (prev === undefined || ts > prev) latestOrderAt.set(order.customerId, ts);
    }

    // --- non_transacted + lapsed_30d ---
    const lapsedCutoff = now.getTime() - LAPSED_WINDOW_DAYS * DAY_MS;
    let nonTransacted = 0;
    let lapsed = 0;
    for (const customer of customers) {
        const last = latestOrderAt.get(customer.id);
        if (last === undefined) nonTransacted += 1;
        else if (last < lapsedCutoff) lapsed += 1;
    }

    return { drop_off_cart: dropOff, non_transacted: nonTransacted, lapsed_30d: lapsed };
}

/** Owner-facing catalog for the three v1 cohorts (name/emoji/description). */
export const COHORT_CATALOG: Array<Omit<CustomerCohort, 'count'>> = [
    {
        id: 'drop_off_cart',
        name: 'Drop-off carts',
        emoji: '🛒',
        description: `Added to cart or started checkout in the last ${DROP_OFF_WINDOW_DAYS} days but never placed the order.`,
    },
    {
        id: 'non_transacted',
        name: 'Non-transacted signups',
        emoji: '👋',
        description: 'Created an account but have not ordered yet — a welcome offer converts these best.',
    },
    {
        id: 'lapsed_30d',
        name: 'Lapsed 30-day',
        emoji: '💤',
        description: `Ordered before, but nothing in the last ${LAPSED_WINDOW_DAYS} days. A gentle reminder brings them back.`,
    },
];

export function buildCohorts(counts: CohortCounts): CustomerCohort[] {
    return COHORT_CATALOG.map((c) => ({ ...c, count: counts[c.id as CohortId] }));
}
