/**
 * Daily snapshots (Brief 07, v2) — the time-series backbone of both buckets.
 *
 *  - `captureSnapshot` — fetch current numbers for a target×source, diff new
 *    reviews against the latest prior snapshot, tag themes, and upsert by the
 *    unique key (idempotent per target×source×day). Google numbers come from the
 *    `places.ts` client + 7-day `competitor_cache`; Zomato numbers from the
 *    adapter registry (`zomato.ts`).
 *  - `runDailySnapshotJob` — captures self + every watchlist competitor across
 *    both sources; the same job the worker (Brief 08) runs and the on-demand
 *    `POST /snapshots/capture` route triggers.
 *  - `getSeries` — day (raw rows) / month (server-side aggregate) trend series.
 *  - `getFeedbackChanges` — the self-only "what changed" feed (both sources).
 *
 * Filter presets (MTD / specific-date / overall) are client-side query params
 * only — there are no preset-specific endpoints.
 */

import {
    getIntelligenceSnapshotsCollection,
    getCompetitorCacheCollection,
    findRestaurantById,
} from '@restropulse/db';
import type {
    DailySnapshot,
    SnapshotSource,
    SnapshotReview,
    ReviewTheme,
} from '@restropulse/shared';
import { getBaseRestaurantDetails } from './places.js';
import { fetchWebsiteSEO } from './seo.js';
import { tagReviewThemes } from './themes.js';
import { getZomatoAdapter, type ZomatoAdapter } from './zomato.js';

// ---- Measurement shape ----

/** Current measured numbers for a target×source, plus the reviews to diff. */
export interface SnapshotMeasurement {
    rating: number;
    reviewCount: number;
    photoCount: number;
    seoScore?: number; // self + google only
    responseRate?: number; // % recent reviews with an owner reply, when measurable
    reviews: SnapshotReview[]; // current reviews (for the newReviews diff)
}

/** A resolved capture target (the route/worker resolves 'self'|placeId → this). */
export interface CaptureTarget {
    placeId: string; // the target's own Google placeId (self's own, or a competitor's)
    isSelf: boolean;
    name: string;
    zomatoUrl?: string;
    selfQuery?: { name: string; city: string }; // required to measure self on Google
}

/** Injectable dependencies (tests stub Places / Anthropic / the Zomato adapter). */
export interface CaptureDeps {
    measureGoogle?: (target: CaptureTarget) => Promise<SnapshotMeasurement | null>;
    zomatoAdapter?: ZomatoAdapter;
    tagThemes?: typeof tagReviewThemes;
}

// ---- Default measurers ----

/** Simple 0–100 SEO score from the deterministic website signals (self google). */
function scoreSeoSignals(seo: Awaited<ReturnType<typeof fetchWebsiteSEO>>): number {
    const signals = [
        seo.hasWebsite,
        seo.customDomain,
        seo.cleanUrl,
        seo.hasH1,
        seo.h1IncludesCity,
        seo.h1IncludesBrand,
        seo.hasMetaDescription,
        seo.metaDescriptionOptimalLength,
        seo.metaDescriptionIncludesCity,
    ];
    const hit = signals.filter(Boolean).length;
    return Math.round((hit / signals.length) * 100);
}

/** Default Google measurer: self via Places search, competitors via competitor_cache. */
async function defaultMeasureGoogle(target: CaptureTarget): Promise<SnapshotMeasurement | null> {
    if (target.isSelf) {
        if (!target.selfQuery) return null;
        const base = await getBaseRestaurantDetails(target.selfQuery.name, target.selfQuery.city);
        if (!base) return null;
        const reviews: SnapshotReview[] = base.recentReviews.map((r) => ({
            rating: r.rating,
            text: r.text,
            time: r.time,
        }));
        const seo = await fetchWebsiteSEO(base.website, base.name, target.selfQuery.city);
        return {
            rating: base.rating,
            reviewCount: base.totalRatings,
            photoCount: base.photoCount,
            seoScore: scoreSeoSignals(seo),
            reviews,
        };
    }

    // Competitor: reuse the 7-day competitor_cache payload (no extra Places cost).
    const doc = await getCompetitorCacheCollection().findOne({ placeId: target.placeId });
    const payload = doc?.payload as
        | {
              rating?: number;
              userRatingCount?: number;
              photos?: unknown[];
              reviews?: Array<{ rating?: number; text?: { text?: string }; relativePublishTimeDescription?: string }>;
          }
        | undefined;
    if (!payload) return null;
    const reviews: SnapshotReview[] = (payload.reviews ?? []).slice(0, 5).map((r) => ({
        rating: r.rating ?? 0,
        text: (r.text?.text ?? '').slice(0, 200),
        time: r.relativePublishTimeDescription ?? '',
    }));
    return {
        rating: payload.rating ?? 0,
        reviewCount: payload.userRatingCount ?? 0,
        photoCount: Array.isArray(payload.photos) ? payload.photos.length : 0,
        reviews,
    };
}

