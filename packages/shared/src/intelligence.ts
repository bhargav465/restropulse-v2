// -------------------------------------------------------
// @restropulse/shared - Restaurant Intelligence types
// Data model for the competitor + self intelligence module.
// Source of truth: Rest intelligence / ARCHITECTURE.md §2.
//
// Provenance is a first-class concept: every metric is labeled
// `measured` (Google Places), `computed` (our formulas), or
// `ai-inferred` (Sonnet). No fake precision — see module CLAUDE.md §2.
// -------------------------------------------------------

/** How a value was obtained. Drives the provenance chips in the UI. */
export type Provenance = 'measured' | 'computed' | 'ai-inferred';

/**
 * Scan job lifecycle. Mirrored client-side by the scan status machine
 * (`apps/web/components/v2/intelligence/scan-status.ts`) and server-side by
 * `apps/api/src/services/intelligence/scan-status.ts` — change all or none.
 */
export type ScanStatus =
  | 'QUEUED'
  | 'FETCHING_PLACES'
  | 'ANALYZING'
  | 'SCORING'
  | 'COMPLETED'
  | 'FAILED';

/**
 * A scan job. One document per scan request; the async pipeline advances
 * `status` and finally links `reportId` when COMPLETED.
 * Collection: `intelligence_scans`.
 */
