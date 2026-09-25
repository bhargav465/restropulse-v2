/**
 * Report builder — assembles a valid `IntelligenceReport` from the measured
 * (Places), ai-inferred (Anthropic), and computed (scoring) stage outputs, and
 * computes `deltas` vs the previous report.
 *
 * `assembleReport` is PURE (no DB, no clock beyond the injected `generatedAt`)
 * so it can be shape-tested from mocked stage inputs. Persistence + reportId
 * linking is done by the pipeline (pipeline.ts).
 *
 * Provenance per section (ARCHITECTURE §2):
 *   base            → measured   competitors ratings/reviews → measured
 *   threatScores    → computed   cuisine / strengths / narrative → ai-inferred
 *   pillars         → per-pillar (see scoring.ts)   searchRankings → computed
 */

import type {
    CompetitorProfile,
    CuisineBucket,
    IntelligenceReport,
    LeaderboardEntry,
    ReportDeltas,
    ReportNarrative,
    SearchRanking,
} from '@restropulse/shared';
import type { BaseRestaurant, PlaceRow } from './places.js';
import type { CompetitiveAnalysis, CuisineClassification } from './analysis.js';
import type { WebsiteSEO } from './seo.js';
import {
    computePillars,
    restroScore as computeRestroScore,
    sameCuisineThreatScore,
    type PillarInputs,
} from './scoring.js';
import { buildCompetitionBuckets } from './buckets.js';

const NEARBY_RADIUS_KM = 5;

/** Composite quality score used for ranking + search simulation (ported). */
function compositeScore(rating: number, reviews: number): number {
    return (rating / 5) * 50 + Math.min(50, (Math.log10(Math.max(1, reviews)) / 4) * 50);
}

export interface AssembleReportInput {
    reportId: string;
    scanId: string;
    restaurantId: string;
    city: string;
    base: BaseRestaurant;
    competitors: PlaceRow[];
    classification: CuisineClassification;
    analysis: CompetitiveAnalysis;
    seo: WebsiteSEO;
    previous?: IntelligenceReport | null;
    generatedAt: Date;
}

