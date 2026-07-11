/**
 * @restropulse/db - Demo seed data for the Restaurant Intelligence module (v1).
 *
 * ALL DATA IN THIS FILE IS SAMPLE/PLACEHOLDER DATA for the "demo" restaurant.
 * Every human-readable string is `[SAMPLE]`-marked. It is consumed by the
 * db-cli `seed-intelligence` command and must never be imported by
 * application runtime code.
 *
 * Story (per Rest intelligence / DESIGN.md §6): base = "RestroPulse Demo
 * Kitchen, Bengaluru", restroScore 68 (grade C) — a strong REVIEWS pillar (A)
 * next to a weak WEBSITE pillar (F), so the Website Design bucket teaser lands.
 * 12 `[SAMPLE]` Bengaluru competitors, 2 alerts in the deltas, full narrative.
 *
 * The report attaches to the same demo restaurant (`demo-r1`) seeded by
 * `ordering-demo.ts`, so the two demos compose.
 */

import type {
  CompetitorProfile,
  CuisineBucket,
  IntelligenceReport,
  IntelligenceScan,
  LeaderboardEntry,
  PillarScore,
  SearchRanking,
} from '@restropulse/shared';

/** Same restaurant id as the ordering demo seed, so the demos compose. */
export const DEMO_INTELLIGENCE_RESTAURANT_ID = 'demo-r1';
export const DEMO_INTELLIGENCE_REPORT_ID = 'demo-intel-report-1';
export const DEMO_INTELLIGENCE_SCAN_ID = 'demo-intel-scan-1';

const R = DEMO_INTELLIGENCE_RESTAURANT_ID;
const NOW = new Date('2026-07-09T09:00:00.000Z');
const LAST_WEEK = new Date('2026-07-02T09:00:00.000Z');

// ----- Competitors (12, all [SAMPLE]-marked) -----

