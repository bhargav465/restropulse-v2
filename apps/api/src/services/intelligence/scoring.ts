/**
 * Intelligence scoring engine — PURE functions, fully unit-tested.
 *
 * Three families of scores (ARCHITECTURE §3.3):
 *  - threatScore              (ported verbatim): rating 40% + log-review 30% +
 *                             linear proximity decay over 7km 30%.
 *  - sameCuisineThreatScore   (ported verbatim): step-proximity 35 + rating 25 +
 *                             reviews 20 + cuisine-match 20.
 *  - restroScore              (NEW): weighted 6-pillar composite. Each pillar is
 *                             0–100 from deterministic boolean checks (each check
 *                             carries an explicit point weight summing to 100 per
 *                             pillar). Composite weights: profile 20, reviews 25,
 *                             photos 10, website 15, competition 20, momentum 10.
 *
 * No network, no DB, no clock — deterministic given inputs.
 */

import type { PillarCheck, PillarScore, Provenance } from '@restropulse/shared';

// ============================================================
// Distance (Haversine) — ported verbatim from the predecessor.
// ============================================================

export function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// ============================================================
// Threat scores — ported verbatim from the predecessor.
// ============================================================

/**
 * General threat: Rating (40) + Review volume (30) + Proximity (30) = max 100.
 * 100 reviews ≈ 15, 1000 ≈ 22, 5000 ≈ 28, 10000+ ≈ 30. Proximity decays
 * linearly to 0 at 7 km.
 */
export function threatScore(rating: number, totalRatings: number, distanceKm: number): number {
    const ratingScore = (rating / 5) * 40;
    const reviewScore = Math.min(30, (Math.log10(Math.max(1, totalRatings)) / 4) * 30);
    const proximityScore = Math.max(0, 30 * (1 - distanceKm / 7));
    return Math.min(100, Math.round(ratingScore + reviewScore + proximityScore));
}

/**
 * Same-cuisine threat: step-proximity (35) + Rating (25) + Reviews (20) +
 * cuisine match (20) = max 100.
 */
export function sameCuisineThreatScore(
    rating: number,
    totalRatings: number,
    distanceKm: number,
    isSameCuisine: boolean,
): number {
    const proximityScore =
        distanceKm <= 0.5 ? 35 :
        distanceKm <= 1 ? 32 :
        distanceKm <= 2 ? 27 :
        distanceKm <= 3 ? 20 :
        distanceKm <= 5 ? 12 :
        Math.max(0, 5 - distanceKm);
    const ratingScore = (rating / 5) * 25;
    const reviewScore = Math.min(20, (Math.log10(Math.max(1, totalRatings)) / 4) * 20);
    const cuisineBonus = isSameCuisine ? 20 : 0;
    return Math.min(100, Math.round(proximityScore + ratingScore + reviewScore + cuisineBonus));
}

// ============================================================
// RestroScore — weighted 6-pillar composite (NEW).
// ============================================================

export type PillarKey = PillarScore['key'];
export type Grade = PillarScore['grade'];

/** Composite weights (sum to 100). ARCHITECTURE §3.3. */
export const PILLAR_WEIGHTS: Record<PillarKey, number> = {
    profile: 20,
    reviews: 25,
    photos: 10,
    website: 15,
    competition: 20,
    momentum: 10,
};

const PILLAR_PROVENANCE: Record<PillarKey, Provenance> = {
    profile: 'measured',
    reviews: 'measured',
    photos: 'measured',
    website: 'measured',
    competition: 'computed',
    momentum: 'computed',
};

/**
 * Grade boundaries: A ≥ 85, B ≥ 70, C ≥ 55, D ≥ 40, else F.
 */
export function gradeForScore(score: number): Grade {
    if (score >= 85) return 'A';
    if (score >= 70) return 'B';
    if (score >= 55) return 'C';
    if (score >= 40) return 'D';
    return 'F';
}

/** A single weighted check: `weight` points earned iff `pass` is true. */
interface WeightedCheck {
    id: string;
    label: string;
    weight: number;
    pass: boolean;
    note: string;
    actionHref?: string;
}

/** Sum the earned points of a pillar's weighted checks (0–100). */
function scoreChecks(checks: WeightedCheck[]): number {
    const total = checks.reduce((sum, c) => sum + (c.pass ? c.weight : 0), 0);
    return Math.round(total);
}

/** Strip the internal `weight` field to produce the public PillarCheck. */
function toPublicChecks(checks: WeightedCheck[]): PillarCheck[] {
    return checks.map(({ id, label, pass, note, actionHref }) => ({
        id,
        label,
        pass,
        note,
        ...(actionHref ? { actionHref } : {}),
    }));
}