export function assembleReport(input: AssembleReportInput): IntelligenceReport {
    const { base, classification, analysis, seo, previous, generatedAt } = input;
    const baseCuisineLower = classification.baseCuisine.toLowerCase();

    // RP-011: the nearby search is centred on the merchant, so Places returns the
    // merchant itself in the results. Left in, it ranked as its own #1 threat in
    // Top Threats / topCompetitors / the buckets, and was counted twice in the
    // leaderboard (inflating `ranking.total` by one). Drop it once, here, so
    // every downstream slice is clean.
    const competitors = base.placeId
        ? input.competitors.filter((c) => c.placeId !== base.placeId)
        : input.competitors;

    // 1. Cuisine + same-cuisine threat + qualitative enhancement per competitor.
    const profiles: CompetitorProfile[] = competitors.map((c) => {
        const cuisine = classification.lookup(c.name) ?? 'Multi-cuisine';
        const isSame = cuisine.toLowerCase() === baseCuisineLower;
        const enh = analysis.enhancementFor(c.name);
        return {
            placeId: c.placeId,
            name: c.name,
            address: c.address,
            rating: c.rating,
            totalRatings: c.totalRatings,
            distanceKm: c.distanceKm,
            lat: c.lat,
            lng: c.lng,
            priceLevel: c.priceLevel,
            photoCount: c.photoCount,
            cuisine,
            threatScore: c.threatScore,
            sameCuisineThreatScore: sameCuisineThreatScore(c.rating, c.totalRatings, c.distanceKm, isSame),
            ...(enh
                ? {
                      strengths: enh.strengths,
                      weaknesses: enh.weaknesses,
                      ...(enh.whatTheyDoBetter ? { whatTheyDoBetter: enh.whatTheyDoBetter } : {}),
                      ...(enh.whereYouWin ? { whereYouWin: enh.whereYouWin } : {}),
                      ...(enh.sentimentLabel ? { sentimentLabel: enh.sentimentLabel } : {}),
                      ...(enh.pricingInsight ? { pricingInsight: enh.pricingInsight } : {}),
                      ...(enh.marketingEdge ? { marketingEdge: enh.marketingEdge } : {}),
                  }
                : {}),
        };
    });

    const topCompetitors = [...profiles].sort((a, b) => b.threatScore - a.threatScore).slice(0, 5);

    // Brief 10: competition buckets (reuses measured competitors + computed threat).
    const buckets = buildCompetitionBuckets({
        baseCuisine: classification.baseCuisine,
        basePriceLevel: base.priceLevel,
        competitors: profiles,
    });

    const sameCuisineNearby = profiles
        .filter((p) => p.cuisine.toLowerCase() === baseCuisineLower && p.distanceKm <= NEARBY_RADIUS_KM)
        .sort((a, b) => b.sameCuisineThreatScore - a.sameCuisineThreatScore)
        .slice(0, 8);

    // 2. Cuisine breakdown (within 5 km, by review share).
    const cuisineBreakdown = buildCuisineBreakdown(profiles);

    // 3. Ranking (composite of base + competitors within 5 km).
    const ranking = buildRanking(base, profiles);

    // 4. Search ranking simulation.
    const searchRankings = buildSearchRankings(base, profiles, classification.baseCuisine, input.city);

    // 5. Scoring — momentum deltas first (no dependency on restroScore).
    const areaAvgRating =
        profiles.length > 0 ? profiles.reduce((s, p) => s + p.rating, 0) / profiles.length : base.rating;
    const reviewPercentile = percentile(profiles.map((p) => p.totalRatings), base.totalRatings);

    const closestSameCuisine = profiles
        .filter((p) => p.cuisine.toLowerCase() === baseCuisineLower)
        .sort((a, b) => a.distanceKm - b.distanceKm)[0];
    const leadsClosestSameCuisineRival = !closestSameCuisine || base.rating >= closestSameCuisine.rating;

    const newCompetitorNames = previous ? diffNewCompetitors(profiles, previous) : [];
    const newSameCuisineRivals = previous
        ? profiles.filter(
              (p) => newCompetitorNames.includes(p.name) && p.cuisine.toLowerCase() === baseCuisineLower,
          ).length
        : 0;

    const momentum = previous
        ? {
              ratingDelta: round1(base.rating - previous.base.rating),
              reviewsDelta: base.totalRatings - previous.base.totalRatings,
              newSameCuisineRivals,
          }
        : undefined;

    const pillarInputs: PillarInputs = {
        base: {
            rating: base.rating,
            totalRatings: base.totalRatings,
            photoCount: base.photoCount,
            website: base.website,
            phone: base.phone,
            hasHours: base.hasHours,
            hasDescription: base.hasDescription,
            businessStatus: base.businessStatus,
            recentReviewCount: base.recentReviews.length,
            ownerRespondsToReviews: base.ownerRespondsToReviews,
        },
        seo: {
            hasWebsite: seo.hasWebsite,
            customDomain: seo.customDomain,
            hasH1: seo.hasH1,
            h1IncludesBrand: seo.h1IncludesBrand,
            hasMetaDescription: seo.hasMetaDescription,
        },
        competition: {
            rank: ranking.rank,
            total: ranking.total,
            leadsClosestSameCuisineRival,
            reviewPercentile,
        },
        momentum,
        areaAvgRating,
    };
    const pillars = computePillars(pillarInputs);
    const restroScore = computeRestroScore(pillars);

    // 6. Narrative (ai-inferred) — map deep-link buckets onto the shared shape.
    const narrative: ReportNarrative = {
        overview: analysis.overview,
        keyFindings: analysis.keyFindings,
        immediateThreats: analysis.immediateThreats,
        growthOpportunities: analysis.growthOpportunities,
        verdict: analysis.verdict,
        actionPlan: analysis.actionPlan.map((a) => ({
            priority: a.priority,
            action: a.action,
            detail: a.detail,
            impact: a.impact,
            timeframe: a.timeframe,
            deepLink: { bucket: a.deepLinkBucket },
        })),
    };

    // 7. Deltas vs previous (competitorAlerts are enriched by the worker).
    let deltas: ReportDeltas | undefined;
    if (previous) {
        deltas = {
            ratingDelta: round1(base.rating - previous.base.rating),
            reviewsDelta: base.totalRatings - previous.base.totalRatings,
            restroScoreDelta: restroScore - previous.restroScore,
            newCompetitors: newCompetitorNames,
            competitorAlerts: [],
        };
    }

    return {
        _id: input.reportId,
        restaurantId: input.restaurantId,
        scanId: input.scanId,
        base: {
            placeId: base.placeId,
            name: base.name,
            city: input.city,
            ...(base.zone ? { zone: base.zone } : {}),
            rating: base.rating,
            totalRatings: base.totalRatings,
            photoCount: base.photoCount,
            ...(base.website ? { website: base.website } : {}),
            ...(base.phone ? { phone: base.phone } : {}),
            hasHours: base.hasHours,
            businessStatus: base.businessStatus,
            location: base.location,
            recentReviews: base.recentReviews,
        },
        restroScore,
        pillars,
        competitors: profiles,
        topCompetitors,
        sameCuisineNearby,
        cuisineBreakdown,
        ranking,
        searchRankings,
        keywords: analysis.keywords,
        narrative,
        ...(deltas ? { deltas } : {}),
        buckets,
        generatedAt,
    };
}

