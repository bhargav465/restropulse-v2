import { describe, test, expect } from 'vitest';
import { deriveNotifications } from '../../src/services/intelligence/notifications.js';
import type { DailySnapshot, IntelligenceReport } from '@restropulse/shared';

/**
 * The notification feed is derived on read from data the worker already writes.
 * These tests pin the shape of the nudges: what appears, when it is unread, and
 * that yesterday's reviews are split positive / negative.
 */

const NOW = new Date('2026-08-19T09:00:00Z');

const report = (over: Partial<IntelligenceReport> = {}): IntelligenceReport =>
    ({
        _id: 'rep-2',
        restaurantId: 'r1',
        scanId: 's2',
        base: { placeId: 'p-self', name: 'Bawarchi', city: 'Hyderabad', rating: 4.5, totalRatings: 900, photoCount: 40, hasHours: true, businessStatus: 'OPERATIONAL', location: { lat: 0, lng: 0 }, recentReviews: [] },
        restroScore: 71,
        pillars: [],
        competitors: [],
        topCompetitors: [],
        sameCuisineNearby: [],
        cuisineBreakdown: [],
        ranking: { rank: 3, total: 40, leaderboard: [] },
        searchRankings: [],
        keywords: { primary: [], longTail: [], trending: [], competitor: [], negativeToMonitor: [] },
        narrative: { overview: '', keyFindings: [], immediateThreats: '', growthOpportunities: '', verdict: '', actionPlan: [] },
        generatedAt: new Date('2026-08-18T03:00:00Z'),
        ...over,
    }) as unknown as IntelligenceReport;

const snap = (date: string, ratings: number[]): DailySnapshot => ({
    _id: `snap-${date}`,
    restaurantId: 'r1',
    targetPlaceId: 'p-self',
    isSelf: true,
    source: 'google',
    date,
    rating: 4.5,
    reviewCount: 900,
    photoCount: 40,
    newReviews: ratings.map((r, i) => ({ rating: r, text: r <= 2 ? 'Cold biryani, slow delivery' : `Great food ${i}`, time: date })),
    capturedAt: new Date(`${date}T02:00:00Z`),
});

describe('deriveNotifications', () => {
    test('a first report yields one "first report" item, unread when never seen', () => {
        const res = deriveNotifications({ latest: report(), selfSnapshots: [], seenAt: null, now: NOW });
        expect(res.items.map((i) => i.kind)).toEqual(['report_ready']);
        expect(res.items[0].title).toMatch(/first report/i);
        expect(res.unread).toBe(1);
    });

    test('a weekly report with deltas yields score change + one item per competitor alert', () => {
        const latest = report({
            deltas: {
                ratingDelta: -0.1,
                reviewsDelta: 40,
                restroScoreDelta: 3,
                newCompetitors: ['Biryani Blues'],
                competitorAlerts: [
                    { type: 'competitor_surge', severity: 'warning', message: 'Meghana gained 380 reviews', competitorName: 'Meghana' },
                    { type: 'new_competitor', severity: 'info', message: 'Biryani Blues opened 0.9 km away', competitorName: 'Biryani Blues' },
                    { type: 'rating_drop', severity: 'warning', message: 'Rating fell 4.6 → 4.5' },
                ],
            },
        });
        const res = deriveNotifications({ latest, selfSnapshots: [], seenAt: null, now: NOW });
        const kinds = res.items.map((i) => i.kind).sort();
        expect(kinds).toEqual(['competitor_surge', 'new_competitor', 'rating_drop', 'report_ready', 'score_change'].sort());
        const surge = res.items.find((i) => i.kind === 'competitor_surge')!;
        expect(surge.title).toContain('Meghana');
        expect(surge.link).toMatchObject({ bucket: 'COMPETITION', tab: 'THREATS' });
        const drop = res.items.find((i) => i.kind === 'rating_drop')!;
        expect(drop.link).toMatchObject({ bucket: 'MINE', tab: 'FEEDBACK' });
    });

    test("yesterday's reviews are split positive / negative and a negative one is flagged", () => {
        const res = deriveNotifications({
            latest: null,
            selfSnapshots: [snap('2026-08-18', [5, 4, 1])],
            seenAt: null,
            now: NOW,
        });
        const y = res.items.find((i) => i.id === 'reviews:2026-08-18')!;
        expect(y.kind).toBe('negative_review');
        expect(y.severity).toBe('warning');
        expect(y.title).toMatch(/3 new Google reviews/);
        expect(y.body).toContain('2 positive · 1 negative');
        expect(y.body).toContain('Cold biryani');
    });

    test('a week of reviews yields a weekly summary compared with the previous week', () => {
        const days: DailySnapshot[] = [
            snap('2026-08-06', [5]), snap('2026-08-08', [4, 2]),               // last week: 3 (1 neg)
            snap('2026-08-13', [5, 5]), snap('2026-08-16', [4]), snap('2026-08-18', [5, 1, 4]), // this week: 6 (1 neg)
        ];
        const res = deriveNotifications({ latest: null, selfSnapshots: days, seenAt: null, now: NOW });
        const week = res.items.find((i) => i.id.startsWith('week:'))!;
        expect(week.title).toMatch(/This week: 6 new reviews — 5 positive, 1 negative/);
        expect(week.body).toContain('+3 vs last week');
    });

    test('items dated before seenAt are read; unread counts only the newer ones', () => {
        const res = deriveNotifications({
            latest: report(),                                    // 18 Aug 03:00
            selfSnapshots: [snap('2026-08-18', [5])],            // 18 Aug 23:59
            seenAt: new Date('2026-08-18T12:00:00Z'),
            now: NOW,
        });
        expect(res.items.find((i) => i.kind === 'report_ready')!.unread).toBe(false);
        // The 18 Aug reviews produce two items dated after seenAt: yesterday's
        // reviews and the weekly summary — both unread; the report is not.
        expect(res.items.filter((i) => i.kind === 'new_reviews')).toHaveLength(2);
        expect(res.items.filter((i) => i.kind === 'new_reviews').every((i) => i.unread)).toBe(true);
        expect(res.unread).toBe(2);
        expect(res.seenAt).toBe('2026-08-18T12:00:00.000Z');
    });

    test('newest first', () => {
        const res = deriveNotifications({ latest: report(), selfSnapshots: [snap('2026-08-18', [5])], seenAt: null, now: NOW });
        expect(res.items[0].kind).toBe('new_reviews');
    });
});
