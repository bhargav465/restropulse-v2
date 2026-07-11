import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';

// The scan pipeline is fire-and-forget with external Places/Anthropic calls —
// stub it so the route tests never touch the network.
vi.mock('../../src/services/intelligence/pipeline.js', () => ({
    runScanPipeline: vi.fn().mockResolvedValue(undefined),
}));

import intelligenceRoutes from '../../src/routes/admin/intelligence.js';
import { runScanPipeline } from '../../src/services/intelligence/pipeline.js';
import { getIntelligenceScansCollection } from '@restropulse/db';
import { generateTokens } from '../../src/services/jwt.js';

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/admin/intelligence', intelligenceRoutes);
    app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
        res.status(500).json({ success: false, error: 'Internal server error' });
    });
    return app;
}

const app = buildApp();
const OWNER_TOKEN = generateTokens('u1', '+919999999999', 'r1', 'OWNER').accessToken;
const STAFF_TOKEN = generateTokens('u2', '+918888888888', 'r1', 'STAFF').accessToken;

describe('POST /api/admin/intelligence/scan — auth guard', () => {
    it('rejects a request with no token (401)', async () => {
        const res = await request(app).post('/api/admin/intelligence/scan').send({ name: 'X', city: 'Y' });
        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it('rejects a non-OWNER role (403)', async () => {
        const res = await request(app)
            .post('/api/admin/intelligence/scan')
            .set('Authorization', `Bearer ${STAFF_TOKEN}`)
            .send({ name: 'X', city: 'Y' });
        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });
});

describe('POST /api/admin/intelligence/scan — behavior (DB-backed)', () => {
    beforeEach(async () => {
        await getIntelligenceScansCollection().deleteMany({ restaurantId: 'r1' });
        vi.clearAllMocks();
    });

    it('queues a scan (202) and fires the pipeline once', async () => {
        const res = await request(app)
            .post('/api/admin/intelligence/scan')
            .set('Authorization', `Bearer ${OWNER_TOKEN}`)
            .send({ name: 'Demo Kitchen', city: 'Bengaluru' });

        expect(res.status).toBe(202);
        expect(res.body.success).toBe(true);
        expect(typeof res.body.data.scanId).toBe('string');
        expect(runScanPipeline).toHaveBeenCalledTimes(1);

        const scan = await getIntelligenceScansCollection().findOne({ _id: res.body.data.scanId });
        expect(scan?.status).toBe('QUEUED');
        expect(scan?.restaurantId).toBe('r1');
    });

    it('returns 409 when a non-failed scan ran within 24 h', async () => {
        await getIntelligenceScansCollection().insertOne({
            _id: 'recent-scan',
            restaurantId: 'r1',
            query: { name: 'Demo', city: 'Bengaluru' },
            status: 'COMPLETED',
            requestedBy: 'u1',
            createdAt: new Date(Date.now() - 60 * 60 * 1000), // 1 h ago
            updatedAt: new Date(),
        } as unknown as Record<string, unknown>);

        const res = await request(app)
            .post('/api/admin/intelligence/scan')
            .set('Authorization', `Bearer ${OWNER_TOKEN}`)
            .send({ name: 'Demo Kitchen', city: 'Bengaluru' });

        expect(res.status).toBe(409);
        expect(runScanPipeline).not.toHaveBeenCalled();
    });

    it('force=true bypasses the 24 h throttle', async () => {
        await getIntelligenceScansCollection().insertOne({
            _id: 'recent-scan-2',
            restaurantId: 'r1',
            query: { name: 'Demo', city: 'Bengaluru' },
            status: 'COMPLETED',
            requestedBy: 'u1',
            createdAt: new Date(Date.now() - 60 * 60 * 1000),
            updatedAt: new Date(),
        } as unknown as Record<string, unknown>);

        const res = await request(app)
            .post('/api/admin/intelligence/scan')
            .set('Authorization', `Bearer ${OWNER_TOKEN}`)
            .send({ name: 'Demo Kitchen', city: 'Bengaluru', force: true });

        expect(res.status).toBe(202);
        expect(runScanPipeline).toHaveBeenCalledTimes(1);
    });
});
