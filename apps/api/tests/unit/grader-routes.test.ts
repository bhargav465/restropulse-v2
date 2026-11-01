/**
 * Public grader routes: validation contract and per-IP limits. Scan/places
 * services are mocked; limiters run on MemoryStore so no database is needed
 * (the Mongo store itself is covered in rate-limit-store.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { trackEvent } from '@restropulse/telemetry/server';

const mocks = vi.hoisted(() => ({
    runGraderScan: vi.fn(),
    unlockGraderScan: vi.fn(),
    searchPlaceCandidates: vi.fn(),
}));

vi.mock('../../src/services/intelligence/grader.js', () => ({
    runGraderScan: mocks.runGraderScan,
    unlockGraderScan: mocks.unlockGraderScan,
}));
vi.mock('../../src/services/intelligence/places.js', () => ({
    searchPlaceCandidates: mocks.searchPlaceCandidates,
}));
vi.mock('../../src/middleware/rate-limit.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/middleware/rate-limit.js')>();
    const { MemoryStore } = await import('express-rate-limit');
    return {
        ...actual,
        createRateLimiter: (opts: Parameters<typeof actual.createRateLimiter>[0]) =>
            actual.createRateLimiter({ ...opts, store: new MemoryStore() }),
    };
});

const { default: graderRoutes } = await import('../../src/routes/grader.js');

const scanResult = {
    scanId: 'scan-1',
    score: 62,
    problems: [1, 2, 3, 4, 5, 6].map((n) => ({ id: n })),
    leaderboard: [1, 2, 3, 4, 5].map((n) => ({ rank: n })),
    searches: [{ query: 'biryani', topResult: 'Paradise', yourPosition: 3 }, { query: 'mandi', topResult: 'Shah', yourPosition: 7 }],
    pillars: [{ id: 'reviews', grade: 'B', checks: [{ id: 'c1' }] }],
    likelyNew: [{ name: 'New Place' }],
};

let ipCounter = 0;
/** Fresh client IP per test so module-level limiters don't leak between tests. */
const nextIp = () => `198.51.100.${++ipCounter}`;

