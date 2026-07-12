import { describe, it, expect, beforeEach } from 'vitest';
import {
    buildCompareRows,
    getNewOpenings,
    type CompareTarget,
    type SourceWindowData,
} from '../../src/services/intelligence/compare.js';
import { getNearbySightingsCollection } from '@restropulse/db';
import type { NearbyPlaceSighting } from '@restropulse/shared';

function src(over: Partial<SourceWindowData> = {}): SourceWindowData {
    return { rating: 4.0, reviewCount: 100, newReviews: 1, photoCount: 20, velocity: 1, ...over };
}

const self: CompareTarget = {
    placeId: 'self-1',
    name: 'Us',
    isSelf: true,
    google: src({ rating: 4.0, photoCount: 20, velocity: 1, responseRate: 50 }),
};

describe('buildCompareRows — thresholds', () => {
    it('self row always has empty beatsYou', () => {
        const rows = buildCompareRows(self, []);
        expect(rows[0].isSelf).toBe(true);
        expect(rows[0].beatsYou).toEqual([]);
    });

    it('rating gap ≥ 0.1 counts, < 0.1 does not (boundary)', () => {
        const beats: CompareTarget = { placeId: 'c1', name: 'C1', isSelf: false, google: src({ rating: 4.1 }) };
        const noBeat: CompareTarget = { placeId: 'c2', name: 'C2', isSelf: false, google: src({ rating: 4.09 }) };
        const [, r1] = buildCompareRows(self, [beats]);
        const [, r2] = buildCompareRows(self, [noBeat]);
        expect(r1.beatsYou.some((g) => g.metric === 'rating')).toBe(true);
        expect(r2.beatsYou.some((g) => g.metric === 'rating')).toBe(false);
    });

    it('review-velocity ratio must exceed 1.25× (strict)', () => {
        const exactly = { placeId: 'c', name: 'C', isSelf: false, google: src({ velocity: 1.25 }) };
        const over = { placeId: 'c', name: 'C', isSelf: false, google: src({ velocity: 1.26 }) };
        expect(buildCompareRows(self, [exactly])[1].beatsYou.some((g) => g.metric === 'reviewVelocity')).toBe(false);
        expect(buildCompareRows(self, [over])[1].beatsYou.some((g) => g.metric === 'reviewVelocity')).toBe(true);
    });

    it('responseRate gap ≥ 10 pts counts', () => {
        const beats: CompareTarget = { placeId: 'c', name: 'C', isSelf: false, google: src({ responseRate: 60 }) };
        const noBeat: CompareTarget = { placeId: 'c', name: 'C', isSelf: false, google: src({ responseRate: 59 }) };
        expect(buildCompareRows(self, [beats])[1].beatsYou.some((g) => g.metric === 'responseRate')).toBe(true);
        expect(buildCompareRows(self, [noBeat])[1].beatsYou.some((g) => g.metric === 'responseRate')).toBe(false);
    });

    it('photoCount gap ≥ 10 counts (boundary)', () => {
        const beats: CompareTarget = { placeId: 'c', name: 'C', isSelf: false, google: src({ photoCount: 30 }) };
        const noBeat: CompareTarget = { placeId: 'c', name: 'C', isSelf: false, google: src({ photoCount: 29 }) };
        expect(buildCompareRows(self, [beats])[1].beatsYou.some((g) => g.metric === 'photoCount')).toBe(true);
        expect(buildCompareRows(self, [noBeat])[1].beatsYou.some((g) => g.metric === 'photoCount')).toBe(false);
    });

    it('missing zomato data → no zomato gaps (never zeros-as-data)', () => {
        // Competitor leads hugely, but only on zomato where self has no data.
        const comp: CompareTarget = {
            placeId: 'c',
            name: 'C',
            isSelf: false,
            zomato: src({ rating: 5, photoCount: 500, velocity: 100 }),
        };
        const [, row] = buildCompareRows(self, [comp]);
        expect(row.beatsYou.filter((g) => g.source === 'zomato')).toEqual([]);
    });

    it('projects only the public per-source fields', () => {
        const [selfRow] = buildCompareRows(self, []);
        expect(Object.keys(selfRow.google!).sort()).toEqual(['newReviews', 'photoCount', 'rating', 'reviewCount']);
    });
});

describe('getNewOpenings', () => {
    const RID = 'no-rid';
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;

    beforeEach(async () => {
        await getNearbySightingsCollection().deleteMany({ restaurantId: RID });
    });

    async function seed(over: Partial<NearbyPlaceSighting>) {
        const base: NearbyPlaceSighting = {
            _id: over.placeId ?? 'p',
            restaurantId: RID,
            placeId: over.placeId ?? 'p',
            name: over.name ?? 'Place',
            lat: 0,
            lng: 0,
            distanceKm: 2,
            firstSeenAt: new Date(now - 5 * DAY),
            lastSeenAt: new Date(now),
            ratingAtFirstSeen: 4,
            reviewsAtFirstSeen: 10,
            ...over,
        };
        await getNearbySightingsCollection().insertOne(base as unknown as Record<string, unknown>);
    }

    it('filters by radius and sorts by distance ascending', async () => {
        await seed({ placeId: 'near', distanceKm: 1 });
        await seed({ placeId: 'far', distanceKm: 4 });
        await seed({ placeId: 'outside', distanceKm: 8 });
        const out = await getNewOpenings(RID, 5, 30, async () => 10);
        expect(out.map((o) => o.placeId)).toEqual(['near', 'far']);
    });

    it('excludes sightings older than the sinceDays window', async () => {
        await seed({ placeId: 'recent', firstSeenAt: new Date(now - 20 * DAY) });
        await seed({ placeId: 'old', firstSeenAt: new Date(now - 40 * DAY) });
        const out = await getNewOpenings(RID, 5, 30, async () => 10);
        expect(out.map((o) => o.placeId)).toEqual(['recent']);
    });

    it('flags fastStarter when ≥30 reviews gained within ≤21 days', async () => {
        await seed({ placeId: 'fast', firstSeenAt: new Date(now - 10 * DAY), reviewsAtFirstSeen: 5 });
        await seed({ placeId: 'slow', firstSeenAt: new Date(now - 10 * DAY), reviewsAtFirstSeen: 5, distanceKm: 3 });
        const out = await getNewOpenings(RID, 5, 30, async (placeId) => (placeId === 'fast' ? 40 : 20));
        const fast = out.find((o) => o.placeId === 'fast')!;
        const slow = out.find((o) => o.placeId === 'slow')!;
        expect(fast.fastStarter).toBe(true);
        expect(slow.fastStarter).toBe(false);
    });
});
