/**
 * *** SAMPLE DATA ONLY — demo-mode Intelligence dashboard fixtures (VITE_DEMO_MODE) ***
 *
 * MIRROR of packages/db/src/seeds/intelligence-snapshots-demo.ts (Brief 06):
 * the same demo restaurant (`demo-r1`, self placeId `sample-place-demo-kitchen`),
 * a 3-competitor watchlist, 60 days of per-target×source daily snapshots, and 8
 * nearby sightings (2 recent fast-starters). Every human string is [SAMPLE].
 *
 * LAZY-LOADED (dynamic import()) from demo-api.ts's intelligence dashboard methods so
 * this fixture only ships in the chunk the Intelligence tab pulls in.
 *
 * DETERMINISTIC given an anchor date: a seeded mulberry32 PRNG (no Math.random)
 * drives the series. The anchor defaults to "today" so the gh-pages preview
 * always looks fresh (mirrors the v1 fixtures' relative-date approach); the pure
 * builders/derivers accept an explicit anchor so tests stay reproducible.
 *
 * Demo-only twists vs the seed (to exercise every UI path):
 *   - self-zomato starts ABSENT → DailyTrends shows "Add your Zomato numbers";
 *     postZomatoManual() adds today's self-zomato point live in-session.
 *   - self-google has a 2-day GAP + 2 `backfilled` points so DailyTrends can
 *     render gaps-not-zeros and hollow catch-up markers.
 */
import type {
    DailySnapshot,
    NearbyPlaceSighting,
    ReviewTheme,
    SnapshotReview,
    SnapshotSource,
    WatchlistEntry,
    CompareRow,
    MetricGap,
} from '@restropulse/shared';
import { REVIEW_THEMES } from '@restropulse/shared';
import type { SnapshotSeriesPoint, FeedbackDay, FeedbackReview, NewOpening } from '../api';

export const DEMO_RESTAURANT_ID = 'demo-r1';
export const DEMO_SELF_PLACE_ID = 'sample-place-demo-kitchen';
const R = DEMO_RESTAURANT_ID;
const SNAPSHOT_DAYS = 60;

// ---- Deterministic PRNG (mulberry32) ----
function makeRng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function rngInt(rng: () => number, min: number, max: number): number {
    return min + Math.floor(rng() * (max - min + 1));
}
function hashSeed(str: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}
function round1(n: number): number {
    return Math.round(n * 10) / 10;
}

// ---- Dates ----
export function todayStr(now: Date = new Date()): string {
    return now.toISOString().slice(0, 10);
}
function dayStringFrom(anchorMs: number, daysAgo: number): string {
    return new Date(anchorMs - daysAgo * 86400000).toISOString().slice(0, 10);
}
function capturedAt(date: string): Date {
    return new Date(`${date}T06:00:00.000Z`);
}

// ---- Reviews ----
const POSITIVE_TEXTS = [
    '[SAMPLE] Loved the food and the vibe, will be back.',
    '[SAMPLE] Great flavours, generous portions.',
    '[SAMPLE] Friendly staff and quick service.',
    '[SAMPLE] Clean place, well plated, tasty.',
    '[SAMPLE] Consistently good — a reliable favourite.',
];
const DIP_TEXTS = [
    '[SAMPLE] Delivery took far too long and food arrived cold.',
    '[SAMPLE] Waited over an hour for delivery on a busy night.',
];
const AUTHORS = ['[SAMPLE] Reviewer A', '[SAMPLE] Reviewer B', '[SAMPLE] Reviewer C', '[SAMPLE] Reviewer D'];

