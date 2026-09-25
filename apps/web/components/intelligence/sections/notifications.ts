import type { IntelligenceNotification } from '@restropulse/shared';

/**
 * Tiny cross-component channel for the notification feed. The bell lives in the
 * shell (Layout), the "while you were away" card lives inside the Intelligence
 * dashboard, and both need to (a) jump to a bucket/tab and (b) agree on "seen".
 * Window events keep them decoupled without a store.
 */

export const INTEL_NAV_EVENT = 'rp:intel-nav';
export const INTEL_NOTIFICATIONS_SEEN_EVENT = 'rp:intel-notifications-seen';

export type IntelNavDetail = NonNullable<IntelligenceNotification['link']>;

export function requestIntelNav(detail: IntelNavDetail): void {
    if (typeof window === 'undefined') return;
    if (detail.bucket) window.sessionStorage?.setItem('intel_bucket', detail.bucket);
    window.dispatchEvent(new CustomEvent<IntelNavDetail>(INTEL_NAV_EVENT, { detail }));
}

export function announceNotificationsSeen(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new Event(INTEL_NOTIFICATIONS_SEEN_EVENT));
}

/** Relative "2h ago / yesterday / 3d ago" for feed timestamps. */
export function relativeTime(iso: string, now = Date.now()): string {
    const ms = now - new Date(iso).getTime();
    const h = Math.floor(ms / 3600000);
    if (h < 1) return 'just now';
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d === 1) return 'yesterday';
    return `${d}d ago`;
}

export const SEVERITY_DOT: Record<IntelligenceNotification['severity'], string> = {
    info: 'bg-primary',
    warning: 'bg-warning',
    critical: 'bg-danger',
};
