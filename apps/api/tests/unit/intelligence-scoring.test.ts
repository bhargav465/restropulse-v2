import { describe, it, expect } from 'vitest';
import {
    getDistanceKm,
    threatScore,
    sameCuisineThreatScore,
    computePillars,
    restroScore,
    gradeForScore,
    PILLAR_WEIGHTS,
    type PillarInputs,
} from '../../src/services/intelligence/scoring.js';
import type { PillarScore } from '@restropulse/shared';

describe('getDistanceKm (Haversine)', () => {
    it('is zero for the same point', () => {
        expect(getDistanceKm(12.97, 77.64, 12.97, 77.64)).toBe(0);
    });
    it('is symmetric and positive for distinct points', () => {
        const a = getDistanceKm(12.9719, 77.6412, 12.9422, 77.5729);
        const b = getDistanceKm(12.9422, 77.5729, 12.9719, 77.6412);
        expect(a).toBeCloseTo(b, 6);
        expect(a).toBeGreaterThan(0);
    });
});

describe('threatScore (rating 40 + log-review 30 + proximity 30)', () => {
    it('maxes at 100 for a perfect, high-volume, on-top competitor', () => {
        expect(threatScore(5, 10000, 0)).toBe(100);
    });
    it('is 0 for a zero-rating unknown place at the 7km edge', () => {
        expect(threatScore(0, 0, 7)).toBe(0);
    });
    it('matches the exact formula for a mid case', () => {
        // rating 4/5*40=32; reviews log10(100)/4*30=15; proximity 30*(1-3.5/7)=15 → 62
        expect(threatScore(4, 100, 3.5)).toBe(62);
    });
    it('never exceeds 100 past the review cap', () => {
        expect(threatScore(5, 5_000_000, 0)).toBe(100);
    });
});

describe('sameCuisineThreatScore (step-proximity 35 + rating 25 + reviews 20 + cuisine 20)', () => {
    it('maxes at 100 for a same-cuisine, adjacent, high-volume rival', () => {
        expect(sameCuisineThreatScore(5, 10000, 0.3, true)).toBe(100);
    });
    it('applies the proximity step function (isolated)', () => {
        expect(sameCuisineThreatScore(0, 1, 0.5, false)).toBe(35);
        expect(sameCuisineThreatScore(0, 1, 1, false)).toBe(32);
        expect(sameCuisineThreatScore(0, 1, 2, false)).toBe(27);
        expect(sameCuisineThreatScore(0, 1, 3, false)).toBe(20);
        expect(sameCuisineThreatScore(0, 1, 5, false)).toBe(12);
    });
    it('adds no cuisine bonus for a different cuisine', () => {
        // prox(3.5<=5→12) + rating 4/5*25=20 + reviews log10(100)/4*20=10 + 0 = 42
        expect(sameCuisineThreatScore(4, 100, 3.5, false)).toBe(42);
    });
});

describe('gradeForScore boundaries', () => {
    it('maps A/B/C/D/F at the exact edges', () => {
        expect(gradeForScore(100)).toBe('A');
        expect(gradeForScore(85)).toBe('A');
        expect(gradeForScore(84)).toBe('B');
        expect(gradeForScore(70)).toBe('B');
        expect(gradeForScore(69)).toBe('C');
        expect(gradeForScore(55)).toBe('C');
        expect(gradeForScore(54)).toBe('D');
        expect(gradeForScore(40)).toBe('D');
        expect(gradeForScore(39)).toBe('F');
        expect(gradeForScore(0)).toBe('F');
    });
});

describe('restroScore composite', () => {
    it('weights sum to 100', () => {
        expect(Object.values(PILLAR_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
    });

    it('reproduces the demo fixture: pillar scores → 68', () => {
        const pillars: PillarScore[] = [
            { key: 'profile', score: 75, grade: 'B', provenance: 'measured', checks: [] },
            { key: 'reviews', score: 90, grade: 'A', provenance: 'measured', checks: [] },
            { key: 'photos', score: 62, grade: 'C', provenance: 'measured', checks: [] },
            { key: 'website', score: 34, grade: 'F', provenance: 'measured', checks: [] },
            { key: 'competition', score: 66, grade: 'C', provenance: 'computed', checks: [] },
            { key: 'momentum', score: 60, grade: 'C', provenance: 'computed', checks: [] },
        ];
        expect(restroScore(pillars)).toBe(68);
    });
});

describe('computePillars (deterministic checks)', () => {
    // Inputs engineered to reproduce the demo fixture pass pattern + scores.
    const inputs: PillarInputs = {
        base: {
            rating: 4.6,
            totalRatings: 820,
            photoCount: 46,
            website: 'https://demo.example.com',
            phone: '+910000000001',
            hasHours: true,
            hasDescription: false,
            businessStatus: 'OPERATIONAL',
            recentReviewCount: 4,
            ownerRespondsToReviews: false,
        },
        seo: {
            hasWebsite: true,
            customDomain: false,
            hasH1: false,
            h1IncludesBrand: false,
            hasMetaDescription: false,
        },
        competition: {
            rank: 4,
            total: 38,
            leadsClosestSameCuisineRival: true,
            reviewPercentile: 40,
        },
        momentum: { ratingDelta: 0.1, reviewsDelta: 45, newSameCuisineRivals: 1 },
        areaAvgRating: 4.4,
    };

    it('returns exactly 6 pillars in canonical order', () => {
        const pillars = computePillars(inputs);
        expect(pillars.map((p) => p.key)).toEqual([
            'profile', 'reviews', 'photos', 'website', 'competition', 'momentum',
        ]);
    });

    it('scores each pillar to the fixture values and composites to 68', () => {
        const pillars = computePillars(inputs);
        const byKey = Object.fromEntries(pillars.map((p) => [p.key, p.score]));
        expect(byKey).toEqual({
            profile: 75, reviews: 90, photos: 62, website: 34, competition: 66, momentum: 60,
        });
        expect(restroScore(pillars)).toBe(68);
    });

    it('assigns measured/computed provenance per pillar', () => {
        const pillars = computePillars(inputs);
        expect(pillars.find((p) => p.key === 'reviews')!.provenance).toBe('measured');
        expect(pillars.find((p) => p.key === 'competition')!.provenance).toBe('computed');
        expect(pillars.find((p) => p.key === 'momentum')!.provenance).toBe('computed');
    });

    it('handles a first scan (no momentum baseline) without throwing', () => {
        const firstScan: PillarInputs = { ...inputs, momentum: undefined };
        const pillars = computePillars(firstScan);
        const momentum = pillars.find((p) => p.key === 'momentum')!;
        // Only "no new rivals" passes (weight 40) on a first scan.
        expect(momentum.score).toBe(40);
    });

    it('every public check omits internal weight fields', () => {
        const pillars = computePillars(inputs);
        for (const p of pillars) {
            for (const c of p.checks) {
                expect(c).not.toHaveProperty('weight');
                expect(typeof c.pass).toBe('boolean');
                expect(typeof c.note).toBe('string');
            }
        }
    });
});
