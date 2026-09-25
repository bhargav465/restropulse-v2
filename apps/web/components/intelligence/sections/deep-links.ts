/**
 * Deep-link resolver — the loop Owner.com cannot close.
 *
 * Maps an intelligence action's `deepLink` bucket onto a concrete in-app
 * destination in the admin shell: which shell bucket to open, which Ordering
 * sub-tab (for Campaigns), a canonical `/admin/*` href (used for the button
 * title + href-mapping tests), and the CTA label.
 *
 * The shell has no URL router (the shell drives buckets from local state), so the
 * href is informational/testable; actual navigation goes through the
 * `onNavigate(target)` callback the shell passes into IntelligenceDashboard.
 */

import type { ActionPlanItem, ViewState } from '@restropulse/shared';

/**
 * Master switch for action CTAs ("Act on this →", Quick-wins "Fix →").
 * OFF for launch (Bhargav, 20 Aug): the destinations aren't configured as
 * guided actionables yet, and a button that lands somewhere unhelpful costs
 * more trust than no button. The deep-link plumbing, tick-boxes and telemetry
 * all stay; flip to true to bring every CTA back.
 */
export const SHOW_ACTION_CTAS = false;

/** Shell-level buckets — mirror of the shell's Bucket union. */
export type ShellBucketId = 'DASHBOARD' | 'GET_STARTED' | 'CONTENT' | 'ORDERING' | 'INTELLIGENCE' | 'DESIGN';

/** Ordering sub-tabs — mirror of Ordering's OrderingTab union. */
export type OrderingSubTab = 'OVERVIEW' | 'ORDERS' | 'MENU' | 'RESERVATIONS' | 'CONTENT' | 'FUNNEL' | 'CAMPAIGNS';

export interface DeepLinkTarget {
    bucket: ShellBucketId;
    /** Set when the destination is a specific Ordering sub-tab (e.g. Campaigns). */
    orderingTab?: OrderingSubTab;
    /** Canonical admin path — informational + asserted by href tests. */
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
            return { bucket: 'CONTENT', href: '/admin/content', cta: 'Draft in Content Engine', params };
        case 'campaigns':
            return { bucket: 'ORDERING', orderingTab: 'CAMPAIGNS', href: '/admin/ordering/campaigns', cta: 'Launch a campaign', params };
        case 'ordering':
            return { bucket: 'ORDERING', orderingTab: 'OVERVIEW', href: '/admin/ordering', cta: 'Open Online Ordering', params };
        case 'get-started':
            // RP-002: this shell has no Get-started checklist. Profile/review
            // actions land on What guests say, where "Draft a reply" lives.
            return {
                bucket: 'INTELLIGENCE',
                href: '/admin/intelligence',
                cta: 'Reply to reviews',
                params: { ...(params ?? {}), intelBucket: 'MINE', intelTab: 'FEEDBACK' },
            };
        default:
            return { bucket: 'GET_STARTED', href: '/admin/get-started', cta: 'Act on this', params };
    }
}

/**
 * Resolve a pillar-check `actionHref` (a raw `/admin/*` path from the report)
 * onto a shell destination for the "Fix" affordance. Kept tolerant: paths the
 * shell doesn't own resolve to their nearest bucket.
 */
/**
 * Shell bucket -> the shell's own `ViewState` (RP-001).
 *
 * `ShellBucketId` was ported from the `restropulse-v2` shell, which has buckets
 * this app does not (Get-started, Ordering/Campaigns, Design). Those map to
 * `null`: the CTA resolves, but there is nowhere to send the user, so the shell
 * leaves them where they are rather than bouncing them somewhere wrong.
 * Retargeting or removing those CTAs is RP-002, gated on RP-014.
 */
export const SHELL_BUCKET_TO_VIEW: Record<ShellBucketId, ViewState | null> = {
    DASHBOARD: 'DASHBOARD',
    INTELLIGENCE: 'INTELLIGENCE',
    CONTENT: 'STUDIO',
    GET_STARTED: null,
    ORDERING: null,
    DESIGN: null,
};

/** Resolve a shell bucket to a view this shell owns, or null when it has none. */
export function shellBucketToView(bucket: ShellBucketId): ViewState | null {
    return SHELL_BUCKET_TO_VIEW[bucket] ?? null;
}

export function resolveActionHref(actionHref?: string): DeepLinkTarget | null {
    if (!actionHref) return null;
    if (actionHref.includes('/content')) return { bucket: 'CONTENT', href: actionHref, cta: 'Fix' };
    if (actionHref.includes('/ordering')) return { bucket: 'ORDERING', orderingTab: 'OVERVIEW', href: actionHref, cta: 'Fix' };
    if (actionHref.includes('/website-design') || actionHref.includes('/design')) return { bucket: 'DESIGN', href: actionHref, cta: 'Fix' };
    if (actionHref.includes('/get-started')) return { bucket: 'GET_STARTED', href: actionHref, cta: 'Fix' };
    if (actionHref.includes('/intelligence')) return { bucket: 'INTELLIGENCE', href: actionHref, cta: 'View' };
    return { bucket: 'GET_STARTED', href: actionHref, cta: 'Fix' };
}