const competitors: CompetitorProfile[] = [
  {
    placeId: 'sample-place-meghana',
    name: '[SAMPLE] Meghana Foods',
    address: '[SAMPLE] 100 Feet Road, Indiranagar, Bengaluru',
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
    strengths: ['[SAMPLE] Iconic boneless biryani draws destination footfall', '[SAMPLE] Very high review velocity'],
    weaknesses: ['[SAMPLE] Long peak-hour wait times', '[SAMPLE] Limited vegetarian depth'],
    whatTheyDoBetter: ['[SAMPLE] Signature dish recognition', '[SAMPLE] Delivery packaging'],
    whereYouWin: ['[SAMPLE] Dine-in ambience', '[SAMPLE] North Indian breadth'],
    sentimentLabel: 'Positive',
    pricingInsight: '[SAMPLE] Mid-market pricing with strong perceived value.',
    marketingEdge: '[SAMPLE] Heavy word-of-mouth and food-blogger coverage.',
  },
  {
    placeId: 'sample-place-nandhana',
    name: '[SAMPLE] Nandhana Palace',
    address: '[SAMPLE] Double Road, Indiranagar, Bengaluru',
    rating: 4.4,
    totalRatings: 3120,
    distanceKm: 0.8,
    lat: 12.9741,
    lng: 77.6389,
    priceLevel: 2,
    photoCount: 410,
    cuisine: 'Andhra',
    threatScore: 82,
    sameCuisineThreatScore: 18,
    strengths: ['[SAMPLE] Spicy Andhra thali loyalists', '[SAMPLE] Close proximity'],
    weaknesses: ['[SAMPLE] Dated interiors'],
    whatTheyDoBetter: ['[SAMPLE] Value lunch thali'],
    whereYouWin: ['[SAMPLE] Online ordering experience'],
    sentimentLabel: 'Positive',
    pricingInsight: '[SAMPLE] Aggressive lunch pricing.',
    marketingEdge: '[SAMPLE] Established local brand.',
  },
  {
    placeId: 'sample-place-nagarjuna',
    name: '[SAMPLE] Nagarjuna',
    address: '[SAMPLE] Residency Road, Bengaluru',
    rating: 4.3,
    totalRatings: 4100,
    distanceKm: 1.1,
    lat: 12.9698,
    lng: 77.6031,
    priceLevel: 2,
    photoCount: 520,
    cuisine: 'Andhra',
    threatScore: 78,
    sameCuisineThreatScore: 16,
    strengths: ['[SAMPLE] Famous Andhra meals on banana leaf'],
    weaknesses: ['[SAMPLE] No dedicated ordering website'],
    sentimentLabel: 'Positive',
    pricingInsight: '[SAMPLE] Premium-of-category thali.',
    marketingEdge: '[SAMPLE] Multi-outlet reputation.',
  },
  {
    placeId: 'sample-place-truffles',
    name: '[SAMPLE] Truffles',
    address: '[SAMPLE] St. Marks Road, Bengaluru',
    rating: 4.6,
    totalRatings: 6100,
    distanceKm: 1.6,
    lat: 12.9724,
    lng: 77.6045,
    priceLevel: 2,
    photoCount: 900,
    cuisine: 'Continental',
    threatScore: 75,
    sameCuisineThreatScore: 8,
    strengths: ['[SAMPLE] Burgers and shakes cult following', '[SAMPLE] Youth-heavy repeat base'],
    weaknesses: ['[SAMPLE] Cramped seating'],
    whatTheyDoBetter: ['[SAMPLE] Instagrammable plating'],
    whereYouWin: ['[SAMPLE] Full-course dinner occasions'],
    sentimentLabel: 'Positive',
    pricingInsight: '[SAMPLE] Casual-dining price band.',
    marketingEdge: '[SAMPLE] Strong social presence.',
  },
  {
    placeId: 'sample-place-empire',
    name: '[SAMPLE] Empire Restaurant',
    address: '[SAMPLE] Church Street, Bengaluru',
    rating: 4.1,
    totalRatings: 8900,
    distanceKm: 2.1,
    lat: 12.9752,
    lng: 77.6068,
    priceLevel: 1,
    photoCount: 1200,
    cuisine: 'North Indian',
    threatScore: 72,
    sameCuisineThreatScore: 71,
    strengths: ['[SAMPLE] Late-night kebabs and rolls', '[SAMPLE] Massive review volume'],
    weaknesses: ['[SAMPLE] Inconsistent service ratings'],
    whatTheyDoBetter: ['[SAMPLE] 24x7 availability', '[SAMPLE] Delivery coverage'],
    whereYouWin: ['[SAMPLE] Higher average rating', '[SAMPLE] Dine-in comfort'],
    sentimentLabel: 'Mixed',
    pricingInsight: '[SAMPLE] Budget pricing, high volume.',
    marketingEdge: '[SAMPLE] Ubiquitous late-night brand recall.',
  },
  {
    placeId: 'sample-place-ctr',
    name: '[SAMPLE] CTR Shri Sagar',
    address: '[SAMPLE] Malleshwaram, Bengaluru',
    rating: 4.7,
    totalRatings: 2200,
    distanceKm: 2.4,
    lat: 13.0068,
    lng: 77.5709,
    priceLevel: 1,
    photoCount: 300,
    cuisine: 'South Indian',
    threatScore: 64,
    sameCuisineThreatScore: 6,
    strengths: ['[SAMPLE] Legendary benne masala dosa', '[SAMPLE] Highest rating in area'],
    weaknesses: ['[SAMPLE] Breakfast-only window', '[SAMPLE] No delivery'],
    sentimentLabel: 'Positive',
    pricingInsight: '[SAMPLE] Very low ticket size.',
    marketingEdge: '[SAMPLE] Heritage reputation.',
  },
  {
    placeId: 'sample-place-toit',
    name: '[SAMPLE] Toit Brewpub',
    address: '[SAMPLE] 100 Feet Road, Indiranagar, Bengaluru',
    rating: 4.6,
    totalRatings: 7300,
    distanceKm: 3.0,
    lat: 12.9789,
    lng: 77.6412,
    priceLevel: 3,
    photoCount: 1500,
    cuisine: 'Continental',
    threatScore: 58,
    sameCuisineThreatScore: 7,
    strengths: ['[SAMPLE] Craft beer destination', '[SAMPLE] Weekend crowds'],
    weaknesses: ['[SAMPLE] Long waitlists', '[SAMPLE] Premium pricing'],
    sentimentLabel: 'Positive',
    pricingInsight: '[SAMPLE] Premium brewpub band.',
    marketingEdge: '[SAMPLE] Nightlife brand.',
  },
  {
    placeId: 'sample-place-mtr',
    name: '[SAMPLE] Mavalli Tiffin Room',
    address: '[SAMPLE] Lalbagh Road, Bengaluru',
    rating: 4.5,
    totalRatings: 4800,
    distanceKm: 2.9,
    lat: 12.9507,
    lng: 77.5848,
    priceLevel: 1,
    photoCount: 700,
    cuisine: 'South Indian',
    threatScore: 60,
    sameCuisineThreatScore: 6,
    strengths: ['[SAMPLE] Heritage South Indian institution'],
    weaknesses: ['[SAMPLE] Peak-hour queues'],
    sentimentLabel: 'Positive',
    pricingInsight: '[SAMPLE] Value pricing.',
    marketingEdge: '[SAMPLE] Iconic legacy brand.',
  },
  {
    placeId: 'sample-place-vidyarthi',
    name: '[SAMPLE] Vidyarthi Bhavan',
    address: '[SAMPLE] Gandhi Bazaar, Basavanagudi, Bengaluru',
    rating: 4.5,
    totalRatings: 3600,
    distanceKm: 3.4,
    lat: 12.9422,
    lng: 77.5729,
    priceLevel: 1,
    photoCount: 380,
    cuisine: 'South Indian',
    threatScore: 55,
    sameCuisineThreatScore: 5,
    strengths: ['[SAMPLE] Cult crispy dosa'],
    weaknesses: ['[SAMPLE] Cash-heavy, small footprint'],
    sentimentLabel: 'Positive',
    pricingInsight: '[SAMPLE] Very low ticket.',
    marketingEdge: '[SAMPLE] Heritage word-of-mouth.',
  },
  {
    placeId: 'sample-place-byg',
    name: '[SAMPLE] Byg Brewski',
    address: '[SAMPLE] Sarjapur Road, Bengaluru',
    rating: 4.4,
    totalRatings: 9100,
    distanceKm: 5.2,
    lat: 12.9098,
    lng: 77.6889,
    priceLevel: 3,
    photoCount: 2100,
    cuisine: 'Continental',
    threatScore: 45,
    sameCuisineThreatScore: 4,
    strengths: ['[SAMPLE] Large-format microbrewery experience'],
    weaknesses: ['[SAMPLE] Far from Indiranagar core'],
    sentimentLabel: 'Positive',
    pricingInsight: '[SAMPLE] Premium band.',
    marketingEdge: '[SAMPLE] Destination venue.',
  },
  {
    placeId: 'sample-place-punjabi-rasoi',
    name: '[SAMPLE] Punjabi Rasoi',
    address: '[SAMPLE] CMH Road, Indiranagar, Bengaluru',
    rating: 4.0,
    totalRatings: 900,
    distanceKm: 0.6,
    lat: 12.9760,
    lng: 77.6402,
    priceLevel: 2,
    photoCount: 120,
    cuisine: 'North Indian',
    threatScore: 40,
    sameCuisineThreatScore: 58,
    strengths: ['[SAMPLE] Closest same-cuisine rival'],
    weaknesses: ['[SAMPLE] Lower rating', '[SAMPLE] Thin review base'],
    whatTheyDoBetter: ['[SAMPLE] Aggressive lunch combos'],
    whereYouWin: ['[SAMPLE] Rating, photos, and ambience'],
    sentimentLabel: 'Mixed',
    pricingInsight: '[SAMPLE] Combo-led value pricing.',
    marketingEdge: '[SAMPLE] Local flyers and offers.',
  },
  {
    placeId: 'sample-place-biryani-blues',
    name: '[SAMPLE] Biryani Blues Express',
    address: '[SAMPLE] 12th Main, Indiranagar, Bengaluru',
    rating: 4.2,
    totalRatings: 480,
    distanceKm: 0.9,
    lat: 12.9705,
    lng: 77.6435,
    priceLevel: 2,
    photoCount: 90,
    cuisine: 'Biryani',
    threatScore: 38,
    sameCuisineThreatScore: 14,
    strengths: ['[SAMPLE] Newly opened, rising fast', '[SAMPLE] Good early rating'],
    weaknesses: ['[SAMPLE] Very small review base', '[SAMPLE] Unproven consistency'],
    sentimentLabel: 'Positive',
    pricingInsight: '[SAMPLE] Introductory pricing.',
    marketingEdge: '[SAMPLE] Launch discounts.',
  },
];

