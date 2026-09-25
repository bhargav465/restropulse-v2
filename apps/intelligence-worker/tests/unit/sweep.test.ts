import { describe, it, expect, beforeEach } from 'vitest';
import { getNearbySightingsCollection, getEventsCollection } from '@restropulse/db';
import { runNearbySweep, NEW_COMPETITOR_EVENT, type NearbyPlace } from '../../src/sweep.js';

const RID = 'rest-sweep';
const ORIGIN = { restaurantId: RID, lat: 12.97, lng: 77.64 };

function place(overrides: Partial<NearbyPlace> = {}): NearbyPlace {
    return {
        placeId: overrides.placeId ?? 'p-near',
        name: overrides.name ?? '[SAMPLE] Nearby',
        lat: overrides.lat ?? 12.971,
        lng: overrides.lng ?? 77.641,
        distanceKm: overrides.distanceKm ?? 1.2,
        rating: overrides.rating ?? 4.4,
        reviewCount: overrides.reviewCount ?? 120,
        cuisine: overrides.cuisine,
    };
}

async function newCompetitorEvents(): Promise<number> {
    return getEventsCollection().countDocuments({ name: NEW_COMPETITOR_EVENT, restaurantId: RID });
}

describe('runNearbySweep', () => {
    beforeEach(async () => {
        await getNearbySightingsCollection().deleteMany({});
        await getEventsCollection().deleteMany({});
    });

    it('first-seen insert stamps the baseline; a re-sighting only updates lastSeenAt', async () => {
        const t1 = new Date('2026-07-10T02:00:00Z');
        const t2 = new Date('2026-07-11T02:00:00Z');

        await runNearbySweep(ORIGIN, {
            searchNearby: async () => [place({ rating: 4.4, reviewCount: 120 })],
            now: t1,
        });
        // Same place, higher numbers the next day.
        await runNearbySweep(ORIGIN, {
            searchNearby: async () => [place({ rating: 4.6, reviewCount: 180 })],
            now: t2,
        });

        const docs = await getNearbySightingsCollection().find({ restaurantId: RID }).toArray();
        expect(docs).toHaveLength(1);
        const s = docs[0];
        expect(s.ratingAtFirstSeen).toBe(4.4); // baseline unchanged
        expect(s.reviewsAtFirstSeen).toBe(120); // baseline unchanged
        expect(new Date(s.firstSeenAt as Date).getTime()).toBe(t1.getTime());
        expect(new Date(s.lastSeenAt as Date).getTime()).toBe(t2.getTime());
    });

    it('a new place within 5 km emits new_competitor exactly once (never on re-sighting)', async () => {
        const searchNearby = async () => [place({ placeId: 'p-close', distanceKm: 3.0 })];

        await runNearbySweep(ORIGIN, { searchNearby, now: new Date('2026-07-10T02:00:00Z') });
        expect(await newCompetitorEvents()).toBe(1);

        // Second sweep: same place → update path → no new alert.
        await runNearbySweep(ORIGIN, { searchNearby, now: new Date('2026-07-11T02:00:00Z') });
        expect(await newCompetitorEvents()).toBe(1);
    });

    it('a new place beyond 5 km is recorded but does NOT emit an alert', async () => {
        await runNearbySweep(ORIGIN, {
            searchNearby: async () => [place({ placeId: 'p-far', distanceKm: 6.5 })],
            now: new Date('2026-07-10T02:00:00Z'),
        });

        const docs = await getNearbySightingsCollection().find({ restaurantId: RID }).toArray();
        expect(docs).toHaveLength(1);
        expect(await newCompetitorEvents()).toBe(0);
    });
});