function buildReviews(rng: () => number, dayIdx: number, isDipDay: boolean, time: string): SnapshotReview[] {
    const reviews: SnapshotReview[] = [];
    const count = rngInt(rng, 2, 3);
    for (let k = 0; k < count; k++) {
        const themeA = REVIEW_THEMES[(dayIdx + k) % REVIEW_THEMES.length];
        const themeB = REVIEW_THEMES[(dayIdx + k + 3) % REVIEW_THEMES.length];
        const themes: ReviewTheme[] = themeA === themeB ? [themeA] : [themeA, themeB];
        reviews.push({
            rating: rngInt(rng, 4, 5),
            text: POSITIVE_TEXTS[rngInt(rng, 0, POSITIVE_TEXTS.length - 1)],
            author: AUTHORS[rngInt(rng, 0, AUTHORS.length - 1)],
            time,
            themes,
        });
    }
    if (isDipDay) {
        reviews.unshift({
            rating: 1,
            text: DIP_TEXTS[dayIdx % DIP_TEXTS.length],
            author: AUTHORS[dayIdx % AUTHORS.length],
            time,
            themes: ['delivery-time'],
        });
    }
    return reviews;
}

// ---- Series ----
const SELF_DIP_DAYS = new Set([20, 45, 3]); // recent dip (idx 3 = 3 days before newest) drives the 7-day negative alert
const SEO_JUMP_DAY = 30;
const SELF_GAP_DAYS = new Set([12, 13]); // missing self-google days → GAPS not zeros
const SELF_BACKFILLED_DAYS = new Set([14, 15]); // catch-up points → hollow markers

interface SeriesConfig {
    targetPlaceId: string;
    isSelf: boolean;
    source: SnapshotSource;
    ratingStart: number;
    ratingEnd: number;
    reviewStart: number;
    velocityMin: number;
    velocityMax: number;
    photoStart: number;
    withSeo: boolean;
    responseRate?: number;
    gapDays?: Set<number>;
    backfilledDays?: Set<number>;
    photoStagnant?: boolean; // freeze photos for the last 14 days (stagnation nudge)
}

function buildSeries(anchorMs: number, cfg: SeriesConfig): DailySnapshot[] {
    const rng = makeRng(hashSeed(`${cfg.targetPlaceId}:${cfg.source}`));
    const out: DailySnapshot[] = [];
    let reviewCount = cfg.reviewStart;
    let photoCount = cfg.photoStart;

    for (let i = 0; i < SNAPSHOT_DAYS; i++) {
        const daysAgo = SNAPSHOT_DAYS - 1 - i;
        const date = dayStringFrom(anchorMs, daysAgo);
        const frac = i / (SNAPSHOT_DAYS - 1);
        const isDipDay = cfg.isSelf && SELF_DIP_DAYS.has(i);

        let rating = round1(cfg.ratingStart + (cfg.ratingEnd - cfg.ratingStart) * frac);
        if (isDipDay) rating = round1(rating - 0.1);

        const dailyReviews = rngInt(rng, cfg.velocityMin, cfg.velocityMax);
        reviewCount += dailyReviews;
        const stagnant = cfg.photoStagnant && i >= SNAPSHOT_DAYS - 14;
        if (!stagnant && rng() > 0.6) photoCount += 1;

        if (cfg.gapDays?.has(i)) continue; // GAP: no row this day

        let seoScore: number | undefined;
        if (cfg.withSeo) {
            const base = 55 + Math.floor(frac * 14);
            seoScore = i >= SEO_JUMP_DAY ? base + 2 : base;
        }

        out.push({
            _id: `snap-${cfg.targetPlaceId}-${cfg.source}-${date}`,
            restaurantId: R,
            targetPlaceId: cfg.targetPlaceId,
            isSelf: cfg.isSelf,
            source: cfg.source,
            date,
            rating,
            reviewCount,
            photoCount,
            ...(seoScore !== undefined ? { seoScore } : {}),
            newReviews: buildReviews(rng, i, isDipDay, capturedAt(date).toISOString()),
            ...(cfg.responseRate !== undefined ? { responseRate: cfg.responseRate } : {}),
            ...(cfg.backfilledDays?.has(i) ? { backfilled: true } : {}),
            capturedAt: capturedAt(date),
        });
    }
    return out;
}

