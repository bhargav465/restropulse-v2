import { describe, it, expect, beforeEach } from 'vitest';
import {
    captureSnapshot,
    getSeries,
    getFeedbackChanges,
    type CaptureTarget,
    type CaptureDeps,
    type SnapshotMeasurement,
} from '../../src/services/intelligence/snapshots.js';
import { getIntelligenceSnapshotsCollection } from '@restropulse/db';
import type { DailySnapshot, SnapshotReview } from '@restropulse/shared';

const RID = 'snap-rid';
const SELF: CaptureTarget = { placeId: 'self-p', isSelf: true, name: 'Us' };

// Stub tagger — no Anthropic. Attaches an empty themes array.
const stubTag = (async (reviews: SnapshotReview[]) =>
    reviews.map((r) => ({ ...r, themes: [] }))) as CaptureDeps['tagThemes'];

function measurer(m: SnapshotMeasurement): CaptureDeps['measureGoogle'] {
    return async () => m;
}

async function count() {
    return getIntelligenceSnapshotsCollection().countDocuments({ restaurantId: RID });
}

describe('captureSnapshot', () => {
    beforeEach(async () => {
        await getIntelligenceSnapshotsCollection().deleteMany({ restaurantId: RID });
    });

    it('is an idempotent upsert per target×source×day', async () => {
        const deps: CaptureDeps = {
            measureGoogle: measurer({ rating: 4.5, reviewCount: 100, photoCount: 12, seoScore: 80, reviews: [] }),
            tagThemes: stubTag,
        };
        await captureSnapshot(RID, SELF, 'google', '2026-07-01', deps);
        await captureSnapshot(RID, SELF, 'google', '2026-07-01', deps);
        expect(await count()).toBe(1);
    });

    it('diffs newReviews against the latest prior snapshot (only unseen)', async () => {
        const a: SnapshotReview = { rating: 5, text: 'A', time: 't1' };
        const b: SnapshotReview = { rating: 4, text: 'B', time: 't2' };
        const c: SnapshotReview = { rating: 3, text: 'C', time: 't3' };

        await captureSnapshot(RID, SELF, 'google', '2026-07-01', {
            measureGoogle: measurer({ rating: 4.5, reviewCount: 100, photoCount: 12, reviews: [a, b] }),
            tagThemes: stubTag,
        });
        const second = await captureSnapshot(RID, SELF, 'google', '2026-07-02', {
            measureGoogle: measurer({ rating: 4.6, reviewCount: 101, photoCount: 12, reviews: [a, b, c] }),
            tagThemes: stubTag,
        });
        expect(second!.newReviews.map((r) => r.text)).toEqual(['C']);
    });

    it('writes seoScore only for self google', async () => {
        const comp: CaptureTarget = { placeId: 'c-p', isSelf: false, name: 'C' };
        const snap = await captureSnapshot(RID, comp, 'google', '2026-07-01', {
            measureGoogle: measurer({ rating: 4, reviewCount: 50, photoCount: 5, seoScore: 90, reviews: [] }),
            tagThemes: stubTag,
        });
        expect(snap!.seoScore).toBeUndefined();
    });

    it('does not write a zomato snapshot when the adapter has no data', async () => {
        const snap = await captureSnapshot(RID, SELF, 'zomato', '2026-07-01', {
            zomatoAdapter: { fetch: async () => null },
            tagThemes: stubTag,
        });
        expect(snap).toBeNull();
        expect(await count()).toBe(0);
    });
});

describe('getSeries — day vs month aggregation', () => {
    beforeEach(async () => {
        await getIntelligenceSnapshotsCollection().deleteMany({ restaurantId: RID });
    });

    async function seedRaw(rows: Array<Partial<DailySnapshot> & { date: string }>) {
        for (const r of rows) {
            const doc: DailySnapshot = {
                _id: `${RID}:self-p:google:${r.date}`,
                restaurantId: RID,
                targetPlaceId: 'self-p',
                isSelf: true,
                source: 'google',
                rating: r.rating ?? 4,
                reviewCount: r.reviewCount ?? 100,
                photoCount: r.photoCount ?? 10,
                newReviews: r.newReviews ?? [],
                capturedAt: new Date(),
                ...r,
            };
            await getIntelligenceSnapshotsCollection().insertOne(doc as unknown as Record<string, unknown>);
        }
    }

    it('day granularity returns one point per raw row', async () => {
        await seedRaw([
            { date: '2026-07-01' },
            { date: '2026-07-02' },
            { date: '2026-07-03' },
        ]);
        const pts = await getSeries(RID, { targetPlaceId: 'self-p', source: 'google', granularity: 'day' });
        expect(pts).toHaveLength(3);
    });

    it('month aggregate: rating=last-of-month, newReviews=sum, photos=last', async () => {
        const rv = (n: number): SnapshotReview[] => Array.from({ length: n }, (_, i) => ({ rating: 5, text: `r${i}`, time: 't' }));
        await seedRaw([
            { date: '2026-07-01', rating: 4.0, photoCount: 10, newReviews: rv(2) },
            { date: '2026-07-15', rating: 4.3, photoCount: 15, newReviews: rv(3) },
            { date: '2026-07-31', rating: 4.6, photoCount: 20, newReviews: rv(1) },
        ]);
        const [pt] = await getSeries(RID, { targetPlaceId: 'self-p', source: 'google', granularity: 'month' });
        expect(pt.date).toBe('2026-07');
        expect(pt.rating).toBe(4.6); // last-of-month
        expect(pt.photoCount).toBe(20); // last
        expect(pt.newReviews).toBe(6); // sum 2+3+1
    });
});

describe('getFeedbackChanges', () => {
    beforeEach(async () => {
        await getIntelligenceSnapshotsCollection().deleteMany({ restaurantId: RID });
    });

    it('merges both sources with source tags and computes before/after rating', async () => {
        await getIntelligenceSnapshotsCollection().insertMany([
            {
                _id: `${RID}:self-p:google:2026-07-01`,
                restaurantId: RID, targetPlaceId: 'self-p', isSelf: true, source: 'google',
                date: '2026-07-01', rating: 4.0, reviewCount: 100, photoCount: 10,
                newReviews: [{ rating: 5, text: 'g1', time: 't', themes: ['food-quality'] }], capturedAt: new Date(),
            },
            {
                _id: `${RID}:self-p:google:2026-07-02`,
                restaurantId: RID, targetPlaceId: 'self-p', isSelf: true, source: 'google',
                date: '2026-07-02', rating: 4.2, reviewCount: 102, photoCount: 10,
                newReviews: [{ rating: 5, text: 'g2', time: 't', themes: ['food-quality'] }], capturedAt: new Date(),
            },
            {
                _id: `${RID}:self-p:zomato:2026-07-02`,
                restaurantId: RID, targetPlaceId: 'self-p', isSelf: true, source: 'zomato',
                date: '2026-07-02', rating: 4.1, reviewCount: 50, photoCount: 8,
                newReviews: [], capturedAt: new Date(),
            },
        ] as unknown as Record<string, unknown>[]);

        const { days } = await getFeedbackChanges(RID, '2026-07-01', '2026-07-02');
        expect(days).toHaveLength(2);
        expect(days[0].ratingBefore).toBeNull();
        expect(days[0].ratingAfter).toBe(4.0);
        expect(days[1].ratingBefore).toBe(4.0);
        expect(days[1].ratingAfter).toBe(4.2);
        expect(days[1].newReviews[0].source).toBe('google');
        expect(days[0].themesTrending).toContain('food-quality');
    });
});
