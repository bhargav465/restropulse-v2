import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObjectId } from 'mongodb';
import {
    getRestaurantsCollection,
    getIntelligenceSnapshotsCollection,
} from '@restropulse/db';
import type { SnapshotReview, SnapshotSource } from '@restropulse/shared';
import { runDailySnapshotJob } from '../../src/daily.js';
import type { CaptureTarget, SnapshotMeasurement } from '../../src/snapshot-store.js';

/** Insert a restaurant with one watchlisted competitor; returns its id. */
async function seedRestaurant(watchlistPlaceId = 'comp-1'): Promise<string> {
    const _id = new ObjectId();
    await getRestaurantsCollection().insertOne({
        _id,
        name: '[SAMPLE] My Biryani House',
        cuisine: 'Biryani',
        location: { address: 'Bengaluru', lat: 12.97, lng: 77.64, mapUrl: '' },
        intelligence: {
            watchlist: [{ placeId: watchlistPlaceId, name: '[SAMPLE] Rival', addedAt: new Date() }],
        },
    } as unknown as Record<string, unknown>);
    return _id.toString();
}

function review(text: string): SnapshotReview {
    return { rating: 5, text, time: '2 days ago', author: text };
}

/** A measurer whose google reviews come from a mutable closure array. */
function measurerWith(reviewsRef: { current: SnapshotReview[] }) {
    return async (target: CaptureTarget, source: SnapshotSource): Promise<SnapshotMeasurement | null> => {
        if (source === 'zomato') {
            return { rating: 4.2, reviewCount: 100, photoCount: 40, reviews: [] };
        }
        return {
            rating: 4.5,
            reviewCount: 100 + reviewsRef.current.length,
            photoCount: 50,
            ...(target.isSelf ? { seoScore: 80 } : {}),
            reviews: reviewsRef.current,
        };
    };
}

describe('runDailySnapshotJob', () => {
    beforeEach(async () => {
        process.env.INTELLIGENCE_DAILY_ENABLED = 'true';
        await getRestaurantsCollection().deleteMany({});
        await getIntelligenceSnapshotsCollection().deleteMany({});
    });
    afterEach(() => {
        delete process.env.INTELLIGENCE_DAILY_ENABLED;
    });

    it('is idempotent: running the same date twice keeps one doc per target×source', async () => {
        const rid = await seedRestaurant();
        const reviewsRef = { current: [review('r1'), review('r2')] };
        const measure = measurerWith(reviewsRef);
        const searchNearby = async () => [];

        await runDailySnapshotJob({ restaurantId: rid, date: '2026-07-10', measure, searchNearby });
        await runDailySnapshotJob({ restaurantId: rid, date: '2026-07-10', measure, searchNearby });

        // self google, self zomato, comp google, comp zomato = 4 docs, no dupes.
        const total = await getIntelligenceSnapshotsCollection().countDocuments({ restaurantId: rid });
        expect(total).toBe(4);

        const selfGoogle = await getIntelligenceSnapshotsCollection().countDocuments({
            restaurantId: rid,
            targetPlaceId: `self:${rid}`,
            source: 'google',
            date: '2026-07-10',
        });
        expect(selfGoogle).toBe(1);
    });

    it('diffs new reviews: 100 → 103 yields exactly 3 newReviews', async () => {
        const rid = await seedRestaurant();
        const reviewsRef = { current: [review('a'), review('b')] };
        const measure = measurerWith(reviewsRef);
        const searchNearby = async () => [];

        await runDailySnapshotJob({ restaurantId: rid, date: '2026-07-10', measure, searchNearby });
        // Three brand-new reviews appear the next day.
        reviewsRef.current = [review('a'), review('b'), review('c'), review('d'), review('e')];
        await runDailySnapshotJob({ restaurantId: rid, date: '2026-07-11', measure, searchNearby });

        const day2 = await getIntelligenceSnapshotsCollection().findOne({
            restaurantId: rid,
            targetPlaceId: `self:${rid}`,
            source: 'google',
            date: '2026-07-11',
        });
        expect((day2?.newReviews as unknown[]).length).toBe(3);
    });

    it('kill switch disabled → no writes and no external calls', async () => {
        const rid = await seedRestaurant();
        process.env.INTELLIGENCE_DAILY_ENABLED = 'false';
        const measure = vi.fn(async () => ({ rating: 4, reviewCount: 1, photoCount: 1, reviews: [] }));
        const searchNearby = vi.fn(async () => []);

        const stats = await runDailySnapshotJob({ restaurantId: rid, date: '2026-07-10', measure, searchNearby });

        expect(stats.enabled).toBe(false);
        expect(measure).not.toHaveBeenCalled();
        expect(searchNearby).not.toHaveBeenCalled();
        const total = await getIntelligenceSnapshotsCollection().countDocuments({ restaurantId: rid });
        expect(total).toBe(0);
    });

    it('zero-new-reviews day → the batched Haiku tagger is never called', async () => {
        const rid = await seedRestaurant();
        // No reviews at all → nothing to diff → nothing to tag.
        const measure = async (): Promise<SnapshotMeasurement> => ({
            rating: 4.5,
            reviewCount: 100,
            photoCount: 50,
            reviews: [],
        });
        const tagThemes = vi.fn(async (reviews: SnapshotReview[]) => reviews);
        const searchNearby = async () => [];

        const stats = await runDailySnapshotJob({
            restaurantId: rid,
            date: '2026-07-10',
            measure,
            tagThemes,
            searchNearby,
        });

        expect(tagThemes).not.toHaveBeenCalled();
        expect(stats.taggedReviews).toBe(0);
        expect(stats.snapshots).toBeGreaterThan(0);
    });

    it('batches every tenant new review into ONE tagger call and writes themes back', async () => {
        const rid = await seedRestaurant();
        const reviewsRef = { current: [review('x'), review('y')] };
        const measure = measurerWith(reviewsRef);
        const tagThemes = vi.fn(async (reviews: SnapshotReview[]) =>
            reviews.map((r) => ({ ...r, themes: ['service' as const] })),
        );
        const searchNearby = async () => [];

        await runDailySnapshotJob({ restaurantId: rid, date: '2026-07-10', measure, tagThemes, searchNearby });

        expect(tagThemes).toHaveBeenCalledTimes(1);
        const selfGoogle = await getIntelligenceSnapshotsCollection().findOne({
            restaurantId: rid,
            targetPlaceId: `self:${rid}`,
            source: 'google',
            date: '2026-07-10',
        });
        const themes = (selfGoogle?.newReviews as Array<{ themes?: string[] }>)[0]?.themes;
        expect(themes).toEqual(['service']);
    });
});
