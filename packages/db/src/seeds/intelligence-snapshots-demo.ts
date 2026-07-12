/**
 * @restropulse/db - Demo seed data for Intelligence v2 (daily snapshots,
 * watchlist, nearby sightings). Brief 06.
 *
 * ALL DATA IN THIS FILE IS SAMPLE/PLACEHOLDER DATA for the "demo" restaurant
 * (`demo-r1`, the same one seeded by `ordering-demo.ts`, so the demos compose).
 * Every human-readable string is `[SAMPLE]`-marked. It is consumed by the
 * db-cli `seed-intelligence-snapshots` command and must never be imported by
 * application runtime code.
 *
 * DETERMINISTIC: this module uses a seeded PRNG (mulberry32) and a fixed date
 * anchor — NO `Math.random()` / `Date.now()` — so tests can assert exact
 * document counts and stable `_id`s. Re-running the seeder upserts by `_id`.
 *
 * ASSUMPTION (Brief 06 §3): the 60-day window ends at a fixed anchor of
 * 2026-07-09 (matches `intelligence-demo.ts` NOW, so the v1 report and the v2
 * snapshots line up on the same demo restaurant). "Last 30 days" for the
 * fast-starter sightings is measured from this anchor.
 */

import type {
  DailySnapshot,
  NearbyPlaceSighting,
  ReviewTheme,
  SnapshotReview,
  SnapshotSource,
  WatchlistEntry,
} from '@restropulse/shared';
import { REVIEW_THEMES } from '@restropulse/shared';

/** Same restaurant id as the ordering + intelligence v1 demos, so they compose. */
export const DEMO_SNAPSHOTS_RESTAURANT_ID = 'demo-r1';

/** Self restaurant placeId — matches the v1 intelligence-demo `base.placeId`. */
export const DEMO_SELF_PLACE_ID = 'sample-place-demo-kitchen';

/** Fixed 60-day window anchor (inclusive most-recent day). See ASSUMPTION above. */
export const DEMO_SNAPSHOTS_ANCHOR = '2026-07-09';

/** Number of days of history seeded per target/source series. */
export const DEMO_SNAPSHOT_DAYS = 60;

/** Self Zomato URL written onto the demo restaurant (enables the Zomato adapter). */
export const DEMO_SELF_ZOMATO_URL = 'https://www.zomato.com/sample/demo-kitchen';

const R = DEMO_SNAPSHOTS_RESTAURANT_ID;

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32). Seeded per series so output never depends on
// call order across series.
// ---------------------------------------------------------------------------

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [min, max] inclusive, from a PRNG draw. */
function rngInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** Deterministic string seed → 32-bit int. */
function hashSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const ANCHOR_MS = Date.parse(`${DEMO_SNAPSHOTS_ANCHOR}T00:00:00.000Z`);

/** `YYYY-MM-DD` for `daysAgo` days before the anchor. */
function dayString(daysAgo: number): string {
  const d = new Date(ANCHOR_MS - daysAgo * 86400000);
  return d.toISOString().slice(0, 10);
}

/** Fixed capture timestamp (06:00Z) for a given day string. */
function capturedAt(date: string): Date {
  return new Date(`${date}T06:00:00.000Z`);
}

// ---------------------------------------------------------------------------
// Review generation (themes distributed across the fixed taxonomy)
// ---------------------------------------------------------------------------

const POSITIVE_TEXTS = [
  '[SAMPLE] Loved the food and the vibe, will be back.',
  '[SAMPLE] Great flavours, generous portions.',
  '[SAMPLE] Friendly staff and quick service.',
  '[SAMPLE] Clean place, well plated, tasty.',
  '[SAMPLE] Consistently good — a reliable favourite.',
];

const DIP_TEXTS = [
  '[SAMPLE] Delivery took far too long and food arrived cold.',
  '[SAMPLE] Waited over an hour for delivery on a busy night.',
];

