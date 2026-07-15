/**
 * Daily snapshot loop (Brief 08 §1) — the job that makes both dashboard buckets
 * real. Per active restaurant, in the restaurant's local calendar day:
 *   1. capture self + each watchlist competitor across google + zomato (idempotent
 *      upsert via the worker snapshot store);
 *   2. run one 7 km nearby sweep (upserts sightings, emits new_competitor ≤ 5 km);
 * then, ONCE across every tenant processed:
 *   3. tag the whole day's new reviews in ONE batched Haiku call and write the
 *      themes back (skipped entirely on a zero-new-review day).
 *
 * Guardrails: kill switch (`INTELLIGENCE_DAILY_ENABLED`, default true / false in
 * test), tenants processed sequentially with try/catch-continue, and a
 * `places_calls` counter for cost monitoring.
 */

import {
    getIntelligenceSnapshotsCollection,
    getIntelligenceReportsCollection,
    getRestaurantsCollection,
    findRestaurantById,
} from '@restropulse/db';
import type { DailySnapshot, SnapshotReview, SnapshotSource, Restaurant } from '@restropulse/shared';
import { createLogger } from '@restropulse/telemetry/server';
import { incrementCounter } from '@restropulse/telemetry/server';
import {
    captureSnapshot,
    applyThemes,
    type CaptureTarget,
    type Measurer,
} from './snapshot-store.js';
import { defaultMeasurer, noopTagger, type ThemeTagger } from './measure.js';
import { runNearbySweep, type NearbySearch, type SweepStats } from './sweep.js';
import { DEFAULT_TIMEZONE, localDateString } from './tz.js';

const log = createLogger('intelligence-daily');

const SOURCES: SnapshotSource[] = ['google', 'zomato'];

export interface DailyDeps {
    /** Fixed capture date (`YYYY-MM-DD`); defaults to each tenant's local today. */
    date?: string;
    /** Limit the run to a single restaurant. */
    restaurantId?: string;
    /** Google/Zomato measurer (tests stub this). */
    measure?: Measurer;
    /** Batched theme tagger; defaults to the no-op (real Haiku injected by caller). */
    tagThemes?: ThemeTagger;
    /** Nearby sweep source; defaults to the competitor_cache reader. */
    searchNearby?: NearbySearch;
    /** Clock injection for deterministic dates/timestamps. */
    now?: () => Date;
    /** Per-restaurant timezone resolver (no per-tenant field exists yet). */
    timezoneOf?: (r: Restaurant) => string;
    /** Set on the ≤ 7-day backfill path so rows are flagged `backfilled: true`. */
    backfilled?: boolean;
}

export interface DailyStats {
    enabled: boolean;
    restaurants: number;
    processed: number;
    failed: number;
    snapshots: number;
    taggedReviews: number;
    sightings: number;
    alerts: number;
}

/** Kill switch: default ON, but OFF in the test env unless explicitly enabled. */
export function isDailyEnabled(): boolean {
    const raw = process.env.INTELLIGENCE_DAILY_ENABLED;
    if (raw !== undefined) return raw !== 'false';
    return process.env.NODE_ENV !== 'test';
}

/**
 * Restaurants with intelligence enabled = opted into v2 (has an `intelligence`
 * settings block) OR already producing intelligence data (snapshots / a v1
 * report). Union keeps v1 tenants covered without a new flag.
 */
export async function getActiveDailyRestaurantIds(): Promise<string[]> {
    const [withSettings, withSnapshots, withReports] = await Promise.all([
        getRestaurantsCollection()
            .find({ intelligence: { $exists: true } })
            .project({ _id: 1 })
            .toArray(),
        getIntelligenceSnapshotsCollection().distinct('restaurantId'),
        getIntelligenceReportsCollection().distinct('restaurantId'),
    ]);

    const ids = new Set<string>();
    for (const doc of withSettings) {
        const id = (doc as { _id?: unknown })._id;
        if (id != null) ids.add(String(id));
    }
    for (const id of withSnapshots) if (typeof id === 'string' && id) ids.add(id);
    for (const id of withReports) if (typeof id === 'string' && id) ids.add(id);
    return [...ids];
}

/** The self target's stable Google placeId (shared across sources). */
async function resolveSelfPlaceId(restaurantId: string): Promise<string> {
    const selfSnap = (await getIntelligenceSnapshotsCollection().findOne(
        { restaurantId, isSelf: true },
        { sort: { date: -1 } },
    )) as unknown as DailySnapshot | null;
    return selfSnap?.targetPlaceId ?? `self:${restaurantId}`;
}

