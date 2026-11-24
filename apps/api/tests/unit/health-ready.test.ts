import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockCommand = vi.fn();
vi.mock('@restropulse/db', async (importOriginal) => {
    const actual = await importOriginal() as any;
    return { ...actual, getDB: vi.fn(() => ({ command: mockCommand })) };
});

const { createReadinessHandler, pingMongo } = await import('../../src/routes/health.js');

function appWith(handler: express.RequestHandler) {
    const app = express();
    app.get('/health/ready', handler);
    return app;
}

describe('GET /health/ready', () => {
    it('returns 200 when every check passes', async () => {
        const res = await request(appWith(createReadinessHandler({ mongo: async () => {} }))).get('/health/ready');

        expect(res.status).toBe(200);
        expect(res.body).toEqual(expect.objectContaining({ status: 'ok', checks: { mongo: 'ok' } }));
        expect(res.headers['cache-control']).toBe('no-store');
    });

    it('returns 503 and names the failing check without leaking the error', async () => {
        const res = await request(appWith(createReadinessHandler({
            mongo: async () => { throw new Error('mongodb+srv://user:secret@cluster refused'); },
            other: async () => {},
        }))).get('/health/ready');

        expect(res.status).toBe(503);
        expect(res.body.status).toBe('unavailable');
        expect(res.body.checks).toEqual({ mongo: 'fail', other: 'ok' });
        expect(JSON.stringify(res.body)).not.toContain('secret');
    });

    it('fails a check that hangs past the timeout', async () => {
        const res = await request(appWith(createReadinessHandler({ mongo: () => new Promise(() => {}) }, 50))).get('/health/ready');

        expect(res.status).toBe(503);
        expect(res.body.checks.mongo).toBe('fail');
    });

    it('pingMongo sends a ping command', async () => {
        mockCommand.mockResolvedValue({ ok: 1 });
        await pingMongo();
        expect(mockCommand).toHaveBeenCalledWith({ ping: 1 });
    });

    it('defaults to the Mongo ping', async () => {
        mockCommand.mockRejectedValue(new Error('down'));
        const res = await request(appWith(createReadinessHandler())).get('/health/ready');
        expect(res.status).toBe(503);
        expect(res.body.checks).toEqual({ mongo: 'fail' });
    });
});
