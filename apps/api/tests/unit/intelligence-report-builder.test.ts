import { describe, it, expect } from 'vitest';
import { assembleReport, type AssembleReportInput } from '../../src/services/intelligence/report-builder.js';
import type { BaseRestaurant, PlaceRow } from '../../src/services/intelligence/places.js';
import type { CompetitiveAnalysis, CompetitorEnhancement, CuisineClassification } from '../../src/services/intelligence/analysis.js';
import type { WebsiteSEO } from '../../src/services/intelligence/seo.js';
import type { IntelligenceReport } from '@restropulse/shared';

const base: BaseRestaurant = {
    placeId: 'base-1',
    name: 'Demo Kitchen',
    rating: 4.6,
    totalRatings: 820,
    website: 'https://demo.example.com',
    phone: '+910000000001',
    hasHours: true,
    photoCount: 46,
    hasDescription: false,
    recentReviews: [{ rating: 5, text: 'Great', time: '2 days ago' }],
    ownerRespondsToReviews: false,
    businessStatus: 'OPERATIONAL',
    location: { lat: 12.9719, lng: 77.6412 },
    zone: 'Indiranagar',
    formattedAddress: 'Indiranagar, Bengaluru',
    priceLevel: 2,
};

const competitors: PlaceRow[] = [
    { placeId: 'c1', name: 'Rival Biryani', address: 'A', rating: 4.5, totalRatings: 5400, lat: 12.9719, lng: 77.6420, priceLevel: 2, photoCount: 640, types: ['restaurant'], distanceKm: 1.2, threatScore: 88 },
    { placeId: 'c2', name: 'North Star', address: 'B', rating: 4.1, totalRatings: 8900, lat: 12.9752, lng: 77.6068, priceLevel: 1, photoCount: 1200, types: ['restaurant'], distanceKm: 2.1, threatScore: 72 },
    { placeId: 'c3', name: 'Cafe Nine', address: 'C', rating: 4.6, totalRatings: 6100, lat: 12.9724, lng: 77.6045, priceLevel: 2, photoCount: 900, types: ['restaurant'], distanceKm: 1.6, threatScore: 75 },
];

const classification: CuisineClassification = {
    baseCuisine: 'North Indian',
    lookup: (name: string) =>
        ({ 'Rival Biryani': 'Biryani', 'North Star': 'North Indian', 'Cafe Nine': 'Continental' } as Record<string, string>)[name],
};

const enhancement: CompetitorEnhancement = {
    name: 'North Star',
    strengths: ['Massive review volume'],
    weaknesses: ['Inconsistent service'],
    whatTheyDoBetter: ['24x7 availability'],
    whereYouWin: ['Higher rating'],
    sentimentLabel: 'Mixed',
    pricingInsight: 'Budget pricing.',
    marketingEdge: 'Late-night recall.',
};

const analysis: CompetitiveAnalysis = {
    overview: 'Overview text.',
    keyFindings: ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'],
    immediateThreats: 'Threats.',
    growthOpportunities: 'Opportunities.',
    verdict: 'Verdict.',
    actionPlan: [
        { priority: 1, action: 'A1', detail: 'D1', impact: 'High', timeframe: 'This week', deepLinkBucket: 'ordering' },
        { priority: 2, action: 'A2', detail: 'D2', impact: 'High', timeframe: 'Now', deepLinkBucket: 'campaigns' },
        { priority: 3, action: 'A3', detail: 'D3', impact: 'Medium', timeframe: '2 weeks', deepLinkBucket: 'content' },
        { priority: 4, action: 'A4', detail: 'D4', impact: 'Medium', timeframe: '1 month', deepLinkBucket: 'get-started' },
        { priority: 5, action: 'A5', detail: 'D5', impact: 'Low', timeframe: 'This week', deepLinkBucket: 'get-started' },
    ],
    keywords: { primary: ['k1'], longTail: ['k2'], trending: ['k3'], competitor: ['k4'], negativeToMonitor: ['k5'] },
    enhancements: [enhancement],
    enhancementFor: (name: string) => (name === 'North Star' ? enhancement : undefined),
};

