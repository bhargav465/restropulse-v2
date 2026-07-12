/**
 * @restropulse/db - Restaurant intelligence collection helpers + indexes (v1)
 *
 * Collections:
 *  - `intelligence_scans`   — async scan jobs (one per scan request)
 *  - `intelligence_reports` — completed reports (keep last 12 per restaurant)
 *  - `competitor_cache`     — Places (New) results, 7-day TTL to control cost
 *
 * Mirrors the `ordering.ts` index-helper pattern. Source of truth for the
 * index specs: Rest intelligence / ARCHITECTURE.md §2 ("Collections & indexes").
 */

import { Db } from 'mongodb';
import { getDB } from './connection.js';

/** competitor_cache TTL: 7 days (Places (New) results expire to control cost). */
export const COMPETITOR_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 604800

/** Max reports retained per restaurant (trend history); worker prunes older. */
export const MAX_REPORTS_PER_RESTAURANT = 12;

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
