/**
 * Intelligence notification feed — the owner's reason to open the app today.
 *
 * Nothing new is measured here. The worker already produces everything: the
 * weekly report with deltas + competitor alerts (`alerts.ts`), and the nightly
 * self snapshots with each day's new reviews. Until now that work was invisible
 * unless the owner went looking. This module turns it into a short, dated feed
 * and tracks one thing per restaurant — when the owner last looked — so
 * "unread" means something.
 *
 * `deriveNotifications` is pure (unit-tested); `getNotificationFeed` loads the
 * inputs from Mongo.
 */

import type {
    DailySnapshot,
    IntelligenceNotification,
    IntelligenceNotificationsResponse,
    IntelligenceReport,
} from '@restropulse/shared';
import {
    findRestaurantById,
    getIntelligenceReportsCollection,
    getIntelligenceSnapshotsCollection,
} from '@restropulse/db';

/** How many days of nightly self snapshots feed the review items. */
export const REVIEW_LOOKBACK_DAYS = 7;
/** Feed size cap — this is a nudge, not an archive. */
export const MAX_ITEMS = 20;

export const POSITIVE_MIN_STARS = 4;
export const NEGATIVE_MAX_STARS = 2;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const fmtDate = (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
};

export interface DeriveInput {
    latest: IntelligenceReport | null;
    /** Self (Google) snapshots, any order, within the lookback window. */
    selfSnapshots: DailySnapshot[];
    seenAt: Date | null;
    /** "Now" for the weekly window; injectable for tests. */
    now: Date;
}

