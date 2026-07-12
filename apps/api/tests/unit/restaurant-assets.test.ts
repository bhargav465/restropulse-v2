/**
 * Restaurant asset upload + serving (Brief 04 / DESIGN-04 §UPLOADS).
 *
 * Covers: oversize (>5 MB → 413), wrong MIME → 400, extension/MIME mismatch →
 * 400, happy path (201 + GridFS round-trip), and GET /api/assets/:id headers
 * (immutable cache + ETag + nosniff), 304 on If-None-Match, and 404 for
 * malformed/unknown ids. Uses the real in-memory Mongo (GridFS) via createTestApp.
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestApp, generateAuthToken } from '../helpers/testHelper.js';

const app = createTestApp();
const authToken = generateAuthToken(); // restaurantId 'r1', role OWNER

// Minimal valid-enough PNG header bytes (content is opaque to GridFS).
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

describe('POST /api/restaurant/assets', () => {
    it('rejects a file over 5 MB with 413', async () => {
        const big = Buffer.alloc(5 * 1024 * 1024 + 1024, 0x41);
        const res = await request(app)
            .post('/api/restaurant/assets')
            .set('Authorization', `Bearer ${authToken}`)
            .attach('file', big, { filename: 'huge.png', contentType: 'image/png' });
        expect(res.status).toBe(413);
        expect(res.body.success).toBe(false);
    });

    it('rejects a wrong MIME type with 400', async () => {
        const res = await request(app)
            .post('/api/restaurant/assets')
            .set('Authorization', `Bearer ${authToken}`)
            .attach('file', Buffer.from('hello'), { filename: 'notes.txt', contentType: 'text/plain' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/PNG, JPEG or WebP/i);
    });

    it('rejects an extension/MIME mismatch with 400', async () => {
        // .png extension but claims to be a PDF → the two must agree.
        const res = await request(app)
            .post('/api/restaurant/assets')
            .set('Authorization', `Bearer ${authToken}`)
            .attach('file', PNG_BYTES, { filename: 'logo.png', contentType: 'application/pdf' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/PNG, JPEG or WebP/i);
    });

    it('returns 400 when no file is attached', async () => {
        const res = await request(app).post('/api/restaurant/assets').set('Authorization', `Bearer ${authToken}`);
        expect(res.status).toBe(400);
    });

    it('returns 401 without a token', async () => {
        const res = await request(app)
            .post('/api/restaurant/assets')
            .attach('file', PNG_BYTES, { filename: 'logo.png', contentType: 'image/png' });
        expect(res.status).toBe(401);
    });

    it('accepts a valid PNG (201) and round-trips via GET /api/assets/:id', async () => {
        const up = await request(app)
            .post('/api/restaurant/assets')
            .set('Authorization', `Bearer ${authToken}`)
            .field('kind', 'logo')
            .attach('file', PNG_BYTES, { filename: 'logo.png', contentType: 'image/png' });

        expect(up.status).toBe(201);
        expect(up.body.data.assetId).toBeTruthy();
        expect(up.body.data.url).toBe(`/api/assets/${up.body.data.assetId}`);
        expect(up.body.data.contentType).toBe('image/png');

        const id = up.body.data.assetId as string;

        // Serve it: correct headers + body.
        const get = await request(app).get(`/api/assets/${id}`);
        expect(get.status).toBe(200);
        expect(get.headers['content-type']).toMatch(/image\/png/);
        expect(get.headers['cache-control']).toBe('public, max-age=31536000, immutable');
        expect(get.headers['etag']).toBe(`"${id}"`);
        expect(get.headers['x-content-type-options']).toBe('nosniff');
        expect(Buffer.from(get.body).length).toBe(PNG_BYTES.length);

        // If-None-Match → 304.
        const notMod = await request(app).get(`/api/assets/${id}`).set('If-None-Match', `"${id}"`);
        expect(notMod.status).toBe(304);
    });
});

describe('GET /api/assets/:id — 404 paths', () => {
    it('returns 404 for a malformed id', async () => {
        const res = await request(app).get('/api/assets/not-an-objectid');
        expect(res.status).toBe(404);
    });

    it('returns 404 for a well-formed but unknown id', async () => {
        const res = await request(app).get('/api/assets/0123456789abcdef01234567');
        expect(res.status).toBe(404);
    });
});
