/**
 * Competition buckets math (Brief 10). Pure functions — no DB/Places/Sonnet.
 * Covers cuisine-family matching, AOV ±1 boundaries, threat-sort stability,
 * ≤10 slices, and the AOV band label map (incl. the null → Value default).
 */
import { describe, it, expect } from 'vitest';
import type { CompetitorProfile } from '@restropulse/shared';
import {
    cuisineMatch,
    aovWithinOne,
    aovBandLabel,
    buildCompetitionBuckets,
} from '../../src/services/intelligence/buckets.js';

function comp(overrides: Partial<CompetitorProfile>): CompetitorProfile {
    return {
        placeId: overrides.placeId ?? 'p',
        name: overrides.name ?? 'X',
        address: 'addr',
        rating: 4.2,
        totalRatings: 100,
        distanceKm: 1,
        lat: 0,
        lng: 0,
        priceLevel: 2,
        photoCount: 10,
        cuisine: 'North Indian',
        threatScore: 50,
        sameCuisineThreatScore: 50,
        ...overrides,
    };
}

describe('cuisineMatch — same-family table', () => {
    it('matches exact labels (case-insensitive)', () => {
        expect(cuisineMatch('North Indian', 'north indian')).toBe(true);
        expect(cuisineMatch('Mexican', 'Mexican')).toBe(true);
    });

    it('matches a specific Indian cuisine to the generic "Indian"', () => {
        expect(cuisineMatch('Hyderabadi', 'Indian')).toBe(true);
        expect(cuisineMatch('Biryani', 'North Indian')).toBe(true);
        expect(cuisineMatch('Andhra', 'South Indian')).toBe(true);
    });

    it('matches within other families', () => {
        expect(cuisineMatch('Sichuan', 'Chinese')).toBe(true);
        expect(cuisineMatch('Pizza', 'Italian')).toBe(true);
    });

    it('does not match across families', () => {
        expect(cuisineMatch('Biryani', 'Chinese')).toBe(false);
        expect(cuisineMatch('Italian', 'Indian')).toBe(false);
    });

    it('unknown cuisines match only themselves', () => {
        expect(cuisineMatch('Ethiopian', 'Ethiopian')).toBe(true);
        expect(cuisineMatch('Ethiopian', 'Peruvian')).toBe(false);
    });

    it('empty strings never match', () => {
        expect(cuisineMatch('', '')).toBe(false);
        expect(cuisineMatch('Indian', '')).toBe(false);
    });
});

describe('aovWithinOne — AOV ±1 boundaries', () => {
    it('0–1 is in (Δ=1)', () => {
        expect(aovWithinOne(0, 1)).toBe(true);
        expect(aovWithinOne(1, 0)).toBe(true);
    });
    it('0–2 is out (Δ=2)', () => {
        expect(aovWithinOne(0, 2)).toBe(false);
        expect(aovWithinOne(2, 0)).toBe(false);
    });
    it('null is treated as level 2 (Value)', () => {
        expect(aovWithinOne(null, 2)).toBe(true);
        expect(aovWithinOne(null, 3)).toBe(true);
        expect(aovWithinOne(null, 0)).toBe(false); // |2-0| = 2
    });
});

describe('aovBandLabel', () => {
    it('maps levels to display bands', () => {
        expect(aovBandLabel(0)).toBe('Budget');
        expect(aovBandLabel(1)).toBe('Budget');
        expect(aovBandLabel(2)).toBe('Value');
        expect(aovBandLabel(3)).toBe('Premium');
        expect(aovBandLabel(4)).toBe('Luxury');
    });
    it('null → the default Value band', () => {
        expect(aovBandLabel(null)).toBe('Value');
    });
});

describe('buildCompetitionBuckets', () => {
    const base = { baseCuisine: 'North Indian', basePriceLevel: 2 };

    it('directTop10 requires cuisine-family match AND AOV ±1, within 5 km', () => {
        const competitors = [
            comp({ placeId: 'a', cuisine: 'Biryani', priceLevel: 2, distanceKm: 1, threatScore: 90 }), // in
            comp({ placeId: 'b', cuisine: 'Biryani', priceLevel: 0, distanceKm: 1, threatScore: 80 }), // out (AOV Δ2)
            comp({ placeId: 'c', cuisine: 'Chinese', priceLevel: 2, distanceKm: 1, threatScore: 70 }), // out (cuisine)
            comp({ placeId: 'd', cuisine: 'North Indian', priceLevel: 3, distanceKm: 6, threatScore: 95 }), // out (distance)
            comp({ placeId: 'e', cuisine: 'South Indian', priceLevel: 3, distanceKm: 2, threatScore: 60 }), // in (family + Δ1)
        ];
        const b = buildCompetitionBuckets({ ...base, competitors });
        expect(b.directTop10.map((c) => c.placeId)).toEqual(['a', 'e']);
    });

    it('overallTop10 includes any cuisine/price within 5 km, threat desc', () => {
        const competitors = [
            comp({ placeId: 'a', threatScore: 30, distanceKm: 1 }),
            comp({ placeId: 'b', threatScore: 90, distanceKm: 1, cuisine: 'Thai', priceLevel: 4 }),
            comp({ placeId: 'c', threatScore: 60, distanceKm: 4 }),
            comp({ placeId: 'far', threatScore: 99, distanceKm: 9 }), // excluded (distance)
        ];
        const b = buildCompetitionBuckets({ ...base, competitors });
        expect(b.overallTop10.map((c) => c.placeId)).toEqual(['b', 'c', 'a']);
    });

    it('threat sort is stable on ties (input order preserved)', () => {
        const competitors = [
            comp({ placeId: 't1', threatScore: 50 }),
            comp({ placeId: 't2', threatScore: 50 }),
            comp({ placeId: 't3', threatScore: 50 }),
        ];
        const b = buildCompetitionBuckets({ ...base, competitors });
        expect(b.overallTop10.map((c) => c.placeId)).toEqual(['t1', 't2', 't3']);
    });

    it('slices each bucket to at most 10', () => {
        const competitors = Array.from({ length: 25 }, (_, i) =>
            comp({ placeId: `p${i}`, cuisine: 'North Indian', priceLevel: 2, threatScore: 100 - i, distanceKm: 1 }),
        );
        const b = buildCompetitionBuckets({ ...base, competitors });
        expect(b.directTop10).toHaveLength(10);
        expect(b.overallTop10).toHaveLength(10);
    });

    it('reports the base AOV band', () => {
        const b = buildCompetitionBuckets({ ...base, competitors: [] });
        expect(b.aovBand).toEqual({ base: 2, label: 'Value' });
        const bNull = buildCompetitionBuckets({ baseCuisine: 'North Indian', basePriceLevel: null, competitors: [] });
        expect(bNull.aovBand).toEqual({ base: null, label: 'Value' });
    });
});