function makePillar(key: PillarKey, checks: WeightedCheck[]): PillarScore {
    const score = scoreChecks(checks);
    return {
        key,
        score,
        grade: gradeForScore(score),
        provenance: PILLAR_PROVENANCE[key],
        checks: toPublicChecks(checks),
    };
}

/**
 * Inputs the report-builder derives from measured/computed stage outputs and
 * feeds into pillar computation. Every field is deterministic (no free text).
 */
export interface PillarInputs {
    base: {
        rating: number;
        totalRatings: number;
        photoCount: number;
        website: string | null;
        phone: string | null;
        hasHours: boolean;
        hasDescription: boolean;
        businessStatus: string;
        recentReviewCount: number;
        ownerRespondsToReviews: boolean;
    };
    /** Deterministic website/SEO signals from seo.ts. */
    seo: {
        hasWebsite: boolean;
        customDomain: boolean;
        hasH1: boolean;
        h1IncludesBrand: boolean;
        hasMetaDescription: boolean;
    };
    /** Competitive context (computed from ranking + same-cuisine analysis). */
    competition: {
        rank: number;
        total: number;
        leadsClosestSameCuisineRival: boolean;
        reviewPercentile: number; // 0–100, base's review-volume percentile vs area
    };
    /** Trend context; absent on a first scan (no previous report). */
    momentum?: {
        ratingDelta: number;
        reviewsDelta: number;
        newSameCuisineRivals: number;
    };
    /** Area average rating (mean of nearby competitors), for the reviews pillar. */
    areaAvgRating: number;
    /** Deep-link targets for failing-check "Fix" affordances. */
    actionHrefs?: Partial<Record<string, string>>;
}

const HREF = {
    getStarted: '/admin/get-started',
    content: '/admin/content',
    website: '/admin/website-design',
    intelligence: '/admin/intelligence',
};

