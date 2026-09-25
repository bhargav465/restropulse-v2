import { describe, test, expect } from 'vitest';
import { assembleReport, type AssembleReportInput } from '../../src/services/intelligence/report-builder.js';
import type { BaseRestaurant, PlaceRow } from '../../src/services/intelligence/places.js';
import type { CompetitiveAnalysis, CuisineClassification } from '../../src/services/intelligence/analysis.js';
import type { WebsiteSEO } from '../../src/services/intelligence/seo.js';

/**
 * RP-011 — the nearby Places search is centred on the merchant, so Google returns
 * the merchant in its own competitor list. Left in, it ranked as its own #1 threat
 * and was counted twice in the leaderboard. `assembleReport` must drop it.
 */

const SELF_PLACE_ID = 'place-self';

const base: BaseRestaurant = {
    placeId: SELF_PLACE_ID,
    name: 'Bawarchi Test Kitchen',
    rating: 4.6,
    totalRatings: 820,
    website: null,
    phone: '+910000000000',
    hasHours: true,
    photoName: null,
    photoCount: 40,
    hasDescription: true,
    recentReviews: [{ rating: 5, text: 'Great biryani', time: new Date().toISOString() }],
    ownerRespondsToReviews: false,
    businessStatus: 'OPERATIONAL',
    location: { lat: 17.4, lng: 78.5 },
    zone: 'RTC X Roads',
    formattedAddress: 'RTC X Roads, Hyderabad',
    priceLevel: 2,
};

function placeRow(placeId: string, name: string, threatScore: number, overrides: Partial<PlaceRow> = {}): PlaceRow {
    return {
        placeId,
        name,
        address: 'Hyderabad',
        rating: 4.5,
        totalRatings: 500,
        lat: 17.4,
        lng: 78.5,
        priceLevel: 2,
        photoCount: 20,
        types: ['restaurant'],
        distanceKm: 1,
        threatScore,
        ...overrides,
    };
}

const classification: CuisineClassification = {
    baseCuisine: 'Biryani',
    lookup: () => 'Biryani',
};

const analysis: CompetitiveAnalysis = {
    overview: 'overview',
    keyFindings: ['finding'],
    immediateThreats: 'threats',
    growthOpportunities: 'opportunities',
    verdict: 'verdict',
    actionPlan: [
        { priority: 1, action: 'act', detail: 'detail', impact: 'High', timeframe: 'this week', deepLinkBucket: 'content' },
    ],
    keywords: { primary: [], longTail: [], trending: [], competitor: [], negativeToMonitor: [] },
    enhancements: [],
    enhancementFor: () => undefined,
};

const seo: WebsiteSEO = {
    websiteUrl: null,
    hasWebsite: false,
    customDomain: false,
    cleanUrl: false,
    hasH1: false,
    h1IncludesCity: false,
    h1IncludesBrand: false,
    hasMetaDescription: false,
    metaDescriptionOptimalLength: false,
    metaDescriptionIncludesCity: false,
    hostname: null,
    h1Text: null,
};

function build(competitors: PlaceRow[]) {
    const input: AssembleReportInput = {
        reportId: 'rep-1',
        scanId: 'scan-1',
        restaurantId: 'rest-1',
        city: 'Hyderabad',
        base,
        competitors,
        classification,
        analysis,
        seo,
        previous: null,
        generatedAt: new Date('2026-08-18T00:00:00Z'),
    };
    return assembleReport(input);
}

describe('assembleReport — RP-011 self-exclusion', () => {
    const rivals = [placeRow('place-rival-a', 'Behrouz', 80), placeRow('place-rival-b', 'Crystal', 70)];

    test('drops the merchant from every competitor slice', () => {
        // Google returns the merchant first — highest threat, zero distance.
        const report = build([placeRow(SELF_PLACE_ID, base.name, 99, { distanceKm: 0 }), ...rivals]);

        const ids = (rows: Array<{ placeId: string }>) => rows.map((r) => r.placeId);
        expect(ids(report.competitors)).not.toContain(SELF_PLACE_ID);
        expect(ids(report.topCompetitors)).not.toContain(SELF_PLACE_ID);
        expect(ids(report.buckets?.overallTop10 ?? [])).not.toContain(SELF_PLACE_ID);
        expect(ids(report.buckets?.directTop10 ?? [])).not.toContain(SELF_PLACE_ID);
    });

    test('does not count the merchant twice in the ranking', () => {
        const withSelf = build([placeRow(SELF_PLACE_ID, base.name, 99, { distanceKm: 0 }), ...rivals]);
        const withoutSelf = build(rivals);

        // 2 rivals + the merchant itself = 3, whether or not Places echoed it back.
        expect(withSelf.ranking.total).toBe(3);
        expect(withSelf.ranking.total).toBe(withoutSelf.ranking.total);
        expect(withSelf.ranking.leaderboard.filter((r) => r.isBase)).toHaveLength(1);
    });

    test('leaves a genuine competitor list untouched', () => {
        const report = build(rivals);
        expect(report.competitors.map((c) => c.placeId)).toEqual(['place-rival-a', 'place-rival-b']);
    });
});