function app() {
    const a = express();
    a.set('trust proxy', 1);
    a.use(express.json());
    a.use('/api/grader', graderRoutes);
    return a;
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('POST /api/grader/scan', () => {
    it('400 with the existing message when name or city is missing or blank', async () => {
        for (const body of [{}, { name: 'Bawarchi' }, { name: '  ', city: 'Hyderabad' }, { name: 1, city: 'Hyderabad' }]) {
            const res = await request(app()).post('/api/grader/scan').set('X-Forwarded-For', nextIp()).send(body);
            expect(res.status).toBe(400);
            expect(res.body).toEqual({ success: false, error: 'Restaurant name and city are required.' });
        }
        expect(mocks.runGraderScan).not.toHaveBeenCalled();
    });

    it('trims and clips inputs before scanning and returns the locked teaser', async () => {
        mocks.runGraderScan.mockResolvedValue(scanResult);
        const longName = 'x'.repeat(200);
        const res = await request(app())
            .post('/api/grader/scan')
            .set('X-Forwarded-For', nextIp())
            .send({ name: `  ${longName}  `, city: ' Hyderabad ', placeId: '  ' });
        expect(res.status).toBe(200);
        expect(mocks.runGraderScan).toHaveBeenCalledWith('x'.repeat(120), 'Hyderabad', undefined);
        expect(res.body.data.problems).toHaveLength(4);
        expect(res.body.data.leaderboard).toHaveLength(4);
        expect(res.body.data.searches[1].topResult).not.toBe('Shah');
        expect(res.body.data.pillars[0].checks).toEqual([]);
        expect(res.body.data.likelyNew).toEqual([]);
    });

    it('404 with a helpful message when the listing is not found', async () => {
        mocks.runGraderScan.mockResolvedValue(null);
        const res = await request(app())
            .post('/api/grader/scan')
            .set('X-Forwarded-For', nextIp())
            .send({ name: 'Nowhere', city: 'Pune', placeId: 'abc' });
        expect(res.status).toBe(404);
        expect(res.body.error).toContain('"Nowhere"');
        expect(mocks.runGraderScan).toHaveBeenCalledWith('Nowhere', 'Pune', 'abc');
    });

    it('limits scans per client IP (port-insensitive) and emits the grader trip event', async () => {
        mocks.runGraderScan.mockResolvedValue(scanResult);
        const ip = nextIp();
        // NODE_ENV=test -> non-production budget of 100/hour.
        for (let i = 0; i < 100; i++) {
            const r = await request(app()).post('/api/grader/scan').set('X-Forwarded-For', `${ip}:${1000 + i}`).send({ name: 'A', city: 'B' });
            expect(r.status).toBe(200);
        }
        const blocked = await request(app()).post('/api/grader/scan').set('X-Forwarded-For', `${ip}:9999`).send({ name: 'A', city: 'B' });
        expect(blocked.status).toBe(429);
        expect(blocked.body).toEqual({ success: false, error: 'Too many scans from this connection — try again in an hour.' });
        expect(trackEvent).toHaveBeenCalledWith('grader_rate_limit_trip', { limitType: 'per-ip', endpoint: '/scan' });
    });
});

describe('POST /api/grader/unlock', () => {
    it('400 when scanId or promoCode is missing or blank', async () => {
        for (const body of [{}, { scanId: 's' }, { scanId: 's', promoCode: '  ' }, { scanId: 5, promoCode: 'X' }]) {
            const res = await request(app()).post('/api/grader/unlock').set('X-Forwarded-For', nextIp()).send(body);
            expect(res.status).toBe(400);
            expect(res.body).toEqual({ success: false, error: 'scanId and promoCode are required.' });
        }
    });

    it('422 when no usable contact is given', async () => {
        const res = await request(app())
            .post('/api/grader/unlock')
            .set('X-Forwarded-For', nextIp())
            .send({ scanId: 's', promoCode: 'PULSE', email: 'not-an-email' });
        expect(res.status).toBe(422);
        expect(mocks.unlockGraderScan).not.toHaveBeenCalled();
    });

    it('unlocks with the cleaned contact details', async () => {
        mocks.unlockGraderScan.mockResolvedValue({ ok: true, result: scanResult });
        const res = await request(app())
            .post('/api/grader/unlock')
            .set('X-Forwarded-For', nextIp())
            .send({ scanId: 's', promoCode: 'PULSE', phone: ' 9876543210 ', name: ' Ravi ' });
        expect(res.status).toBe(200);
        expect(mocks.unlockGraderScan).toHaveBeenCalledWith('s', 'PULSE', { phone: '9876543210', name: 'Ravi' });
    });
});

describe('GET /api/grader/suggest', () => {
    it('returns an empty list for short queries without calling Places', async () => {
        const res = await request(app()).get('/api/grader/suggest?name=a').set('X-Forwarded-For', nextIp());
        expect(res.body).toEqual({ success: true, data: [] });
        expect(mocks.searchPlaceCandidates).not.toHaveBeenCalled();
    });
});

describe('image proxies share one budget', () => {
    it('/photo and /staticmap count against the same per-IP limit', async () => {
        const ip = nextIp();
        // Invalid refs 404 fast without network; each still counts toward the budget.
        for (let i = 0; i < 150; i++) {
            expect((await request(app()).get('/api/grader/photo?ref=bad').set('X-Forwarded-For', ip)).status).toBe(404);
            expect((await request(app()).get('/api/grader/staticmap?lat=x').set('X-Forwarded-For', ip)).status).toBe(404);
        }
        expect((await request(app()).get('/api/grader/photo?ref=bad').set('X-Forwarded-For', ip)).status).toBe(429);
    });
});
