/**
 * Sites host configuration, read once at startup.
 *
 *   PORT               listen port (default 3004)
 *   API_URL            API origin the server fetches from (default http://localhost:3001)
 *   PUBLIC_API_URL     API origin the browser calls for cart and checkout (default API_URL)
 *   SITES_BASE_URL     this host's own origin; /r/<slug> pages are served only here
 *   SITES_ROOT_DOMAIN  wildcard root for <slug>.<root> (optional)
 *   SITES_EDGE_SECRET  when set, requests for an owner's own domain must carry the
 *                      X-RestroPulse-Edge header with this value (ADR 0002), so the
 *                      origin can't be reached around the edge with a spoofed Host
 *   SITES_CACHE_TTL_MS how long API answers are reused (default 60000)
 */

export interface SitesHostConfig {
    port: number;
    apiUrl: string;
    publicApiUrl: string;
    baseUrl: string;
    baseHost: string;
    rootDomain: string | null;
    edgeSecret: string | null;
    cacheTtlMs: number;
}

const trimSlash = (v: string) => v.trim().replace(/\/+$/, '');

function hostOf(url: string, name: string): string {
    try {
        return new URL(url).host.toLowerCase();
    } catch {
        throw new Error(`${name} must be a full URL, e.g. https://sites.restropulse.in`);
    }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SitesHostConfig {
    const port = Number(env.PORT ?? 3004);
    const apiUrl = trimSlash(env.API_URL || 'http://localhost:3001');
    const publicApiUrl = trimSlash(env.PUBLIC_API_URL || apiUrl);
    const baseUrl = trimSlash(env.SITES_BASE_URL || `http://localhost:${port}`);
    hostOf(apiUrl, 'API_URL');
    hostOf(publicApiUrl, 'PUBLIC_API_URL');
    const ttl = Number(env.SITES_CACHE_TTL_MS ?? 60_000);
    return {
        port,
        apiUrl,
        publicApiUrl,
        baseUrl,
        baseHost: hostOf(baseUrl, 'SITES_BASE_URL'),
        rootDomain: (env.SITES_ROOT_DOMAIN ?? '').trim().toLowerCase().replace(/^\.+|\.+$/g, '') || null,
        edgeSecret: (env.SITES_EDGE_SECRET ?? '').trim() || null,
        cacheTtlMs: Number.isFinite(ttl) && ttl >= 0 ? ttl : 60_000,
    };
}
