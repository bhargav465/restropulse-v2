/**
 * Rate limiter unit tests. These use an in-process fake collection and
 * express-rate-limit's MemoryStore so they need no database; the real-Mongo
 * behaviour of MongoRateLimitStore is covered in rate-limit-store.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { MemoryStore } from 'express-rate-limit';
import type { Collection } from 'mongodb';
import { trackEvent } from '@restropulse/telemetry/server';
import {
    MongoRateLimitStore,
    createRateLimiter,
    createGlobalApiLimiter,
    GLOBAL_API_LIMIT_PER_MINUTE,
    type RateLimitDoc,
} from '../../src/middleware/rate-limit.js';

/** Minimal in-memory stand-in for the handful of Collection methods the store uses. */
function fakeCollection() {
    const docs = new Map<string, RateLimitDoc>();
    const col = {
        docs,
        createIndex: vi.fn(async () => 'ok'),
        findOne: vi.fn(async (q: { _id: string }) => docs.get(q._id) ?? null),
        findOneAndUpdate: vi.fn(async (
            q: { _id: string },
            u: { $inc: { hits: number }; $setOnInsert: Omit<RateLimitDoc, '_id' | 'hits'> },
        ) => {
            const cur = docs.get(q._id) ?? { _id: q._id, hits: 0, ...u.$setOnInsert };
            const next = { ...cur, hits: cur.hits + u.$inc.hits };
            docs.set(q._id, next);
            return next;
        }),
        updateOne: vi.fn(async (q: { _id: string; hits: { $gt: number } }, u: { $inc: { hits: number } }) => {
            const cur = docs.get(q._id);
            if (cur && cur.hits > q.hits.$gt) docs.set(q._id, { ...cur, hits: cur.hits + u.$inc.hits });
        }),
        deleteMany: vi.fn(async (q: { k: string }) => {
            for (const [id, d] of docs) if (d.k === q.k) docs.delete(id);
        }),
    };
    return col;
}

function storeWith(col: ReturnType<typeof fakeCollection>, now: { t: number }, windowMs = 60_000) {
    const store = new MongoRateLimitStore({
        prefix: 'test',
        getCollection: () => col as unknown as Collection<RateLimitDoc>,
        now: () => now.t,
    });
    store.init({ windowMs } as never);
    return store;
}

describe('MongoRateLimitStore (fake collection)', () => {
    it('counts hits within a window and reports the window end as resetTime', async () => {
        const col = fakeCollection();
        const now = { t: 120_000 + 5_000 }; // 5 s into the [120s, 180s) window
        const store = storeWith(col, now);

        expect((await store.increment('1.2.3.4')).totalHits).toBe(1);
        const second = await store.increment('1.2.3.4');
        expect(second.totalHits).toBe(2);
        expect(second.resetTime?.getTime()).toBe(180_000);
        expect(await store.get('1.2.3.4')).toEqual({ totalHits: 2, resetTime: new Date(180_000) });
    });

    it('starts a fresh count in the next window', async () => {
        const col = fakeCollection();
        const now = { t: 0 };
        const store = storeWith(col, now);
        await store.increment('k');
        await store.increment('k');
        now.t = 60_000;
        expect((await store.increment('k')).totalHits).toBe(1);
    });

    it('keeps keys and prefixes separate', async () => {
        const col = fakeCollection();
        const now = { t: 0 };
        const a = storeWith(col, now);
        const b = new MongoRateLimitStore({ prefix: 'other', getCollection: () => col as never, now: () => now.t });
        b.init({ windowMs: 60_000 } as never);
        await a.increment('k');
        await a.increment('k2');
        expect((await b.increment('k')).totalHits).toBe(1);
        expect((await a.increment('k')).totalHits).toBe(2);
    });

    it('sets a TTL one window past reset so stale windows are reaped', async () => {
        const col = fakeCollection();
        const store = storeWith(col, { t: 10_000 });
        await store.increment('k');
        const [doc] = [...col.docs.values()];
        expect(doc.resetAt.getTime()).toBe(60_000);
        expect(doc.expireAt.getTime()).toBe(120_000);
        expect(doc.k).toBe('test:k');
    });

    it('creates the TTL index once, and retries after a failure', async () => {
        const col = fakeCollection();
        col.createIndex.mockRejectedValueOnce(new Error('boom'));
        const store = storeWith(col, { t: 0 });
        await store.increment('k');
        await new Promise((r) => setTimeout(r, 0));
        await store.increment('k');
        await store.increment('k');
        // 2 indexes on the failed attempt + 2 on the retry, then cached.
        expect(col.createIndex).toHaveBeenCalledTimes(4);
        expect(col.createIndex).toHaveBeenCalledWith({ expireAt: 1 }, expect.objectContaining({ expireAfterSeconds: 0 }));
    });

    it('decrement never goes below zero and resetKey clears every window for the key', async () => {
        const col = fakeCollection();
        const now = { t: 0 };
        const store = storeWith(col, now);
        await store.increment('k');
        await store.decrement('k');
        await store.decrement('k');
        expect((await store.get('k'))?.totalHits).toBe(0);

        await store.increment('k');
        now.t = 60_000;
        await store.increment('k');
        await store.increment('other');
        await store.resetKey('k');
        expect([...col.docs.values()].map((d) => d.k)).toEqual(['test:other']);
    });

    it('get returns undefined for an unseen key', async () => {
        expect(await storeWith(fakeCollection(), { t: 0 }).get('nobody')).toBeUndefined();
    });
});

