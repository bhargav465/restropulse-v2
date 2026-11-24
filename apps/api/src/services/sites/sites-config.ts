/**
 * Where restaurant websites live (Phase 2, M3). Read from env on every call so
 * tests and slot settings can change them without a restart of the module.
 *
 *   SITES_BASE_URL     origin of the sites host, e.g. https://sites.restropulse.in
 *                      (each restaurant is always at <base>/r/<slug>)
 *   SITES_ROOT_DOMAIN  wildcard root for <slug>.<root>, e.g. restropulse.in (optional
 *                      until *.restropulse.in DNS exists)
 *   SITES_CNAME_TARGET where an owner's CNAME points; defaults to the base URL's host
 *
 * ASSUMPTION: until Bhargav picks the zone (ADR 0002 open question) these stay
 * unset in every slot and the Website screen just shows "not live yet".
 */

export interface SitesConfig {
    baseUrl: string | null;
    rootDomain: string | null;
    cnameTarget: string | null;
}

function hostOf(url: string): string | null {
    try {
        return new URL(url).hostname || null;
    } catch {
        return null;
    }
}

export function getSitesConfig(): SitesConfig {
    const base = (process.env.SITES_BASE_URL ?? '').trim().replace(/\/+$/, '');
    const baseUrl = base && hostOf(base) ? base : null;
    const rootDomain = (process.env.SITES_ROOT_DOMAIN ?? '').trim().toLowerCase().replace(/^\.+|\.+$/g, '') || null;
    const cnameTarget = (process.env.SITES_CNAME_TARGET ?? '').trim().toLowerCase() || (baseUrl ? hostOf(baseUrl) : null);
    return { baseUrl, rootDomain, cnameTarget };
}

/** Domains an owner may not bring because we serve them ourselves. */
export function reservedRoots(config: SitesConfig = getSitesConfig()): string[] {
    const roots = new Set<string>(['restropulse.in']);
    if (config.rootDomain) roots.add(config.rootDomain);
    if (config.cnameTarget) roots.add(config.cnameTarget);
    if (config.baseUrl) {
        const h = hostOf(config.baseUrl);
        if (h) roots.add(h);
    }
    return [...roots];
}

export function siteUrlsFor(slug: string | undefined, config: SitesConfig = getSitesConfig()) {
    return {
        previewUrl: slug && config.baseUrl ? `${config.baseUrl}/r/${slug}` : null,
        subdomainUrl: slug && config.rootDomain ? `https://${slug}.${config.rootDomain}` : null,
    };
}
