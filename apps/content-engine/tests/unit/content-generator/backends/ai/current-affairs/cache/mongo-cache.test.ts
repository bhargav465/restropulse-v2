import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { setDB } from '@restropulse/db';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { MongoCurrentAffairsCache } = await import(
  '../../../../../../../src/services/content-generator/backends/ai/current-affairs/cache/mongo-cache.js'
);

let mongod: MongoMemoryServer;
let client: MongoClient;
const cache = new MongoCurrentAffairsCache();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongod.getUri());
  setDB(client.db('current-affairs-cache-test'));
}, 60000);

afterAll(async () => {
  await client.close();
  await mongod.stop();
}, 20000);

beforeEach(async () => {
  await client.db('current-affairs-cache-test').collection('currentAffairsCache').deleteMany({});
});

describe('MongoCurrentAffairsCache', () => {
  it('returns null when key is absent', async () => {
    const v = await cache.get('missing');
    expect(v).toBeNull();
  });

  it('stores and retrieves a payload', async () => {
    await cache.set('k1', { hello: 'world' }, 60_000);
    const v = await cache.get<{ hello: string }>('k1');
    expect(v).toEqual({ hello: 'world' });
  });

  it('returns null for an expired entry without deleting it (cleanup is separate)', async () => {
    await cache.set('k2', { v: 1 }, -1_000); // already expired
    const v = await cache.get('k2');
    expect(v).toBeNull();
    // Entry still present in collection
    const raw = await client.db('current-affairs-cache-test').collection('currentAffairsCache').findOne({ key: 'k2' });
    expect(raw).not.toBeNull();
  });

  it('upserts: second set overwrites the first', async () => {
    await cache.set('k3', { v: 1 }, 60_000);
    await cache.set('k3', { v: 2 }, 60_000);
    const v = await cache.get<{ v: number }>('k3');
    expect(v?.v).toBe(2);
  });

  it('cleanup removes expired entries and reports the count', async () => {
    await cache.set('valid', { ok: true }, 60_000);
    await cache.set('expired1', { ok: false }, -1_000);
    await cache.set('expired2', { ok: false }, -1_000);
    const removed = await cache.cleanup();
    expect(removed).toBe(2);
    expect(await cache.get('valid')).not.toBeNull();
    expect(await cache.get('expired1')).toBeNull();
  });
});