function limitedApp(limiter: express.RequestHandler) {
    const app = express();
    app.set('trust proxy', 1);
    app.use('/api', limiter);
    app.get('/api/thing', (_req, res) => res.json({ success: true }));
    app.post('/api/subscriptions/webhook', (_req, res) => res.json({ received: true }));
    return app;
}

describe('createRateLimiter', () => {
    beforeEach(() => vi.mocked(trackEvent).mockClear());

    it('returns 429 with the ApiResponse shape and standard headers once the limit is hit', async () => {
        const onTrip = vi.fn();
        const app = limitedApp(createRateLimiter({
            name: 't', windowMs: 60_000, limit: 2, message: 'slow down', store: new MemoryStore(), onTrip,
        }));
        const ok = await request(app).get('/api/thing').set('X-Forwarded-For', '203.0.113.7:1000');
        expect(ok.status).toBe(200);
        expect(ok.headers['ratelimit-policy']).toBeDefined();
        await request(app).get('/api/thing').set('X-Forwarded-For', '203.0.113.7:2000');
        const blocked = await request(app).get('/api/thing').set('X-Forwarded-For', '203.0.113.7:3000');
        expect(blocked.status).toBe(429);
        expect(blocked.body).toEqual({ success: false, error: 'slow down' });
        expect(onTrip).toHaveBeenCalledTimes(1);
        expect(trackEvent).toHaveBeenCalledWith('api_rate_limit_trip', expect.objectContaining({ limiter: 't' }));
    });

    it('counts different clients separately', async () => {
        const app = limitedApp(createRateLimiter({
            name: 't', windowMs: 60_000, limit: 1, message: 'm', store: new MemoryStore(),
        }));
        expect((await request(app).get('/api/thing').set('X-Forwarded-For', '198.51.100.1')).status).toBe(200);
        expect((await request(app).get('/api/thing').set('X-Forwarded-For', '198.51.100.2')).status).toBe(200);
        expect((await request(app).get('/api/thing').set('X-Forwarded-For', '198.51.100.1')).status).toBe(429);
    });

    it('fails open when the store errors', async () => {
        const broken = {
            init: () => undefined,
            increment: async () => { throw new Error('mongo down'); },
            decrement: async () => undefined,
            resetKey: async () => undefined,
        };
        const app = limitedApp(createRateLimiter({ name: 't', windowMs: 60_000, limit: 1, message: 'm', store: broken }));
        expect((await request(app).get('/api/thing')).status).toBe(200);
        expect((await request(app).get('/api/thing')).status).toBe(200);
    });
});

describe('createGlobalApiLimiter', () => {
    it('allows the configured budget then blocks', async () => {
        const app = limitedApp(createGlobalApiLimiter(new MemoryStore()));
        for (let i = 0; i < GLOBAL_API_LIMIT_PER_MINUTE; i++) {
            const r = await request(app).get('/api/thing').set('X-Forwarded-For', '192.0.2.1');
            expect(r.status).toBe(200);
        }
        expect((await request(app).get('/api/thing').set('X-Forwarded-For', '192.0.2.1')).status).toBe(429);
    });

    it('never throttles the Razorpay webhook', async () => {
        const app = limitedApp(createGlobalApiLimiter(new MemoryStore()));
        for (let i = 0; i < GLOBAL_API_LIMIT_PER_MINUTE + 5; i++) {
            const r = await request(app).post('/api/subscriptions/webhook').set('X-Forwarded-For', '192.0.2.1');
            expect(r.status).toBe(200);
        }
    });
});