const AUTHORS = [
  '[SAMPLE] Reviewer A',
  '[SAMPLE] Reviewer B',
  '[SAMPLE] Reviewer C',
  '[SAMPLE] Reviewer D',
];

/** Build the day's new reviews. On dip days, prepend a 1★ delivery-time review. */
function buildReviews(
  rng: () => number,
  dayIdx: number,
  isDipDay: boolean,
): SnapshotReview[] {
  const reviews: SnapshotReview[] = [];
  const count = rngInt(rng, 2, 3);
  for (let k = 0; k < count; k++) {
    const themeA = REVIEW_THEMES[(dayIdx + k) % REVIEW_THEMES.length];
    const themeB = REVIEW_THEMES[(dayIdx + k + 3) % REVIEW_THEMES.length];
    const themes: ReviewTheme[] = themeA === themeB ? [themeA] : [themeA, themeB];
    reviews.push({
      rating: rngInt(rng, 4, 5),
      text: POSITIVE_TEXTS[rngInt(rng, 0, POSITIVE_TEXTS.length - 1)],
      author: AUTHORS[rngInt(rng, 0, AUTHORS.length - 1)],
      time: capturedAt(dayString(DEMO_SNAPSHOT_DAYS - 1 - dayIdx)).toISOString(),
      themes,
    });
  }
  if (isDipDay) {
    reviews.unshift({
      rating: 1,
      text: DIP_TEXTS[dayIdx % DIP_TEXTS.length],
      author: AUTHORS[dayIdx % AUTHORS.length],
      time: capturedAt(dayString(DEMO_SNAPSHOT_DAYS - 1 - dayIdx)).toISOString(),
      themes: ['delivery-time'],
    });
  }
  return reviews;
}

// ---------------------------------------------------------------------------
// Series generation
// ---------------------------------------------------------------------------

/** Deliberate dip days (rating −0.1 with a 1★ delivery-time review) for self. */
const SELF_DIP_DAYS = new Set([20, 45]);

/** seoScore annotated jump day (self + google only). */
const SEO_JUMP_DAY = 30;

