import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Db } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  ensureIntelligenceIndexes,
  assertWatchlistSize,
  getIntelligenceSnapshotsCollection,
  getNearbySightingsCollection,
} from '../src/intelligence.js';
import { connectDB, disconnectDB } from '../src/connection.js';
import {
  INTELLIGENCE_SNAPSHOTS_DEMO_SEED,
  DEMO_SNAPSHOTS,
  DEMO_NEARBY_SIGHTINGS,
  DEMO_WATCHLIST,
  DEMO_SNAPSHOT_COUNTS,
  DEMO_SNAPSHOT_DAYS,
  DEMO_SNAPSHOTS_RESTAURANT_ID,
} from '../src/seeds/intelligence-snapshots-demo.js';
import { WATCHLIST_MAX } from '@restropulse/shared';

interface CreatedIndex {
  collection: string;
  spec: Record<string, unknown>;
  options: Record<string, unknown>;
}

function mockDb(): { db: Db; created: CreatedIndex[] } {
  const created: CreatedIndex[] = [];
  const db = {
    collection(name: string) {
      return {
        createIndex: vi.fn(async (spec: Record<string, unknown>, options: Record<string, unknown>) => {
          created.push({ collection: name, spec, options });
          return 'ok';
        }),
      };
    },
  } as unknown as Db;
  return { db, created };
}

describe('ensureIntelligenceIndexes — v2 snapshot/sighting indexes', () => {
  it('creates the unique target×source×day snapshot index', async () => {
    const { db, created } = mockDb();
    await ensureIntelligenceIndexes(db);
    expect(created).toContainEqual({
      collection: 'intelligence_snapshots',
      spec: { restaurantId: 1, targetPlaceId: 1, source: 1, date: 1 },
      options: { unique: true },
    });
  });

  it('creates the newest-first snapshot range index', async () => {
    const { db, created } = mockDb();
    await ensureIntelligenceIndexes(db);
    expect(created).toContainEqual({
      collection: 'intelligence_snapshots',
      spec: { restaurantId: 1, date: -1 },
      options: {},
    });
  });

  it('creates the unique + firstSeen nearby_sightings indexes', async () => {
    const { db, created } = mockDb();
    await ensureIntelligenceIndexes(db);
    expect(created).toContainEqual({
      collection: 'nearby_sightings',
      spec: { restaurantId: 1, placeId: 1 },
      options: { unique: true },
    });
    expect(created).toContainEqual({
      collection: 'nearby_sightings',
      spec: { restaurantId: 1, firstSeenAt: -1 },
      options: {},
    });
  });
});

describe('assertWatchlistSize', () => {
  it('WATCHLIST_MAX is 5', () => {
    expect(WATCHLIST_MAX).toBe(5);
  });

  it('accepts a watchlist at the cap (5)', () => {
    expect(() => assertWatchlistSize(new Array(5).fill({}))).not.toThrow();
  });

  it('throws when the watchlist exceeds the cap (6)', () => {
    expect(() => assertWatchlistSize(new Array(6).fill({}))).toThrow(/maximum of 5/);
  });
});

