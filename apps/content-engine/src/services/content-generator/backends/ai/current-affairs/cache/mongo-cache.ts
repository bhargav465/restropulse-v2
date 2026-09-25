/**
 * MongoCurrentAffairsCache -- MongoDB-backed implementation of ICurrentAffairsCache.
 *
 * Reads/writes go through the @restropulse/db connection singleton. The
 * `currentAffairsCache` collection is created lazily (Mongo creates collections
 * on first write); no explicit setup step is required. Indexes are not
 * declared here -- a future migration may add `{ key: 1 }` unique and
 * `{ expiresAt: 1 }` TTL.
 */

import { getCurrentAffairsCacheCollection } from '@restropulse/db';
import { createLogger } from '@restropulse/telemetry/server';
import type { CacheEntry, ICurrentAffairsCache } from './types.js';

const log = createLogger('current-affairs-cache');

export class MongoCurrentAffairsCache implements ICurrentAffairsCache {
  async get<T = unknown>(key: string): Promise<T | null> {
    const col = getCurrentAffairsCacheCollection();
    const doc = await col.findOne({ key });
    if (!doc) return null;
    if ((doc as any).expiresAt && new Date((doc as any).expiresAt) <= new Date()) {
      return null;
    }
    return ((doc as any).payload ?? null) as T | null;
  }

  async set<T = unknown>(key: string, payload: T, ttlMs: number): Promise<void> {
    const col = getCurrentAffairsCacheCollection();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);
    await col.updateOne(
      { key },
      {
        $set: {
          key,
          payload,
          expiresAt,
          updatedAt: now,
        } as any,
        $setOnInsert: { createdAt: now } as any,
      },
      { upsert: true },
    );
  }

  async cleanup(): Promise<number> {
    const col = getCurrentAffairsCacheCollection();
    const result = await col.deleteMany({ expiresAt: { $lte: new Date() } } as any);
    log.info({ deleted: result.deletedCount }, 'Current-affairs cache cleanup completed');
    return result.deletedCount ?? 0;
  }
}

export type { CacheEntry, ICurrentAffairsCache };