export function computePillars(inputs: PillarInputs): PillarScore[] {
    const { base, seo, competition, momentum, areaAvgRating } = inputs;

    const profile = makePillar('profile', [
        { id: 'profile-hours', label: 'Business hours set', weight: 25, pass: base.hasHours,
          note: base.hasHours ? 'Hours are listed on your Google profile.' : 'No business hours found — add them to improve visibility.', actionHref: HREF.getStarted },
        { id: 'profile-phone', label: 'Phone number present', weight: 25, pass: !!base.phone,
          note: base.phone ? 'A contact phone number is listed.' : 'No phone number found — add contact info to your profile.', actionHref: HREF.getStarted },
        { id: 'profile-category', label: 'Business is operational', weight: 25, pass: base.businessStatus === 'OPERATIONAL',
          note: base.businessStatus === 'OPERATIONAL' ? 'Marked operational on Google.' : `Business status: ${base.businessStatus || 'Unknown'}.`, actionHref: HREF.getStarted },
        { id: 'profile-description', label: 'Business description', weight: 25, pass: base.hasDescription,
          note: base.hasDescription ? 'A description is present on the profile.' : 'No description on the Google profile — add a keyword-rich one.', actionHref: HREF.getStarted },
    ]);

    const ratingAboveArea = base.rating >= areaAvgRating;
    const reviews = makePillar('reviews', [
        { id: 'reviews-rating', label: 'Rating above area average', weight: 30, pass: ratingAboveArea,
          note: ratingAboveArea ? `${base.rating} vs area avg ${areaAvgRating.toFixed(1)}.` : `${base.rating} is below the area average of ${areaAvgRating.toFixed(1)}.`, actionHref: HREF.getStarted },
        { id: 'reviews-volume', label: 'Healthy review volume', weight: 30, pass: base.totalRatings >= 50,
          note: base.totalRatings >= 50 ? `${base.totalRatings} ratings and growing.` : `Only ${base.totalRatings} ratings — more reviews improve ranking.`, actionHref: HREF.getStarted },
        { id: 'reviews-recency', label: 'Recent reviews present', weight: 30, pass: base.recentReviewCount > 0,
          note: base.recentReviewCount > 0 ? `${base.recentReviewCount} recent reviews on record.` : 'No recent reviews found.', actionHref: HREF.getStarted },
        { id: 'reviews-replies', label: 'Owner replies to reviews', weight: 10, pass: base.ownerRespondsToReviews,
          note: base.ownerRespondsToReviews ? 'Owner appears active in replying to reviews.' : 'No owner replies found — reply weekly to build trust.', actionHref: HREF.getStarted },
    ]);

    const photos = makePillar('photos', [
        { id: 'photos-count', label: 'At least 30 photos', weight: 34, pass: base.photoCount >= 30,
          note: `${base.photoCount} photos on the profile.`, actionHref: HREF.content },
        { id: 'photos-food', label: 'Menu/food photos present', weight: 28, pass: base.photoCount >= 10,
          note: base.photoCount >= 10 ? 'Photo library has enough depth for food shots.' : 'Add food and menu photos to attract customers.', actionHref: HREF.content },
        // Places API (New) does not expose photo recency — reported as a known limitation.
        { id: 'photos-fresh', label: 'Photos added recently', weight: 38, pass: false,
          note: 'Photo recency is not exposed by Google — refresh photos regularly to stay relevant.', actionHref: HREF.content },
    ]);

    const website = makePillar('website', [
        { id: 'website-exists', label: 'Website linked on profile', weight: 34, pass: seo.hasWebsite,
          note: seo.hasWebsite ? 'A website is linked on the profile.' : 'No website linked on your Google Business Profile.', actionHref: HREF.website },
        { id: 'website-custom-domain', label: 'Custom domain', weight: 20, pass: seo.customDomain,
          note: seo.customDomain ? 'Using a custom domain.' : 'No custom domain — using a third-party or link-in-bio page.', actionHref: HREF.website },
        { id: 'website-ordering', label: 'Branded ordering site', weight: 18, pass: seo.hasWebsite && seo.h1IncludesBrand,
          note: seo.hasWebsite && seo.h1IncludesBrand ? 'Homepage headline references your brand.' : 'No branded ordering link surfaced from search.', actionHref: HREF.website },
        { id: 'website-meta', label: 'SEO meta description', weight: 16, pass: seo.hasMetaDescription,
          note: seo.hasMetaDescription ? 'Meta description present.' : 'Missing meta description for search results.', actionHref: HREF.website },
        { id: 'website-mobile', label: 'Homepage headline (H1)', weight: 12, pass: seo.hasH1,
          note: seo.hasH1 ? 'Homepage has an H1 headline.' : 'No H1 headline found on the homepage.', actionHref: HREF.website },
    ]);

    const leadsRival = competition.leadsClosestSameCuisineRival;
    const beatsVolume = competition.reviewPercentile >= 50;
    const competitionPillar = makePillar('competition', [
        { id: 'competition-rank', label: 'Top-5 by rating nearby', weight: 34, pass: competition.rank <= 5,
          note: `Ranked #${competition.rank} of ${competition.total} nearby.`, actionHref: HREF.getStarted },
        { id: 'competition-samecuisine', label: 'Leads closest same-cuisine rival', weight: 32, pass: leadsRival,
          note: leadsRival ? 'Ahead of your closest same-cuisine rival on rating.' : 'A same-cuisine rival out-rates you nearby.', actionHref: HREF.getStarted },
        { id: 'competition-volume', label: 'Review volume vs rivals', weight: 34, pass: beatsVolume,
          note: beatsVolume ? 'Your review volume is above the local median.' : 'Top rivals have far more reviews — close the gap.', actionHref: HREF.getStarted },
    ]);

    // Momentum: on a first scan there is no trend baseline. The two trend checks
    // fail (unknown), and "no new rivals" passes (nothing to compare against).
    const m = momentum;
    const ratingUpOrFlat = m ? m.ratingDelta >= 0 : false;
    const reviewsUp = m ? m.reviewsDelta > 0 : false;
    const noNewRivals = m ? m.newSameCuisineRivals === 0 : true;
    const momentumPillar = makePillar('momentum', [
        { id: 'momentum-rating', label: 'Rating trending up', weight: 30, pass: ratingUpOrFlat,
          note: !m ? 'First scan — no trend yet.' : m.ratingDelta >= 0 ? `Rating change ${m.ratingDelta >= 0 ? '+' : ''}${m.ratingDelta.toFixed(1)} vs last scan.` : `Rating fell ${m.ratingDelta.toFixed(1)} vs last scan.`, actionHref: HREF.intelligence },
        { id: 'momentum-reviews', label: 'Review growth pace', weight: 30, pass: reviewsUp,
          note: !m ? 'First scan — no trend yet.' : reviewsUp ? `+${m.reviewsDelta} reviews vs last scan.` : 'No review growth since the last scan.', actionHref: HREF.intelligence },
        { id: 'momentum-newrivals', label: 'No new same-cuisine rivals', weight: 40, pass: noNewRivals,
          note: noNewRivals ? 'No new same-cuisine rivals detected nearby.' : `${m!.newSameCuisineRivals} new same-cuisine rival(s) appeared nearby.`, actionHref: HREF.intelligence },
    ]);

    return [profile, reviews, photos, website, competitionPillar, momentumPillar];
}

/**
 * Weighted composite of the 6 pillars, 0–100. Weights sum to 100 so this is the
 * point-weighted mean of the pillar scores.
 */
export function restroScore(pillars: PillarScore[]): number {
    const total = pillars.reduce((sum, p) => sum + p.score * PILLAR_WEIGHTS[p.key], 0);
    return Math.round(total / 100);
}
