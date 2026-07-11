import { describe, it, expect, vi } from 'vitest';
import type { Db } from 'mongodb';
import {
  ensureIntelligenceIndexes,
  COMPETITOR_CACHE_TTL_SECONDS,
  MAX_REPORTS_PER_RESTAURANT,
} from '../src/intelligence.js';
import {
  INTELLIGENCE_DEMO_SEED,
  DEMO_INTELLIGENCE_REPORT,
  DEMO_INTELLIGENCE_SCAN,
  DEMO_INTELLIGENCE_RESTAURANT_ID,
} from '../src/seeds/intelligence-demo.js';

interface CreatedIndex {
  collection: string;
  spec: Record<string, unknown>;
  options: Record<string, unknown>;
}

/**
 * A minimal Db test double that records every createIndex call, so we can
 * assert index creation without a live mongod (mirrors the ordering pattern).
 */
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

describe('ensureIntelligenceIndexes', () => {
  it('creates the scans, reports, and competitor_cache indexes', async () => {
    const { db, created } = mockDb();
    await ensureIntelligenceIndexes(db);

    expect(created).toContainEqual({
      collection: 'intelligence_scans',
      spec: { restaurantId: 1, createdAt: -1 },
      options: {},
    });
    expect(created).toContainEqual({
      collection: 'intelligence_reports',
      spec: { restaurantId: 1, generatedAt: -1 },
      options: {},
    });
    expect(created).toContainEqual({
      collection: 'competitor_cache',
      spec: { placeId: 1 },
      options: { unique: true },
    });
  });

  it('creates a 7-day TTL index on competitor_cache.fetchedAt', async () => {
    const { db, created } = mockDb();
    await ensureIntelligenceIndexes(db);

    const ttl = created.find(
      (c) => c.collection === 'competitor_cache' && 'expireAfterSeconds' in c.options,
    );
    expect(ttl).toBeDefined();
    expect(ttl?.spec).toEqual({ fetchedAt: 1 });
    expect(ttl?.options.expireAfterSeconds).toBe(COMPETITOR_CACHE_TTL_SECONDS);
    expect(COMPETITOR_CACHE_TTL_SECONDS).toBe(7 * 24 * 60 * 60);
  });

  it('swallows existing-index conflicts (codes 85/86)', async () => {
    const db = {
      collection() {
        return { createIndex: vi.fn(async () => { throw { code: 85 }; }) };
      },
    } as unknown as Db;
    await expect(ensureIntelligenceIndexes(db)).resolves.toBeUndefined();
  });

  it('rethrows unexpected errors', async () => {
    const db = {
      collection() {
        return { createIndex: vi.fn(async () => { throw { code: 26 }; }) };
      },
    } as unknown as Db;
    await expect(ensureIntelligenceIndexes(db)).rejects.toBeDefined();
  });
});

describe('INTELLIGENCE_DEMO_SEED', () => {
  it('keeps the last-12 report cap constant', () => {
    expect(MAX_REPORTS_PER_RESTAURANT).toBe(12);
  });

  it('is keyed by the intelligence collection names', () => {
    expect(Object.keys(INTELLIGENCE_DEMO_SEED).sort()).toEqual([
      'intelligence_reports',
      'intelligence_scans',
    ]);
  });

  it('every seed document has a stable _id (upsertable)', () => {
    for (const docs of Object.values(INTELLIGENCE_DEMO_SEED)) {
      for (const doc of docs) {
        expect(typeof doc._id).toBe('string');
        expect((doc._id as string).length).toBeGreaterThan(0);
      }
    }
  });

  it('links the scan to the report and the demo restaurant', () => {
    expect(DEMO_INTELLIGENCE_SCAN.reportId).toBe(DEMO_INTELLIGENCE_REPORT._id);
    expect(DEMO_INTELLIGENCE_SCAN.restaurantId).toBe(DEMO_INTELLIGENCE_RESTAURANT_ID);
    expect(DEMO_INTELLIGENCE_REPORT.restaurantId).toBe(DEMO_INTELLIGENCE_RESTAURANT_ID);
    expect(DEMO_INTELLIGENCE_REPORT.scanId).toBe(DEMO_INTELLIGENCE_SCAN._id);
    expect(DEMO_INTELLIGENCE_SCAN.status).toBe('COMPLETED');
  });

  it('tells the DESIGN §6 story: restroScore 68, strong reviews, weak website', () => {
    expect(DEMO_INTELLIGENCE_REPORT.restroScore).toBe(68);
    expect(DEMO_INTELLIGENCE_REPORT.pillars).toHaveLength(6);
    const reviews = DEMO_INTELLIGENCE_REPORT.pillars.find((p) => p.key === 'reviews');
    const website = DEMO_INTELLIGENCE_REPORT.pillars.find((p) => p.key === 'website');
    expect(reviews?.grade).toBe('A');
    expect(website?.grade).toBe('F');
  });

  it('ships 12 competitors and 2 delta alerts', () => {
    expect(DEMO_INTELLIGENCE_REPORT.competitors).toHaveLength(12);
    expect(DEMO_INTELLIGENCE_REPORT.deltas?.competitorAlerts).toHaveLength(2);
  });

  it('[SAMPLE]-marks every competitor name', () => {
    for (const c of DEMO_INTELLIGENCE_REPORT.competitors) {
      expect(c.name).toContain('[SAMPLE]');
    }
  });
});
