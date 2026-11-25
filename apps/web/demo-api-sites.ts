/**
 * demo-api-sites.ts — DEMO twin for the website/domains client (sitesAPI in api.ts).
 *
 * The demo restaurant's site lives at a [SAMPLE] preview address. Adding a
 * domain shows the real DNS records; the first check "fails" (no record yet)
 * and the second succeeds, so the whole flow can be clicked through.
 * Typed via `typeof realSitesAPI`.
 */
import { isValidCustomHostname, MAX_DOMAINS_PER_RESTAURANT, normalizeHostname } from '@restropulse/shared';
import type { SiteDomain, SiteView } from './api';
import { notifyDemoBackendAction } from './lib/demo';
import { ordersAPI as demoOrders } from './demo-api-orders';
import { perRestaurant } from './lib/demo-restaurants';

const delay = (ms = 120): Promise<void> => new Promise((r) => setTimeout(r, ms));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const CNAME = 'sites.restropulse.in';

interface DemoSitesState {
    domains: SiteDomain[];
    checks: Record<string, number>;
    seq: number;
}


function domain(id: string, hostname: string, token: string): SiteDomain {
    return {
        id,
        hostname,
        status: 'pending_dns',
        sslStatus: 'none',
        records: [
            { type: 'CNAME', name: hostname, value: CNAME },
            { type: 'TXT', name: `_restropulse.${hostname}`, value: `restropulse-verify=${token}` },
        ],
    };
}

// One set of domains per sample restaurant; the signed-in one is served.
const store = perRestaurant((): DemoSitesState => ({ domains: [], checks: {}, seq: 0 }));
const S = store.get;

export function resetDemoSites(): void {
    store.reset();
}

function find(id: string): SiteDomain {
    const d = S().domains.find((x) => x.id === id);
    if (!d) throw new Error('Domain not found');
    return d;
}

export const sitesAPI = {
    getSite: async (): Promise<SiteView> => {
        await delay();
        // The web address is set in ordering settings, so read it from there.
        const { slug } = await demoOrders.getSettings();
        return {
            slug,
            previewUrl: slug ? `https://sites.restropulse.in/r/${slug}` : null,
            subdomainUrl: slug ? `https://${slug}.restropulse.in` : null,
            cnameTarget: CNAME,
            domainsAvailable: true,
            maxDomains: MAX_DOMAINS_PER_RESTAURANT,
            domains: clone(S().domains),
        };
    },
    addDomain: async (hostname: string): Promise<SiteDomain> => {
        await delay();
        const h = normalizeHostname(hostname);
        if (!h || !isValidCustomHostname(h, ['restropulse.in'])) throw new Error('Enter a domain you own, like www.yourrestaurant.in');
        if (S().domains.some((d) => d.hostname === h)) throw new Error('That domain is already connected to a site.');
        if (S().domains.length >= MAX_DOMAINS_PER_RESTAURANT) throw new Error(`You can connect up to ${MAX_DOMAINS_PER_RESTAURANT} domains.`);
        S().seq += 1;
        const d = domain(`demo-dom-${S().seq}`, h, `sample${String(S().seq).padStart(26, '0')}`);
        S().domains.push(d);
        notifyDemoBackendAction();
        return clone(d);
    },
    verifyDomain: async (id: string): Promise<SiteDomain> => {
        await delay();
        const d = find(id);
        if (d.status === 'active') return clone(d);
        S().checks[id] = (S().checks[id] ?? 0) + 1;
        const at = new Date().toISOString();
        if (S().checks[id] < 2) {
            Object.assign(d, { status: 'failed', lastCheckedAt: at, lastError: `No TXT record found at _restropulse.${d.hostname} yet. DNS changes can take up to an hour.` });
        } else {
            Object.assign(d, { status: 'active', sslStatus: 'manual', lastCheckedAt: at, verifiedAt: at });
            delete d.lastError;
        }
        notifyDemoBackendAction();
        return clone(d);
    },
    removeDomain: async (id: string): Promise<void> => {
        await delay();
        find(id);
        S().domains = S().domains.filter((d) => d.id !== id);
        notifyDemoBackendAction();
    },
};

/** Exposed for tests. */
export const _demoSitesState = (): Readonly<DemoSitesState> => S();
