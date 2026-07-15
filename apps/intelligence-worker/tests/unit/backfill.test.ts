import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { getRestaurantsCollection, getIntelligenceSnapshotsCollection } from '@restropulse/db';
import type { SnapshotMeasurement } from '../../src/snapshot-store.js';
import { runBackfill } from '../../src/backfill.js';

/** now = 2026-07-11 (UTC tz injected) → 7-day window is 07-05 … 07-11. */
const NOW = new Date('2026-07-11T12:00:00Z');

async function seedRestaurant(): Promise<string> {
    const _id = new ObjectId();
    await getRestaurantsCollection().insertOne({
        _id,
        name: '[SAMPLE] Backfill Diner',
        cuisine: 'Biryani',
        location: { address: 'Bengaluru', lat: 12.97, lng: 77.64, mapUrl: '' },
        intelligence: { watchlist: [] },
    } as unknown as Record<string, unknown>);
    return _id.toString();
}

async function seedSelfSnapshot(rid: string, date: string): Promise<void> {
    await getIntelligenceSnapshotsCollection().insertOne({
        _id: `${rid}:self:${rid}:google:${date}`,
        restaurantId: rid,
        targetPlaceId: `self:${rid}`,
        isSelf: true,
        source: 'google',
        date,
        rating: 4.5,
        reviewCount: 100,
        photoCount: 50,
        newReviews: [],
        capturedAt: new Date(`${date}T02:00:00Z`),
    } as unknown as Record<string, unknown>);
}

const measure = async (): Promise<SnapshotMeasurement> => ({
    rating: 4.5,
    reviewCount: 100,
    photoCount: 50,
    reviews: [],
});

describe('runBackfill', () => {
    beforeEach(async () => {
        process.env.INTELLIGENCE_DAILY_ENABLED = 'true';
        await getRestaurantsCollection().deleteMany({});
        await getIntelligenceSnapshotsCollection().deleteMany({});
    });
    afterEach(() => {
        delete process.env.INTELLIGENCE_DAILY_ENABLED;
    });

    it('fills a 3-day gap in the last 7 with backfilled docs; leaves a 9-day-old gap alone', async () => {
        const rid = await seedRestaurant();
        // Present days inside the window: 07-05, 07-06, 07-07, 07-11.
        for (const d of ['2026-07-05', '2026-07-06', '2026-07-07', '2026-07-11']) {
            await seedSelfSnapshot(rid, d);
        }
        // Missing inside window: 07-08, 07-09, 07-10 (the 3-day gap).
        // 07-02 is 9 days back (outside the window) and intentionally absent.

        const stats = await runBackfill({
            restaurantId: rid,
            measure,
            searchNearby: async () => [],
            now: () => NOW,
            timezoneOf: () => 'UTC',
        });

        expect(stats.daysFilled).toBe(3);

        for (const d of ['2026-07-08', '2026-07-09', '2026-07-10']) {
            const doc = await getIntelligenceSnapshotsCollection().findOne({
                restaurantId: rid,
                targetPlaceId: `self:${rid}`,
                source: 'google',
                date: d,
            });
            expect(doc, `expected backfilled doc for ${d}`).toBeTruthy();
            expect(doc?.backfilled).toBe(true);
        }

        // Pre-existing day is untouched (not flagged backfilled).
        const kept = await getIntelligenceSnapshotsCollection().findOne({
            restaurantId: rid,
            date: '2026-07-11',
            source: 'google',
            isSelf: true,
        });
        expect(kept?.backfilled).toBeUndefined();

        // The 9-day-old gap is NOT filled.
        const old = await getIntelligenceSnapshotsCollection().findOne({
            restaurantId: rid,
            date: '2026-07-02',
        });
        expect(old).toBeNull();
    });

    it('kill switch disabled → backfill writes nothing', async () => {
        const rid = await seedRestaurant();
        process.env.INTELLIGENCE_DAILY_ENABLED = 'false';

        const stats = await runBackfill({
            restaurantId: rid,
            measure,
            searchNearby: async () => [],
            now: () => NOW,
            timezoneOf: () => 'UTC',
        });

        expect(stats.enabled).toBe(false);
        expect(stats.daysFilled).toBe(0);
        const total = await getIntelligenceSnapshotsCollection().countDocuments({ restaurantId: rid });
        expect(total).toBe(0);
    });
});