export function deriveNotifications(input: DeriveInput): IntelligenceNotificationsResponse {
    const { latest, selfSnapshots, seenAt, now } = input;
    const items: IntelligenceNotification[] = [];
    const seenMs = seenAt ? seenAt.getTime() : 0;
    const unreadFor = (atIso: string) => new Date(atIso).getTime() > seenMs;
    const push = (n: Omit<IntelligenceNotification, 'unread'>) => items.push({ ...n, unread: unreadFor(n.at) });

    // ---- From the latest report -------------------------------------------
    if (latest) {
        const at = new Date(latest.generatedAt).toISOString();
        const d = latest.deltas;
        const first = !d;
        push({
            id: `report:${latest._id}`,
            kind: 'report_ready',
            severity: 'info',
            title: first ? 'Your first report is ready' : 'Your new weekly report is ready',
            body: first
                ? `Score ${latest.restroScore}/100 · rank #${latest.ranking.rank} of ${latest.ranking.total} nearby.`
                : `Score ${latest.restroScore}/100 (${d.restroScoreDelta >= 0 ? '+' : ''}${d.restroScoreDelta}) · rank #${latest.ranking.rank} of ${latest.ranking.total} nearby.`,
            at,
            link: { view: 'INTELLIGENCE', bucket: 'MINE', tab: 'OVERVIEW' },
        });
        if (d && d.restroScoreDelta !== 0) {
            const up = d.restroScoreDelta > 0;
            push({
                id: `score:${latest._id}`,
                kind: 'score_change',
                severity: up ? 'info' : 'warning',
                title: up ? `Your score went up ${d.restroScoreDelta} points` : `Your score dropped ${Math.abs(d.restroScoreDelta)} points`,
                body: up ? 'Whatever you changed is working — keep going.' : 'Open the action plan to see what slipped.',
                at,
                link: { view: 'INTELLIGENCE', bucket: 'MINE', tab: 'OVERVIEW' },
            });
        }
        for (const [i, a] of (d?.competitorAlerts ?? []).entries()) {
            const isSelfRating = a.type === 'rating_drop';
            push({
                id: `alert:${latest._id}:${i}`,
                kind: a.type,
                severity: a.severity,
                title:
                    a.type === 'competitor_surge'
                        ? `${a.competitorName ?? 'A rival'} is gaining reviews fast`
                        : a.type === 'new_competitor'
                          ? `${a.competitorName ?? 'A new restaurant'} opened near you`
                          : 'Your Google rating dropped',
                body: a.message,
                at,
                link: isSelfRating
                    ? { view: 'INTELLIGENCE', bucket: 'MINE', tab: 'FEEDBACK' }
                    : { view: 'INTELLIGENCE', bucket: 'COMPETITION', tab: a.type === 'new_competitor' ? 'OPENINGS' : 'THREATS' },
            });
        }
    }

    // ---- From the nightly self snapshots (Google) ---------------------------
    const google = selfSnapshots
        .filter((s) => s.isSelf && s.source === 'google')
        .sort((a, b) => a.date.localeCompare(b.date));

    // Yesterday (t-1): the latest captured day.
    const lastDay = google[google.length - 1];
    if (lastDay && lastDay.newReviews.length > 0) {
        const pos = lastDay.newReviews.filter((r) => r.rating >= POSITIVE_MIN_STARS).length;
        const neg = lastDay.newReviews.filter((r) => r.rating <= NEGATIVE_MAX_STARS).length;
        const at = new Date(`${lastDay.date}T23:59:00Z`).toISOString();
        const worst = [...lastDay.newReviews].sort((a, b) => a.rating - b.rating)[0];
        push({
            id: `reviews:${lastDay.date}`,
            kind: neg > 0 ? 'negative_review' : 'new_reviews',
            severity: neg > 0 ? 'warning' : 'info',
            title: `${plural(lastDay.newReviews.length, 'new Google review')} on ${fmtDate(lastDay.date)}`,
            body:
                (pos || neg ? `${pos} positive · ${neg} negative. ` : '') +
                (neg > 0 && worst?.text ? `“${worst.text.slice(0, 120)}${worst.text.length > 120 ? '…' : ''}” — reply today.` : pos > 0 ? 'Say thanks — replies lift your profile.' : ''),
            at,
            link: { view: 'INTELLIGENCE', bucket: 'MINE', tab: 'FEEDBACK' },
        });
    }

    // This week vs last week: review volume + tone.
    const dayMs = 86400000;
    const weekAgo = new Date(now.getTime() - 7 * dayMs).toISOString().slice(0, 10);
    const twoWeeksAgo = new Date(now.getTime() - 14 * dayMs).toISOString().slice(0, 10);
    const thisWeek = google.filter((s) => s.date > weekAgo);
    const lastWeek = google.filter((s) => s.date > twoWeeksAgo && s.date <= weekAgo);
    const tally = (rows: DailySnapshot[]) => {
        let n = 0, pos = 0, neg = 0;
        for (const s of rows) for (const r of s.newReviews) {
            n++;
            if (r.rating >= POSITIVE_MIN_STARS) pos++;
            if (r.rating <= NEGATIVE_MAX_STARS) neg++;
        }
        return { n, pos, neg };
    };
    const tw = tally(thisWeek);
    if (thisWeek.length > 0 && tw.n > 0) {
        const lw = tally(lastWeek);
        const diff = lastWeek.length > 0 ? tw.n - lw.n : null;
        const at = new Date(`${thisWeek[thisWeek.length - 1].date}T23:58:00Z`).toISOString();
        push({
            id: `week:${thisWeek[thisWeek.length - 1].date}`,
            kind: tw.neg > tw.pos ? 'negative_review' : 'new_reviews',
            severity: tw.neg > tw.pos ? 'warning' : 'info',
            title: `This week: ${plural(tw.n, 'new review')} — ${tw.pos} positive, ${tw.neg} negative`,
            body:
                diff === null
                    ? 'First full week of daily checks.'
                    : diff === 0
                      ? 'Same as last week.'
                      : `${diff > 0 ? '+' : ''}${diff} vs last week${lw.neg !== tw.neg ? ` · negatives ${lw.neg} → ${tw.neg}` : ''}.`,
            at,
            link: { view: 'INTELLIGENCE', bucket: 'MINE', tab: 'FEEDBACK' },
        });
    }

    items.sort((a, b) => b.at.localeCompare(a.at));
    const trimmed = items.slice(0, MAX_ITEMS);
    return {
        items: trimmed,
        unread: trimmed.filter((i) => i.unread).length,
        seenAt: seenAt ? seenAt.toISOString() : null,
    };
}

export async function getNotificationFeed(restaurantId: string, now = new Date()): Promise<IntelligenceNotificationsResponse> {
    const [restaurant, reports, from] = [
        await findRestaurantById(restaurantId),
        (await getIntelligenceReportsCollection()
            .find({ restaurantId })
            .sort({ generatedAt: -1 })
            .limit(1)
            .toArray()) as unknown as IntelligenceReport[],
        new Date(now.getTime() - (REVIEW_LOOKBACK_DAYS + 7) * 86400000).toISOString().slice(0, 10),
    ];
    const selfSnapshots = (await getIntelligenceSnapshotsCollection()
        .find({ restaurantId, isSelf: true, source: 'google', date: { $gte: from } })
        .sort({ date: 1 })
        .toArray()) as unknown as DailySnapshot[];
    const seenRaw = restaurant?.intelligence?.notificationsSeenAt;
    const seenAt = seenRaw ? new Date(seenRaw) : null;
    return deriveNotifications({ latest: reports[0] ?? null, selfSnapshots, seenAt, now });
}
