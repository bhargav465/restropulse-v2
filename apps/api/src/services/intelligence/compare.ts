/**
 * Competition-bucket comparison (Brief 07, v2).
 *
 *  - `buildCompareRows` — PURE + unit-tested. Given the self row and each
 *    watchlist competitor's per-source window data, computes the
 *    "Where They Beat You" gaps (`beatsYou: MetricGap[]`) with EXACT thresholds:
 *      rating gap ≥ 0.1 · review-velocity ratio > 1.25× · responseRate gap ≥ 10
 *      pts · photoCount gap ≥ 10 — each per source that BOTH sides have real
 *      data for (never zeros-as-data). The self row always has `beatsYou: []`.
 *  - `getCompareRows` — reads `intelligence_snapshots` for self + watchlist over
 *    a day/month window and calls `buildCompareRows`.
 *  - `getNewOpenings` — reads `nearby_sightings` for the New Openings radar.
 */

import {
    getIntelligenceSnapshotsCollection,
    getNearbySightingsCollection,
    getCompetitorCacheCollection,
    findRestaurantById,
} from '@restropulse/db';
import type {
    CompareRow,
    MetricGap,
    SnapshotSource,
    DailySnapshot,
    NearbyPlaceSighting,
} from '@restropulse/shared';

// ---- Thresholds (exact — do not soften) ----
export const RATING_GAP_MIN = 0.1;
export const REVIEW_VELOCITY_RATIO_MIN = 1.25;
export const RESPONSE_RATE_GAP_MIN = 10;
export const PHOTO_COUNT_GAP_MIN = 10;

// ---- Pure comparison ----

/** Per-source window data for a single target. `velocity` = new reviews per day. */
export interface SourceWindowData {
    rating: number;
    reviewCount: number;
    newReviews: number;
    photoCount: number;
    responseRate?: number;
    velocity: number;
}

/** One target (self or competitor) with the per-source data present in the window. */
export interface CompareTarget {
    placeId: string;
    name: string;
    isSelf: boolean;
    google?: SourceWindowData;
    zomato?: SourceWindowData;
}

const SOURCES: SnapshotSource[] = ['google', 'zomato'];

function projectSource(d: SourceWindowData): NonNullable<CompareRow['google']> {
    return {
        rating: d.rating,
        reviewCount: d.reviewCount,
        newReviews: d.newReviews,
        photoCount: d.photoCount,
    };
}

/** Gaps where the competitor beats you on a source BOTH of you have data for. */
function beatsYouFor(self: CompareTarget, comp: CompareTarget): MetricGap[] {
    const gaps: MetricGap[] = [];
    for (const source of SOURCES) {
        const mine = self[source];
        const theirs = comp[source];
        // Never zeros-as-data: only compare a source both sides actually have.
        if (!mine || !theirs) continue;

        // rating gap ≥ 0.1 (round first — avoids 4.1 − 4.0 = 0.0999… float miss)
        const ratingGap = round2(theirs.rating - mine.rating);
        if (ratingGap >= RATING_GAP_MIN) {
            gaps.push({ metric: 'rating', source, yours: mine.rating, theirs: theirs.rating, gap: ratingGap });
        }

        // review-velocity ratio > 1.25× (new reviews per day over the window)
        if (theirs.velocity > 0 && theirs.velocity > REVIEW_VELOCITY_RATIO_MIN * mine.velocity) {
            gaps.push({
                metric: 'reviewVelocity',
                source,
                yours: round2(mine.velocity),
                theirs: round2(theirs.velocity),
                gap: round2(theirs.velocity - mine.velocity),
            });
        }

        // responseRate gap ≥ 10 pts (only when both sides measured it)
        if (typeof mine.responseRate === 'number' && typeof theirs.responseRate === 'number') {
            const rrGap = theirs.responseRate - mine.responseRate;
            if (rrGap >= RESPONSE_RATE_GAP_MIN) {
                gaps.push({ metric: 'responseRate', source, yours: mine.responseRate, theirs: theirs.responseRate, gap: round2(rrGap) });
            }
        }

        // photoCount gap ≥ 10
        const photoGap = theirs.photoCount - mine.photoCount;
        if (photoGap >= PHOTO_COUNT_GAP_MIN) {
            gaps.push({ metric: 'photoCount', source, yours: mine.photoCount, theirs: theirs.photoCount, gap: photoGap });
        }
    }
    return gaps;
}

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