// ---- Diff ----

function reviewKey(r: SnapshotReview): string {
    return `${r.author ?? ''}|${r.text}|${r.time}`;
}

/** Latest prior snapshot for a target×source, strictly before `date`. */
async function latestPrior(
    restaurantId: string,
    targetPlaceId: string,
    source: SnapshotSource,
    date: string,
): Promise<DailySnapshot | null> {
    const doc = await getIntelligenceSnapshotsCollection().findOne(
        { restaurantId, targetPlaceId, source, date: { $lt: date } },
        { sort: { date: -1 } },
    );
    return (doc as unknown as DailySnapshot | null) ?? null;
}

/** Reviews present now that were not in the latest prior snapshot's newReviews. */
function diffNewReviews(current: SnapshotReview[], prior: DailySnapshot | null): SnapshotReview[] {
    if (!prior) return current;
    const seen = new Set((prior.newReviews ?? []).map(reviewKey));
    return current.filter((r) => !seen.has(reviewKey(r)));
}

// ---- Capture ----

function snapshotId(restaurantId: string, targetPlaceId: string, source: SnapshotSource, date: string): string {
    return `${restaurantId}:${targetPlaceId}:${source}:${date}`;
}

/**
 * Capture (idempotent upsert) one target×source snapshot for `date`.
 * Returns the written snapshot, or null when the source has no data (e.g. a
 * Zomato target with no manual entry) — no empty rows are written.
 */
export async function captureSnapshot(
    restaurantId: string,
    target: CaptureTarget,
    source: SnapshotSource,
    date: string,
    deps: CaptureDeps = {},
): Promise<DailySnapshot | null> {
    const measure =
        source === 'google'
            ? (deps.measureGoogle ?? defaultMeasureGoogle)
            : undefined;

    let measurement: SnapshotMeasurement | null;
    if (source === 'google') {
        measurement = await measure!(target);
    } else {
        const adapter = deps.zomatoAdapter ?? getZomatoAdapter();
        const z = await adapter.fetch({ placeId: target.placeId, zomatoUrl: target.zomatoUrl });
        // Zomato provides no review text — numbers only.
        measurement = z
            ? { rating: z.rating, reviewCount: z.reviewCount, photoCount: z.photoCount, reviews: [] }
            : null;
    }
    if (!measurement) return null;

    const prior = await latestPrior(restaurantId, target.placeId, source, date);
    const unseen = diffNewReviews(measurement.reviews, prior);

    const tag = deps.tagThemes ?? tagReviewThemes;
    const newReviews = unseen.length > 0 ? await tag(unseen) : [];

    const now = new Date();
    const doc: DailySnapshot = {
        _id: snapshotId(restaurantId, target.placeId, source, date),
        restaurantId,
        targetPlaceId: target.placeId,
        isSelf: target.isSelf,
        source,
        date,
        rating: measurement.rating,
        reviewCount: measurement.reviewCount,
        photoCount: measurement.photoCount,
        ...(typeof measurement.seoScore === 'number' && target.isSelf && source === 'google'
            ? { seoScore: measurement.seoScore }
            : {}),
        newReviews,
        ...(typeof measurement.responseRate === 'number' ? { responseRate: measurement.responseRate } : {}),
        capturedAt: now,
    };

    const { _id, ...rest } = doc;
    await getIntelligenceSnapshotsCollection().updateOne(
        { restaurantId, targetPlaceId: target.placeId, source, date },
        { $set: rest, $setOnInsert: { _id } },
        { upsert: true },
    );
    return doc;
}

