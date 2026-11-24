/**
 * TLS + routing at the edge for owners' own domains (ADR 0002).
 *
 * The approved edge is Cloudflare for SaaS; its adapter needs a Cloudflare
 * account and API token that don't exist yet, so the only provider today is
 * `manual`: a verified domain is marked active and `sslStatus: 'manual'`, and an
 * engineer adds the hostname at the edge. A Cloudflare adapter implements the
 * same two calls and is picked by SITES_EDGE_PROVIDER.
 */

import type { RestaurantDomainSslStatus } from '@restropulse/shared';

export interface EdgeProvider {
    readonly id: string;
    /** Start serving the hostname (issue TLS). Returns the TLS state to store. */
    addHostname(hostname: string): Promise<{ sslStatus: RestaurantDomainSslStatus }>;
    /** Stop serving the hostname. Must not throw when it was never added. */
    removeHostname(hostname: string): Promise<void>;
}

export const manualEdgeProvider: EdgeProvider = {
    id: 'manual',
    async addHostname() {
        return { sslStatus: 'manual' };
    },
    async removeHostname() {
        /* nothing to undo */
    },
};

let override: EdgeProvider | null = null;

/** Test seam. */
export function _setEdgeProvider(p: EdgeProvider | null): void {
    override = p;
}

export function getEdgeProvider(): EdgeProvider {
    return override ?? manualEdgeProvider;
}
