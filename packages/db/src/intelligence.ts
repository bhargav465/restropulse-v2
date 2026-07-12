/**
 * @restropulse/db - Restaurant intelligence collection helpers + indexes (v1)
 *
 * Collections:
 *  - `intelligence_scans`     — async scan jobs (one per scan request)
 *  - `intelligence_reports`   — completed reports (keep last 12 per restaurant)
 *  - `competitor_cache`       — Places (New) results, 7-day TTL to control cost
 *  - `intelligence_snapshots` — v2 daily snapshots (target × source × day)
 *  - `nearby_sightings`       — v2 first-seen registry for the New Openings radar
 *
 * Mirrors the `ordering.ts` index-helper pattern. Source of truth for the
 * index specs: Rest intelligence / ARCHITECTURE.md §2 ("Collections & indexes").
 */

import { Collection, Db } from 'mongodb';
import { getDB } from './connection.js';
import { WATCHLIST_MAX } from '@restropulse/shared';

/** competitor_cache TTL: 7 days (Places (New) results expire to control cost). */
export const COMPETITOR_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 604800

/** Max reports retained per restaurant (trend history); worker prunes older. */
export const MAX_REPORTS_PER_RESTAURANT = 12;

// ----- v2: daily snapshots, watchlist, sightings (Brief 06, additive) -----

/**
 * Daily snapshots collection (v2): one row per target × source × day.
 * Time-series backbone of the two-bucket dashboard.
 */
export function getIntelligenceSnapshotsCollection(): Collection {
  return getDB().collection('intelligence_snapshots');
}

/**
 * Nearby sightings collection (v2): first-seen registry powering the
 * New Openings radar (5 km).
 */
export function getNearbySightingsCollection(): Collection {
  return getDB().collection('nearby_sightings');
}

/**
 * Enforces the server-side watchlist cap. TypeScript cannot bound array length,
 * so writes to `restaurant.intelligence.watchlist` must call this first.
 * Throws when the resulting watchlist would exceed WATCHLIST_MAX (5).
 */
export function assertWatchlistSize(watchlist: readonly unknown[]): void {
  if (watchlist.length > WATCHLIST_MAX) {
    throw new Error(
      `Watchlist exceeds the maximum of ${WATCHLIST_MAX} competitors (got ${watchlist.length}).`,
    );
  }
}

/**
 * Creates all indexes required by the intelligence module.
 * Accepts an optional Db (used by db-cli which manages its own connection);
 * defaults to the shared singleton connection.
 * Safe to call repeatedly — existing-index errors are ignored.
 */
export async function ensureIntelligenceIndexes(db?: Db): Promise<void> {
  const database = db ?? getDB();

  const specs: Array<{
    collection: string;
    spec: Record<string, 1 | -1>;
    options?: Record<string, unknown>;
  }> = [
    // Scans: newest-first per tenant.
    { collection: 'intelligence_scans', spec: { restaurantId: 1, createdAt: -1 } },
    // Reports: newest-first per tenant (trend history, capped at 12).
    { collection: 'intelligence_reports', spec: { restaurantId: 1, generatedAt: -1 } },
    // Competitor cache: unique per place, and a TTL index for 7-day expiry.
    { collection: 'competitor_cache', spec: { placeId: 1 }, options: { unique: true } },
    {
      collection: 'competitor_cache',
      spec: { fetchedAt: 1 },
      options: { expireAfterSeconds: COMPETITOR_CACHE_TTL_SECONDS },
    },
    // v2 snapshots: unique per target×source×day makes the daily job an idempotent upsert.
    {
      collection: 'intelligence_snapshots',
      spec: { restaurantId: 1, targetPlaceId: 1, source: 1, date: 1 },
      options: { unique: true },
    },
    // v2 snapshots: newest-first range reads for filters.
    { collection: 'intelligence_snapshots', spec: { restaurantId: 1, date: -1 } },
    // v2 nearby sightings: unique per place (first-seen registry).
    { collection: 'nearby_sightings', spec: { restaurantId: 1, placeId: 1 }, options: { unique: true } },
    // v2 nearby sightings: newest-first by first-seen for the radar.
    { collection: 'nearby_sightings', spec: { restaurantId: 1, firstSeenAt: -1 } },
  ];

  for (const { collection, spec, options } of specs) {
    try {
      await database.collection(collection).createIndex(spec, options ?? {});
    } catch (err) {
      // 85 = IndexOptionsConflict, 86 = IndexKeySpecsConflict — index already exists
      const code = (err as { code?: number }).code;
      if (code !== 85 && code !== 86) throw err;
    }
  }
}