const byThreat = (a: CompetitorProfile, b: CompetitorProfile) => b.threatScore - a.threatScore;
const topCompetitors = [...competitors].sort(byThreat).slice(0, 5);
const sameCuisineNearby = competitors
  .filter((c) => c.cuisine === 'North Indian')
  .sort((a, b) => b.sameCuisineThreatScore - a.sameCuisineThreatScore);

// ----- Cuisine breakdown (market review share, competitors only) -----

const cuisineBreakdown: CuisineBucket[] = [
  { cuisine: 'Continental', count: 3, totalRatings: 22500, reviewShare: 0.402, avgRating: 4.53, restaurants: ['[SAMPLE] Truffles', '[SAMPLE] Toit Brewpub', '[SAMPLE] Byg Brewski'] },
  { cuisine: 'South Indian', count: 3, totalRatings: 10600, reviewShare: 0.189, avgRating: 4.57, restaurants: ['[SAMPLE] CTR Shri Sagar', '[SAMPLE] Mavalli Tiffin Room', '[SAMPLE] Vidyarthi Bhavan'] },
  { cuisine: 'North Indian', count: 2, totalRatings: 9800, reviewShare: 0.175, avgRating: 4.05, restaurants: ['[SAMPLE] Empire Restaurant', '[SAMPLE] Punjabi Rasoi'] },
  { cuisine: 'Andhra', count: 2, totalRatings: 7220, reviewShare: 0.129, avgRating: 4.35, restaurants: ['[SAMPLE] Nandhana Palace', '[SAMPLE] Nagarjuna'] },
  { cuisine: 'Biryani', count: 2, totalRatings: 5880, reviewShare: 0.105, avgRating: 4.35, restaurants: ['[SAMPLE] Meghana Foods', '[SAMPLE] Biryani Blues Express'] },
];

