/**
 * Minimal [SAMPLE] report/competitor builders for worker tests. Not shipped;
 * lives under tests/. Values are deterministic and easy to perturb per case.
 */

import type {
    CompetitorProfile,
    IntelligenceReport,
    PillarScore,
    ReportDeltas,
} from '@restropulse/shared';

let seq = 0;
export function uid(prefix = 'id'): string {
    seq += 1;
    return `${prefix}-${seq}`;
}

export function makeCompetitor(overrides: Partial<CompetitorProfile> = {}): CompetitorProfile {
    return {
        placeId: overrides.placeId ?? uid('place'),
        name: overrides.name ?? 'Rival Kitchen',
        address: '1 Test Road',
        rating: 4.2,
        totalRatings: 300,
        distanceKm: 1.0,
        lat: 12.9,
        lng: 77.6,
        priceLevel: 2,
        photoCount: 20,
        cuisine: 'Biryani',
        threatScore: 50,
        sameCuisineThreatScore: 50,
        ...overrides,
    };
}

const PILLAR: PillarScore = {
    key: 'profile',
    score: 80,
    grade: 'B',
    provenance: 'computed',
    checks: [],
};

export interface MakeReportOverrides {
    _id?: string;
    restaurantId?: string;
    baseRating?: number;
    baseTotalRatings?: number;
    restroScore?: number;
    competitors?: CompetitorProfile[];
    sameCuisineNearby?: CompetitorProfile[];
    generatedAt?: Date;
    deltas?: ReportDeltas;
    withEmptyDeltas?: boolean;
}

export function makeReport(o: MakeReportOverrides = {}): IntelligenceReport {
    const competitors = o.competitors ?? [makeCompetitor()];
    const report: IntelligenceReport = {
        _id: o._id ?? uid('report'),
        restaurantId: o.restaurantId ?? 'rest-1',
        scanId: uid('scan'),
        base: {
            placeId: 'base-place',
            name: 'My Biryani House',
            city: 'Bengaluru',
            rating: o.baseRating ?? 4.5,
            totalRatings: o.baseTotalRatings ?? 500,
            photoCount: 40,
            hasHours: true,
            businessStatus: 'OPERATIONAL',
            location: { lat: 12.9, lng: 77.6 },
            recentReviews: [],
        },
        restroScore: o.restroScore ?? 78,
        pillars: [PILLAR, PILLAR, PILLAR, PILLAR, PILLAR, PILLAR],
        competitors,
        topCompetitors: competitors.slice(0, 5),
        sameCuisineNearby: o.sameCuisineNearby ?? [],
        cuisineBreakdown: [],
        ranking: { rank: 1, total: competitors.length + 1, leaderboard: [] },
        searchRankings: [],
        keywords: { primary: [], longTail: [], trending: [], competitor: [], negativeToMonitor: [] },
        narrative: {
            overview: '',
            keyFindings: [],
            immediateThreats: '',
            growthOpportunities: '',
            verdict: '',
            actionPlan: [],
        },
        generatedAt: o.generatedAt ?? new Date('2026-07-01T00:00:00Z'),
    };

    if (o.deltas) {
        report.deltas = o.deltas;
    } else if (o.withEmptyDeltas) {
        report.deltas = {
            ratingDelta: 0,
            reviewsDelta: 0,
            restroScoreDelta: 0,
            newCompetitors: [],
            competitorAlerts: [],
        };
    }

    return report;
}
