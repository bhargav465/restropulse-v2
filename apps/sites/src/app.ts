/**
 * The sites host: one Express app serving every restaurant's website.
 *
 * Tenant from the request (docs/LAUNCH_ARCHITECTURE B2):
 *   - this host's own name (SITES_BASE_URL)  -> /r/<slug>/... only; always works
 *   - <slug>.<SITES_ROOT_DOMAIN>            -> that restaurant at /
 *   - any other Host                         -> an owner's own domain, looked up
 *                                               via GET /api/sites/resolve (active only)
 * /r/<slug> is not served on other hosts, so nobody's domain can show someone
 * else's restaurant.
 */

import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { NextFunction, Request, Response } from 'express';
import { isValidRestaurantSlug, normalizeHostname, slugFromSitesHost } from '@restropulse/shared';
import { ApiUnavailableError, type ApiClient } from './api-client.js';
import type { SitesHostConfig } from './config.js';
import { renderHome, renderNotFound, renderSitePage, renderTracking, renderUnavailable, visiblePages, type PageContext } from './render/pages.js';
import { robotsTxt, sitemapXml } from './render/sitemap.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PUBLIC_DIR = path.resolve(here, '../public');

interface Tenant {
    slug: string;
    basePath: string;
    siteUrl: string;
}

declare module 'express-serve-static-core' {
    interface Locals {
        nonce: string;
        tenant?: Tenant;
    }
}

