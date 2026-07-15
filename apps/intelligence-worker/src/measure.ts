/**
 * Production default measurers + theme-tagger seam for the daily loop (Brief 08).
 *
 * Following the `rescan.ts` seam rule (no cross-app import of `apps/api`), the
 * worker's default measurers read only from importable packages:
 *
 *  - Google numbers come from the 7-day `competitor_cache` payload that the api's
 *    scan / nearby-sweep already warms (self and competitors alike, keyed by
 *    placeId). This costs zero extra Places calls in the common path.
 *  - Zomato numbers come from the `zomato_manual_entries` collection that the
 *    manual adapter (`apps/api/.../zomato.ts`) writes — same collection, read via
 *    `@restropulse/db#getDB`.
 *  - The default theme tagger is a best-effort NO-OP (reviews returned with
 *    `themes: []`). The real batched Haiku call is INJECTED (`daily.ts` accepts a
 *    `tagThemes` dep, wired to `apps/api/.../themes.ts#tagReviewThemes` by the
 *    caller that has it) so the worker stays free of the Anthropic dependency and
 *    the api's tool schema is never duplicated. See ASSUMPTION in the handoff.
 */

import { getDB } from '@restropulse/db';
import type { SnapshotReview, SnapshotSource } from '@restropulse/shared';
import type { CaptureTarget, Measurer, SnapshotMeasurement } from './snapshot-store.js';

/** Reviews from a cached Places payload (up to 5), matching the api twin. */
function reviewsFromCache(
    payload: {
        reviews?: Array<{
            rating?: number;
            text?: { text?: string };
            relativePublishTimeDescription?: string;
        }>;
    },
): SnapshotReview[] {
    return (payload.reviews ?? []).slice(0, 5).map((r) => ({
        rating: r.rating ?? 0,
        text: (r.text?.text ?? '').slice(0, 200),
        time: r.relativePublishTimeDescription ?? '',
    }));
}

interface CachePayload {
    rating?: number;
    userRatingCount?: number;
    photos?: unknown[];
    reviews?: Array<{ rating?: number; text?: { text?: string }; relativePublishTimeDescription?: string }>;
}

/** Google measurer: reuse the 7-day competitor_cache payload (no extra Places cost). */
async function measureGoogleFromCache(target: CaptureTarget): Promise<SnapshotMeasurement | null> {
    const doc = await getDB().collection('competitor_cache').findOne({ placeId: target.placeId });
    const payload = doc?.payload as CachePayload | undefined;
    if (!payload) return null;
    return {
        rating: payload.rating ?? 0,
        reviewCount: payload.userRatingCount ?? 0,
        photoCount: Array.isArray(payload.photos) ? payload.photos.length : 0,
        reviews: reviewsFromCache(payload),
    };
}

interface ZomatoManualEntry {
    rating?: number;
    reviewCount?: number;
    photoCount?: number;
}

/** Zomato measurer: latest merchant-supplied numbers (numbers only, no reviews). */
async function measureZomatoFromManual(target: CaptureTarget): Promise<SnapshotMeasurement | null> {
    const doc = (await getDB()
        .collection('zomato_manual_entries')
        .findOne({ placeId: target.placeId }, { sort: { capturedAt: -1 } })) as ZomatoManualEntry | null;
    if (!doc) return null;
    return {
        rating: doc.rating ?? 0,
        reviewCount: doc.reviewCount ?? 0,
        photoCount: doc.photoCount ?? 0,
        reviews: [],
    };
}

/**
 * The default worker measurer: google via competitor_cache, zomato via the manual
 * entries collection. Both are pure reads — the daily loop is safe to re-run.
 */
export const defaultMeasurer: Measurer = async (
    target: CaptureTarget,
    source: SnapshotSource,
): Promise<SnapshotMeasurement | null> => {
    return source === 'google' ? measureGoogleFromCache(target) : measureZomatoFromManual(target);
};

/** A batched review-theme tagger (one call for the whole batch). */
export type ThemeTagger = (reviews: SnapshotReview[]) => Promise<SnapshotReview[]>;

/**
 * Default tagger: best-effort no-op. Never calls a model, so it is free and
 * dependency-light. The real Haiku tagger is injected by the caller.
 */
export const noopTagger: ThemeTagger = async (reviews) =>
    reviews.map((r) => ({ ...r, themes: r.themes ?? [] }));