function toCompareRow(t: CompareTarget, beatsYou: MetricGap[]): CompareRow {
    return {
        placeId: t.placeId,
        name: t.name,
        isSelf: t.isSelf,
        ...(t.google ? { google: projectSource(t.google) } : {}),
        ...(t.zomato ? { zomato: projectSource(t.zomato) } : {}),
        beatsYou,
    };
}

/**
 * PURE. Builds the compare table: the self row first (`beatsYou: []`), then one
 * row per competitor with its "Where They Beat You" gaps.
 */
export function buildCompareRows(self: CompareTarget, competitors: CompareTarget[]): CompareRow[] {
    const rows: CompareRow[] = [toCompareRow(self, [])];
    for (const comp of competitors) {
        rows.push(toCompareRow(comp, beatsYouFor(self, comp)));
    }
    return rows;
}

// ---- Window loading (day | month) ----

export type CompareWindow =
    | { granularity: 'day'; date: string }
    | { granularity: 'month'; month: string };

/** Days spanned by a window, for per-day velocity. */
function windowDays(win: CompareWindow): number {
    if (win.granularity === 'day') return 1;
    const [y, m] = win.month.split('-').map(Number);
    return new Date(y, m, 0).getDate(); // days in month
}

function monthPrefix(date: string): string {
    return date.slice(0, 7);
}

/** Reduce a target's snapshots (one source) within the window to SourceWindowData. */
function reduceSource(rows: DailySnapshot[], win: CompareWindow): SourceWindowData | undefined {
    const inWindow =
        win.granularity === 'day'
            ? rows.filter((r) => r.date === win.date)
            : rows.filter((r) => monthPrefix(r.date) === win.month);
    if (inWindow.length === 0) return undefined;

    inWindow.sort((a, b) => a.date.localeCompare(b.date));
    const last = inWindow[inWindow.length - 1];
    const newReviews = inWindow.reduce((sum, r) => sum + (r.newReviews?.length ?? 0), 0);
    const responseRates = inWindow.map((r) => r.responseRate).filter((v): v is number => typeof v === 'number');
    return {
        rating: last.rating,
        reviewCount: last.reviewCount,
        newReviews,
        photoCount: last.photoCount,
        responseRate: responseRates.length ? responseRates[responseRates.length - 1] : undefined,
        velocity: newReviews / windowDays(win),
    };
}

async function loadTarget(
    restaurantId: string,
    placeId: string,
    name: string,
    isSelf: boolean,
    win: CompareWindow,
): Promise<CompareTarget> {
    const from = win.granularity === 'day' ? win.date : `${win.month}-01`;
    const to = win.granularity === 'day' ? win.date : `${win.month}-31`;
    const docs = (await getIntelligenceSnapshotsCollection()
        .find({ restaurantId, targetPlaceId: placeId, date: { $gte: from, $lte: to } })
        .toArray()) as unknown as DailySnapshot[];

    const bySource = (s: SnapshotSource) => reduceSource(docs.filter((d) => d.source === s), win);
    return {
        placeId,
        name,
        isSelf,
        google: bySource('google'),
        zomato: bySource('zomato'),
    };
}

/** Resolve the restaurant's own target placeId from the latest self snapshot. */
async function resolveSelfPlaceId(restaurantId: string): Promise<{ placeId: string; name: string } | null> {
    const doc = (await getIntelligenceSnapshotsCollection().findOne(
        { restaurantId, isSelf: true },
        { sort: { date: -1 } },
    )) as unknown as DailySnapshot | null;
    if (!doc) return null;
    const restaurant = await findRestaurantById(restaurantId);
    return { placeId: doc.targetPlaceId, name: restaurant?.name ?? 'Your restaurant' };
}