const seo: WebsiteSEO = {
    websiteUrl: 'https://demo.example.com',
    hasWebsite: true,
    customDomain: true,
    cleanUrl: true,
    hasH1: true,
    h1IncludesCity: false,
    h1IncludesBrand: true,
    hasMetaDescription: false,
    metaDescriptionOptimalLength: false,
    metaDescriptionIncludesCity: false,
    hostname: 'demo.example.com',
    h1Text: 'Demo Kitchen',
};

function makeInput(previous?: IntelligenceReport | null): AssembleReportInput {
    return {
        reportId: 'report-1',
        scanId: 'scan-1',
        restaurantId: 'r1',
        city: 'Bengaluru',
        base,
        competitors,
        classification,
        analysis,
        seo,
        previous: previous ?? null,
        generatedAt: new Date('2026-07-09T09:00:00.000Z'),
    };
}

describe('assembleReport', () => {
    it('produces a well-formed IntelligenceReport', () => {
        const report = assembleReport(makeInput());

        expect(report._id).toBe('report-1');
        expect(report.scanId).toBe('scan-1');
        expect(report.restaurantId).toBe('r1');
        expect(report.base.name).toBe('Demo Kitchen');
        expect(report.base.city).toBe('Bengaluru');

        // Exactly 6 pillars, canonical keys, restroScore in range.
        expect(report.pillars).toHaveLength(6);
        expect(report.pillars.map((p) => p.key)).toEqual([
            'profile', 'reviews', 'photos', 'website', 'competition', 'momentum',
        ]);
        expect(report.restroScore).toBeGreaterThanOrEqual(0);
        expect(report.restroScore).toBeLessThanOrEqual(100);

        // Competitors get cuisine + sameCuisineThreatScore; enhancement merged.
        expect(report.competitors).toHaveLength(3);
        const northStar = report.competitors.find((c) => c.name === 'North Star')!;
        expect(northStar.cuisine).toBe('North Indian');
        expect(typeof northStar.sameCuisineThreatScore).toBe('number');
        expect(northStar.strengths).toEqual(['Massive review volume']);
        expect(northStar.sentimentLabel).toBe('Mixed');

        // Derived collections.
        expect(report.topCompetitors.length).toBeLessThanOrEqual(5);
        expect(report.sameCuisineNearby.every((c) => c.cuisine === 'North Indian')).toBe(true);
        expect(report.cuisineBreakdown.length).toBeGreaterThan(0);
        expect(report.cuisineBreakdown.length).toBeLessThanOrEqual(10);

        // Ranking includes the base restaurant.
        expect(report.ranking.total).toBe(4); // base + 3 competitors within 5km
        expect(report.ranking.leaderboard.some((r) => r.isBase)).toBe(true);

        // Search rankings are simulated/computed.
        expect(report.searchRankings.length).toBeGreaterThan(0);
        expect(report.searchRankings.every((s) => s.provenance === 'computed')).toBe(true);

        // Narrative action plan carries a deepLink bucket (incl. campaigns).
        expect(report.narrative.actionPlan).toHaveLength(5);
        expect(report.narrative.actionPlan.map((a) => a.deepLink?.bucket)).toContain('campaigns');

        // First scan → no deltas.
        expect(report.deltas).toBeUndefined();
    });

    it('computes deltas vs a previous report', () => {
        const previous = {
            ...assembleReport(makeInput()),
            restroScore: 60,
            base: { ...base, rating: 4.5, totalRatings: 775, city: 'Bengaluru' },
            competitors: [{ placeId: 'c1' }, { placeId: 'c2' }],
        } as unknown as IntelligenceReport;

        const report = assembleReport(makeInput(previous));
        expect(report.deltas).toBeDefined();
        expect(report.deltas!.ratingDelta).toBeCloseTo(0.1, 5);
        expect(report.deltas!.reviewsDelta).toBe(45);
        expect(report.deltas!.restroScoreDelta).toBe(report.restroScore - 60);
        // c3 is new vs the previous report.
        expect(report.deltas!.newCompetitors).toContain('Cafe Nine');
        expect(Array.isArray(report.deltas!.competitorAlerts)).toBe(true);
    });
});
