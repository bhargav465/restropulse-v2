/**
 * Competitor / self movement alerts (ARCHITECTURE.md §5).
 *
 * Pure functions: given the previous and current reports, derive the
 * `CompetitorAlert[]` that enrich `current.deltas.competitorAlerts` (the
 * report-builder leaves that array empty for the worker to fill) and drive the
 * `intelligence.alert.*` events.
 *
 * The emitted `type` values MUST stay inside the shared union
 * `CompetitorAlert['type'] = 'competitor_surge' | 'rating_drop' | 'new_competitor'`.
 */

import type { CompetitorAlert, CompetitorProfile, IntelligenceReport } from '@restropulse/shared';

// ---- Thresholds (ARCHITECTURE §5 leaves the numeric X for competitor_surge /
// new-competitor radius partly open; the chosen values are ASSUMPTIONs, all in
// one place so they are easy to tune). ----

/** competitor_surge: a returning competitor gained strictly more than this many
 *  reviews since the previous report. ASSUMPTION: 50 (§5 says "> X reviews"). */
export const SURGE_REVIEW_THRESHOLD = 50;

/** rating_drop: base rating fell by at least this much (§5: "≥ 0.1"). */
export const RATING_DROP_THRESHOLD = 0.1;

/** rating_drop severity escalates to 'critical' at or beyond this drop.
 *  ASSUMPTION (§5 does not grade severity). */
export const RATING_DROP_CRITICAL_THRESHOLD = 0.3;

/** new_competitor: a newly-appeared same-cuisine place within this radius (§5:
 *  "≤ 2 km"). */
export const NEW_COMPETITOR_RADIUS_KM = 2;

function round1(n: number): number {
    return Math.round(n * 10) / 10;
}

/**
 * Compute all movement alerts for a restaurant from its previous and current
 * intelligence reports. Returns an empty list when there is no previous report
 * (a first scan has nothing to compare against).
 */
export function computeCompetitorAlerts(
    previous: IntelligenceReport | null | undefined,
    current: IntelligenceReport,
): CompetitorAlert[] {
    if (!previous) return [];

    const alerts: CompetitorAlert[] = [];

    // 1. rating_drop -- base rating fell >= 0.1 since last report.
    const ratingDrop = round1(previous.base.rating - current.base.rating);
    if (ratingDrop >= RATING_DROP_THRESHOLD) {
        alerts.push({
            type: 'rating_drop',
            severity: ratingDrop >= RATING_DROP_CRITICAL_THRESHOLD ? 'critical' : 'warning',
            message: `Your Google rating dropped ${ratingDrop.toFixed(1)} stars (${previous.base.rating.toFixed(
                1,
            )} → ${current.base.rating.toFixed(1)}). Review recent feedback and respond.`,
        });
    }

    // 2. competitor_surge -- a returning competitor gained > threshold reviews.
    const prevReviewsByPlace = new Map<string, number>(
        previous.competitors.map((c) => [c.placeId, c.totalRatings]),
    );
    for (const c of current.competitors) {
        const before = prevReviewsByPlace.get(c.placeId);
        if (before === undefined) continue; // new competitor -> handled below
        const gained = c.totalRatings - before;
        if (gained > SURGE_REVIEW_THRESHOLD) {
            alerts.push({
                type: 'competitor_surge',
                severity: 'warning',
                message: `${c.name} gained ${gained} reviews since your last scan (now ${c.totalRatings}). They are pulling ahead on visibility.`,
                competitorName: c.name,
            });
        }
    }

    // 3. new_competitor -- a newly-appeared same-cuisine place within 2 km.
    const prevPlaceIds = new Set(previous.competitors.map((c) => c.placeId));
    const sameCuisinePlaceIds = new Set(current.sameCuisineNearby.map((c) => c.placeId));
    const newSameCuisineNearby: CompetitorProfile[] = current.competitors.filter(
        (c) =>
            !prevPlaceIds.has(c.placeId) &&
            sameCuisinePlaceIds.has(c.placeId) &&
            c.distanceKm <= NEW_COMPETITOR_RADIUS_KM,
    );
    for (const c of newSameCuisineNearby) {
        alerts.push({
            type: 'new_competitor',
            severity: 'info',
            message: `New ${c.cuisine} competitor "${c.name}" opened ${c.distanceKm.toFixed(
                1,
            )} km away. Keep an eye on their momentum.`,
            competitorName: c.name,
        });
    }

    return alerts;
}
