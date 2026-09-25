/**
 * ICurrentAffairsCache -- thin abstraction over the cache backend.
 *
 * Phase 3 ships MongoCurrentAffairsCache (collection: currentAffairsCache).
 * Future phases could add Redis (no infrastructure change required by callers).
 *
 * Entries are typed as `unknown` payloads -- callers narrow via Zod where strict
 * shapes matter. This keeps cache plumbing decoupled from the data inside.
 */

export interface CacheEntry<T = unknown> {
  key: string;
  payload: T;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICurrentAffairsCache {
  /** Returns the entry's payload if present and unexpired; otherwise null. */
  get<T = unknown>(key: string): Promise<T | null>;

  /** Upsert. ttlMs is the duration from now the entry is valid for. */
  set<T = unknown>(key: string, payload: T, ttlMs: number): Promise<void>;

  /** Best-effort cleanup of expired entries. Returns the deleted count. */
  cleanup(): Promise<number>;
}