interface SeriesConfig {
  targetPlaceId: string;
  isSelf: boolean;
  source: SnapshotSource;
  ratingStart: number;
  ratingEnd: number;
  reviewStart: number;
  velocityMin: number;
  velocityMax: number;
  photoStart: number;
  withSeo: boolean;
  responseRate?: number;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Build one 60-day series (oldest → newest). */
function buildSeries(cfg: SeriesConfig): DailySnapshot[] {
  const rng = makeRng(hashSeed(`${cfg.targetPlaceId}:${cfg.source}`));
  const out: DailySnapshot[] = [];
  let reviewCount = cfg.reviewStart;
  let photoCount = cfg.photoStart;

  for (let i = 0; i < DEMO_SNAPSHOT_DAYS; i++) {
    const daysAgo = DEMO_SNAPSHOT_DAYS - 1 - i;
    const date = dayString(daysAgo);
    const frac = i / (DEMO_SNAPSHOT_DAYS - 1);
    const isDipDay = cfg.isSelf && SELF_DIP_DAYS.has(i);

    let rating = round1(cfg.ratingStart + (cfg.ratingEnd - cfg.ratingStart) * frac);
    if (isDipDay) rating = round1(rating - 0.1);

    const dailyReviews = rngInt(rng, cfg.velocityMin, cfg.velocityMax);
    reviewCount += dailyReviews;
    if (rng() > 0.6) photoCount += 1;

    let seoScore: number | undefined;
    if (cfg.withSeo) {
      // step 55 → 71 with a bigger annotated jump at SEO_JUMP_DAY
      const base = 55 + Math.floor(frac * 14);
      seoScore = i >= SEO_JUMP_DAY ? base + 2 : base;
    }

    out.push({
      _id: `snap-${cfg.targetPlaceId}-${cfg.source}-${date}`,
      restaurantId: R,
      targetPlaceId: cfg.targetPlaceId,
      isSelf: cfg.isSelf,
      source: cfg.source,
      date,
      rating,
      reviewCount,
      photoCount,
      ...(seoScore !== undefined ? { seoScore } : {}),
      newReviews: buildReviews(rng, i, isDipDay),
      ...(cfg.responseRate !== undefined ? { responseRate: cfg.responseRate } : {}),
      capturedAt: capturedAt(date),
    });
  }
  return out;
}

// ----- Self (google + zomato) -----

const selfGoogle = buildSeries({
  targetPlaceId: DEMO_SELF_PLACE_ID,
  isSelf: true,
  source: 'google',
  ratingStart: 4.2,
  ratingEnd: 4.4,
  reviewStart: 780,
  velocityMin: 2,
  velocityMax: 6,
  photoStart: 40,
  withSeo: true,
  responseRate: 42,
});

const selfZomato = buildSeries({
  targetPlaceId: DEMO_SELF_PLACE_ID,
  isSelf: true,
  source: 'zomato',
  ratingStart: 4.2,
  ratingEnd: 4.4,
  reviewStart: 320,
  velocityMin: 1,
  velocityMax: 4,
  photoStart: 60,
  withSeo: false,
});

// ----- Watchlist competitors -----

/** Competitor A: clearly beats self on rating + velocity. */
const COMP_A = { placeId: 'sample-wl-meghana', name: '[SAMPLE] Meghana Foods' };
/** Competitor B: losing on rating + velocity. */
const COMP_B = { placeId: 'sample-wl-punjabi', name: '[SAMPLE] Punjabi Rasoi' };
/** Competitor C: mixed; also has a Zomato series. */
const COMP_C = { placeId: 'sample-wl-nandhana', name: '[SAMPLE] Nandhana Palace' };

const compAGoogle = buildSeries({
  targetPlaceId: COMP_A.placeId,
  isSelf: false,
  source: 'google',
  ratingStart: 4.5,
  ratingEnd: 4.6,
  reviewStart: 5200,
  velocityMin: 5,
  velocityMax: 9,
  photoStart: 620,
  withSeo: false,
  responseRate: 55,
});

const compBGoogle = buildSeries({
  targetPlaceId: COMP_B.placeId,
  isSelf: false,
  source: 'google',
  ratingStart: 4.0,
  ratingEnd: 3.9,
  reviewStart: 900,
  velocityMin: 0,
  velocityMax: 2,
  photoStart: 120,
  withSeo: false,
  responseRate: 18,
});

const compCGoogle = buildSeries({
  targetPlaceId: COMP_C.placeId,
  isSelf: false,
  source: 'google',
  ratingStart: 4.3,
  ratingEnd: 4.3,
  reviewStart: 3100,
  velocityMin: 2,
  velocityMax: 6,
  photoStart: 410,
  withSeo: false,
  responseRate: 30,
});

const compCZomato = buildSeries({
  targetPlaceId: COMP_C.placeId,
  isSelf: false,
  source: 'zomato',
  ratingStart: 4.1,
  ratingEnd: 4.2,
  reviewStart: 1400,
  velocityMin: 1,
  velocityMax: 4,
  photoStart: 260,
  withSeo: false,
});

export const DEMO_SNAPSHOTS: DailySnapshot[] = [
  ...selfGoogle,
  ...selfZomato,
  ...compAGoogle,
  ...compBGoogle,
  ...compCGoogle,
  ...compCZomato,
];

// ----- Watchlist (written onto the demo restaurant's intelligence.watchlist) -----

export const DEMO_WATCHLIST: WatchlistEntry[] = [
  { placeId: COMP_A.placeId, name: COMP_A.name, addedAt: capturedAt(dayString(59)) },
  { placeId: COMP_B.placeId, name: COMP_B.name, addedAt: capturedAt(dayString(59)) },
  {
    placeId: COMP_C.placeId,
    name: COMP_C.name,
    addedAt: capturedAt(dayString(59)),
    zomatoUrl: 'https://www.zomato.com/sample/nandhana-palace',
  },
];

// ----- Nearby sightings (8; 2 fast-starters inside the last 30 days) -----

function sighting(
  idx: number,
  name: string,
  firstSeenDaysAgo: number,
  lat: number,
  lng: number,
  distanceKm: number,
  cuisine: string,
  ratingAtFirstSeen: number,
  reviewsAtFirstSeen: number,
): NearbyPlaceSighting {
  const firstSeen = dayString(firstSeenDaysAgo);
  return {
    _id: `sight-demo-${idx}`,
    restaurantId: R,
    placeId: `sample-sight-${idx}`,
    name,
    lat,
    lng,
    distanceKm,
    cuisine,
    firstSeenAt: capturedAt(firstSeen),
    lastSeenAt: capturedAt(DEMO_SNAPSHOTS_ANCHOR),
    ratingAtFirstSeen,
    reviewsAtFirstSeen,
  };
}

export const DEMO_NEARBY_SIGHTINGS: NearbyPlaceSighting[] = [
  // Two recent fast-starters (firstSeenAt inside the last 30 days).
  sighting(1, '[SAMPLE] Biryani Blues Express', 10, 12.9705, 77.6435, 0.9, 'Biryani', 4.6, 180),
  sighting(2, '[SAMPLE] Curry Theory', 22, 12.972, 77.638, 1.4, 'North Indian', 4.5, 95),
  // Six established sightings (firstSeenAt older than 30 days).
  sighting(3, '[SAMPLE] Nandhana Palace', 210, 12.9741, 77.6389, 0.8, 'Andhra', 4.4, 3120),
  sighting(4, '[SAMPLE] Meghana Foods', 340, 12.9719, 77.6412, 1.2, 'Biryani', 4.5, 5400),
  sighting(5, '[SAMPLE] Truffles', 400, 12.9724, 77.6045, 1.6, 'Continental', 4.6, 6100),
  sighting(6, '[SAMPLE] Empire Restaurant', 520, 12.9752, 77.6068, 2.1, 'North Indian', 4.1, 8900),
  sighting(7, '[SAMPLE] Punjabi Rasoi', 300, 12.976, 77.6402, 0.6, 'North Indian', 4.0, 900),
  sighting(8, '[SAMPLE] CTR Shri Sagar', 460, 13.0068, 77.5709, 2.4, 'South Indian', 4.7, 2200),
];

// ---------------------------------------------------------------------------
// Expected counts (asserted by tests; keep in sync with the arrays above)
// ---------------------------------------------------------------------------

export const DEMO_SNAPSHOT_COUNTS = {
  selfGoogle: selfGoogle.length,
  selfZomato: selfZomato.length,
  competitorGoogle: compAGoogle.length + compBGoogle.length + compCGoogle.length,
  competitorZomato: compCZomato.length,
  snapshotsTotal: DEMO_SNAPSHOTS.length,
  nearbySightings: DEMO_NEARBY_SIGHTINGS.length,
  watchlist: DEMO_WATCHLIST.length,
} as const;

/**
 * Seed documents keyed by collection name, in insert order. Upserted by `_id`
 * by the db-cli `seed-intelligence-snapshots` command (safe to re-run). The
 * watchlist + selfZomatoUrl are applied separately as an update to the demo
 * restaurant document (see the command).
 */
export const INTELLIGENCE_SNAPSHOTS_DEMO_SEED: Record<string, Array<Record<string, unknown>>> = {
  intelligence_snapshots: DEMO_SNAPSHOTS as unknown as Array<Record<string, unknown>>,
  nearby_sightings: DEMO_NEARBY_SIGHTINGS as unknown as Array<Record<string, unknown>>,
};
