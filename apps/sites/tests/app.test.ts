import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from './http.js';
import { ApiUnavailableError, type ApiClient } from '../src/api-client.js';
import { contentSecurityPolicy, createSitesApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { CASH_NOTE } from '../src/render/pages.js';

/** The payment gateway that was removed; spelled as a pattern so the repo holds no mention of it. */
const OLD_GATEWAY = /razor.?pay/i;
import { sampleConfig, sampleMenu } from './fixtures.js';

const config = loadConfig({
    PORT: '3004',
    API_URL: 'http://api.internal:3001',
    PUBLIC_API_URL: 'https://api.restropulse.in',
    SITES_BASE_URL: 'https://sites.restropulse.in',
    SITES_ROOT_DOMAIN: 'restropulse.in',
});

const api = {
    getConfig: vi.fn(),
    getMenu: vi.fn(),
    resolveHost: vi.fn(),
    clear: vi.fn(),
} satisfies ApiClient;

beforeEach(() => {
    api.getConfig.mockReset().mockImplementation(async (slug: string) => (slug === 'bawarchi' ? sampleConfig() : null));
    api.getMenu.mockReset().mockResolvedValue(sampleMenu());
    api.resolveHost.mockReset().mockImplementation(async (host: string) => (host === 'www.bawarchi.in' ? 'bawarchi' : null));
});

const app = createSitesApp(config, api);
const base = 'sites.restropulse.in';

describe('preview at /r/<slug> on the sites host', () => {
    it('serves the home page with security headers and CSP', async () => {
        const res = await get(app, '/r/bawarchi/', { 'Host': base });
        expect(res.status).toBe(200);
        expect(res.type).toBe('text/html');
        expect(res.text).toContain('<link rel="canonical" href="https://sites.restropulse.in/r/bawarchi/">');
        expect(res.text).toContain('href="/r/bawarchi/p/catering"');
        expect(res.headers['cache-control']).toBe('public, max-age=60, s-maxage=60');
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        const csp = res.headers['content-security-policy'];
        const nonce = /'nonce-([^']+)'/.exec(csp)![1];
        expect(res.text).toContain(`nonce="${nonce}"`);
        expect(csp).toContain("connect-src 'self' https://api.restropulse.in;");
        expect(api.getMenu).toHaveBeenCalledWith('bawarchi');
    });

    it('redirects /r/<slug> to the trailing slash', async () => {
        const res = await get(app, '/r/bawarchi', { 'Host': base });
        expect(res.status).toBe(301);
        expect(res.headers.location).toBe('/r/bawarchi/');
    });

    it('serves pages, tracking, robots and sitemap', async () => {
        const page = await get(app, '/r/bawarchi/p/catering', { 'Host': base });
        expect(page.status).toBe(200);
        expect(page.text).toContain('We cater weddings.');
        expect((await get(app, '/r/bawarchi/p/secret', { 'Host': base })).status).toBe(404);

        const track = await get(app, '/r/bawarchi/order/ord1', { 'Host': base });
        expect(track.status).toBe(200);
        expect(track.headers['cache-control']).toBe('no-store');
        expect((await get(app, '/r/bawarchi/order/bad%20id', { 'Host': base })).status).toBe(404);

        const robots = await get(app, '/r/bawarchi/robots.txt', { 'Host': base });
        expect(robots.text).toContain('Sitemap: https://sites.restropulse.in/r/bawarchi/sitemap.xml');
        const sitemap = await get(app, '/r/bawarchi/sitemap.xml', { 'Host': base });
        expect(sitemap.type).toBe('application/xml');
        expect(sitemap.text).toContain('<loc>https://sites.restropulse.in/r/bawarchi/p/catering</loc>');
    });

    it('unknown and malformed slugs are 404', async () => {
        expect((await get(app, '/r/nobody/', { 'Host': base })).status).toBe(404);
        expect((await get(app, '/r/no--pe/', { 'Host': base })).status).toBe(404);
        expect((await get(app, '/r/x/', { 'Host': base })).status).toBe(404);
        expect((await get(app, '/r/nobody/sitemap.xml', { 'Host': base })).status).toBe(404);
        expect((await get(app, '/r/nobody/p/catering', { 'Host': base })).status).toBe(404);
        expect((await get(app, '/r/nobody/order/ord1', { 'Host': base })).status).toBe(404);
    });

    it('/r/<slug> is not served on other hosts', async () => {
        const res = await get(app, '/r/bawarchi/', { 'Host': 'www.bawarchi.in' });
        expect(res.status).toBe(404);
    });

    it('the bare sites host has no site of its own', async () => {
        expect((await get(app, '/', { 'Host': base })).status).toBe(404);
        const robots = await get(app, '/robots.txt', { 'Host': base });
        expect(robots.text).toBe('User-agent: *\nAllow: /\n');
        expect((await get(app, '/', { 'Host': 'localhost:3004' })).status).toBe(404);
    });
});

