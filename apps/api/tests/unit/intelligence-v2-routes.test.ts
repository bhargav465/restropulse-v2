import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';

// Stub the v1 scan pipeline (imported transitively by the router).
vi.mock('../../src/services/intelligence/pipeline.js', () => ({
    runScanPipeline: vi.fn().mockResolvedValue(undefined),
}));

import intelligenceRoutes from '../../src/routes/admin/intelligence.js';
import {
    getRestaurantsCollection,
    getCompetitorCacheCollection,
    getIntelligenceSnapshotsCollection,
} from '@restropulse/db';
import { generateTokens } from '../../src/services/jwt.js';

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/admin/intelligence', intelligenceRoutes);
    app.use((_err: Error, _req: Request, res: Response, _next: NextFunction) => {
        res.status(500).json({ success: false, error: 'Internal server error' });
    });
    return app;
}

const app = buildApp();
const OWNER = generateTokens('u1', '+919999999999', 'r1', 'OWNER').accessToken;
const STAFF = generateTokens('u2', '+918888888888', 'r1', 'STAFF').accessToken;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function seedRestaurant(watchlist: Array<{ placeId: string; name: string }> = []) {
    await getRestaurantsCollection().deleteMany({ _id: 'r1' as never });
    await getRestaurantsCollection().insertOne({
        _id: 'r1' as never,
        name: 'Test Kitchen',
        cuisine: 'Indian',
        intelligence: { watchlist },
    } as never);
}

async function seedCache(placeIds: string[]) {
    for (const placeId of placeIds) {
        await getCompetitorCacheCollection().updateOne(
            { placeId },
            { $set: { placeId, payload: { rating: 4.2, userRatingCount: 200, photos: [] }, fetchedAt: new Date() } },
            { upsert: true },
        );
    }
}

describe('intelligence v2 routes — auth guard', () => {
    it('401 without a token', async () => {
        const res = await request(app).get('/api/admin/intelligence/watchlist');
        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });
    it('403 for a non-OWNER role', async () => {
        const res = await request(app).get('/api/admin/intelligence/watchlist').set(auth(STAFF));
        expect(res.status).toBe(403);
    });
});

describe('GET/PUT /watchlist', () => {
    beforeEach(async () => {
        await seedRestaurant();
        await seedCache(['c1', 'c2', 'c3', 'c4', 'c5', 'c6']);
    });

    it('GET returns entries + max envelope', async () => {
        const res = await request(app).get('/api/admin/intelligence/watchlist').set(auth(OWNER));
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.max).toBe(5);
        expect(Array.isArray(res.body.data.entries)).toBe(true);
    });

    it('accepts 5 known placeIds', async () => {
        const entries = ['c1', 'c2', 'c3', 'c4', 'c5'].map((placeId) => ({ placeId, name: placeId }));
        const res = await request(app).put('/api/admin/intelligence/watchlist').set(auth(OWNER)).send({ entries });
        expect(res.status).toBe(200);
        expect(res.body.data.entries).toHaveLength(5);
    });

    it('rejects 6 entries with 422', async () => {
        const entries = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map((placeId) => ({ placeId, name: placeId }));
        const res = await request(app).put('/api/admin/intelligence/watchlist').set(auth(OWNER)).send({ entries });
        expect(res.status).toBe(422);
    });

    it('rejects an unknown placeId with 422', async () => {
        const res = await request(app)
            .put('/api/admin/intelligence/watchlist')
            .set(auth(OWNER))
            .send({ entries: [{ placeId: 'unknown-x', name: 'X' }] });
        expect(res.status).toBe(422);
    });

    it('rejects duplicate placeIds with 422', async () => {
        const res = await request(app)
            .put('/api/admin/intelligence/watchlist')
            .set(auth(OWNER))
            .send({ entries: [{ placeId: 'c1', name: 'A' }, { placeId: 'c1', name: 'B' }] });
        expect(res.status).toBe(422);
    });
});