/**
 * The self target's stable Google placeId (shared across sources). Resolved from
 * the most recent self snapshot; falls back to a synthetic id before the first
 * capture. Both Google and Zomato self snapshots use this same id so the compare
 * and series joins line up.
 */
export async function resolveSelfPlaceId(restaurantId: string): Promise<string> {
    const selfSnap = (await getIntelligenceSnapshotsCollection().findOne(
        { restaurantId, isSelf: true },
        { sort: { date: -1 } },
    )) as unknown as DailySnapshot | null;
    return selfSnap?.targetPlaceId ?? `self:${restaurantId}`;
}

/**
 * Capture self + every watchlist competitor across both sources for `date`.
 * The same job the weekly/daily worker (Brief 08) runs; the on-demand
 * `POST /snapshots/capture` route calls this for instant gratification.
 */
export async function runDailySnapshotJob(
    restaurantId: string,
    date: string,
    deps: CaptureDeps = {},
): Promise<DailySnapshot[]> {
    const restaurant = await findRestaurantById(restaurantId);
    if (!restaurant) return [];

    const written: DailySnapshot[] = [];

    const selfPlaceId = await resolveSelfPlaceId(restaurantId);

    const selfCity =
        (restaurant as { sourceCity?: string }).sourceCity ??
        restaurant.location?.address ??
        '';
    const selfTarget: CaptureTarget = {
        placeId: selfPlaceId,
        isSelf: true,
        name: restaurant.name,
        zomatoUrl: restaurant.intelligence?.selfZomatoUrl,
        selfQuery: { name: restaurant.name, city: selfCity },
    };

    for (const source of ['google', 'zomato'] as SnapshotSource[]) {
        const snap = await captureSnapshot(restaurantId, selfTarget, source, date, deps);
        if (snap) written.push(snap);
    }

    for (const w of restaurant.intelligence?.watchlist ?? []) {
        const compTarget: CaptureTarget = {
            placeId: w.placeId,
            isSelf: false,
            name: w.name,
            zomatoUrl: w.zomatoUrl,
        };
        for (const source of ['google', 'zomato'] as SnapshotSource[]) {
            const snap = await captureSnapshot(restaurantId, compTarget, source, date, deps);
            if (snap) written.push(snap);
        }
    }

    return written;
}

// ---- Series (day | month) ----

export interface SeriesQuery {
    targetPlaceId: string;
    source: SnapshotSource | 'both';
    from?: string;
    to?: string;
    granularity: 'day' | 'month';
}

/** One numeric point in a trend series (newReviews is a COUNT here). */
export interface SnapshotSeriesPoint {
    date: string; // YYYY-MM-DD (day) or YYYY-MM (month)
    source: SnapshotSource;
    rating: number;
    reviewCount: number;
    newReviews: number;
    photoCount: number;
    seoScore?: number;
}

function toDayPoint(s: DailySnapshot): SnapshotSeriesPoint {
    return {
        date: s.date,
        source: s.source,
        rating: s.rating,
        reviewCount: s.reviewCount,
        newReviews: s.newReviews?.length ?? 0,
        photoCount: s.photoCount,
        ...(typeof s.seoScore === 'number' ? { seoScore: s.seoScore } : {}),
    };
}

/** Month aggregate: rating = last-of-month, newReviews = sum, photos/seo = last. */
function aggregateMonths(rows: DailySnapshot[], source: SnapshotSource): SnapshotSeriesPoint[] {
    const byMonth = new Map<string, DailySnapshot[]>();
    for (const r of rows) {
        const month = r.date.slice(0, 7);
        const list = byMonth.get(month) ?? [];
        list.push(r);
        byMonth.set(month, list);
    }
    const points: SnapshotSeriesPoint[] = [];
    for (const [month, list] of byMonth) {
        list.sort((a, b) => a.date.localeCompare(b.date));
        const last = list[list.length - 1];
        points.push({
            date: month,
            source,
            rating: last.rating,
            reviewCount: last.reviewCount,
            newReviews: list.reduce((sum, r) => sum + (r.newReviews?.length ?? 0), 0),
            photoCount: last.photoCount,
            ...(typeof last.seoScore === 'number' ? { seoScore: last.seoScore } : {}),
        });
    }
    return points.sort((a, b) => a.date.localeCompare(b.date));
}