describe('<slug>.<root> and own domains', () => {
    it('a subdomain serves its restaurant at /', async () => {
        const res = await get(app, '/', { 'Host': 'bawarchi.restropulse.in' });
        expect(res.status).toBe(200);
        expect(res.text).toContain('<link rel="canonical" href="https://bawarchi.restropulse.in/">');
        expect(api.resolveHost).not.toHaveBeenCalled();
    });

    it('an active own domain resolves through the API', async () => {
        const res = await get(app, '/', { 'Host': 'www.bawarchi.in' });
        expect(res.status).toBe(200);
        expect(res.text).toContain('href="/p/catering"');
        expect(api.resolveHost).toHaveBeenCalledWith('www.bawarchi.in');
        const robots = await get(app, '/robots.txt', { 'Host': 'www.bawarchi.in' });
        expect(robots.text).toContain('Sitemap: https://www.bawarchi.in/sitemap.xml');
    });

    it('unknown hosts and bad subdomains are 404', async () => {
        expect((await get(app, '/', { 'Host': 'random.example.com' })).status).toBe(404);
        expect((await get(app, '/', { 'Host': 'ab.restropulse.in' })).status).toBe(404);
    });

    it('an API outage is a 503 page, not a crash', async () => {
        api.resolveHost.mockRejectedValueOnce(new ApiUnavailableError('down'));
        const res = await get(app, '/', { 'Host': 'www.bawarchi.in' });
        expect(res.status).toBe(503);
        expect(res.text).toContain('Back soon');
        expect(res.headers['cache-control']).toBe('no-store');

        api.getConfig.mockRejectedValueOnce(new ApiUnavailableError('down'));
        expect((await get(app, '/r/bawarchi/', { 'Host': base })).status).toBe(503);
    });

    it('other errors are a 500 page', async () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        api.getConfig.mockRejectedValueOnce(new Error('bug'));
        const res = await get(app, '/r/bawarchi/', { 'Host': base });
        expect(res.status).toBe(500);
        expect(res.text).toContain('Back soon');
        spy.mockRestore();
    });

    it('with an edge secret, own domains need the edge header', async () => {
        const locked = createSitesApp({ ...config, edgeSecret: 's3cret' }, api);
        expect((await get(locked, '/', { 'Host': 'www.bawarchi.in' })).status).toBe(404);
        expect((await get(locked, '/', { 'Host': 'www.bawarchi.in', 'X-RestroPulse-Edge': 'wrong!' })).status).toBe(404);
        expect((await get(locked, '/', { 'Host': 'www.bawarchi.in', 'X-RestroPulse-Edge': 's3cret' })).status).toBe(200);
        // Our own wildcard subdomains don't need it.
        expect((await get(locked, '/', { 'Host': 'bawarchi.restropulse.in' })).status).toBe(200);
    });

    it('without a root domain every non-base host is an own domain', async () => {
        const noRoot = createSitesApp({ ...config, rootDomain: null }, api);
        expect((await get(noRoot, '/', { 'Host': 'bawarchi.restropulse.in' })).status).toBe(404);
        expect(api.resolveHost).toHaveBeenCalledWith('bawarchi.restropulse.in');
    });
});

