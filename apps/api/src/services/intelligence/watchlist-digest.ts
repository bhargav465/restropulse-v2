/**
 * Rivals-you-track digest — the insight layer for the Watchlist tab.
 *
 * For each tracked rival, from the nightly checks: yesterday's and this week's
 * new reviews split positive / negative, the actual review texts (the owner
 * wants to read what a rival's guests are praising or complaining about), and
 * whether the rival moved ahead of the merchant on rating this week.
 * Pure aggregation over DailySnapshot docs the worker already writes.
 */

import type { DailySnapshot, SnapshotReview, WatchlistEntry } from '@restropulse/shared';
import { findRestaurantById, getIntelligenceSnapshotsCollection } from '@restropulse/db';

export const POSITIVE_MIN_STARS = 4;
export const NEGATIVE_MAX_STARS = 2;
const COMMENTS_PER_RIVAL = 5;
const WEEK_DAYS = 7;

export interface RivalComment {
    rating: number;
    text: string;
    date: string; // YYYY-MM-DD of the check that captured it
}

export interface RivalDigest {
    placeId: string;
    name: string;
    /** Latest captured numbers, if any check has run. */
    latest?: { date: string; rating: number; reviewCount: number };
    yesterday: { date: string | null; total: number; positive: number; negative: number };
    week: { total: number; positive: number; negative: number };
    positiveComments: RivalComment[];
    negativeComments: RivalComment[];
    /** True when this rival's latest rating is above the merchant's latest. */
    aheadOnRating?: boolean;
}

export interface WatchlistDigestResponse {
    rivals: RivalDigest[];
    /** False until the nightly worker has captured at least one rival check. */
    hasData: boolean;
}

function tally(reviews: SnapshotReview[]): { total: number; positive: number; negative: number } {
    let positive = 0;
    let negative = 0;
    for (const r of reviews) {
        if (r.rating >= POSITIVE_MIN_STARS) positive++;
        if (r.rating <= NEGATIVE_MAX_STARS) negative++;
    }
    return { total: reviews.length, positive, negative };
}

export function buildDigest(entries: WatchlistEntry[], snapshots: DailySnapshot[], selfRating?: number): WatchlistDigestResponse {
    const byTarget = new Map<string, DailySnapshot[]>();
    for (const s of snapshots) {
        if (s.isSelf || s.source !== 'google') continue;
        const list = byTarget.get(s.targetPlaceId) ?? [];
        list.push(s);
        byTarget.set(s.targetPlaceId, list);
    }

    let hasData = false;
    const rivals: RivalDigest[] = entries.map((e) => {
        const rows = (byTarget.get(e.placeId) ?? []).sort((a, b) => a.date.localeCompare(b.date));
        if (rows.length > 0) hasData = true;
        const last = rows[rows.length - 1];

        const yesterdayReviews = last?.newReviews ?? [];
        const weekRows = rows.slice(-WEEK_DAYS);
        const weekReviews = weekRows.flatMap((r) => r.newReviews.map((rev) => ({ ...rev, __date: r.date })));

        const comments = weekReviews
            .filter((r) => r.text && r.text.trim())
            .map((r) => ({ rating: r.rating, text: r.text.slice(0, 240), date: (r as SnapshotReview & { __date: string }).__date }));

        return {
            placeId: e.placeId,
            name: e.name,
            ...(last ? { latest: { date: last.date, rating: last.rating, reviewCount: last.reviewCount } } : {}),
            yesterday: { date: last?.date ?? null, ...tally(yesterdayReviews) },
            week: tally(weekReviews),
            positiveComments: comments.filter((c) => c.rating >= POSITIVE_MIN_STARS).slice(-COMMENTS_PER_RIVAL).reverse(),
            negativeComments: comments.filter((c) => c.rating <= NEGATIVE_MAX_STARS).slice(-COMMENTS_PER_RIVAL).reverse(),
            ...(last && typeof selfRating === 'number' ? { aheadOnRating: last.rating > selfRating } : {}),
        };
    });

    return { rivals, hasData };
}

export async function getWatchlistDigest(restaurantId: string, now = new Date()): Promise<WatchlistDigestResponse> {
    const restaurant = await findRestaurantById(restaurantId);
    const entries = restaurant?.intelligence?.watchlist ?? [];
    if (entries.length === 0) return { rivals: [], hasData: false };

    const from = new Date(now.getTime() - (WEEK_DAYS + 1) * 86400000).toISOString().slice(0, 10);
    const snapshots = (await getIntelligenceSnapshotsCollection()
        .find({ restaurantId, date: { $gte: from } })
        .sort({ date: 1 })
        .toArray()) as unknown as DailySnapshot[];

    const selfLatest = snapshots.filter((s) => s.isSelf && s.source === 'google').sort((a, b) => a.date.localeCompare(b.date)).pop();
    return buildDigest(entries, snapshots, selfLatest?.rating);
}