export function contentSecurityPolicy(nonce: string, publicApiUrl: string): string {
    const api = new URL(publicApiUrl).origin;
    return [
        "default-src 'none'",
        `script-src 'self' 'nonce-${nonce}'`,
        `style-src 'self' 'nonce-${nonce}'`,
        "img-src 'self' https: data:",
        `connect-src 'self' ${api}`,
        "frame-src 'none'",
        "font-src 'self'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ].join('; ');
}

const SLUG_RE = /^[a-z0-9-]{3,48}$/;
const ORDER_ID_RE = /^[\w-]{1,64}$/;

export function createSitesApp(config: SitesHostConfig, api: ApiClient) {
    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', 1);

    app.use((_req, res, next) => {
        res.locals.nonce = crypto.randomBytes(16).toString('base64');
        res.set({
            'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'strict-origin-when-cross-origin',
            'Strict-Transport-Security': 'max-age=31536000',
            'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        });
        next();
    });

    app.get('/healthz', (_req, res) => res.type('text/plain').send('ok'));
    app.use('/assets', express.static(PUBLIC_DIR, { maxAge: '1h', index: false, fallthrough: false }));

    const hostOf = (req: Request) => normalizeHostname(req.get('host') ?? '') ?? '';
    const baseHostname = normalizeHostname(config.baseHost) ?? '';
    const isBaseHost = (req: Request) => {
        const h = hostOf(req);
        return h === baseHostname || h === 'localhost' || h === '127.0.0.1';
    };
    const proto = (req: Request) => (req.protocol === 'http' && !isBaseHost(req) ? 'https' : req.protocol);

    const send = (res: Response, status: number, html: string, cache = status === 200 ? 'public, max-age=60, s-maxage=60' : 'no-store') => {
        res.status(status)
            .set('Content-Security-Policy', contentSecurityPolicy(res.locals.nonce, config.publicApiUrl))
            .set('Cache-Control', cache)
            .type('html')
            .send(html);
    };

    /** Async route wrapper: an API outage is a 503 page, anything else goes to the error handler. */
    const page = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
        (req: Request, res: Response, next: NextFunction) => {
            fn(req, res, next).catch((err) => {
                if (err instanceof ApiUnavailableError) return send(res, 503, renderUnavailable());
                next(err);
            });
        };

    // ----- Tenant resolution -----

    const fromPath = (req: Request, res: Response, next: NextFunction) => {
        const slug = String(req.params.slug ?? '').toLowerCase();
        if (!isBaseHost(req) || !SLUG_RE.test(slug) || !isValidRestaurantSlug(slug)) return send(res, 404, renderNotFound());
        res.locals.tenant = { slug, basePath: `/r/${slug}`, siteUrl: `${config.baseUrl}/r/${slug}` };
        next();
    };

    const fromHost = page(async (req, res, next) => {
        if (isBaseHost(req)) return send(res, 404, renderNotFound());
        const host = hostOf(req);
        let slug = config.rootDomain ? slugFromSitesHost(host, config.rootDomain) : null;
        if (!slug) {
            // An owner's own domain: only through the edge when a secret is set.
            if (config.edgeSecret) {
                const given = req.get('x-restropulse-edge') ?? '';
                const ok = given.length === config.edgeSecret.length
                    && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(config.edgeSecret));
                if (!ok) return send(res, 404, renderNotFound());
            }
            slug = await api.resolveHost(host);
        }
        if (!slug || !isValidRestaurantSlug(slug)) return send(res, 404, renderNotFound());
        res.locals.tenant = { slug, basePath: '', siteUrl: `${proto(req)}://${host}` };
        next();
    });

    // ----- Pages (same router for /r/<slug> and own hosts) -----

    const site = express.Router({ mergeParams: true });

    async function context(res: Response, withMenu: boolean): Promise<PageContext | null> {
        const t = res.locals.tenant!;
        const [cfg, menu] = await Promise.all([api.getConfig(t.slug), withMenu ? api.getMenu(t.slug) : Promise.resolve(null)]);
        if (!cfg) return null;
        return { config: cfg, menu, siteUrl: t.siteUrl, basePath: t.basePath, nonce: res.locals.nonce, publicApiUrl: config.publicApiUrl };
    }

    site.get('/', page(async (_req, res) => {
        const ctx = await context(res, true);
        if (!ctx) return send(res, 404, renderNotFound());
        send(res, 200, renderHome(ctx));
    }));

    site.get('/p/:page', page(async (req, res) => {
        const ctx = await context(res, false);
        const sitePage = ctx && visiblePages(ctx.config.content).find((p) => p.slug === req.params.page);
        if (!ctx || !sitePage) return send(res, 404, renderNotFound());
        send(res, 200, renderSitePage(ctx, sitePage));
    }));

    site.get('/order/:id', page(async (req, res) => {
        if (!ORDER_ID_RE.test(req.params.id)) return send(res, 404, renderNotFound());
        const ctx = await context(res, false);
        if (!ctx) return send(res, 404, renderNotFound());
        send(res, 200, renderTracking(ctx, req.params.id), 'no-store');
    }));

    site.get('/robots.txt', (_req, res) => {
        const t = res.locals.tenant!;
        res.type('text/plain').set('Cache-Control', 'public, max-age=3600').send(robotsTxt(t.siteUrl));
    });

    site.get('/sitemap.xml', page(async (_req, res) => {
        const ctx = await context(res, false);
        if (!ctx) return send(res, 404, renderNotFound());
        res.type('application/xml').set('Cache-Control', 'public, max-age=3600').send(sitemapXml(ctx.siteUrl, visiblePages(ctx.config.content)));
    }));

    app.get('/r/:slug', (req, res, next) => (req.path.endsWith('/') ? next() : res.redirect(301, `${req.path}/`)));
    app.use('/r/:slug', fromPath, site);

    // The base host's own robots: allow the /r/ previews, no sitemap of its own.
    app.get('/robots.txt', (req, res, next) => {
        if (!isBaseHost(req)) return next();
        res.type('text/plain').send('User-agent: *\nAllow: /\n');
    });
    app.use(fromHost, site);

    app.use((_req, res) => send(res, 404, renderNotFound()));
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
        if (err.status === 404) return send(res, 404, renderNotFound());
        console.error('[sites] unhandled error', err.message);
        send(res, 500, renderUnavailable());
    });

    return app;
}