export const COMP_A = { placeId: 'sample-wl-meghana', name: '[SAMPLE] Meghana Foods' };
export const COMP_B = { placeId: 'sample-wl-punjabi', name: '[SAMPLE] Punjabi Rasoi' };
export const COMP_C = { placeId: 'sample-wl-nandhana', name: '[SAMPLE] Nandhana Palace' };

/** Build the full 60-day snapshot dataset for an anchor date (self-zomato absent). */
export function buildSnapshots(anchor: string): DailySnapshot[] {
    const anchorMs = Date.parse(`${anchor}T00:00:00.000Z`);
    return [
        ...buildSeries(anchorMs, {
            targetPlaceId: DEMO_SELF_PLACE_ID, isSelf: true, source: 'google',
            ratingStart: 4.2, ratingEnd: 4.4, reviewStart: 780, velocityMin: 2, velocityMax: 6,
            photoStart: 40, withSeo: true, responseRate: 42,
            gapDays: SELF_GAP_DAYS, backfilledDays: SELF_BACKFILLED_DAYS, photoStagnant: true,
        }),
        ...buildSeries(anchorMs, {
            targetPlaceId: COMP_A.placeId, isSelf: false, source: 'google',
            ratingStart: 4.5, ratingEnd: 4.6, reviewStart: 5200, velocityMin: 5, velocityMax: 9,
            photoStart: 620, withSeo: false, responseRate: 55,
        }),
        ...buildSeries(anchorMs, {
            targetPlaceId: COMP_B.placeId, isSelf: false, source: 'google',
            ratingStart: 4.0, ratingEnd: 3.9, reviewStart: 900, velocityMin: 0, velocityMax: 2,
            photoStart: 120, withSeo: false, responseRate: 18,
        }),
        ...buildSeries(anchorMs, {
            targetPlaceId: COMP_C.placeId, isSelf: false, source: 'google',
            ratingStart: 4.3, ratingEnd: 4.3, reviewStart: 3100, velocityMin: 2, velocityMax: 6,
            photoStart: 410, withSeo: false, responseRate: 30,
        }),
        ...buildSeries(anchorMs, {
            targetPlaceId: COMP_C.placeId, isSelf: false, source: 'zomato',
            ratingStart: 4.1, ratingEnd: 4.2, reviewStart: 1400, velocityMin: 1, velocityMax: 4,
            photoStart: 260, withSeo: false,
        }),
    ];
}

export function buildWatchlist(anchor: string): WatchlistEntry[] {
    const at = capturedAt(dayStringFrom(Date.parse(`${anchor}T00:00:00.000Z`), 59));
    return [
        { placeId: COMP_A.placeId, name: COMP_A.name, addedAt: at },
        { placeId: COMP_B.placeId, name: COMP_B.name, addedAt: at },
        { placeId: COMP_C.placeId, name: COMP_C.name, addedAt: at, zomatoUrl: 'https://www.zomato.com/sample/nandhana-palace' },
    ];
}

function sighting(
    anchorMs: number, idx: number, name: string, firstSeenDaysAgo: number,
    lat: number, lng: number, distanceKm: number, cuisine: string,
    ratingAtFirstSeen: number, reviewsAtFirstSeen: number,
): NearbyPlaceSighting {
    const firstSeen = dayStringFrom(anchorMs, firstSeenDaysAgo);
    return {
        _id: `sight-${idx}`, restaurantId: R, placeId: `sample-sight-${idx}`, name,
        lat, lng, distanceKm, cuisine,
        firstSeenAt: capturedAt(firstSeen),
        lastSeenAt: new Date(anchorMs),
        ratingAtFirstSeen, reviewsAtFirstSeen,
    };
}

