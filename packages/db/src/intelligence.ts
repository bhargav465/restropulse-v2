/**
 * @restropulse/db - Restaurant Intelligence collection helpers.
 *
 * Collections (camelCase, per this repo's convention -- the reference used snake_case):
 *  - `intelligenceScans`     - async scan jobs (one per scan request)
 *  - `intelligenceReports`   - completed reports (keep last 12 per restaurant)
 *  - `competitorCache`       - Places (New) results, 7-day TTL to control cost
 *  - `intelligenceSnapshots` - daily snapshots (target x source x day)
 *  - `nearbySightings`       - first-seen registry for the New Openings radar
 *  - `zomatoManualEntries`   - merchant-entered Zomato numbers
 *
 * Index specs live with the rest of the schema in
 * apps/db-cli/src/schemas/collections.ts (COLLECTIONS) and are created by
 * `db-cli setup` -- this module only exposes typed getters + small helpers,
 * matching the existing collection-helper pattern (users.ts, posts.ts, ...).
 */

import { Collection } from 'mongodb';
import { getDB } from './connection.js';
import { WATCHLIST_MAX } from '@restropulse/shared';

/** competitorCache TTL: 7 days (Places (New) results expire to control cost). */
export const COMPETITOR_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 604800

/** Max reports retained per restaurant (trend history); worker prunes older. */
export const MAX_REPORTS_PER_RESTAURANT = 12;

/** Canonical collection names (single source of truth for getters + schema). */
export const INTELLIGENCE_COLLECTIONS = {
  scans: 'intelligenceScans',
  reports: 'intelligenceReports',
  competitorCache: 'competitorCache',
  snapshots: 'intelligenceSnapshots',
  nearbySightings: 'nearbySightings',
  zomatoManualEntries: 'zomatoManualEntries',
} as const;

export function getIntelligenceScansCollection(): Collection {
  return getDB().collection(INTELLIGENCE_COLLECTIONS.scans);
}

export function getIntelligenceReportsCollection(): Collection {
  return getDB().collection(INTELLIGENCE_COLLECTIONS.reports);
}

export function getCompetitorCacheCollection(): Collection {
  return getDB().collection(INTELLIGENCE_COLLECTIONS.competitorCache);
}

export function getIntelligenceSnapshotsCollection(): Collection {
  return getDB().collection(INTELLIGENCE_COLLECTIONS.snapshots);
}

export function getNearbySightingsCollection(): Collection {
  return getDB().collection(INTELLIGENCE_COLLECTIONS.nearbySightings);
}

export function getZomatoManualEntriesCollection(): Collection {
  return getDB().collection(INTELLIGENCE_COLLECTIONS.zomatoManualEntries);
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

// ----- Analytics events (best-effort internal signals) -----
// The intelligence worker emits scan/alert signals into a shared `events`
// collection. (the reference kept this in ordering.ts; this app has no ordering system,
// so the minimal seam lives here alongside the other intelligence helpers.)

export interface AnalyticsEvent {
  id?: string;
  name: string;
  sessionId: string;
  restaurantId: string;
  customerId?: string;
  payload?: Record<string, unknown>;
  ts: string | Date;
}

export function getEventsCollection(): Collection {
  return getDB().collection('events');
}

/** Insert one analytics event. Best-effort -- write failures are swallowed. */
export async function insertAnalyticsEvent(event: Omit<AnalyticsEvent, 'id'>): Promise<void> {
  try {
    await getEventsCollection().insertOne({ ...event, ts: new Date(event.ts) });
  } catch {
    // Swallow -- analytics writes are best-effort.
  }
}