export interface IntelligenceScan {
  _id: string;
  restaurantId: string; // tenant
  query: { name: string; city: string; placeId?: string };
  status: ScanStatus;
  error?: string; // user-safe, stage-labeled
  reportId?: string;
  requestedBy: string; // merchant user id
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A single nearby competitor. Measured fields come from Places (New);
 * `threatScore`/`sameCuisineThreatScore` are computed; the qualitative
 * layer (`cuisine`, strengths, weaknesses, sentiment, insights) is ai-inferred.
 */
export interface CompetitorProfile {
  placeId: string;
  name: string;
  address: string;
  rating: number;
  totalRatings: number;
  distanceKm: number;
  lat: number;
  lng: number;
  priceLevel: number;
  photoCount: number;
  cuisine: string; // Sonnet-classified, provenance ai-inferred
  threatScore: number; // computed
  sameCuisineThreatScore: number; // computed
  // Sonnet qualitative layer (all ai-inferred):
  strengths?: string[];
  weaknesses?: string[];
  whatTheyDoBetter?: string[];
  whereYouWin?: string[];
  sentimentLabel?: 'Positive' | 'Negative' | 'Mixed';
  pricingInsight?: string;
  marketingEdge?: string;
}

/** A single deterministic check within a pillar. */
export interface PillarCheck {
  id: string;
  label: string;
  pass: boolean;
  note: string;
  actionHref?: string;
}

/** One of the six RestroScore pillars. */
export interface PillarScore {
  key: 'profile' | 'reviews' | 'photos' | 'website' | 'competition' | 'momentum';
  score: number; // 0–100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  provenance: Provenance;
  checks: PillarCheck[];
}

/**
 * Cuisine aggregation bucket (≤10 per report). Powers the cuisine-breakdown
 * stacked bar (share of nearby review volume) — provenance computed.
 */
export interface CuisineBucket {
  cuisine: string; // ai-inferred label
  count: number; // number of nearby restaurants in this cuisine
  totalRatings: number; // summed review volume
  reviewShare: number; // 0–1 share of nearby review volume — computed
  avgRating: number; // computed
  restaurants: string[]; // competitor names in this bucket
}

/**
 * Simulated local-search ranking for a query. Provenance computed
 * (simulation) — the UI labels these "Computed (simulation)".
 */
export interface SearchRanking {
  query: string; // e.g. "Best Biryani in Bengaluru"
  topResult: string; // name of the simulated #1 result
  yourPosition: number | null; // base restaurant's simulated rank, null if unranked
  inMapPack: boolean; // whether base lands in the top-3 local pack
  provenance: Provenance; // 'computed'
}

/**
 * Keyword clusters (ai-inferred, Sonnet). Chip groups surfaced in Search & SEO;
 * each keyword can seed a Content Engine draft.
 */
export interface KeywordCluster {
  primary: string[];
  longTail: string[];
  trending: string[];
  competitor: string[];
  negativeToMonitor: string[];
}

/** A single competitor/self movement alert raised by the weekly worker. */
export interface CompetitorAlert {
  type: 'competitor_surge' | 'rating_drop' | 'new_competitor';
  severity: 'info' | 'warning' | 'critical';
  message: string; // user-safe summary
  competitorName?: string; // set for competitor_surge / new_competitor
}

/**
 * Deltas vs the previous report (filled by the worker on re-scan).
 * Uses ASCII field names (ratingDelta …) for the Greek Δ fields named in
 * ARCHITECTURE.md §2. Positive = improvement for the base restaurant.
 */
export interface ReportDeltas {
  ratingDelta: number; // base rating change
  reviewsDelta: number; // base review-count change
  restroScoreDelta: number; // composite score change
  newCompetitors: string[]; // names of newly appeared nearby competitors
  competitorAlerts: CompetitorAlert[];
}

/** A single prioritized action in the narrative action plan. */
export interface ActionPlanItem {
  priority: number;
  action: string;
  detail: string;
  impact: 'High' | 'Medium' | 'Low';
  timeframe: string;
  deepLink?: {
    // 'campaigns' added in PR2 (DESIGN §4.1): retention/win-back actions deep-link
    // to the Campaigns bucket. Additive — existing buckets are unchanged.
    bucket: 'content' | 'ordering' | 'get-started' | 'campaigns';
    params?: Record<string, string>;
  };
}

/** Sonnet-authored narrative (ai-inferred). */
export interface ReportNarrative {
  overview: string;
  keyFindings: string[];
  immediateThreats: string;
  growthOpportunities: string;
  verdict: string;
  actionPlan: ActionPlanItem[];
}

/** One row of the nearby-restaurant leaderboard. */
export interface LeaderboardEntry {
  rank: number;
  name: string;
  rating: number;
  reviews: number;
  isBase: boolean;
}

/**
 * A completed intelligence report. Assembled by `report-builder.ts` with
 * provenance attached per section. Collection: `intelligence_reports`
 * (keep last 12 per restaurant; worker prunes).
 */
export interface IntelligenceReport {
  _id: string;
  restaurantId: string;
  scanId: string;
  base: {
    // the merchant's own restaurant, measured
    placeId: string;
    name: string;
    city: string;
    zone?: string;
    rating: number;
    totalRatings: number;
    photoCount: number;
    website?: string;
    phone?: string;
    hasHours: boolean;
    businessStatus: string;
    location: { lat: number; lng: number };
    recentReviews: Array<{ rating: number; text: string; time: string }>;
  };
  restroScore: number; // 0–100 composite
  pillars: PillarScore[]; // exactly 6
  competitors: CompetitorProfile[]; // all mapped, ≤60
  topCompetitors: CompetitorProfile[]; // top 5 by threat
  sameCuisineNearby: CompetitorProfile[]; // ≤8
  cuisineBreakdown: CuisineBucket[]; // ≤10
  ranking: {
    rank: number;
    total: number;
    leaderboard: LeaderboardEntry[];
  };
  searchRankings: SearchRanking[]; // simulated map-pack, provenance computed
  keywords: KeywordCluster; // ai-inferred
  narrative: ReportNarrative; // ai-inferred (Sonnet)
  deltas?: ReportDeltas; // vs previous report (worker fills)
  generatedAt: Date;
}

/**
 * Compact report row for the reports list (GET /reports). Full report bodies are
 * ~100–200 KB, so the list returns only the header fields + deltas.
 */
export interface IntelligenceReportSummary {
  id: string;
  restroScore: number;
  generatedAt: Date;
  deltas?: ReportDeltas;
}

/**
 * Internal "Your Metrics" payload (GET /self-metrics), computed from the
 * existing `events` / `orders` collections — no new event tracking. Powers the
 * Your Metrics sub-tab (DESIGN §4.5).
 */
export interface IntelligenceSelfMetrics {
  orderCount: number;
  totalCustomers: number;
  repeatCustomers: number;
  repeatRatePct: number; // 0–100
  avgOrderValue: number;
  revenue: {
    newCustomer: number; // revenue from a customer's first order
    returningCustomer: number; // revenue from repeat orders
  };
  /** 7×24 matrix: peakHours[weekday 0=Sun][hour 0–23] = completed-order count. */
  peakHours: number[][];
  /** Growth cohorts (drop-off carts, non-transacted, lapsed) from the cohort service. */
  cohorts: Array<{ id: string; name: string; count: number }>;
}
