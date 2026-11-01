/**
 * MongoRateLimitStore against a real MongoDB (mongodb-memory-server from
 * tests/setup.ts). Verifies the atomic upsert, concurrency, TTL index and
 * cross-instance sharing that the fake-collection tests cannot prove.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getDB } from '@restropulse/db';
import { MongoRateLimitStore, RATE_LIMITS_COLLECTION, type RateLimitDoc } from '../../src/middleware/rate-limit.js';

function makeStore(prefix: string, now: { t: number }, windowMs = 60_000) {
    const store = new MongoRateLimitStore({ prefix, now: () => now.t });
    store.init({ windowMs } as never);
    return store;
}

describe('MongoRateLimitStore (MongoDB)', () => {
    beforeEach(async () => {
        await getDB().collection<RateLimitDoc>(RATE_LIMITS_COLLECTION).deleteMany({});
    });

    it('counts concurrent increments exactly (no lost updates)', async () => {
        const now = { t: 1_000 };
        const store = makeStore('concurrent', now);
        const results = await Promise.all(Array.from({ length: 25 }, () => store.increment('1.2.3.4')));
        const hits = results.map((r) => r.totalHits).sort((a, b) => a - b);
        expect(hits).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
        expect((await store.get('1.2.3.4'))?.totalHits).toBe(25);
    });

    it('shares counters between two store instances (two API instances)', async () => {
        const now = { t: 1_000 };
        const a = makeStore('shared', now);
        const b = makeStore('shared', now);
        await a.increment('k');
        await b.increment('k');
        expect((await a.increment('k')).totalHits).toBe(3);
    });

    it('rolls over to a new window', async () => {
        const now = { t: 1_000 };
        const store = makeStore('roll', now);
        await store.increment('k');
        now.t = 61_000;
        expect((await store.increment('k')).totalHits).toBe(1);
    });

    it('creates the TTL index on first use', async () => {
        const store = makeStore('ttl', { t: 0 });
        await store.increment('k');
        // ensureIndexes is fire-and-forget; give it a moment.
        await new Promise((r) => setTimeout(r, 200));
        const indexes = await getDB().collection(RATE_LIMITS_COLLECTION).indexes();
        const ttl = indexes.find((i) => i.name === 'rateLimits_ttl');
        expect(ttl?.expireAfterSeconds).toBe(0);
    });

    it('decrement and resetKey', async () => {
        const store = makeStore('dec', { t: 0 });
        await store.increment('k');
        await store.increment('k');
        await store.decrement('k');
        expect((await store.get('k'))?.totalHits).toBe(1);
        await store.resetKey('k');
        expect(await store.get('k')).toBeUndefined();
    });
});
