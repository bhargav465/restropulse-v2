import { trackEvent } from '@restropulse/telemetry/browser';

/**
 * Intelligence instrumentation — the ten events that tell us whether any of
 * this works. Thin wrappers over telemetry so names stay consistent and every
 * call site is greppable. All properties are strings (App Insights contract).
 *
 * North star: RestroScore delta at 30 days for owners who marked >=3 actions
 * done vs. those who marked none. Everything below feeds that comparison.
 */
const ev = (name: string, props?: Record<string, string | number | boolean | null | undefined>) => {
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(props ?? {})) if (v !== undefined && v !== null) clean[k] = String(v);
    try {
        trackEvent(`intelligence.${name}`, clean);
    } catch {
        /* never let telemetry break the UI */
    }
};

export const track = {
    reportViewed: (p: { reportId: string; score: number; first: boolean }) => ev('report_viewed', p),
    actionCtaClicked: (p: { rank: number; bucket: string; resolvedView: string | null }) => ev('action_cta_clicked', p),
    actionMarkedDone: (p: { reportId: string; rank: number; done: boolean; doneCount: number; total: number }) => ev('action_marked_done', p),
    notificationsOpened: (p: { unread: number; total: number }) => ev('notifications_opened', p),
    notificationClicked: (p: { kind: string; unread: boolean; source: 'bell' | 'landing' }) => ev('notification_clicked', p),
    placeConfirmed: (p: { changedName: boolean; hadSavedPlace: boolean }) => ev('place_confirmed', p),
    rescanClicked: (p: { reason: 'refresh' | 'change_restaurant' }) => ev('rescan_clicked', p),
    pillarOpened: (p: { pillar: string; grade: string }) => ev('pillar_opened', p),
    tabOpened: (p: { bucket: string; tab: string }) => ev('tab_opened', p),
    replyDrafted: (p: { rating: number; stance?: string; ok: boolean }) => ev('reply_drafted', p),
    replyCopied: (p: { rating: number }) => ev('reply_copied', p),
};
