import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { securityHeaders } from '../../src/middleware/security-headers.js';

function app() {
    const a = express();
    a.disable('x-powered-by');
    a.use(securityHeaders());
    a.get('/health', (_req, res) => res.json({ status: 'ok' }));
    return a;
}

describe('securityHeaders', () => {
    it('sets the hardening headers on JSON responses', async () => {
        const res = await request(app()).get('/health');
        expect(res.status).toBe(200);
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
        expect(res.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
        expect(res.headers['referrer-policy']).toBe('no-referrer');
        expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('locks CSP down to nothing, since the API never serves executable HTML', async () => {
        const csp = (await request(app()).get('/health')).headers['content-security-policy'];
        expect(csp).toContain("default-src 'none'");
        expect(csp).toContain("frame-ancestors 'none'");
        expect(csp).not.toContain('script-src');
    });

    it('allows cross-origin subresource loads (SPA <img> of /content and grader photos)', async () => {
        const res = await request(app()).get('/health');
        expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    });
});