describe('assets and health', () => {
    it('serves the script and stylesheet, 404s anything else', async () => {
        const js = await get(app, '/assets/site.js');
        expect(js.status).toBe(200);
        expect(js.headers['content-type']).toMatch(/javascript/);
        expect(js.headers['cache-control']).toBe('public, max-age=3600');
        expect((await get(app, '/assets/site.css')).status).toBe(200);
        expect(js.text).not.toMatch(OLD_GATEWAY);
        const missing = await get(app, '/assets/nope.js');
        expect(missing.status).toBe(404);
        expect(missing.text).toContain('Page not found');
    });

    it('the script places cash orders only, with no payment gateway steps', async () => {
        const js = (await get(app, '/assets/site.js')).text;
        expect(js).toContain("body.paymentMethod = 'cash';");
        expect(js).not.toMatch(/payment\/(verify|retry)/);
        expect(js).not.toMatch(/PENDING_PAYMENT|PAYMENT_FAILED|data-pay-again/);
        // The tracking page repeats the checkout's cash lines word for word.
        for (const line of Object.values(CASH_NOTE)) expect(js).toContain(`'${line}'`);
    });

        it('health check', async () => {
        const res = await get(app, '/healthz');
        expect(res.text).toBe('ok');
    });

    it('unmatched paths on a tenant host are 404', async () => {
        expect((await get(app, '/nope/deeper', { 'Host': 'bawarchi.restropulse.in' })).status).toBe(404);
    });
});

describe('config', () => {
    it('defaults for local dev', () => {
        const c = loadConfig({});
        expect(c).toMatchObject({ port: 3004, apiUrl: 'http://localhost:3001', publicApiUrl: 'http://localhost:3001', baseUrl: 'http://localhost:3004', baseHost: 'localhost:3004', rootDomain: null, edgeSecret: null, cacheTtlMs: 60000 });
        expect(loadConfig({ SITES_CACHE_TTL_MS: 'abc' }).cacheTtlMs).toBe(60000);
        expect(loadConfig({ SITES_CACHE_TTL_MS: '0', SITES_ROOT_DOMAIN: '.Restropulse.in.' })).toMatchObject({ cacheTtlMs: 0, rootDomain: 'restropulse.in' });
    });

    it('rejects a URL that is not a URL', () => {
        expect(() => loadConfig({ API_URL: 'api' })).toThrow(/API_URL must be a full URL/);
        expect(() => loadConfig({ SITES_BASE_URL: 'nope' })).toThrow(/SITES_BASE_URL/);
    });

    it('CSP allows only our own scripts and API', () => {
        const csp = contentSecurityPolicy('abc', 'https://api.restropulse.in/');
        expect(csp).toContain("script-src 'self' 'nonce-abc';");
        expect(csp).toContain("connect-src 'self' https://api.restropulse.in;");
        expect(csp).toContain("frame-src 'none'");
        expect(csp).toContain("default-src 'none'");
        expect(csp).toContain("frame-ancestors 'none'");
    });

    it('CSP no longer allows any payment gateway', async () => {
        const csp = contentSecurityPolicy('abc', 'https://api.restropulse.in/');
        expect(csp).not.toMatch(OLD_GATEWAY);
        // Only 'self', the nonce and our API origin may appear as sources.
        const hosts = csp.match(/https?:\/\/[^\s;]+/g) ?? [];
        expect(hosts).toEqual(['https://api.restropulse.in']);
        const served = (await get(app, '/r/bawarchi/', { 'Host': base })).headers['content-security-policy'];
        expect(served).not.toMatch(OLD_GATEWAY);
    });
});
