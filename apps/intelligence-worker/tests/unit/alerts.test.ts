import { describe, it, expect } from 'vitest';
import type { CompetitorAlert } from '@restropulse/shared';
import {
    computeCompetitorAlerts,
    NEW_COMPETITOR_RADIUS_KM,
    RATING_DROP_CRITICAL_THRESHOLD,
    RATING_DROP_THRESHOLD,
    SURGE_REVIEW_THRESHOLD,
} from '../../src/alerts.js';
import { makeCompetitor, makeReport } from '../fixtures.js';

const UNION: CompetitorAlert['type'][] = ['competitor_surge', 'rating_drop', 'new_competitor'];

describe('computeCompetitorAlerts', () => {
    it('returns no alerts when there is no previous report', () => {
        const current = makeReport();
        expect(computeCompetitorAlerts(null, current)).toEqual([]);
    });

    it('returns no alerts when nothing crossed a threshold', () => {
        const shared = makeCompetitor({ placeId: 'p1', totalRatings: 100 });
        const previous = makeReport({ baseRating: 4.5, competitors: [shared] });
        const current = makeReport({ baseRating: 4.5, competitors: [{ ...shared, totalRatings: 120 }] });
        expect(computeCompetitorAlerts(previous, current)).toEqual([]);
    });

    describe('rating_drop', () => {
        it('fires when the base rating fell by exactly the threshold', () => {
            const previous = makeReport({ baseRating: 4.5 });
            const current = makeReport({ baseRating: 4.5 - RATING_DROP_THRESHOLD });
            const alerts = computeCompetitorAlerts(previous, current);
            expect(alerts).toHaveLength(1);
            expect(alerts[0].type).toBe('rating_drop');
            expect(alerts[0].severity).toBe('warning');
        });

        it('does NOT fire for a sub-threshold drop', () => {
            const previous = makeReport({ baseRating: 4.5 });
            const current = makeReport({ baseRating: 4.45 });
            expect(computeCompetitorAlerts(previous, current)).toEqual([]);
        });

        it('does NOT fire when the rating improved', () => {
            const previous = makeReport({ baseRating: 4.3 });
            const current = makeReport({ baseRating: 4.6 });
            expect(computeCompetitorAlerts(previous, current)).toEqual([]);
        });

        it('escalates to critical for a large drop', () => {
            const previous = makeReport({ baseRating: 4.6 });
            const current = makeReport({ baseRating: 4.6 - RATING_DROP_CRITICAL_THRESHOLD });
            const alerts = computeCompetitorAlerts(previous, current);
            expect(alerts[0].severity).toBe('critical');
        });
    });

    describe('competitor_surge', () => {
        it('fires when a returning competitor gained more than the review threshold', () => {
            const c = makeCompetitor({ placeId: 'p1', name: 'Surge Diner', totalRatings: 200 });
            const previous = makeReport({ competitors: [c] });
            const current = makeReport({
                competitors: [{ ...c, totalRatings: 200 + SURGE_REVIEW_THRESHOLD + 1 }],
            });
            const alerts = computeCompetitorAlerts(previous, current);
            expect(alerts).toHaveLength(1);
            expect(alerts[0].type).toBe('competitor_surge');
            expect(alerts[0].competitorName).toBe('Surge Diner');
        });

        it('does NOT fire at exactly the threshold (strictly greater)', () => {
            const c = makeCompetitor({ placeId: 'p1', totalRatings: 200 });
            const previous = makeReport({ competitors: [c] });
            const current = makeReport({ competitors: [{ ...c, totalRatings: 200 + SURGE_REVIEW_THRESHOLD }] });
            expect(computeCompetitorAlerts(previous, current)).toEqual([]);
        });

        it('does NOT fire for a brand-new competitor (handled as new_competitor path)', () => {
            const previous = makeReport({ competitors: [makeCompetitor({ placeId: 'p1', totalRatings: 100 })] });
            const fresh = makeCompetitor({ placeId: 'p2', totalRatings: 999, cuisine: 'Pizza', distanceKm: 4 });
            const current = makeReport({ competitors: [makeCompetitor({ placeId: 'p1', totalRatings: 100 }), fresh] });
            const surges = computeCompetitorAlerts(previous, current).filter((a) => a.type === 'competitor_surge');
            expect(surges).toEqual([]);
        });
    });

    describe('new_competitor', () => {
        it('fires for a new same-cuisine place within the radius', () => {
            const fresh = makeCompetitor({ placeId: 'p9', name: 'Fresh Biryani', cuisine: 'Biryani', distanceKm: 1.5 });
            const previous = makeReport({ competitors: [makeCompetitor({ placeId: 'p1' })] });
            const current = makeReport({
                competitors: [makeCompetitor({ placeId: 'p1' }), fresh],
                sameCuisineNearby: [fresh],
            });
            const alerts = computeCompetitorAlerts(previous, current);
            const news = alerts.filter((a) => a.type === 'new_competitor');
            expect(news).toHaveLength(1);
            expect(news[0].competitorName).toBe('Fresh Biryani');
            expect(news[0].severity).toBe('info');
        });

        it('does NOT fire for a new same-cuisine place beyond the radius', () => {
            const fresh = makeCompetitor({
                placeId: 'p9',
                cuisine: 'Biryani',
                distanceKm: NEW_COMPETITOR_RADIUS_KM + 1,
            });
            const previous = makeReport({ competitors: [makeCompetitor({ placeId: 'p1' })] });
            const current = makeReport({
                competitors: [makeCompetitor({ placeId: 'p1' }), fresh],
                sameCuisineNearby: [fresh],
            });
            expect(computeCompetitorAlerts(previous, current).filter((a) => a.type === 'new_competitor')).toEqual([]);
        });

        it('does NOT fire for a new place of a different cuisine (not in sameCuisineNearby)', () => {
            const fresh = makeCompetitor({ placeId: 'p9', cuisine: 'Pizza', distanceKm: 1 });
            const previous = makeReport({ competitors: [makeCompetitor({ placeId: 'p1' })] });
            const current = makeReport({
                competitors: [makeCompetitor({ placeId: 'p1' }), fresh],
                sameCuisineNearby: [],
            });
            expect(computeCompetitorAlerts(previous, current).filter((a) => a.type === 'new_competitor')).toEqual([]);
        });

        it('does NOT fire for a same-cuisine place that already existed', () => {
            const existing = makeCompetitor({ placeId: 'p1', cuisine: 'Biryani', distanceKm: 1 });
            const previous = makeReport({ competitors: [existing] });
            const current = makeReport({ competitors: [existing], sameCuisineNearby: [existing] });
            expect(computeCompetitorAlerts(previous, current).filter((a) => a.type === 'new_competitor')).toEqual([]);
        });
    });

    it('every emitted alert type stays inside the shared CompetitorAlert union', () => {
        const c = makeCompetitor({ placeId: 'p1', name: 'Multi', totalRatings: 100, cuisine: 'Biryani' });
        const fresh = makeCompetitor({ placeId: 'p2', name: 'Newbie', cuisine: 'Biryani', distanceKm: 1 });
        const previous = makeReport({ baseRating: 4.6, competitors: [c] });
        const current = makeReport({
            baseRating: 4.2,
            competitors: [{ ...c, totalRatings: 100 + SURGE_REVIEW_THRESHOLD + 10 }, fresh],
            sameCuisineNearby: [fresh],
        });
        const alerts = computeCompetitorAlerts(previous, current);
        const types = new Set(alerts.map((a) => a.type));
        expect(types).toEqual(new Set(['rating_drop', 'competitor_surge', 'new_competitor']));
        for (const a of alerts) expect(UNION).toContain(a.type);
    });
});
