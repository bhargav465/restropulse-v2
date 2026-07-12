import { describe, it, expect } from 'vitest';
import type {
  ActionPlanItem,
  CompetitorAlert,
  CompetitorProfile,
  CuisineBucket,
  IntelligenceReport,
  IntelligenceScan,
  KeywordCluster,
  LeaderboardEntry,
  PillarCheck,
  PillarScore,
  Provenance,
  ReportDeltas,
  ReportNarrative,
  ScanStatus,
  SearchRanking,
} from '../src/intelligence.js';

// These typed literals exist to force the exported intelligence types to
// compile and resolve at their point of use. If a type export is removed or
// its shape drifts, this file fails to type-check (`turbo type-check` on
// @restropulse/shared) and the runtime assertions below fail to import.

const provenances: Provenance[] = ['measured', 'computed', 'ai-inferred'];

const scanStatuses: ScanStatus[] = [
  'QUEUED',
  'FETCHING_PLACES',
  'ANALYZING',
  'SCORING',
  'COMPLETED',
  'FAILED',
];

const sampleCheck: PillarCheck = {
  id: 'website-custom-domain',
  label: 'Custom domain',
  pass: false,
  note: '[SAMPLE] No custom domain.',
  actionHref: '/admin-v2/website-design',
};

const samplePillar: PillarScore = {
  key: 'website',
  score: 34,
  grade: 'F',
  provenance: 'measured',
  checks: [sampleCheck],
};

const sampleCompetitor: CompetitorProfile = {
  placeId: 'sample-place-1',
  name: '[SAMPLE] Rival Kitchen',
  address: '[SAMPLE] 1 Market Rd, Bengaluru',
  rating: 4.5,
  totalRatings: 5400,
  distanceKm: 1.2,
  lat: 12.9719,
  lng: 77.6412,
  priceLevel: 2,
  photoCount: 640,
  cuisine: 'Biryani',
  threatScore: 88,
  sameCuisineThreatScore: 22,
  sentimentLabel: 'Positive',
};

const sampleCuisine: CuisineBucket = {
  cuisine: 'Continental',
  count: 3,
  totalRatings: 22500,
  reviewShare: 0.402,
  avgRating: 4.53,
  restaurants: ['[SAMPLE] A', '[SAMPLE] B'],
};

const sampleSearchRanking: SearchRanking = {
  query: '[SAMPLE] Best biryani',
  topResult: '[SAMPLE] Rival Kitchen',
  yourPosition: 9,
  inMapPack: false,
  provenance: 'computed',
};

const sampleKeywords: KeywordCluster = {
  primary: ['[SAMPLE] a'],
  longTail: ['[SAMPLE] b'],
  trending: ['[SAMPLE] c'],
  competitor: ['[SAMPLE] d'],
  negativeToMonitor: ['[SAMPLE] e'],
};

const sampleLeaderboard: LeaderboardEntry = {
  rank: 4,
  name: '[SAMPLE] Demo Kitchen',
  rating: 4.6,
  reviews: 820,
  isBase: true,
};

const sampleAction: ActionPlanItem = {
  priority: 1,
  action: '[SAMPLE] Publish a website',
  detail: '[SAMPLE] Launch a branded site.',
  impact: 'High',
  timeframe: '[SAMPLE] This week',
  deepLink: { bucket: 'ordering', params: { foo: 'bar' } },
};

const sampleNarrative: ReportNarrative = {
  overview: '[SAMPLE] overview',
  keyFindings: ['[SAMPLE] finding'],
  immediateThreats: '[SAMPLE] threats',
  growthOpportunities: '[SAMPLE] opportunities',
  verdict: '[SAMPLE] verdict',
  actionPlan: [sampleAction],
};

const sampleAlert: CompetitorAlert = {
  type: 'new_competitor',
  severity: 'info',
  message: '[SAMPLE] A new rival opened nearby.',
  competitorName: '[SAMPLE] Rival Kitchen',
};

const sampleDeltas: ReportDeltas = {
  ratingDelta: 0.1,
  reviewsDelta: 45,
  restroScoreDelta: 3,
  newCompetitors: ['[SAMPLE] Rival Kitchen'],
  competitorAlerts: [sampleAlert],
};

const sampleScan: IntelligenceScan = {
  _id: 'scan-1',
  restaurantId: 'demo-r1',
  query: { name: '[SAMPLE] Demo Kitchen', city: 'Bengaluru' },
  status: 'COMPLETED',
  reportId: 'report-1',
  requestedBy: 'owner-1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const sampleReport: IntelligenceReport = {
  _id: 'report-1',
  restaurantId: 'demo-r1',
  scanId: 'scan-1',
  base: {
    placeId: 'sample-place-base',
    name: '[SAMPLE] Demo Kitchen',
    city: 'Bengaluru',
    rating: 4.6,
    totalRatings: 820,
    photoCount: 46,
    hasHours: true,
    businessStatus: 'OPERATIONAL',
    location: { lat: 12.9719, lng: 77.6412 },
    recentReviews: [{ rating: 5, text: '[SAMPLE] Great', time: new Date().toISOString() }],
  },
  restroScore: 68,
  pillars: [samplePillar],
  competitors: [sampleCompetitor],
  topCompetitors: [sampleCompetitor],
  sameCuisineNearby: [sampleCompetitor],
  cuisineBreakdown: [sampleCuisine],
  ranking: { rank: 4, total: 38, leaderboard: [sampleLeaderboard] },
  searchRankings: [sampleSearchRanking],
  keywords: sampleKeywords,
  narrative: sampleNarrative,
  deltas: sampleDeltas,
  generatedAt: new Date(),
};

describe('intelligence type exports', () => {
  it('enumerates provenance and scan statuses', () => {
    expect(provenances).toHaveLength(3);
    expect(scanStatuses).toContain('COMPLETED');
    expect(scanStatuses).toContain('FAILED');
  });

  it('constructs a well-formed report and scan', () => {
    expect(sampleReport.restroScore).toBe(68);
    expect(sampleReport.pillars[0].key).toBe('website');
    expect(sampleReport.narrative.actionPlan[0].deepLink?.bucket).toBe('ordering');
    expect(sampleScan.status).toBe('COMPLETED');
    expect(sampleReport.deltas?.competitorAlerts[0].type).toBe('new_competitor');
  });
});
