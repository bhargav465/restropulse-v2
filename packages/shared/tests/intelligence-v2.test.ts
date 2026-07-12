import { describe, it, expect } from 'vitest';
import {
  REVIEW_THEMES,
  WATCHLIST_MAX,
} from '../src/intelligence.js';
import type {
  CompareRow,
  DailySnapshot,
  MetricGap,
  NearbyPlaceSighting,
  ReviewTheme,
  SnapshotReview,
  SnapshotSource,
  WatchlistEntry,
} from '../src/intelligence.js';

// Typed literals force the new v2 exports to compile and resolve at their point
// of use. If a type export is removed or its shape drifts, this file fails to
// type-check (`turbo type-check` on @restropulse/shared).

const sources: SnapshotSource[] = ['google', 'zomato'];

const sampleReview: SnapshotReview = {
  rating: 5,
  text: '[SAMPLE] Loved it',
  author: '[SAMPLE] Reviewer',
  time: '2026-07-01T06:00:00.000Z',
  themes: ['food-quality', 'service'],
};

const sampleSnapshot: DailySnapshot = {
  _id: 'snap-1',
  restaurantId: 'demo-r1',
  targetPlaceId: 'sample-place-demo-kitchen',
  isSelf: true,
  source: 'google',
  date: '2026-07-01',
  rating: 4.3,
  reviewCount: 800,
  photoCount: 46,
  seoScore: 62,
  newReviews: [sampleReview],
  responseRate: 42,
  backfilled: false,
  capturedAt: new Date(),
};

const sampleWatchlist: WatchlistEntry = {
  placeId: 'sample-wl-1',
  name: '[SAMPLE] Rival Kitchen',
  addedAt: new Date(),
  zomatoUrl: 'https://www.zomato.com/sample/rival',
};

const sampleSighting: NearbyPlaceSighting = {
  _id: 'sight-1',
  restaurantId: 'demo-r1',
  placeId: 'sample-sight-1',
  name: '[SAMPLE] New Opening',
  lat: 12.97,
  lng: 77.64,
  distanceKm: 0.9,
  cuisine: 'Biryani',
  firstSeenAt: new Date(),
  lastSeenAt: new Date(),
  ratingAtFirstSeen: 4.6,
  reviewsAtFirstSeen: 180,
};

const sampleGap: MetricGap = {
  metric: 'rating',
  source: 'google',
  yours: 4.3,
  theirs: 4.6,
  gap: 0.3,
};

const sampleCompareRow: CompareRow = {
  placeId: 'sample-wl-1',
  name: '[SAMPLE] Rival Kitchen',
  isSelf: false,
  google: { rating: 4.6, reviewCount: 5400, newReviews: 8, photoCount: 620 },
  beatsYou: [sampleGap],
};

describe('intelligence v2 type exports', () => {
  it('enumerates snapshot sources and constructs a snapshot', () => {
    expect(sources).toEqual(['google', 'zomato']);
    expect(sampleSnapshot.source).toBe('google');
    expect(sampleSnapshot.newReviews[0].themes).toContain('food-quality');
    expect(sampleWatchlist.name).toContain('[SAMPLE]');
    expect(sampleSighting.distanceKm).toBeLessThan(5);
    expect(sampleCompareRow.beatsYou[0].gap).toBeCloseTo(0.3);
  });
});

describe('REVIEW_THEMES taxonomy (contract — UI filters + prompts key off it)', () => {
  it('is exactly this frozen list, in order', () => {
    expect(REVIEW_THEMES).toEqual([
      'food-quality',
      'service',
      'delivery-time',
      'pricing',
      'ambience',
      'hygiene',
      'portion-size',
      'staff',
    ]);
  });

  it('has 8 unique themes', () => {
    expect(new Set(REVIEW_THEMES).size).toBe(8);
  });

  it('every ReviewTheme is a member of REVIEW_THEMES', () => {
    const t: ReviewTheme = 'hygiene';
    expect(REVIEW_THEMES).toContain(t);
  });
});

describe('WATCHLIST_MAX', () => {
  it('is 5', () => {
    expect(WATCHLIST_MAX).toBe(5);
  });
});