// ---- helpers ----

function round1(n: number): number {
    return Math.round(n * 10) / 10;
}

/** Percentile of `value` within `pool` (0–100): share of pool ≤ value. */
function percentile(pool: number[], value: number): number {
    if (pool.length === 0) return 100;
    const atOrBelow = pool.filter((v) => v <= value).length;
    return Math.round((atOrBelow / pool.length) * 100);
}

function buildCuisineBreakdown(profiles: CompetitorProfile[]): CuisineBucket[] {
    const within = profiles.filter((p) => p.distanceKm <= NEARBY_RADIUS_KM);
    const totalReviews = within.reduce((s, p) => s + p.totalRatings, 0);
    const agg = new Map<string, { count: number; totalRatings: number; ratingSum: number; names: string[] }>();
    for (const p of within) {
        const key = p.cuisine || 'Multi-cuisine';
        const bucket = agg.get(key) ?? { count: 0, totalRatings: 0, ratingSum: 0, names: [] };
        bucket.count += 1;
        bucket.totalRatings += p.totalRatings;
        bucket.ratingSum += p.rating;
        bucket.names.push(p.name);
        agg.set(key, bucket);
    }
    return [...agg.entries()]
        .map(([cuisine, b]) => ({
            cuisine,
            count: b.count,
            totalRatings: b.totalRatings,
            reviewShare: totalReviews > 0 ? Number((b.totalRatings / totalReviews).toFixed(3)) : 0,
            avgRating: Number((b.ratingSum / b.count).toFixed(2)),
            restaurants: b.names,
        }))
        .sort((a, b) => b.totalRatings - a.totalRatings)
        .slice(0, 10);
}

function buildRanking(
    base: BaseRestaurant,
    profiles: CompetitorProfile[],
): { rank: number; total: number; leaderboard: LeaderboardEntry[] } {
    const rows = [
        { name: base.name, rating: base.rating, reviews: base.totalRatings, isBase: true },
        ...profiles
            .filter((p) => p.distanceKm <= NEARBY_RADIUS_KM)
            .map((p) => ({ name: p.name, rating: p.rating, reviews: p.totalRatings, isBase: false })),
    ].sort((a, b) => compositeScore(b.rating, b.reviews) - compositeScore(a.rating, a.reviews));

    const rank = rows.findIndex((r) => r.isBase) + 1;
    const leaderboard: LeaderboardEntry[] = rows
        .slice(0, Math.max(10, rank + 2))
        .map((r, i) => ({ rank: i + 1, name: r.name, rating: r.rating, reviews: r.reviews, isBase: r.isBase }));

    return { rank, total: rows.length, leaderboard };
}

function buildSearchRankings(
    base: BaseRestaurant,
    profiles: CompetitorProfile[],
    baseCuisine: string,
    city: string,
): SearchRanking[] {
    const cuisineLower = baseCuisine.toLowerCase();
    const within = profiles.filter((p) => p.distanceKm <= NEARBY_RADIUS_KM);

    const buildPool = (sameCuisineOnly: boolean) =>
        [
            { name: base.name, rating: base.rating, reviews: base.totalRatings, isBase: true },
            ...within
                .filter((p) => (sameCuisineOnly ? p.cuisine.toLowerCase() === cuisineLower : true))
                .map((p) => ({ name: p.name, rating: p.rating, reviews: p.totalRatings, isBase: false })),
        ].sort((a, b) => compositeScore(b.rating, b.reviews) - compositeScore(a.rating, a.reviews));

    const queries: Array<{ query: string; sameCuisine: boolean }> = [
        { query: `Best ${baseCuisine} in ${city}`, sameCuisine: true },
        { query: `Top restaurants in ${city}`, sameCuisine: false },
        { query: `Best ${baseCuisine} near me`, sameCuisine: true },
        { query: `Best restaurants in ${city}`, sameCuisine: false },
    ];

    return queries.map(({ query, sameCuisine }) => {
        const pool = buildPool(sameCuisine);
        const idx = pool.findIndex((r) => r.isBase);
        const yourPosition = idx >= 0 ? idx + 1 : null;
        return {
            query,
            topResult: pool[0]?.name ?? base.name,
            yourPosition,
            inMapPack: idx >= 0 && idx < 3,
            provenance: 'computed',
        };
    });
}

function diffNewCompetitors(current: CompetitorProfile[], previous: IntelligenceReport): string[] {
    const prevIds = new Set(previous.competitors.map((c) => c.placeId));
    return current.filter((c) => !prevIds.has(c.placeId)).map((c) => c.name);
}
