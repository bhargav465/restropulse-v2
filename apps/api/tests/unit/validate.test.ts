import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import {
    validateBody,
    validateQuery,
    formatZodError,
    requiredText,
    optionalText,
    clipped,
} from '../../src/middleware/validate.js';

function bodyApp(schema: z.ZodTypeAny, status?: 400 | 422) {
    const app = express();
    app.use(express.json());
    app.post('/x', validateBody(schema, status ? { status } : {}), (req, res) => {
        res.json({ success: true, data: req.body });
    });
    return app;
}

describe('validateBody', () => {
    const Schema = z.object({
        name: requiredText(5, 'name is required'),
        note: optionalText(3),
        count: z.number().int().optional(),
    });

    it('passes parsed data to the handler (trimmed, clipped, unknown keys stripped)', async () => {
        const res = await request(bodyApp(Schema)).post('/x').send({ name: '  abcdefgh ', note: ' hello ', extra: 1 });
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ name: 'abcde', note: 'hel' });
    });

    it('returns 400 with the schema message in the ApiResponse shape', async () => {
        const res = await request(bodyApp(Schema)).post('/x').send({ name: '   ' });
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ success: false, error: 'name is required' });
    });

    it('uses the custom message when the field is missing or the wrong type', async () => {
        const missing = await request(bodyApp(Schema)).post('/x').send({});
        expect(missing.body.error).toBe('name is required');
        const wrongType = await request(bodyApp(Schema)).post('/x').send({ name: 42 });
        expect(wrongType.body.error).toBe('name is required');
    });

    it('honours a 422 status override', async () => {
        const res = await request(bodyApp(Schema, 422)).post('/x').send({});
        expect(res.status).toBe(422);
    });

    it('treats a missing body as an empty object', async () => {
        const app = express();
        app.post('/x', validateBody(z.object({ a: z.string().optional() })), (_req, res) => res.json({ ok: true }));
        const res = await request(app).post('/x');
        expect(res.status).toBe(200);
    });

    it('optionalText turns blanks and non-strings into undefined', async () => {
        const res = await request(bodyApp(z.object({ note: optionalText(10) }))).post('/x').send({ note: 7 });
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({});
    });
});

describe('validateQuery', () => {
    it('stores parsed query on res.locals.query', async () => {
        const app = express();
        app.get('/q', validateQuery(z.object({ limit: z.coerce.number().int().max(100) })), (_req, res) => {
            res.json({ data: res.locals.query });
        });
        const ok = await request(app).get('/q?limit=10');
        expect(ok.body.data).toEqual({ limit: 10 });
        const bad = await request(app).get('/q?limit=500');
        expect(bad.status).toBe(400);
        expect(bad.body.success).toBe(false);
    });
});

describe('formatZodError', () => {
    it('prefixes zod default messages with the field path', () => {
        const r = z.object({ a: z.object({ b: z.string() }) }).safeParse({ a: {} });
        expect(r.success).toBe(false);
        if (!r.success) expect(formatZodError(r.error)).toBe('a.b: Required');
    });

    it('returns custom messages verbatim', () => {
        const r = z.object({ a: z.string().min(3, 'too short') }).safeParse({ a: 'x' });
        if (!r.success) expect(formatZodError(r.error)).toBe('too short');
    });

    it('handles an error with no issues', () => {
        expect(formatZodError(new z.ZodError([]))).toBe('Invalid request.');
    });
});

describe('clipped', () => {
    it('trims then clips without rejecting long input', () => {
        expect(clipped(3).parse('  abcdef  ')).toBe('abc');
    });
});