function selfCityOf(restaurant: Restaurant): string {
    return (restaurant as { sourceCity?: string }).sourceCity ?? restaurant.location?.address ?? '';
}

/** A collected batch item: which snapshot the reviews belong to. */
interface BatchItem {
    snapshotId: string;
    reviews: SnapshotReview[];
}

/**
 * Run the daily snapshot loop. Returns per-run stats; never throws for a single
 * tenant (logged and skipped). When the kill switch is off it returns
 * immediately with `enabled: false` and performs no reads, writes, or calls.
 */
export async function runDailySnapshotJob(deps: DailyDeps = {}): Promise<DailyStats> {
    const stats: DailyStats = {
        enabled: true,
        restaurants: 0,
        processed: 0,
        failed: 0,
        snapshots: 0,
        taggedReviews: 0,
        sightings: 0,
        alerts: 0,
    };

    if (!isDailyEnabled()) {
        log.info('Daily snapshot job disabled (INTELLIGENCE_DAILY_ENABLED=false) — skipping');
        return { ...stats, enabled: false };
    }

    const measure = deps.measure ?? defaultMeasurer;
    const tagThemes = deps.tagThemes ?? noopTagger;
    const now = deps.now?.() ?? new Date();
    const timezoneOf = deps.timezoneOf ?? (() => DEFAULT_TIMEZONE);

    const allIds = deps.restaurantId ? [deps.restaurantId] : await getActiveDailyRestaurantIds();
    stats.restaurants = allIds.length;

    const batch: BatchItem[] = [];

    for (const restaurantId of allIds) {
        try {
            const restaurant = await findRestaurantById(restaurantId);
            if (!restaurant) continue;

            const date = deps.date ?? localDateString(now, timezoneOf(restaurant));
            const selfPlaceId = await resolveSelfPlaceId(restaurantId);

            const targets: CaptureTarget[] = [
                {
                    placeId: selfPlaceId,
                    isSelf: true,
                    name: restaurant.name,
                    zomatoUrl: restaurant.intelligence?.selfZomatoUrl,
                    selfQuery: { name: restaurant.name, city: selfCityOf(restaurant) },
                },
                ...(restaurant.intelligence?.watchlist ?? []).map((w) => ({
                    placeId: w.placeId,
                    isSelf: false,
                    name: w.name,
                    zomatoUrl: w.zomatoUrl,
                })),
            ];

            for (const target of targets) {
                for (const source of SOURCES) {
                    if (source === 'google') incrementCounter('placesCalls', { op: 'daily_details' });
                    const result = await captureSnapshot(restaurantId, target, source, date, {
                        measure,
                        backfilled: deps.backfilled,
                        now,
                    });
                    if (!result) continue;
                    stats.snapshots += 1;
                    if (result.unseen.length > 0) {
                        batch.push({ snapshotId: result.doc._id, reviews: result.unseen });
                    }
                }
            }

            // Nearby sweep (own 7 km search) — one per tenant.
            const sweep: SweepStats = await runNearbySweep(
                { restaurantId, lat: restaurant.location.lat, lng: restaurant.location.lng },
                { searchNearby: deps.searchNearby, now },
            );
            stats.sightings += sweep.inserted;
            stats.alerts += sweep.alerts;

            stats.processed += 1;
        } catch (error) {
            stats.failed += 1;
            log.error({ restaurantId, error: String(error) }, 'Daily snapshot failed for restaurant');
        }
    }

    // ONE batched Haiku call across every tenant's new reviews for the day.
    const flat: SnapshotReview[] = batch.flatMap((b) => b.reviews);
    if (flat.length > 0) {
        const tagged = await tagThemes(flat);
        stats.taggedReviews = tagged.length;
        let offset = 0;
        for (const item of batch) {
            const slice = tagged.slice(offset, offset + item.reviews.length);
            offset += item.reviews.length;
            await applyThemes(item.snapshotId, slice);
        }
    }

    log.info(
        {
            restaurants: stats.restaurants,
            processed: stats.processed,
            failed: stats.failed,
            snapshots: stats.snapshots,
            taggedReviews: stats.taggedReviews,
            sightings: stats.sightings,
            alerts: stats.alerts,
        },
        'Daily snapshot loop completed',
    );
    return stats;
}