export function buildSightings(anchor: string): NearbyPlaceSighting[] {
    const anchorMs = Date.parse(`${anchor}T00:00:00.000Z`);
    return [
        sighting(anchorMs, 1, '[SAMPLE] Biryani Blues Express', 10, 12.9705, 77.6435, 0.9, 'Biryani', 4.6, 180),
        sighting(anchorMs, 2, '[SAMPLE] Curry Theory', 22, 12.972, 77.638, 1.4, 'North Indian', 4.5, 95),
        sighting(anchorMs, 3, '[SAMPLE] Nandhana Palace', 210, 12.9741, 77.6389, 0.8, 'Andhra', 4.4, 3120),
        sighting(anchorMs, 4, '[SAMPLE] Meghana Foods', 340, 12.9719, 77.6412, 1.2, 'Biryani', 4.5, 5400),
        sighting(anchorMs, 5, '[SAMPLE] Truffles', 400, 12.9724, 77.6045, 1.6, 'Continental', 4.6, 6100),
        sighting(anchorMs, 6, '[SAMPLE] Empire Restaurant', 520, 12.9752, 77.6068, 2.1, 'North Indian', 4.1, 8900),
        sighting(anchorMs, 7, '[SAMPLE] Punjabi Rasoi', 300, 12.976, 77.6402, 0.6, 'North Indian', 4.0, 900),
        sighting(anchorMs, 8, '[SAMPLE] CTR Shri Sagar', 460, 13.0068, 77.5709, 2.4, 'South Indian', 4.7, 2200),
    ];
}

// ===========================================================================
// Pure derivers — mirror BRIEF-07 services (snapshots.ts / compare.ts) exactly.
// ===========================================================================

function toDayPoint(s: DailySnapshot): SnapshotSeriesPoint {
    return {
        date: s.date,
        source: s.source,
        rating: s.rating,
        reviewCount: s.reviewCount,
        newReviews: s.newReviews?.length ?? 0,
        photoCount: s.photoCount,
        ...(typeof s.seoScore === 'number' ? { seoScore: s.seoScore } : {}),
        ...(s.backfilled ? { backfilled: true } : {}),
    };
}

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

export function deriveSeries(
    snapshots: DailySnapshot[],
    q: { targetPlaceId: string; source: SnapshotSource | 'both'; from?: string; to?: string; granularity: 'day' | 'month' },
): SnapshotSeriesPoint[] {
    let rows = snapshots.filter((s) => s.targetPlaceId === q.targetPlaceId);
    if (q.source !== 'both') rows = rows.filter((s) => s.source === q.source);
    if (q.from) rows = rows.filter((s) => s.date >= q.from!);
    if (q.to) rows = rows.filter((s) => s.date <= q.to!);
    rows = [...rows].sort((a, b) => a.date.localeCompare(b.date));

    if (q.granularity === 'day') {
        return rows.map(toDayPoint).sort((a, b) => a.date.localeCompare(b.date) || a.source.localeCompare(b.source));
    }
    const sources: SnapshotSource[] = q.source === 'both' ? ['google', 'zomato'] : [q.source];
    const out: SnapshotSeriesPoint[] = [];
    for (const source of sources) out.push(...aggregateMonths(rows.filter((d) => d.source === source), source));
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.source.localeCompare(b.source));
}

const reviewKey = (r: SnapshotReview): string => `${r.author ?? ''}|${r.text}|${r.time}`;

