/**
 * Deep-link resolver — the loop Owner.com cannot close.
 *
 * Maps an intelligence action's `deepLink` bucket onto a concrete in-app
 * destination in the v2 admin shell: which shell bucket to open, which Ordering
 * sub-tab (for Campaigns), a canonical `/admin-v2/*` href (used for the button
 * title + href-mapping tests), and the CTA label.
 *
 * The shell has no URL router (ShellV2 drives buckets from local state), so the
 * href is informational/testable; actual navigation goes through the
 * `onNavigate(target)` callback ShellV2 passes into IntelligenceV2.
 */

import type { ActionPlanItem } from '@restropulse/shared';

/** Shell-level buckets — mirror of ShellV2's BucketV2 union. */
export type ShellBucketId = 'DASHBOARD' | 'GET_STARTED' | 'CONTENT' | 'ORDERING' | 'INTELLIGENCE' | 'DESIGN';

/** Ordering sub-tabs — mirror of OrderingV2's OrderingTab union. */
export type OrderingSubTab = 'OVERVIEW' | 'ORDERS' | 'MENU' | 'RESERVATIONS' | 'CONTENT' | 'FUNNEL' | 'CAMPAIGNS';

export interface DeepLinkTarget {
    bucket: ShellBucketId;
    /** Set when the destination is a specific Ordering sub-tab (e.g. Campaigns). */
    orderingTab?: OrderingSubTab;
    /** Canonical admin-v2 path — informational + asserted by href tests. */
    href: string;
    /** Button label. */
    cta: string;
    /** Optional params forwarded to the destination (e.g. content brief, cohort). */
    params?: Record<string, string>;
}

type DeepLink = ActionPlanItem['deepLink'];

/**
 * Resolve an action-plan / keyword deep link to a shell destination. Unknown or
 * missing links fall back to the Get-started checklist (a safe, always-present
 * destination) so a button is never dead.
 */
export function resolveDeepLink(deepLink?: DeepLink): DeepLinkTarget {
    const params = deepLink?.params;
    switch (deepLink?.bucket) {
        case 'content':
            return { bucket: 'CONTENT', href: '/admin-v2/content', cta: 'Draft in Content Engine', params };
        case 'campaigns':
            return { bucket: 'ORDERING', orderingTab: 'CAMPAIGNS', href: '/admin-v2/ordering/campaigns', cta: 'Launch a campaign', params };
        case 'ordering':
            return { bucket: 'ORDERING', orderingTab: 'OVERVIEW', href: '/admin-v2/ordering', cta: 'Open Online Ordering', params };
        case 'get-started':
            return { bucket: 'GET_STARTED', href: '/admin-v2/get-started', cta: 'Open Get started', params };
        default:
            return { bucket: 'GET_STARTED', href: '/admin-v2/get-started', cta: 'Act on this', params };
    }
}

/**
 * Resolve a pillar-check `actionHref` (a raw `/admin-v2/*` path from the report)
 * onto a shell destination for the "Fix" affordance. Kept tolerant: paths the
 * shell doesn't own resolve to their nearest bucket.
 */
export function resolveActionHref(actionHref?: string): DeepLinkTarget | null {
    if (!actionHref) return null;
    if (actionHref.includes('/content')) return { bucket: 'CONTENT', href: actionHref, cta: 'Fix' };
    if (actionHref.includes('/ordering')) return { bucket: 'ORDERING', orderingTab: 'OVERVIEW', href: actionHref, cta: 'Fix' };
    if (actionHref.includes('/website-design') || actionHref.includes('/design')) return { bucket: 'DESIGN', href: actionHref, cta: 'Fix' };
    if (actionHref.includes('/get-started')) return { bucket: 'GET_STARTED', href: actionHref, cta: 'Fix' };
    if (actionHref.includes('/intelligence')) return { bucket: 'INTELLIGENCE', href: actionHref, cta: 'View' };
    return { bucket: 'GET_STARTED', href: actionHref, cta: 'Fix' };
}