// ----- Leaderboard / ranking -----

const leaderboard: LeaderboardEntry[] = [
  { rank: 1, name: '[SAMPLE] CTR Shri Sagar', rating: 4.7, reviews: 2200, isBase: false },
  { rank: 2, name: '[SAMPLE] Toit Brewpub', rating: 4.6, reviews: 7300, isBase: false },
  { rank: 3, name: '[SAMPLE] Truffles', rating: 4.6, reviews: 6100, isBase: false },
  { rank: 4, name: '[SAMPLE] RestroPulse Demo Kitchen', rating: 4.6, reviews: 820, isBase: true },
  { rank: 5, name: '[SAMPLE] Meghana Foods', rating: 4.5, reviews: 5400, isBase: false },
  { rank: 6, name: '[SAMPLE] Mavalli Tiffin Room', rating: 4.5, reviews: 4800, isBase: false },
  { rank: 7, name: '[SAMPLE] Nandhana Palace', rating: 4.4, reviews: 3120, isBase: false },
];

// ----- Search rankings (simulated, provenance computed) -----

const searchRankings: SearchRanking[] = [
  { query: '[SAMPLE] Best North Indian in Indiranagar', topResult: '[SAMPLE] Empire Restaurant', yourPosition: 5, inMapPack: false, provenance: 'computed' },
  { query: '[SAMPLE] Butter chicken near me', topResult: '[SAMPLE] RestroPulse Demo Kitchen', yourPosition: 1, inMapPack: true, provenance: 'computed' },
  { query: '[SAMPLE] Best biryani in Bengaluru', topResult: '[SAMPLE] Meghana Foods', yourPosition: 9, inMapPack: false, provenance: 'computed' },
  { query: '[SAMPLE] Family restaurant Indiranagar', topResult: '[SAMPLE] Truffles', yourPosition: 4, inMapPack: true, provenance: 'computed' },
];

