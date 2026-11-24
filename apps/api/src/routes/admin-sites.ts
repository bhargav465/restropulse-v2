/**
 * Restaurant website + own domains (Phase 2, M3) -- mounted at /api/admin/sites
 *
 *   GET    /                    site addresses (preview, subdomain) + own domains with DNS records to add
 *   POST   /domains             { hostname }  add an own domain (pending_dns)
 *   POST   /domains/:id/verify  check the TXT record; on success the domain goes active
 *   DELETE /domains/:id         remove it (stops routing)
 *
 * Auth: merchant JWT, OWNER or MANAGER (same as the other Website routes).
 */

import crypto from 'crypto';
import express, { Request, Response } from 'express';
import { z } from 'zod';
import {
    deleteRestaurantDomain,
    DuplicateDomainError,
    findRestaurantById,
    findRestaurantDomainById,
    findRestaurantDomains,
    insertRestaurantDomain,
    updateRestaurantDomainStatus,
} from '@restropulse/db';
import type { ApiResponse, RestaurantDomain } from '@restropulse/shared';
import {
    domainVerifyRecordName,
    domainVerifyRecordValue,
    isValidCustomHostname,
    MAX_DOMAINS_PER_RESTAURANT,
    normalizeHostname,
} from '@restropulse/shared';
import { createLogger, trackEvent } from '@restropulse/telemetry/server';
import { handle } from '../middleware/async-handler.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/require-role.js';
import { validateBody } from '../middleware/validate.js';
import { checkDomainOwnership } from '../services/sites/domain-verify.js';
import { getEdgeProvider } from '../services/sites/edge-provider.js';
import { getSitesConfig, reservedRoots, siteUrlsFor } from '../services/sites/sites-config.js';

const log = createLogger('admin-sites');
const router = express.Router();

router.use(requireAuth, requireRole('OWNER', 'MANAGER'));

const rid = (req: Request) => req.user!.restaurantId;

const AddDomainBody = z.object({ hostname: z.string().trim().min(3).max(300) });

/** A domain as the dashboard shows it, with the exact DNS records to add. */
function domainView(d: RestaurantDomain) {
    return {
        id: d.id,
        hostname: d.hostname,
        status: d.status,
        sslStatus: d.sslStatus,
        ...(d.lastError ? { lastError: d.lastError } : {}),
        ...(d.lastCheckedAt ? { lastCheckedAt: d.lastCheckedAt } : {}),
        ...(d.verifiedAt ? { verifiedAt: d.verifiedAt } : {}),
        records: [
            { type: 'CNAME', name: d.hostname, value: d.cnameTarget },
            { type: 'TXT', name: domainVerifyRecordName(d.hostname), value: domainVerifyRecordValue(d.verifyToken) },
        ],
    };
}

const validId = (id: string) => /^[a-f0-9]{24}$|^[\w-]{1,64}$/.test(id);

router.get('/', handle(async (req, res: Response<ApiResponse>) => {
    const [restaurant, domains] = await Promise.all([findRestaurantById(rid(req)), findRestaurantDomains(rid(req))]);
    if (!restaurant) return res.status(404).json({ success: false, error: 'Restaurant not found' });
    const config = getSitesConfig();
    res.json({
        success: true,
        data: {
            slug: restaurant.slug ?? null,
            ...siteUrlsFor(restaurant.slug, config),
            cnameTarget: config.cnameTarget,
            domainsAvailable: Boolean(config.cnameTarget),
            maxDomains: MAX_DOMAINS_PER_RESTAURANT,
            domains: domains.map(domainView),
        },
    });
}));

router.post('/domains', validateBody(AddDomainBody), handle(async (req, res: Response<ApiResponse>) => {
    const config = getSitesConfig();
    if (!config.cnameTarget) {
        return res.status(503).json({ success: false, error: 'Own domains are not available yet.' });
    }
    const hostname = normalizeHostname((req.body as z.infer<typeof AddDomainBody>).hostname);
    if (!hostname || !isValidCustomHostname(hostname, reservedRoots(config))) {
        return res.status(400).json({ success: false, error: 'Enter a domain you own, like www.yourrestaurant.in' });
    }
    const existing = await findRestaurantDomains(rid(req));
    if (existing.length >= MAX_DOMAINS_PER_RESTAURANT) {
        return res.status(409).json({ success: false, error: `You can connect up to ${MAX_DOMAINS_PER_RESTAURANT} domains.` });
    }
    try {
        const domain = await insertRestaurantDomain({
            restaurantId: rid(req),
            hostname,
            status: 'pending_dns',
            verifyToken: crypto.randomBytes(16).toString('hex'),
            cnameTarget: config.cnameTarget,
            sslStatus: 'none',
        });
        trackEvent('site_domain_added', { restaurantId: rid(req) });
        res.status(201).json({ success: true, data: domainView(domain) });
    } catch (err) {
        if (err instanceof DuplicateDomainError) {
            return res.status(409).json({ success: false, error: 'That domain is already connected to a site.' });
        }
        throw err;
    }
}));

router.post('/domains/:id/verify', handle(async (req, res: Response<ApiResponse>) => {
    const id = req.params.id;
    const domain = validId(id) ? await findRestaurantDomainById(rid(req), id) : null;
    if (!domain) return res.status(404).json({ success: false, error: 'Domain not found' });
    if (domain.status === 'active') return res.json({ success: true, data: domainView(domain) });

    await updateRestaurantDomainStatus(rid(req), id, { status: 'verifying' });
    const check = await checkDomainOwnership(domain.hostname, domain.verifyToken, domain.cnameTarget);
    if (!check.verified) {
        const failed = await updateRestaurantDomainStatus(rid(req), id, { status: 'failed', lastError: check.reason });
        return res.json({ success: true, data: domainView(failed ?? { ...domain, status: 'failed', lastError: check.reason }) });
    }

    let sslStatus: RestaurantDomain['sslStatus'] = 'pending';
    try {
        sslStatus = (await getEdgeProvider().addHostname(domain.hostname)).sslStatus;
    } catch (err) {
        // Ownership is proven; TLS can be retried at the edge without the owner.
        log.error({ restaurantId: rid(req), error: (err as Error).message }, 'Edge provider failed to add hostname');
        sslStatus = 'failed';
    }
    const active = await updateRestaurantDomainStatus(rid(req), id, {
        status: 'active',
        sslStatus,
        lastError: check.cnameOk ? null : `Ownership confirmed. Point ${domain.hostname} at ${domain.cnameTarget} so visitors reach your site.`,
        verifiedAt: new Date(),
    });
    trackEvent('site_domain_verified', { restaurantId: rid(req), cnameOk: String(check.cnameOk) });
    res.json({ success: true, data: domainView(active ?? { ...domain, status: 'active', sslStatus }) });
}));

router.delete('/domains/:id', handle(async (req, res: Response<ApiResponse>) => {
    const id = req.params.id;
    const domain = validId(id) ? await findRestaurantDomainById(rid(req), id) : null;
    if (!domain) return res.status(404).json({ success: false, error: 'Domain not found' });
    await deleteRestaurantDomain(rid(req), id);
    if (domain.status === 'active') {
        try {
            await getEdgeProvider().removeHostname(domain.hostname);
        } catch (err) {
            log.error({ restaurantId: rid(req), error: (err as Error).message }, 'Edge provider failed to remove hostname');
        }
    }
    trackEvent('site_domain_removed', { restaurantId: rid(req) });
    res.json({ success: true });
}));

export default router;