describe('GET /snapshots — param combos, consistent series', () => {
    beforeEach(async () => {
        await seedRestaurant();
        await getIntelligenceSnapshotsCollection().deleteMany({ restaurantId: 'r1' });
        const dates = ['2026-07-01', '2026-07-02', '2026-07-03'];
        for (const date of dates) {
            await getIntelligenceSnapshotsCollection().insertOne({
                _id: `r1:selfp:google:${date}`,
                restaurantId: 'r1', targetPlaceId: 'selfp', isSelf: true, source: 'google',
                date, rating: 4.3, reviewCount: 100, photoCount: 10, newReviews: [], capturedAt: new Date(),
            } as never);
        }
    });

    it('rejects a target not in watchlist ∪ self (422)', async () => {
        const res = await request(app)
            .get('/api/admin/intelligence/snapshots?target=not-mine&source=google')
            .set(auth(OWNER));
        expect(res.status).toBe(422);
    });

    it('MTD / date / overall combos return consistent-length day series', async () => {
        const mtd = await request(app)
            .get('/api/admin/intelligence/snapshots?target=self&source=google&from=2026-07-01&to=2026-07-31&granularity=day')
            .set(auth(OWNER));
        const oneDay = await request(app)
            .get('/api/admin/intelligence/snapshots?target=self&source=google&from=2026-07-02&to=2026-07-02&granularity=day')
            .set(auth(OWNER));
        expect(mtd.status).toBe(200);
        expect(mtd.body.data.points).toHaveLength(3);
        expect(oneDay.body.data.points).toHaveLength(1);
    });

    it('overall + month granularity aggregates into one point', async () => {
        const res = await request(app)
            .get('/api/admin/intelligence/snapshots?target=self&source=google&granularity=month')
            .set(auth(OWNER));
        expect(res.status).toBe(200);
        expect(res.body.data.points).toHaveLength(1);
        expect(res.body.data.points[0].date).toBe('2026-07');
    });
});

describe('GET /compare + GET /new-openings + POST /zomato-manual + capture', () => {
    beforeEach(async () => {
        await seedRestaurant();
        await getIntelligenceSnapshotsCollection().deleteMany({ restaurantId: 'r1' });
    });

    it('GET /compare returns an array envelope (day)', async () => {
        const res = await request(app).get('/api/admin/intelligence/compare?granularity=day&date=2026-07-01').set(auth(OWNER));
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('GET /compare rejects a malformed month (400)', async () => {
        const res = await request(app).get('/api/admin/intelligence/compare?granularity=month&month=2026').set(auth(OWNER));
        expect(res.status).toBe(400);
    });

    it('GET /new-openings rejects sinceDays outside {30,60,90}', async () => {
        const res = await request(app).get('/api/admin/intelligence/new-openings?sinceDays=45').set(auth(OWNER));
        expect(res.status).toBe(400);
    });

    it('POST /zomato-manual validates rating range (422)', async () => {
        const res = await request(app)
            .post('/api/admin/intelligence/zomato-manual')
            .set(auth(OWNER))
            .send({ target: 'self', rating: 9, reviewCount: 10, photoCount: 5 });
        expect(res.status).toBe(422);
    });

    it('POST /zomato-manual writes today\'s zomato snapshot', async () => {
        const res = await request(app)
            .post('/api/admin/intelligence/zomato-manual')
            .set(auth(OWNER))
            .send({ target: 'self', rating: 4.4, reviewCount: 120, photoCount: 30 });
        expect(res.status).toBe(200);
        expect(res.body.data.snapshotWritten).toBe(true);
        const doc = await getIntelligenceSnapshotsCollection().findOne({ restaurantId: 'r1', source: 'zomato' });
        expect(doc).not.toBeNull();
    });

    it('POST /snapshots/capture is rate-limited to 1/hour (429)', async () => {
        await getIntelligenceSnapshotsCollection().insertOne({
            _id: 'r1:selfp:google:recent',
            restaurantId: 'r1', targetPlaceId: 'selfp', isSelf: true, source: 'google',
            date: '2026-07-01', rating: 4, reviewCount: 1, photoCount: 1, newReviews: [],
            capturedAt: new Date(),
        } as never);
        const res = await request(app).post('/api/admin/intelligence/snapshots/capture').set(auth(OWNER));
        expect(res.status).toBe(429);
    });
});