/** Reads snapshots for self + watchlist over the window and builds the compare table. */
export async function getCompareRows(restaurantId: string, win: CompareWindow): Promise<CompareRow[]> {
    const self = await resolveSelfPlaceId(restaurantId);
    const restaurant = await findRestaurantById(restaurantId);
    const watchlist = restaurant?.intelligence?.watchlist ?? [];

    const selfTarget: CompareTarget = self
        ? await loadTarget(restaurantId, self.placeId, self.name, true, win)
        : { placeId: 'self', name: restaurant?.name ?? 'Your restaurant', isSelf: true };

    const competitors = await Promise.all(
        watchlist.map((w) => loadTarget(restaurantId, w.placeId, w.name, false, win)),
    );
    return buildCompareRows(selfTarget, competitors);
}

// ---- New openings radar ----

export interface NewOpening {
    placeId: string;
    name: string;
    distanceKm: number;
    cuisine?: string;
    firstSeenAt: Date;
    ratingAtFirstSeen: number;
    reviewsAtFirstSeen: number;
    currentReviewCount: number;
    reviewsSinceFirstSeen: number;
    daysSinceFirstSeen: number;
    fastStarter: boolean;
}

const FAST_STARTER_MIN_REVIEWS = 30;
const FAST_STARTER_MAX_DAYS = 21;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Current review count for a sighting, from the 7-day competitor_cache payload. */
async function currentReviewCountFromCache(placeId: string): Promise<number | null> {
    const doc = await getCompetitorCacheCollection().findOne({ placeId });
    const payload = doc?.payload as { userRatingCount?: number } | undefined;
    return typeof payload?.userRatingCount === 'number' ? payload.userRatingCount : null;
}

/**
 * New Openings radar: sightings first seen within `sinceDays` and within
 * `radiusKm`, sorted by distance ascending. `fastStarter` when the place has
 * gained ≥ 30 reviews within ≤ 21 days of first being seen.
 *
 * `getCurrentReviews` is injectable for tests; it defaults to the
 * `competitor_cache` payload.
 */
export async function getNewOpenings(
    restaurantId: string,
    radiusKm: number,
    sinceDays: number,
    getCurrentReviews: (placeId: string) => Promise<number | null> = currentReviewCountFromCache,
): Promise<NewOpening[]> {
    const now = Date.now();
    const cutoff = new Date(now - sinceDays * MS_PER_DAY);

    const docs = (await getNearbySightingsCollection()
        .find({
            restaurantId,
            firstSeenAt: { $gte: cutoff },
            distanceKm: { $lte: radiusKm },
        })
        .sort({ distanceKm: 1 })
        .toArray()) as unknown as NearbyPlaceSighting[];

    const openings: NewOpening[] = [];
    for (const s of docs) {
        const current = (await getCurrentReviews(s.placeId)) ?? s.reviewsAtFirstSeen;
        const reviewsSince = Math.max(0, current - s.reviewsAtFirstSeen);
        const daysSince = Math.max(0, Math.floor((now - new Date(s.firstSeenAt).getTime()) / MS_PER_DAY));
        openings.push({
            placeId: s.placeId,
            name: s.name,
            distanceKm: s.distanceKm,
            cuisine: s.cuisine,
            firstSeenAt: s.firstSeenAt,
            ratingAtFirstSeen: s.ratingAtFirstSeen,
            reviewsAtFirstSeen: s.reviewsAtFirstSeen,
            currentReviewCount: current,
            reviewsSinceFirstSeen: reviewsSince,
            daysSinceFirstSeen: daysSince,
            fastStarter: reviewsSince >= FAST_STARTER_MIN_REVIEWS && daysSince <= FAST_STARTER_MAX_DAYS,
        });
    }
    return openings;
}