export function deriveFeedbackDays(snapshots: DailySnapshot[], from: string, to: string): { days: FeedbackDay[] } {
    const docs = snapshots
        .filter((s) => s.isSelf && s.date >= from && s.date <= to)
        .sort((a, b) => a.date.localeCompare(b.date));
    const prior = snapshots
        .filter((s) => s.isSelf && s.source === 'google' && s.date < from)
        .sort((a, b) => b.date.localeCompare(a.date))[0];

    const byDate = new Map<string, DailySnapshot[]>();
    for (const d of docs) {
        const list = byDate.get(d.date) ?? [];
        list.push(d);
        byDate.set(d.date, list);
    }
    const days: FeedbackDay[] = [];
    let prevRating: number | null = prior?.rating ?? null;
    for (const date of [...byDate.keys()].sort()) {
        const list = byDate.get(date)!;
        const google = list.find((d) => d.source === 'google');
        const zomato = list.find((d) => d.source === 'zomato');
        const newReviews: FeedbackReview[] = [];
        const seen = new Set<string>();
        for (const snap of list) {
            for (const r of snap.newReviews ?? []) {
                const key = `${snap.source}|${reviewKey(r)}`;
                if (seen.has(key)) continue;
                seen.add(key);
                newReviews.push({ ...r, source: snap.source });
            }
        }
        const ratingAfter: number = google?.rating ?? zomato?.rating ?? prevRating ?? 0;
        const counts = new Map<ReviewTheme, number>();
        for (const r of newReviews) for (const t of r.themes ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
        const themesTrending = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t);
        days.push({ date, newReviews, ratingBefore: prevRating, ratingAfter, themesTrending });
        prevRating = ratingAfter;
    }
    return { days };
}

// ---- Compare (mirror compare.ts) ----
const RATING_GAP_MIN = 0.1;
const REVIEW_VELOCITY_RATIO_MIN = 1.25;
const RESPONSE_RATE_GAP_MIN = 10;
const PHOTO_COUNT_GAP_MIN = 10;
const round2 = (n: number): number => Math.round(n * 100) / 100;

interface SourceWindow {
    rating: number; reviewCount: number; newReviews: number; photoCount: number; responseRate?: number; velocity: number;
}
interface CompareTargetLocal {
    placeId: string; name: string; isSelf: boolean; google?: SourceWindow; zomato?: SourceWindow;
}

function windowDays(gran: 'day' | 'month', value: string): number {
    if (gran === 'day') return 1;
    const [y, m] = value.split('-').map(Number);
    return new Date(y, m, 0).getDate();
}

function reduceSource(rows: DailySnapshot[], gran: 'day' | 'month', value: string): SourceWindow | undefined {
    const inWindow = gran === 'day' ? rows.filter((r) => r.date === value) : rows.filter((r) => r.date.slice(0, 7) === value);
    if (inWindow.length === 0) return undefined;
    inWindow.sort((a, b) => a.date.localeCompare(b.date));
    const last = inWindow[inWindow.length - 1];
    const newReviews = inWindow.reduce((sum, r) => sum + (r.newReviews?.length ?? 0), 0);
    const rr = inWindow.map((r) => r.responseRate).filter((v): v is number => typeof v === 'number');
    return {
        rating: last.rating, reviewCount: last.reviewCount, newReviews, photoCount: last.photoCount,
        responseRate: rr.length ? rr[rr.length - 1] : undefined, velocity: newReviews / windowDays(gran, value),
    };
}

function beatsYouFor(self: CompareTargetLocal, comp: CompareTargetLocal): MetricGap[] {
    const gaps: MetricGap[] = [];
    for (const source of ['google', 'zomato'] as SnapshotSource[]) {
        const mine = self[source];
        const theirs = comp[source];
        if (!mine || !theirs) continue;
        const ratingGap = round2(theirs.rating - mine.rating);
        if (ratingGap >= RATING_GAP_MIN) gaps.push({ metric: 'rating', source, yours: mine.rating, theirs: theirs.rating, gap: ratingGap });
        if (theirs.velocity > 0 && theirs.velocity > REVIEW_VELOCITY_RATIO_MIN * mine.velocity) {
            gaps.push({ metric: 'reviewVelocity', source, yours: round2(mine.velocity), theirs: round2(theirs.velocity), gap: round2(theirs.velocity - mine.velocity) });
        }
        if (typeof mine.responseRate === 'number' && typeof theirs.responseRate === 'number') {
            const rrGap = theirs.responseRate - mine.responseRate;
            if (rrGap >= RESPONSE_RATE_GAP_MIN) gaps.push({ metric: 'responseRate', source, yours: mine.responseRate, theirs: theirs.responseRate, gap: round2(rrGap) });
        }
        const photoGap = theirs.photoCount - mine.photoCount;
        if (photoGap >= PHOTO_COUNT_GAP_MIN) gaps.push({ metric: 'photoCount', source, yours: mine.photoCount, theirs: theirs.photoCount, gap: photoGap });
    }
    return gaps;
}

