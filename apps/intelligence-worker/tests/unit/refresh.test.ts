import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getEventsCollection, getIntelligenceReportsCollection } from '@restropulse/db';
import {
    getActiveIntelligenceRestaurantIds,
    runIntelligenceRefresh,
} from '../../src/refresh.js';
import { SURGE_REVIEW_THRESHOLD } from '../../src/alerts.js';
import type { RescanFn } from '../../src/rescan.js';
import { makeCompetitor, makeReport } from '../fixtures.js';

const RID = 'rest-1';

async function insert(report: ReturnType<typeof makeReport>): Promise<void> {
    await getIntelligenceReportsCollection().insertOne(report as unknown as Record<string, unknown>);
}

async function eventNames(): Promise<string[]> {
    const docs = await getEventsCollection().find({}).toArray();
    return docs.map((d) => d.name as string).sort();
}

describe('runIntelligenceRefresh (weekly-loop smoke, pipeline mocked)', () => {
    beforeEach(async () => {
        await getIntelligenceReportsCollection().deleteMany({});
        await getEventsCollection().deleteMany({});
    });

    it('lists only restaurants that already have a report', async () => {
        await insert(makeReport({ restaurantId: 'rest-A', _id: 'a1' }));
        await insert(makeReport({ restaurantId: 'rest-B', _id: 'b1' }));
        const ids = await getActiveIntelligenceRestaurantIds();
        expect(new Set(ids)).toEqual(new Set(['rest-A', 'rest-B']));
    });

    it('re-scans, writes alerts back to the report, and emits one event per alert + scan.completed', async () => {
        // Previous week's report.
        await insert(
            makeReport({
                restaurantId: RID,
                _id: 'prev',
                baseRating: 4.6,
                generatedAt: new Date('2026-07-01T00:00:00Z'),
                competitors: [makeCompetitor({ placeId: 'p1', name: 'Rival', totalRatings: 100 })],
            }),
        );

        // Mocked pipeline: inserts this week's fresh report (rating drop + surge + new same-cuisine).
        const fresh = makeCompetitor({ placeId: 'p2', name: 'Newbie', cuisine: 'Biryani', distanceKm: 1 });
        const scanRestaurant: RescanFn = vi.fn(async () => {
            await insert(
                makeReport({
                    restaurantId: RID,
                    _id: 'curr',
                    baseRating: 4.2,
                    generatedAt: new Date('2026-07-08T00:00:00Z'),
                    competitors: [
                        makeCompetitor({ placeId: 'p1', name: 'Rival', totalRatings: 100 + SURGE_REVIEW_THRESHOLD + 5 }),
                        fresh,
                    ],
                    sameCuisineNearby: [fresh],
                    withEmptyDeltas: true,
                }),
            );
            return null;
        });

        const stats = await runIntelligenceRefresh({
            scanRestaurant,
            now: () => new Date('2026-07-08T01:00:00Z'),
        });

        expect(scanRestaurant).toHaveBeenCalledTimes(1);
        expect(stats.restaurants).toBe(1);
        expect(stats.processed).toBe(1);
        expect(stats.alerts).toBe(3);

        // Alerts persisted onto the current report.
        const curr = await getIntelligenceReportsCollection().findOne({ _id: 'curr' as unknown as never });
        expect(curr?.deltas?.competitorAlerts).toHaveLength(3);
        expect(curr?.alertsEmittedAt).toBeInstanceOf(Date);

        // Events: scan.completed + one per alert type.
        expect(await eventNames()).toEqual([
            'intelligence.alert.competitor_surge',
            'intelligence.alert.new_competitor',
            'intelligence.alert.rating_drop',
            'intelligence.scan.completed',
        ]);
    });

    it('is idempotent: a second pass with no new report emits nothing more', async () => {
        await insert(
            makeReport({
                restaurantId: RID,
                _id: 'prev',
                baseRating: 4.6,
                generatedAt: new Date('2026-07-01T00:00:00Z'),
                competitors: [makeCompetitor({ placeId: 'p1', totalRatings: 100 })],
            }),
        );

        let inserted = false;
        const scanRestaurant: RescanFn = vi.fn(async () => {
            if (!inserted) {
                inserted = true;
                await insert(
                    makeReport({
                        restaurantId: RID,
                        _id: 'curr',
                        baseRating: 4.2,
                        generatedAt: new Date('2026-07-08T00:00:00Z'),
                        competitors: [makeCompetitor({ placeId: 'p1', totalRatings: 100 })],
                        withEmptyDeltas: true,
                    }),
                );
            }
            return null;
        });

        await runIntelligenceRefresh({ scanRestaurant, now: () => new Date('2026-07-08T01:00:00Z') });
        const afterFirst = await getEventsCollection().countDocuments({});

        const stats2 = await runIntelligenceRefresh({ scanRestaurant, now: () => new Date('2026-07-15T01:00:00Z') });
        const afterSecond = await getEventsCollection().countDocuments({});

        expect(stats2.skipped).toBe(1);
        expect(stats2.processed).toBe(0);
        expect(afterSecond).toBe(afterFirst);
    });

    it('emits scan.completed with no alerts when nothing crossed a threshold', async () => {
        await insert(
            makeReport({
                restaurantId: RID,
                _id: 'prev',
                baseRating: 4.5,
                generatedAt: new Date('2026-07-01T00:00:00Z'),
                competitors: [makeCompetitor({ placeId: 'p1', totalRatings: 100 })],
            }),
        );
        const scanRestaurant: RescanFn = vi.fn(async () => {
            await insert(
                makeReport({
                    restaurantId: RID,
                    _id: 'curr',
                    baseRating: 4.5,
                    generatedAt: new Date('2026-07-08T00:00:00Z'),
                    competitors: [makeCompetitor({ placeId: 'p1', totalRatings: 110 })],
                    withEmptyDeltas: true,
                }),
            );
            return null;
        });

        const stats = await runIntelligenceRefresh({ scanRestaurant, now: () => new Date('2026-07-08T01:00:00Z') });
        expect(stats.alerts).toBe(0);
        expect(await eventNames()).toEqual(['intelligence.scan.completed']);
    });
});
