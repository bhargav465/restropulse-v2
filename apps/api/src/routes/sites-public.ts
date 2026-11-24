/**
 * Public tenant resolution for the sites host (Phase 2, M3) -- mounted at /api/sites
 *
 *   GET /resolve?host=<hostname>   { slug } for an active own domain or a <slug>.<root> host
 *
 * The sites host calls this once per new Host header and caches the answer, so a
 * restaurant's own domain serves the same pages as /r/<slug>.
 */

import express, { Response } from 'express';
import { findActiveDomainByHostname, findRestaurantById, findRestaurantBySlug } from '@restropulse/db';
import type { ApiResponse } from '@restropulse/shared';
import { isValidRestaurantSlug, normalizeHostname, slugFromSitesHost } from '@restropulse/shared';
import { handle } from '../middleware/async-handler.js';
import { getSitesConfig } from '../services/sites/sites-config.js';

const router = express.Router();

const notFound = (res: Response) => res.status(404).json({ success: false, error: 'No site for this address' });

router.get('/resolve', handle(async (req, res: Response<ApiResponse>) => {
    const host = normalizeHostname(String(req.query.host ?? ''));
    if (!host || host.length > 253) return notFound(res);

    const { rootDomain } = getSitesConfig();
    const sub = rootDomain ? slugFromSitesHost(host, rootDomain) : null;
    if (sub) {
        if (!isValidRestaurantSlug(sub)) return notFound(res);
        const restaurant = await findRestaurantBySlug(sub);
        if (!restaurant?.slug) return notFound(res);
        res.set('Cache-Control', 'public, max-age=60');
        return res.json({ success: true, data: { slug: restaurant.slug, source: 'subdomain' } });
    }

    const domain = await findActiveDomainByHostname(host);
    if (!domain) return notFound(res);
    const restaurant = await findRestaurantById(domain.restaurantId);
    if (!restaurant?.slug) return notFound(res);
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ success: true, data: { slug: restaurant.slug, source: 'domain' } });
}));

export default router;