function toCompareRow(t: CompareTargetLocal, beatsYou: MetricGap[]): CompareRow {
    const proj = (d: SourceWindow) => ({ rating: d.rating, reviewCount: d.reviewCount, newReviews: d.newReviews, photoCount: d.photoCount });
    return {
        placeId: t.placeId, name: t.name, isSelf: t.isSelf,
        ...(t.google ? { google: proj(t.google) } : {}),
        ...(t.zomato ? { zomato: proj(t.zomato) } : {}),
        beatsYou,
    };
}

export function deriveCompareRows(
    snapshots: DailySnapshot[],
    watchlist: WatchlistEntry[],
    selfName: string,
    gran: 'day' | 'month',
    value: string,
): CompareRow[] {
    const load = (placeId: string, name: string, isSelf: boolean): CompareTargetLocal => {
        const rows = snapshots.filter((s) => s.targetPlaceId === placeId);
        return {
            placeId, name, isSelf,
            google: reduceSource(rows.filter((r) => r.source === 'google'), gran, value),
            zomato: reduceSource(rows.filter((r) => r.source === 'zomato'), gran, value),
        };
    };
    const self = load(DEMO_SELF_PLACE_ID, selfName, true);
    const rows: CompareRow[] = [toCompareRow(self, [])];
    for (const w of watchlist) rows.push(toCompareRow(load(w.placeId, w.name, false), beatsYouFor(self, load(w.placeId, w.name, false))));
    return rows;
}

// ---- New openings (mirror compare.ts getNewOpenings) ----
const FAST_STARTER_MIN_REVIEWS = 30;
const FAST_STARTER_MAX_DAYS = 21;
const MS_PER_DAY = 86400000;

/** currentReviewCount grows deterministically from firstSeen (fast starters ramp harder). */
function currentReviews(s: NearbyPlaceSighting, fast: boolean): number {
    return s.reviewsAtFirstSeen + (fast ? 150 : 12);
}

export function deriveNewOpenings(
    sightings: NearbyPlaceSighting[],
    radiusKm: number,
    sinceDays: number,
    now: number,
): NewOpening[] {
    const cutoff = now - sinceDays * MS_PER_DAY;
    return sightings
        .filter((s) => new Date(s.firstSeenAt).getTime() >= cutoff && s.distanceKm <= radiusKm)
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .map((s) => {
            const daysSince = Math.max(0, Math.floor((now - new Date(s.firstSeenAt).getTime()) / MS_PER_DAY));
            const fast = daysSince <= FAST_STARTER_MAX_DAYS;
            const current = currentReviews(s, fast);
            const reviewsSince = Math.max(0, current - s.reviewsAtFirstSeen);
            return {
                placeId: s.placeId, name: s.name, distanceKm: s.distanceKm, cuisine: s.cuisine,
                firstSeenAt: new Date(s.firstSeenAt).toISOString(),
                ratingAtFirstSeen: s.ratingAtFirstSeen, reviewsAtFirstSeen: s.reviewsAtFirstSeen,
                currentReviewCount: current, reviewsSinceFirstSeen: reviewsSince, daysSinceFirstSeen: daysSince,
                fastStarter: reviewsSince >= FAST_STARTER_MIN_REVIEWS && daysSince <= FAST_STARTER_MAX_DAYS,
            };
        });
}
