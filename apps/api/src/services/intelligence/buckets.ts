/**
 * Competition buckets (Brief 10) — PURE helpers, no DB / Places / Sonnet calls.
 * Reuses the already-measured competitor set + already-computed threat scores to
 * derive two ranked slices and the base AOV band. Kept separate from
 * report-builder.ts so the math is unit-testable in isolation, and so the
 * standalone grader site can mirror the exact same thresholds.
 *
 * Provenance: `directTop10`/`overallTop10` are computed (threat-sorted slices);
 * `aovBand` is measured (Places priceLevel) → computed display band.
 */

import type { CompetitorProfile, CompetitionBuckets } from '@restropulse/shared';

/** Nearby radius shared with report-builder (km). */
export const BUCKET_RADIUS_KM = 5;
/** AOV proxy assumed when Google reports no price level. */
export const DEFAULT_PRICE_LEVEL = 2;

/**
 * AOV band label map. Google price levels 0–4 (Free…Very Expensive) collapse to
 * four display bands. Missing/unknown price level is treated as level 2 (Value).
 */
export const AOV_BANDS = ['Budget', 'Budget', 'Value', 'Premium', 'Luxury'] as const;

/** Human display band for a Places price level (null → the default Value band). */
export function aovBandLabel(priceLevel: number | null): string {
    const lvl = priceLevel === null ? DEFAULT_PRICE_LEVEL : priceLevel;
    return AOV_BANDS[Math.max(0, Math.min(4, Math.round(lvl)))] ?? 'Value';
}

/**
 * Cuisine-family table. Specific cuisines map to a generic family so that, e.g.,
 * "Hyderabadi Biryani" and "North Indian" both match the generic "Indian".
 * Keys + values are lowercase. Families map to themselves implicitly.
 */
const CUISINE_FAMILY: Record<string, string> = {
    // Indian family
    'indian': 'indian',
    'north indian': 'indian',
    'south indian': 'indian',
    'mughlai': 'indian',
    'punjabi': 'indian',
    'biryani': 'indian',
    'hyderabadi': 'indian',
    'andhra': 'indian',
    'chettinad': 'indian',
    'tandoori': 'indian',
    'awadhi': 'indian',
    'gujarati': 'indian',
    'rajasthani': 'indian',
    'bengali': 'indian',
    'kerala': 'indian',
    'tamil': 'indian',
    'goan': 'indian',
    'malvani': 'indian',
    'maharashtrian': 'indian',
    'udupi': 'indian',
    // Chinese family
    'chinese': 'chinese',
    'sichuan': 'chinese',
    'szechuan': 'chinese',
    'cantonese': 'chinese',
    'indo-chinese': 'chinese',
    'hakka': 'chinese',
    // Italian family
    'italian': 'italian',
    'pizza': 'italian',
    'pasta': 'italian',
    // Japanese family
    'japanese': 'japanese',
    'sushi': 'japanese',
    'ramen': 'japanese',
    // Mexican family
    'mexican': 'mexican',
    'tex-mex': 'mexican',
    // Middle-Eastern family
    'middle eastern': 'middle eastern',
    'lebanese': 'middle eastern',
    'arabic': 'middle eastern',
    'shawarma': 'middle eastern',
    // Continental / American
    'american': 'american',
    'burger': 'american',
    'bbq': 'american',
    'continental': 'continental',
};

function normalizeCuisine(c: string): string {
    return c.trim().toLowerCase();
}

/** Family label for a cuisine; unknown cuisines are their own family (self). */
function familyOf(cuisine: string): string {
    const n = normalizeCuisine(cuisine);
    return CUISINE_FAMILY[n] ?? n;
}

/**
 * Same-family cuisine match. Exact (case-insensitive) OR shared cuisine family.
 * Empty strings never match anything (including each other).
 */
export function cuisineMatch(a: string, b: string): boolean {
    const na = normalizeCuisine(a);
    const nb = normalizeCuisine(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    return familyOf(na) === familyOf(nb);
}

/** AOV bands match when the price levels are within one step (|Δ| ≤ 1). */
export function aovWithinOne(a: number | null, b: number | null): boolean {
    const la = a === null ? DEFAULT_PRICE_LEVEL : a;
    const lb = b === null ? DEFAULT_PRICE_LEVEL : b;
    return Math.abs(la - lb) <= 1;
}

/** Stable threat-desc sort (preserves input order on ties). */
function byThreatDesc(rows: CompetitorProfile[]): CompetitorProfile[] {
    return rows
        .map((r, i) => ({ r, i }))
        .sort((a, b) => b.r.threatScore - a.r.threatScore || a.i - b.i)
        .map((x) => x.r);
}

export interface BuildBucketsInput {
    baseCuisine: string;
    basePriceLevel: number | null;
    competitors: CompetitorProfile[];
}

/**
 * Build the two competition buckets from measured competitors.
 * - directTop10: within 5 km, same cuisine family AND |priceLevel − base| ≤ 1.
 * - overallTop10: within 5 km, any cuisine/price.
 * Both threat-desc, sliced to 10.
 */
export function buildCompetitionBuckets(input: BuildBucketsInput): CompetitionBuckets {
    const { baseCuisine, basePriceLevel, competitors } = input;
    const within = competitors.filter((c) => c.distanceKm <= BUCKET_RADIUS_KM);

    const direct = within.filter(
        (c) => cuisineMatch(c.cuisine, baseCuisine) && aovWithinOne(c.priceLevel, basePriceLevel),
    );

    return {
        directTop10: byThreatDesc(direct).slice(0, 10),
        overallTop10: byThreatDesc(within).slice(0, 10),
        aovBand: { base: basePriceLevel, label: aovBandLabel(basePriceLevel) },
    };
}