// ----- Pillars (weighted composite → restroScore 68, grade C) -----
// Weights: profile 20, reviews 25, photos 10, website 15, competition 20, momentum 10.

const pillars: PillarScore[] = [
  {
    key: 'profile',
    score: 75,
    grade: 'B',
    provenance: 'measured',
    checks: [
      { id: 'profile-hours', label: 'Business hours set', pass: true, note: '[SAMPLE] Hours listed for all 7 days.' },
      { id: 'profile-phone', label: 'Phone number present', pass: true, note: '[SAMPLE] Primary contact number verified.' },
      { id: 'profile-category', label: 'Primary category set', pass: true, note: '[SAMPLE] Listed as "North Indian Restaurant".' },
      { id: 'profile-description', label: 'Business description', pass: false, note: '[SAMPLE] No description on the Google profile.', actionHref: '/admin-v2/get-started' },
    ],
  },
  {
    key: 'reviews',
    score: 90,
    grade: 'A',
    provenance: 'measured',
    checks: [
      { id: 'reviews-rating', label: 'Rating above area average', pass: true, note: '[SAMPLE] 4.6 vs area avg 4.4.' },
      { id: 'reviews-volume', label: 'Healthy review volume', pass: true, note: '[SAMPLE] 820 ratings and growing.' },
      { id: 'reviews-recency', label: 'Recent reviews (last 30d)', pass: true, note: '[SAMPLE] 18 reviews in the last month.' },
      { id: 'reviews-replies', label: 'Owner replies to reviews', pass: false, note: '[SAMPLE] Only 12% of reviews have owner replies.', actionHref: '/admin-v2/get-started' },
    ],
  },
  {
    key: 'photos',
    score: 62,
    grade: 'C',
    provenance: 'measured',
    checks: [
      { id: 'photos-count', label: 'At least 30 photos', pass: true, note: '[SAMPLE] 46 photos on the profile.' },
      { id: 'photos-food', label: 'Menu/food photos present', pass: true, note: '[SAMPLE] 20 food photos.' },
      { id: 'photos-fresh', label: 'Photos added recently', pass: false, note: '[SAMPLE] No new photos in 90 days.', actionHref: '/admin-v2/content' },
    ],
  },
  {
    key: 'website',
    score: 34,
    grade: 'F',
    provenance: 'measured',
    checks: [
      { id: 'website-exists', label: 'Website linked on profile', pass: true, note: '[SAMPLE] Links to a social page, not a site.' },
      { id: 'website-custom-domain', label: 'Custom domain', pass: false, note: '[SAMPLE] No custom domain — using a link-in-bio page.', actionHref: '/admin-v2/website-design' },
      { id: 'website-ordering', label: 'Online ordering link', pass: false, note: '[SAMPLE] No direct ordering link from search.', actionHref: '/admin-v2/website-design' },
      { id: 'website-meta', label: 'SEO title & meta description', pass: false, note: '[SAMPLE] Missing meta description and H1.', actionHref: '/admin-v2/website-design' },
      { id: 'website-mobile', label: 'Mobile-friendly', pass: false, note: '[SAMPLE] Landing page not mobile-optimized.', actionHref: '/admin-v2/website-design' },
    ],
  },
  {
    key: 'competition',
    score: 66,
    grade: 'C',
    provenance: 'computed',
    checks: [
      { id: 'competition-rank', label: 'Top-5 by rating nearby', pass: true, note: '[SAMPLE] Ranked #4 of 38 nearby.' },
      { id: 'competition-samecuisine', label: 'Leads closest same-cuisine rival', pass: true, note: '[SAMPLE] Ahead of Punjabi Rasoi on rating.' },
      { id: 'competition-volume', label: 'Review volume vs top rivals', pass: false, note: '[SAMPLE] Meghana and Empire have far more reviews.', actionHref: '/admin-v2/get-started' },
    ],
  },
  {
    key: 'momentum',
    score: 60,
    grade: 'C',
    provenance: 'computed',
    checks: [
      { id: 'momentum-rating', label: 'Rating trending up', pass: true, note: '[SAMPLE] +0.1 vs last scan.' },
      { id: 'momentum-reviews', label: 'Review growth pace', pass: true, note: '[SAMPLE] +45 reviews week-over-week.' },
      { id: 'momentum-newrivals', label: 'No new same-cuisine rivals nearby', pass: false, note: '[SAMPLE] A new biryani outlet opened 0.9 km away.', actionHref: '/admin-v2/intelligence' },
    ],
  },
];

