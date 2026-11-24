/**
 * Restaurant websites (Phase 2 M3): own-domain admin routes, public tenant
 * resolution, DNS ownership check, sites config and the CORS split.
 * @restropulse/db is an in-memory fake; DNS is injected or stubbed.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import type { Restaurant, RestaurantDomain } from '@restropulse/shared';

const state = {
    restaurants: [] as Restaurant[],
    domains: [] as RestaurantDomain[],
    seq: 0,
};
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
class DuplicateDomainError extends Error {}

const fakeDb = {
    findRestaurantById: vi.fn(async (id: string) => clone(state.restaurants.find((r) => r.id === id) ?? null)),
    findRestaurantBySlug: vi.fn(async (slug: string) => clone(state.restaurants.find((r) => r.slug === slug) ?? null)),
    findRestaurantDomains: vi.fn(async (rid: string) => clone(state.domains.filter((d) => d.restaurantId === rid))),
    findRestaurantDomainById: vi.fn(async (rid: string, id: string) =>
        clone(state.domains.find((d) => d.restaurantId === rid && d.id === id) ?? null)),
    findActiveDomainByHostname: vi.fn(async (h: string) => clone(state.domains.find((d) => d.hostname === h && d.status === 'active') ?? null)),
    insertRestaurantDomain: vi.fn(async (d: Omit<RestaurantDomain, 'id'>) => {
        if (state.domains.some((x) => x.hostname === d.hostname)) throw new DuplicateDomainError();
        const row = { ...clone(d), id: `dom${++state.seq}`, createdAt: new Date().toISOString() } as RestaurantDomain;
        state.domains.push(row);
        return clone(row);
    }),
    updateRestaurantDomainStatus: vi.fn(async (rid: string, id: string, u: Record<string, unknown>) => {
        const d = state.domains.find((x) => x.restaurantId === rid && x.id === id);
        if (!d) return null;
        for (const [k, v] of Object.entries(u)) {
            if (v === null) delete (d as unknown as Record<string, unknown>)[k];
            else if (v !== undefined) (d as unknown as Record<string, unknown>)[k] = v instanceof Date ? v.toISOString() : v;
        }
        return clone(d);
    }),
    deleteRestaurantDomain: vi.fn(async (rid: string, id: string) => {
        const before = state.domains.length;
        state.domains = state.domains.filter((d) => !(d.restaurantId === rid && d.id === id));
        return state.domains.length < before;
    }),
};

vi.mock('@restropulse/db', async (importOriginal) => {
    const actual = await importOriginal() as Record<string, unknown>;
    return { ...actual, ...fakeDb, DuplicateDomainError };
});

vi.mock('@restropulse/telemetry/server', () => {
    const noop = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    return { createLogger: vi.fn(() => noop), trackEvent: vi.fn() };
});

const dnsCheck = vi.hoisted(() => ({ checkDomainOwnership: vi.fn() }));
vi.mock('../../src/services/sites/domain-verify.js', async (importOriginal) => {
    const actual = await importOriginal() as Record<string, unknown>;
    return { ...actual, ...dnsCheck };
});

const { generateTokens } = await import('../../src/services/jwt.js');
const { default: adminSitesRoutes } = await import('../../src/routes/admin-sites.js');
const { default: sitesPublicRoutes } = await import('../../src/routes/sites-public.js');
const edge = await import('../../src/services/sites/edge-provider.js');
const realVerify = await vi.importActual<typeof import('../../src/services/sites/domain-verify.js')>('../../src/services/sites/domain-verify.js');
const { getSitesConfig, reservedRoots, siteUrlsFor } = await import('../../src/services/sites/sites-config.js');
const { corsPolicy } = await import('../../src/middleware/cors-policy.js');

const app = express();
app.use(express.json());
app.use('/api/admin/sites', adminSitesRoutes);
app.use('/api/sites', sitesPublicRoutes);
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ success: false, error: err.message });
});

const owner = `Bearer ${generateTokens('u1', '+910000000000', 'r1', 'OWNER').accessToken}`;
const staff = `Bearer ${generateTokens('u2', '+910000000001', 'r1', 'STAFF' as 'OWNER').accessToken}`;
const other = `Bearer ${generateTokens('u3', '+910000000002', 'r2', 'OWNER').accessToken}`;

const ENV_KEYS = ['SITES_BASE_URL', 'SITES_ROOT_DOMAIN', 'SITES_CNAME_TARGET'] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
    state.restaurants = [
        { id: 'r1', name: 'Bawarchi', cuisine: 'Biryani', slug: 'bawarchi' } as Restaurant,
        { id: 'r2', name: 'Other', cuisine: 'Cafe' } as Restaurant,
    ];
    state.domains = [];
    state.seq = 0;
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    process.env.SITES_BASE_URL = 'https://sites.restropulse.in/';
    process.env.SITES_ROOT_DOMAIN = 'restropulse.in';
    delete process.env.SITES_CNAME_TARGET;
    dnsCheck.checkDomainOwnership.mockReset();
    edge._setEdgeProvider(null);
});

afterEach(() => {
    for (const k of ENV_KEYS) {
        if (savedEnv[k] === undefined) delete process.env[k];
        else process.env[k] = savedEnv[k];
    }
});

async function addDomain(hostname = 'www.bawarchi.in', auth = owner) {
    return request(app).post('/api/admin/sites/domains').set('Authorization', auth).send({ hostname });
}

describe('GET /api/admin/sites', () => {
    test('shows the site addresses and DNS records', async () => {
        await addDomain();
        const res = await request(app).get('/api/admin/sites').set('Authorization', owner);
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({
            slug: 'bawarchi',
            previewUrl: 'https://sites.restropulse.in/r/bawarchi',
            subdomainUrl: 'https://bawarchi.restropulse.in',
            cnameTarget: 'sites.restropulse.in',
            domainsAvailable: true,
            maxDomains: 3,
        });
        const [d] = res.body.data.domains;
        expect(d.hostname).toBe('www.bawarchi.in');
        expect(d.records[0]).toEqual({ type: 'CNAME', name: 'www.bawarchi.in', value: 'sites.restropulse.in' });
        expect(d.records[1].name).toBe('_restropulse.www.bawarchi.in');
        expect(d.records[1].value).toMatch(/^restropulse-verify=[a-f0-9]{32}$/);
        expect(d).not.toHaveProperty('verifyToken');
    });

    test('no slug and no sites host: nothing is live yet', async () => {
        delete process.env.SITES_BASE_URL;
        delete process.env.SITES_ROOT_DOMAIN;
        const res = await request(app).get('/api/admin/sites').set('Authorization', other);
        expect(res.body.data).toMatchObject({ slug: null, previewUrl: null, subdomainUrl: null, cnameTarget: null, domainsAvailable: false });
    });

    test('needs OWNER or MANAGER', async () => {
        expect((await request(app).get('/api/admin/sites')).status).toBe(401);
        expect((await request(app).get('/api/admin/sites').set('Authorization', staff)).status).toBe(403);
    });

    test('404 when the restaurant is gone', async () => {
        state.restaurants = [];
        expect((await request(app).get('/api/admin/sites').set('Authorization', owner)).status).toBe(404);
    });
});

describe('POST /api/admin/sites/domains', () => {
    test('normalises what the owner typed', async () => {
        const res = await addDomain('https://WWW.Bawarchi.in/menu');
        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ hostname: 'www.bawarchi.in', status: 'pending_dns', sslStatus: 'none' });
    });

    test('rejects junk, internal names and our own domains', async () => {
        for (const h of ['localhost', '10.0.0.1', 'not a domain', 'demo.restropulse.in', 'sites.restropulse.in']) {
            const res = await addDomain(h);
            expect(res.status, h).toBe(400);
        }
        expect((await addDomain('')).status).toBe(400);
    });

    test('one domain can only serve one site', async () => {
        await addDomain('bawarchi.in');
        const res = await addDomain('bawarchi.in', other);
        expect(res.status).toBe(409);
        expect(res.body.error).toMatch(/already connected/);
    });

    test('caps domains per restaurant', async () => {
        for (const h of ['a-one.in', 'a-two.in', 'a-three.in']) expect((await addDomain(h)).status).toBe(201);
        const res = await addDomain('a-four.in');
        expect(res.status).toBe(409);
        expect(res.body.error).toMatch(/up to 3/);
    });

    test('503 until a sites host is configured', async () => {
        delete process.env.SITES_BASE_URL;
        expect((await addDomain()).status).toBe(503);
    });

    test('rethrows unexpected db errors', async () => {
        fakeDb.insertRestaurantDomain.mockRejectedValueOnce(new Error('boom'));
        expect((await addDomain()).status).toBe(500);
    });
});

describe('POST /api/admin/sites/domains/:id/verify', () => {
    test('a matching TXT record makes the domain active', async () => {
        const id = (await addDomain()).body.data.id;
        dnsCheck.checkDomainOwnership.mockResolvedValue({ verified: true, cnameOk: true });
        const res = await request(app).post(`/api/admin/sites/domains/${id}/verify`).set('Authorization', owner);
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ status: 'active', sslStatus: 'manual' });
        expect(res.body.data.lastError).toBeUndefined();
        expect(res.body.data.verifiedAt).toBeTruthy();
        // Already active: no second DNS check.
        await request(app).post(`/api/admin/sites/domains/${id}/verify`).set('Authorization', owner);
        expect(dnsCheck.checkDomainOwnership).toHaveBeenCalledTimes(1);
    });

    test('verified without the CNAME still activates and says what to fix', async () => {
        const id = (await addDomain()).body.data.id;
        dnsCheck.checkDomainOwnership.mockResolvedValue({ verified: true, cnameOk: false });
        const res = await request(app).post(`/api/admin/sites/domains/${id}/verify`).set('Authorization', owner);
        expect(res.body.data.status).toBe('active');
        expect(res.body.data.lastError).toMatch(/Point www.bawarchi.in at sites.restropulse.in/);
    });

    test('a missing record fails with the reason', async () => {
        const id = (await addDomain()).body.data.id;
        dnsCheck.checkDomainOwnership.mockResolvedValue({ verified: false, cnameOk: false, reason: 'No TXT record found' });
        const res = await request(app).post(`/api/admin/sites/domains/${id}/verify`).set('Authorization', owner);
        expect(res.body.data).toMatchObject({ status: 'failed', lastError: 'No TXT record found' });
    });

    test('falls back to the row when the update returns nothing', async () => {
        const id = (await addDomain()).body.data.id;
        dnsCheck.checkDomainOwnership.mockResolvedValue({ verified: false, cnameOk: false, reason: 'nope' });
        fakeDb.updateRestaurantDomainStatus.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
        const res = await request(app).post(`/api/admin/sites/domains/${id}/verify`).set('Authorization', owner);
        expect(res.body.data).toMatchObject({ status: 'failed', lastError: 'nope' });

        dnsCheck.checkDomainOwnership.mockResolvedValue({ verified: true, cnameOk: true });
        fakeDb.updateRestaurantDomainStatus.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
        const ok = await request(app).post(`/api/admin/sites/domains/${id}/verify`).set('Authorization', owner);
        expect(ok.body.data).toMatchObject({ status: 'active', sslStatus: 'manual' });
    });

    test('an edge failure keeps the domain active with TLS failed', async () => {
        const id = (await addDomain()).body.data.id;
        dnsCheck.checkDomainOwnership.mockResolvedValue({ verified: true, cnameOk: true });
        edge._setEdgeProvider({ id: 'x', addHostname: vi.fn().mockRejectedValue(new Error('cf down')), removeHostname: vi.fn() });
        const res = await request(app).post(`/api/admin/sites/domains/${id}/verify`).set('Authorization', owner);
        expect(res.body.data).toMatchObject({ status: 'active', sslStatus: 'failed' });
    });

    test("can't touch another restaurant's domain", async () => {
        const id = (await addDomain()).body.data.id;
        expect((await request(app).post(`/api/admin/sites/domains/${id}/verify`).set('Authorization', other)).status).toBe(404);
        expect((await request(app).post('/api/admin/sites/domains/bad%20id/verify').set('Authorization', owner)).status).toBe(404);
    });
});

describe('DELETE /api/admin/sites/domains/:id', () => {
    test('removes a pending domain without touching the edge', async () => {
        const removeHostname = vi.fn();
        edge._setEdgeProvider({ id: 'x', addHostname: vi.fn(), removeHostname });
        const id = (await addDomain()).body.data.id;
        const res = await request(app).delete(`/api/admin/sites/domains/${id}`).set('Authorization', owner);
        expect(res.status).toBe(200);
        expect(state.domains).toHaveLength(0);
        expect(removeHostname).not.toHaveBeenCalled();
    });

    test('removing an active domain tells the edge, and survives an edge error', async () => {
        const removeHostname = vi.fn().mockRejectedValue(new Error('cf down'));
        edge._setEdgeProvider({ id: 'x', addHostname: vi.fn().mockResolvedValue({ sslStatus: 'pending' }), removeHostname });
        const id = (await addDomain()).body.data.id;
        dnsCheck.checkDomainOwnership.mockResolvedValue({ verified: true, cnameOk: true });
        await request(app).post(`/api/admin/sites/domains/${id}/verify`).set('Authorization', owner);
        const res = await request(app).delete(`/api/admin/sites/domains/${id}`).set('Authorization', owner);
        expect(res.status).toBe(200);
        expect(removeHostname).toHaveBeenCalledWith('www.bawarchi.in');
    });

    test('404 for an unknown domain', async () => {
        expect((await request(app).delete('/api/admin/sites/domains/nope').set('Authorization', owner)).status).toBe(404);
        expect((await request(app).delete('/api/admin/sites/domains/bad%20id').set('Authorization', owner)).status).toBe(404);
    });
});

describe('GET /api/sites/resolve', () => {
    test('a <slug>.<root> host resolves to that restaurant', async () => {
        const res = await request(app).get('/api/sites/resolve').query({ host: 'Bawarchi.restropulse.in' });
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ slug: 'bawarchi', source: 'subdomain' });
        expect(res.headers['cache-control']).toBe('public, max-age=60');
    });

    test('unknown or invalid subdomains are 404', async () => {
        expect((await request(app).get('/api/sites/resolve').query({ host: 'nobody.restropulse.in' })).status).toBe(404);
        expect((await request(app).get('/api/sites/resolve').query({ host: 'ab.restropulse.in' })).status).toBe(404);
    });

    test('an active own domain resolves; a pending one does not', async () => {
        const id = (await addDomain()).body.data.id;
        expect((await request(app).get('/api/sites/resolve').query({ host: 'www.bawarchi.in' })).status).toBe(404);
        dnsCheck.checkDomainOwnership.mockResolvedValue({ verified: true, cnameOk: true });
        await request(app).post(`/api/admin/sites/domains/${id}/verify`).set('Authorization', owner);
        const res = await request(app).get('/api/sites/resolve').query({ host: 'www.bawarchi.in:443' });
        expect(res.body.data).toEqual({ slug: 'bawarchi', source: 'domain' });
    });

    test('an own domain whose restaurant lost its slug is 404', async () => {
        state.domains.push({ id: 'd9', restaurantId: 'r2', hostname: 'other.in', status: 'active' } as RestaurantDomain);
        expect((await request(app).get('/api/sites/resolve').query({ host: 'other.in' })).status).toBe(404);
    });

    test('works without a root domain configured, and rejects empty hosts', async () => {
        delete process.env.SITES_ROOT_DOMAIN;
        expect((await request(app).get('/api/sites/resolve').query({ host: 'bawarchi.restropulse.in' })).status).toBe(404);
        expect((await request(app).get('/api/sites/resolve')).status).toBe(404);
        expect((await request(app).get('/api/sites/resolve').query({ host: `${'a'.repeat(260)}.in` })).status).toBe(404);
    });
});

describe('checkDomainOwnership', () => {
    const dns = (txt: string[][] | Error, cname: string[] | Error = ['sites.restropulse.in.']) => ({
        resolveTxt: vi.fn(async () => { if (txt instanceof Error) throw txt; return txt; }),
        resolveCname: vi.fn(async () => { if (cname instanceof Error) throw cname; return cname; }),
    });
    const err = (code: string) => Object.assign(new Error(code), { code });

    test('matches the token, joining split TXT strings', async () => {
        const r = await realVerify.checkDomainOwnership('www.bawarchi.in', 'tok', 'sites.restropulse.in',
            dns([['other'], ['restropulse-', 'verify=tok']]));
        expect(r).toEqual({ verified: true, cnameOk: true });
    });

    test('wrong value, missing record and missing CNAME', async () => {
        const wrong = await realVerify.checkDomainOwnership('a.in', 'tok', 'sites.restropulse.in', dns([['restropulse-verify=old']], ['elsewhere.com']));
        expect(wrong).toMatchObject({ verified: false, cnameOk: false });
        expect(wrong.reason).toMatch(/doesn't match yet/);
        const missing = await realVerify.checkDomainOwnership('a.in', 'tok', 'sites.restropulse.in', dns(err('ENOTFOUND'), err('ENODATA')));
        expect(missing.reason).toMatch(/No TXT record found at _restropulse.a.in/);
        const noTarget = await realVerify.checkDomainOwnership('a.in', 'tok', null, dns([['restropulse-verify=tok']]));
        expect(noTarget).toEqual({ verified: true, cnameOk: false });
    });

    test('a DNS outage is not reported as a missing record', async () => {
        const r = await realVerify.checkDomainOwnership('a.in', 'tok', 'x', dns(err('ETIMEOUT')));
        expect(r.reason).toMatch(/could not reach DNS/);
        const noCode = await realVerify.checkDomainOwnership('a.in', 'tok', 'x', dns(new Error('weird')));
        expect(noCode.verified).toBe(false);
    });

    test('builds a default resolver when none is passed', async () => {
        const r = await realVerify.checkDomainOwnership('does-not-exist.invalid', 'tok', null);
        expect(r.verified).toBe(false);
    });
});

describe('sites config', () => {
    test('reads env, trims and derives the CNAME target', () => {
        process.env.SITES_BASE_URL = 'https://sites.example.com///';
        process.env.SITES_ROOT_DOMAIN = '.Example.com.';
        expect(getSitesConfig()).toEqual({ baseUrl: 'https://sites.example.com', rootDomain: 'example.com', cnameTarget: 'sites.example.com' });
        process.env.SITES_CNAME_TARGET = 'Edge.Example.net';
        expect(getSitesConfig().cnameTarget).toBe('edge.example.net');
        expect(reservedRoots()).toEqual(expect.arrayContaining(['restropulse.in', 'example.com', 'edge.example.net', 'sites.example.com']));
    });

    test('ignores a base URL that is not a URL', () => {
        process.env.SITES_BASE_URL = 'not a url';
        delete process.env.SITES_ROOT_DOMAIN;
        expect(getSitesConfig()).toEqual({ baseUrl: null, rootDomain: null, cnameTarget: null });
        expect(reservedRoots()).toEqual(['restropulse.in']);
        expect(siteUrlsFor('x')).toEqual({ previewUrl: null, subdomainUrl: null });
        expect(siteUrlsFor(undefined, { baseUrl: 'https://s.in', rootDomain: 'r.in', cnameTarget: null })).toEqual({ previewUrl: null, subdomainUrl: null });
    });

    test('the manual edge provider does nothing but report manual TLS', async () => {
        expect(edge.getEdgeProvider().id).toBe('manual');
        expect(await edge.manualEdgeProvider.addHostname('a.in')).toEqual({ sslStatus: 'manual' });
        await expect(edge.manualEdgeProvider.removeHostname('a.in')).resolves.toBeUndefined();
    });
});

describe('corsPolicy', () => {
    const corsApp = express();
    corsApp.use(corsPolicy(['https://app.restropulse.in']));
    corsApp.get('/api/storefront/x', (_req, res) => res.json({ ok: true }));
    corsApp.get('/api/restaurant/x', (_req, res) => res.json({ ok: true }));

    test('storefront routes are open to any site, without credentials', async () => {
        const res = await request(corsApp).get('/api/storefront/x').set('Origin', 'https://www.bawarchi.in');
        expect(res.headers['access-control-allow-origin']).toBe('*');
        expect(res.headers['access-control-allow-credentials']).toBeUndefined();
        const pre = await request(corsApp).options('/api/storefront/x')
            .set('Origin', 'https://www.bawarchi.in')
            .set('Access-Control-Request-Method', 'POST')
            .set('Access-Control-Request-Headers', 'content-type,idempotency-key');
        expect(pre.status).toBe(204);
        expect(pre.headers['access-control-allow-headers']).toMatch(/idempotency-key/);
    });

    test('dashboard routes keep the origin list with credentials', async () => {
        const ok = await request(corsApp).get('/api/restaurant/x').set('Origin', 'https://app.restropulse.in');
        expect(ok.headers['access-control-allow-origin']).toBe('https://app.restropulse.in');
        expect(ok.headers['access-control-allow-credentials']).toBe('true');
        const blocked = await request(corsApp).get('/api/restaurant/x').set('Origin', 'https://www.bawarchi.in');
        expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
    });
});