describe('INTELLIGENCE_SNAPSHOTS_DEMO_SEED — shape & [SAMPLE] marks', () => {
  it('is keyed by the v2 collection names', () => {
    expect(Object.keys(INTELLIGENCE_SNAPSHOTS_DEMO_SEED).sort()).toEqual([
      'intelligence_snapshots',
      'nearby_sightings',
    ]);
  });

  it('seeds deterministic, expected document counts', () => {
    // 60 days × (self google + self zomato) = 120 self rows.
    expect(DEMO_SNAPSHOT_COUNTS.selfGoogle).toBe(DEMO_SNAPSHOT_DAYS);
    expect(DEMO_SNAPSHOT_COUNTS.selfZomato).toBe(DEMO_SNAPSHOT_DAYS);
    // 3 competitors × 60 google + 1 × 60 zomato = 240 competitor rows.
    expect(DEMO_SNAPSHOT_COUNTS.competitorGoogle).toBe(DEMO_SNAPSHOT_DAYS * 3);
    expect(DEMO_SNAPSHOT_COUNTS.competitorZomato).toBe(DEMO_SNAPSHOT_DAYS);
    expect(DEMO_SNAPSHOT_COUNTS.snapshotsTotal).toBe(DEMO_SNAPSHOT_DAYS * 6);
    expect(DEMO_SNAPSHOTS).toHaveLength(DEMO_SNAPSHOT_DAYS * 6);
    expect(DEMO_NEARBY_SIGHTINGS).toHaveLength(8);
    expect(DEMO_WATCHLIST).toHaveLength(3);
  });

  it('[SAMPLE]-marks every seeded review text/author and sighting/watchlist name', () => {
    for (const snap of DEMO_SNAPSHOTS) {
      for (const r of snap.newReviews) {
        expect(r.text).toContain('[SAMPLE]');
        if (r.author) expect(r.author).toContain('[SAMPLE]');
      }
    }
    for (const s of DEMO_NEARBY_SIGHTINGS) {
      expect(s.name).toContain('[SAMPLE]');
    }
    for (const w of DEMO_WATCHLIST) {
      expect(w.name).toContain('[SAMPLE]');
    }
  });

  it('ships exactly 2 fast-starter sightings (firstSeenAt within the last 30 days)', () => {
    const anchor = Date.parse('2026-07-09T00:00:00.000Z');
    const cutoff = anchor - 30 * 86400000;
    const recent = DEMO_NEARBY_SIGHTINGS.filter((s) => s.firstSeenAt.getTime() >= cutoff);
    expect(recent).toHaveLength(2);
  });

  it('includes deliberate 1★ delivery-time dip reviews on self google', () => {
    const dipReviews = DEMO_SNAPSHOTS.filter((s) => s.isSelf && s.source === 'google').flatMap((s) =>
      s.newReviews.filter((r) => r.rating === 1 && (r.themes ?? []).includes('delivery-time')),
    );
    expect(dipReviews.length).toBeGreaterThanOrEqual(2);
  });
});

describe('intelligence_snapshots unique index (live mongod)', () => {
  let mongo: MongoMemoryServer;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongo.getUri();
    process.env.MONGODB_DB_NAME = 'restropulse-db-test';
    await connectDB();
    await ensureIntelligenceIndexes();
  }, 60000);

  afterAll(async () => {
    await disconnectDB();
    if (mongo) await mongo.stop();
  }, 20000);

  it('rejects a duplicate (restaurantId, target, source, date) row', async () => {
    const col = getIntelligenceSnapshotsCollection();
    const base = {
      restaurantId: 'r-uniq',
      targetPlaceId: 'p-uniq',
      isSelf: true,
      source: 'google',
      date: '2026-07-01',
      rating: 4.2,
      reviewCount: 100,
      photoCount: 10,
      newReviews: [],
      capturedAt: new Date(),
    };
    await col.insertOne({ _id: 'u-1', ...base } as any);
    await expect(col.insertOne({ _id: 'u-2', ...base } as any)).rejects.toThrow();
  });

  it('upserts in place on the unique key (idempotent daily job)', async () => {
    const col = getIntelligenceSnapshotsCollection();
    const key = { restaurantId: 'r-up', targetPlaceId: 'p-up', source: 'google', date: '2026-07-02' };
    await col.replaceOne(
      key,
      { ...key, _id: 'up-1', isSelf: true, rating: 4.0, reviewCount: 1, photoCount: 1, newReviews: [], capturedAt: new Date() } as any,
      { upsert: true },
    );
    await col.replaceOne(
      key,
      { ...key, _id: 'up-1', isSelf: true, rating: 4.5, reviewCount: 9, photoCount: 3, newReviews: [], capturedAt: new Date() } as any,
      { upsert: true },
    );
    const found = await col.find(key).toArray();
    expect(found).toHaveLength(1);
    expect(found[0].rating).toBe(4.5);
    expect(found[0].reviewCount).toBe(9);
  });

  it('seeds without duplicate-key errors and persists all rows + sightings', async () => {
    const snaps = getIntelligenceSnapshotsCollection();
    const sights = getNearbySightingsCollection();
    for (const doc of INTELLIGENCE_SNAPSHOTS_DEMO_SEED.intelligence_snapshots) {
      await snaps.replaceOne({ _id: doc._id as any }, doc, { upsert: true });
    }
    for (const doc of INTELLIGENCE_SNAPSHOTS_DEMO_SEED.nearby_sightings) {
      await sights.replaceOne({ _id: doc._id as any }, doc, { upsert: true });
    }
    expect(await snaps.countDocuments({ restaurantId: DEMO_SNAPSHOTS_RESTAURANT_ID })).toBe(
      DEMO_SNAPSHOT_COUNTS.snapshotsTotal,
    );
    expect(await sights.countDocuments({ restaurantId: DEMO_SNAPSHOTS_RESTAURANT_ID })).toBe(8);
  });
});