/** Trend series for a target: day (raw rows) or month (server-side aggregate). */
export async function getSeries(restaurantId: string, q: SeriesQuery): Promise<SnapshotSeriesPoint[]> {
    const filter: Record<string, unknown> = { restaurantId, targetPlaceId: q.targetPlaceId };
    if (q.source !== 'both') filter.source = q.source;
    if (q.from || q.to) {
        const range: Record<string, string> = {};
        if (q.from) range.$gte = q.from;
        if (q.to) range.$lte = q.to;
        filter.date = range;
    }

    const docs = (await getIntelligenceSnapshotsCollection()
        .find(filter)
        .sort({ date: 1 })
        .toArray()) as unknown as DailySnapshot[];

    const sources: SnapshotSource[] = q.source === 'both' ? ['google', 'zomato'] : [q.source];

    if (q.granularity === 'day') {
        return docs
            .map(toDayPoint)
            .sort((a, b) => a.date.localeCompare(b.date) || a.source.localeCompare(b.source));
    }

    const out: SnapshotSeriesPoint[] = [];
    for (const source of sources) {
        out.push(...aggregateMonths(docs.filter((d) => d.source === source), source));
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.source.localeCompare(b.source));
}

// ---- Feedback changes (self only, both sources) ----

export interface FeedbackReview extends SnapshotReview {
    source: SnapshotSource;
}

export interface FeedbackDay {
    date: string;
    newReviews: FeedbackReview[];
    ratingBefore: number | null;
    ratingAfter: number;
    themesTrending: ReviewTheme[];
}

/**
 * The self-only "what changed" feed: per day, the new reviews (merged across
 * sources with a source tag), the before/after rating, and the trending themes.
 */
export async function getFeedbackChanges(
    restaurantId: string,
    from: string,
    to: string,
): Promise<{ days: FeedbackDay[] }> {
    const docs = (await getIntelligenceSnapshotsCollection()
        .find({ restaurantId, isSelf: true, date: { $gte: from, $lte: to } })
        .sort({ date: 1 })
        .toArray()) as unknown as DailySnapshot[];

    // Rating right before the window, for the first day's `ratingBefore`.
    const priorDoc = (await getIntelligenceSnapshotsCollection().findOne(
        { restaurantId, isSelf: true, source: 'google', date: { $lt: from } },
        { sort: { date: -1 } },
    )) as unknown as DailySnapshot | null;

    const byDate = new Map<string, DailySnapshot[]>();
    for (const d of docs) {
        const list = byDate.get(d.date) ?? [];
        list.push(d);
        byDate.set(d.date, list);
    }

    const days: FeedbackDay[] = [];
    let prevRating: number | null = priorDoc?.rating ?? null;

    for (const date of [...byDate.keys()].sort()) {
        const list = byDate.get(date)!;
        const google = list.find((d) => d.source === 'google');
        const zomato = list.find((d) => d.source === 'zomato');

        const newReviews: FeedbackReview[] = [];
        for (const snap of list) {
            for (const r of snap.newReviews ?? []) newReviews.push({ ...r, source: snap.source });
        }

        const ratingAfter = google?.rating ?? zomato?.rating ?? prevRating ?? 0;

        // Trending themes: most frequent across the day's new reviews (top 3).
        const counts = new Map<ReviewTheme, number>();
        for (const r of newReviews) {
            for (const t of r.themes ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
        }
        const themesTrending = [...counts.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([t]) => t);

        days.push({ date, newReviews, ratingBefore: prevRating, ratingAfter, themesTrending });
        prevRating = ratingAfter;
    }

    return { days };
}
