/**
 * Zomato snapshot adapter (Brief 07).
 *
 * Zomato has no public API, so the reference ships a manual/stub adapter:
 *  - `manualZomatoAdapter` — reads the latest merchant-supplied numbers posted
 *    via `POST /api/admin/intelligence/zomato-manual` (stored in the small
 *    `zomato_manual_entries` collection, keyed by target placeId). Provenance is
 *    `measured` + `source: zomato` (merchant-supplied); the UI labels by source.
 *  - `stubZomatoAdapter` — deterministic fixture for tests/demo.
 *
 * The registry picks by env `ZOMATO_ADAPTER=manual|stub` (default `manual`).
 * A live scraping connector is a later paid-tier item (see docs/NEXT.md).
 */

import { getDB } from '@restropulse/db';
import type { Collection } from 'mongodb';

/** Numbers a Zomato source can supply for a daily snapshot. */
export interface ZomatoSnapshotInput {
    rating: number;
    reviewCount: number;
    photoCount: number;
}

/** A Zomato data source. `fetch` returns null when no data exists for the target. */
export interface ZomatoAdapter {
    fetch(target: { placeId: string; zomatoUrl?: string }): Promise<ZomatoSnapshotInput | null>;
}

/** One merchant-supplied Zomato entry (latest wins per target placeId). */
interface ZomatoManualEntry extends ZomatoSnapshotInput {
    placeId: string;
    restaurantId: string;
    capturedAt: Date;
}

/** Small provenance-`measured` collection backing the manual adapter. */
export function getZomatoManualEntriesCollection(): Collection {
    return getDB().collection('zomato_manual_entries');
}

/**
 * Persist a merchant-supplied Zomato entry (latest values per target placeId).
 * Called by `POST /zomato-manual` before it writes today's zomato snapshot.
 */
export async function recordZomatoManualEntry(
    restaurantId: string,
    placeId: string,
    input: ZomatoSnapshotInput,
): Promise<void> {
    const entry: ZomatoManualEntry = {
        placeId,
        restaurantId,
        rating: input.rating,
        reviewCount: input.reviewCount,
        photoCount: input.photoCount,
        capturedAt: new Date(),
    };
    await getZomatoManualEntriesCollection().updateOne(
        { placeId },
        { $set: entry },
        { upsert: true },
    );
}

/** Reads the latest merchant-supplied numbers for a target placeId. */
export const manualZomatoAdapter: ZomatoAdapter = {
    async fetch(target) {
        const doc = (await getZomatoManualEntriesCollection().findOne(
            { placeId: target.placeId },
            { sort: { capturedAt: -1 } },
        )) as ZomatoManualEntry | null;
        if (!doc) return null;
        return { rating: doc.rating, reviewCount: doc.reviewCount, photoCount: doc.photoCount };
    },
};

/** Deterministic fixture: only responds when a `zomatoUrl` marks the target as Zomato-enabled. */
export const stubZomatoAdapter: ZomatoAdapter = {
    async fetch(target) {
        if (!target.zomatoUrl) return null;
        return { rating: 4.2, reviewCount: 128, photoCount: 46 };
    },
};

/** Registry: env `ZOMATO_ADAPTER=manual|stub` (default `manual`). */
export function getZomatoAdapter(): ZomatoAdapter {
    return process.env.ZOMATO_ADAPTER === 'stub' ? stubZomatoAdapter : manualZomatoAdapter;
}
