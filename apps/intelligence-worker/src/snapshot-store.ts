/**
 * Worker-local daily-snapshot capture (Brief 08).
 *
 * WHY THIS DUPLICATES `apps/api/.../snapshots.ts#captureSnapshot`
 * ---------------------------------------------------------------
 * `apps/api` is an *application* workspace: no `exports` map, `main` boots
 * Express, and the worker's `tsc` build has `rootDir: ./src`, so a cross-app
 * import is impossible to build. `src/rescan.ts` established the repo pattern —
 * duplicate the *minimal* seam and inject the rest — and this module follows it.
 *
 * Only the load-bearing core is reproduced: the idempotent unique-key upsert and
 * the review diff. Two deliberate differences from the api twin, both required
 * by Brief 08:
 *   1. Theme tagging is DEFERRED — the daily loop batches every tenant's new
 *      reviews into ONE Haiku call (`daily.ts`), so capture writes reviews
 *      untagged and returns them for the batch.
 *   2. A `backfilled` flag is stamped when the ≤7-day catch-up writes a row.
 *
 * The upsert key and diff semantics are kept byte-identical to the api twin so
 * a snapshot written by either path is interchangeable.
 */

import { getIntelligenceSnapshotsCollection } from '@restropulse/db';
import type { DailySnapshot, SnapshotReview, SnapshotSource } from '@restropulse/shared';

/** Current measured numbers for a target×source, plus the reviews to diff. */
export interface SnapshotMeasurement {
    rating: number;
    reviewCount: number;
    photoCount: number;
    seoScore?: number; // self + google only
    responseRate?: number;
    reviews: SnapshotReview[];
}

/** A resolved capture target (self or a watchlisted competitor). */
export interface CaptureTarget {
    placeId: string;
    isSelf: boolean;
    name: string;
    zomatoUrl?: string;
    selfQuery?: { name: string; city: string };
}

/** Measures one target on one source; returns null when the source has no data. */
export type Measurer = (
    target: CaptureTarget,
    source: SnapshotSource,
) => Promise<SnapshotMeasurement | null>;

export interface CaptureOptions {
    measure: Measurer;
    backfilled?: boolean;
    now?: Date;
}

/** Result of a capture: the written doc plus the reviews new this run (untagged). */
export interface CaptureResult {
    doc: DailySnapshot;
    unseen: SnapshotReview[];
}

function snapshotId(
    restaurantId: string,
    targetPlaceId: string,
    source: SnapshotSource,
    date: string,
): string {
    return `${restaurantId}:${targetPlaceId}:${source}:${date}`;
}

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

/** Reviews present now that were not already in the latest prior snapshot. */
function diffNewReviews(current: SnapshotReview[], prior: DailySnapshot | null): SnapshotReview[] {
    if (!prior) return current;
    const seen = new Set((prior.newReviews ?? []).map(reviewKey));
    return current.filter((r) => !seen.has(reviewKey(r)));
}

/**
 * Capture (idempotent upsert) one target×source snapshot for `date`. Writes the
 * new reviews UNTAGGED (the loop tags them in one batched call afterwards) and
 * returns them so the caller can collect the batch. Returns null when the
 * source has no data (no empty rows are written).
 */
export async function captureSnapshot(
    restaurantId: string,
    target: CaptureTarget,
    source: SnapshotSource,
    date: string,
    opts: CaptureOptions,
): Promise<CaptureResult | null> {
    const measurement = await opts.measure(target, source);
    if (!measurement) return null;

    const prior = await latestPrior(restaurantId, target.placeId, source, date);
    const unseen = diffNewReviews(measurement.reviews, prior);

    const now = opts.now ?? new Date();
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
        newReviews: unseen,
        ...(typeof measurement.responseRate === 'number' ? { responseRate: measurement.responseRate } : {}),
        ...(opts.backfilled ? { backfilled: true } : {}),
        capturedAt: now,
    };

    const { _id, ...rest } = doc;
    await getIntelligenceSnapshotsCollection().updateOne(
        { restaurantId, targetPlaceId: target.placeId, source, date },
        { $set: rest, $setOnInsert: { _id } },
        { upsert: true },
    );
    return { doc, unseen };
}

/** Write already-tagged themes back onto a snapshot's `newReviews`. */
export async function applyThemes(snapshotId: string, tagged: SnapshotReview[]): Promise<void> {
    await getIntelligenceSnapshotsCollection().updateOne(
        { _id: snapshotId as unknown as never },
        { $set: { newReviews: tagged } },
    );
}