// ----- The report -----

export const DEMO_INTELLIGENCE_REPORT: IntelligenceReport = {
  _id: DEMO_INTELLIGENCE_REPORT_ID,
  restaurantId: R,
  scanId: DEMO_INTELLIGENCE_SCAN_ID,
  base: {
    placeId: 'sample-place-demo-kitchen',
    name: '[SAMPLE] RestroPulse Demo Kitchen',
    city: 'Bengaluru',
    zone: 'Indiranagar',
    rating: 4.6,
    totalRatings: 820,
    photoCount: 46,
    website: 'https://link.example.com/demo-kitchen',
    phone: '+910000000001',
    hasHours: true,
    businessStatus: 'OPERATIONAL',
    location: { lat: 12.9719, lng: 77.6412 },
    recentReviews: [
      { rating: 5, text: '[SAMPLE] Best butter chicken in Indiranagar, cozy dine-in.', time: '2026-07-05T18:30:00.000Z' },
      { rating: 5, text: '[SAMPLE] Great service and fresh naan. Will return.', time: '2026-07-03T13:10:00.000Z' },
      { rating: 4, text: '[SAMPLE] Lovely food, but the website was hard to find.', time: '2026-06-30T20:05:00.000Z' },
      { rating: 2, text: '[SAMPLE] Delivery took longer than promised on a Friday.', time: '2026-06-28T21:40:00.000Z' },
    ],
  },
  restroScore: 68,
  pillars,
  competitors,
  topCompetitors,
  sameCuisineNearby,
  cuisineBreakdown,
  ranking: { rank: 4, total: 38, leaderboard },
  searchRankings,
  keywords: {
    primary: ['[SAMPLE] butter chicken indiranagar', '[SAMPLE] north indian restaurant indiranagar', '[SAMPLE] family dinner indiranagar'],
    longTail: ['[SAMPLE] best butter chicken near 100 feet road', '[SAMPLE] north indian thali indiranagar delivery'],
    trending: ['[SAMPLE] weekend dinner deals bengaluru', '[SAMPLE] late night north indian'],
    competitor: ['[SAMPLE] meghana foods alternative', '[SAMPLE] empire restaurant vs demo kitchen'],
    negativeToMonitor: ['[SAMPLE] slow delivery', '[SAMPLE] hard to find website'],
  },
  narrative: {
    overview:
      '[SAMPLE] RestroPulse Demo Kitchen is a well-loved North Indian spot in Indiranagar with a strong 4.6 rating, but a thin digital footprint is capping its growth. Reviews are your superpower; your website is your weakest link.',
    keyFindings: [
      '[SAMPLE] Rating (4.6) beats the area average (4.4) and ranks you #4 of 38 nearby.',
      '[SAMPLE] Review volume (820) trails destination rivals like Meghana (5,400) and Empire (8,900).',
      '[SAMPLE] No custom-domain website — you are invisible for high-intent local searches.',
      '[SAMPLE] Only 12% of reviews get an owner reply, leaving trust signals on the table.',
      '[SAMPLE] A new biryani outlet opened 0.9 km away and is rising fast.',
      '[SAMPLE] Photos are stale — nothing new in 90 days.',
    ],
    immediateThreats:
      '[SAMPLE] Meghana Foods and Empire dominate discovery through sheer review volume, and a newly opened Biryani Blues Express is capturing nearby search demand.',
    growthOpportunities:
      '[SAMPLE] Launching a proper ordering website and replying to reviews weekly would convert your rating advantage into measurable traffic and repeat orders.',
    verdict:
      '[SAMPLE] Over the next 90 days, fix the website foundation and lean into your review strength. You have the product quality to climb from #4 to a top-2 position in Indiranagar North Indian search.',
    actionPlan: [
      {
        priority: 1,
        action: '[SAMPLE] Publish a custom-domain ordering website',
        detail: '[SAMPLE] Your weakest pillar (Website, grade F) is costing you high-intent search traffic. Launch a branded site with a direct ordering link.',
        impact: 'High',
        timeframe: '[SAMPLE] This week',
        deepLink: { bucket: 'ordering' },
      },
      {
        priority: 2,
        action: '[SAMPLE] Reply to every review weekly',
        detail: '[SAMPLE] Only 12% of reviews have owner replies. Weekly replies lift trust and local ranking signals.',
        impact: 'High',
        timeframe: '[SAMPLE] Ongoing, start now',
        deepLink: { bucket: 'get-started', params: { task: 'review-replies' } },
      },
      {
        priority: 3,
        action: '[SAMPLE] Publish fresh food photos and posts',
        detail: '[SAMPLE] No new photos in 90 days. Generate a week of butter-chicken and naan content to refresh the profile.',
        impact: 'Medium',
        timeframe: '[SAMPLE] Next 2 weeks',
        deepLink: { bucket: 'content', params: { brief: 'butter-chicken-hero' } },
      },
      {
        priority: 4,
        action: '[SAMPLE] Run a weekday dinner offer to build volume',
        detail: '[SAMPLE] Close the review-volume gap with rivals by driving repeat weekday orders.',
        impact: 'Medium',
        timeframe: '[SAMPLE] Next month',
        deepLink: { bucket: 'get-started', params: { task: 'launch-offer' } },
      },
      {
        priority: 5,
        action: '[SAMPLE] Complete your Google business description & category',
        detail: '[SAMPLE] A missing description weakens your profile pillar. Add a keyword-rich description.',
        impact: 'Low',
        timeframe: '[SAMPLE] This week',
        deepLink: { bucket: 'get-started', params: { task: 'profile-description' } },
      },
    ],
  },
  deltas: {
    ratingDelta: 0.1,
    reviewsDelta: 45,
    restroScoreDelta: 3,
    newCompetitors: ['[SAMPLE] Biryani Blues Express'],
    competitorAlerts: [
      {
        type: 'competitor_surge',
        severity: 'warning',
        message: '[SAMPLE] Meghana Foods gained 380 reviews since your last scan.',
        competitorName: '[SAMPLE] Meghana Foods',
      },
      {
        type: 'new_competitor',
        severity: 'info',
        message: '[SAMPLE] Biryani Blues Express opened 0.9 km away and is rising fast.',
        competitorName: '[SAMPLE] Biryani Blues Express',
      },
    ],
  },
  generatedAt: NOW,
};

// ----- The completed scan that produced the report -----

export const DEMO_INTELLIGENCE_SCAN: IntelligenceScan = {
  _id: DEMO_INTELLIGENCE_SCAN_ID,
  restaurantId: R,
  query: { name: '[SAMPLE] RestroPulse Demo Kitchen', city: 'Bengaluru', placeId: 'sample-place-demo-kitchen' },
  status: 'COMPLETED',
  reportId: DEMO_INTELLIGENCE_REPORT_ID,
  requestedBy: 'demo-owner-u1',
  createdAt: LAST_WEEK,
  updatedAt: NOW,
};

/**
 * Seed documents keyed by collection name, in insert order.
 * Upserted by `_id` (safe to re-run) by the db-cli `seed-intelligence` command.
 */
export const INTELLIGENCE_DEMO_SEED: Record<string, Array<Record<string, unknown>>> = {
  intelligence_scans: [DEMO_INTELLIGENCE_SCAN as unknown as Record<string, unknown>],
  intelligence_reports: [DEMO_INTELLIGENCE_REPORT as unknown as Record<string, unknown>],
};
