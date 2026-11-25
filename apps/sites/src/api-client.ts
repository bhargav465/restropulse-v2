/**
 * Reads a restaurant's public data from the API, with a small in-memory cache
 * so a busy page doesn't hit the API on every request. On an API error a stale
 * answer is served if we have one; a 404 is cached briefly too.
 */

import type { MenuItemAddon, MenuItemVariant, StorefrontContent } from '@restropulse/shared';

export interface SiteRestaurant {
    id: string;
    name: string;
    cuisine: string;
    slug: string;
    phone?: string;
    address?: string;
}

export interface SiteOrdering {
    storeOpen: boolean;
    orderTypes: { delivery: boolean; pickup: boolean; dineIn: boolean };
    delivery: { flatFee: number; minOrder: number; freeAbove?: number };
    taxRatePercent: number;
}

export interface SiteConfig {
    restaurant: SiteRestaurant;
    ordering: SiteOrdering;
    content: StorefrontContent | null;
}

export interface SiteMenuItem {
    id: string;
    categoryId: string;
    name: string;
    description?: string;
    price: number;
    images?: string[];
    isVeg: boolean;
    isBestSeller?: boolean;
    variants?: MenuItemVariant[];
    addons?: MenuItemAddon[];
    availability: 'in_stock' | 'out_of_stock' | 'hidden';
    sortOrder: number;
}

export interface SiteMenu {
    categories: Array<{ id: string; name: string; description?: string; sortOrder: number }>;
    items: SiteMenuItem[];
    offers: Array<{ id: string; title: string; description?: string; summary: string; code?: string; bannerImage?: string }>;
}

export class ApiUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ApiUnavailableError';
    }
}

type Fetch = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ status: number; ok: boolean; json(): Promise<unknown> }>;

interface Entry {
    value: unknown;
    expires: number;
}

const MAX_ENTRIES = 1000;
const NEGATIVE_TTL_MS = 30_000;

export interface ApiClient {
    getConfig(slug: string): Promise<SiteConfig | null>;
    getMenu(slug: string): Promise<SiteMenu | null>;
    resolveHost(host: string): Promise<string | null>;
    clear(): void;
}

export function createApiClient(opts: { apiUrl: string; ttlMs: number; fetchImpl?: Fetch; now?: () => number; timeoutMs?: number }): ApiClient {
    const fetchImpl: Fetch = opts.fetchImpl ?? (globalThis.fetch as unknown as Fetch);
    const now = opts.now ?? Date.now;
    const cache = new Map<string, Entry>();

    function remember(key: string, value: unknown, ttl: number) {
        if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
        cache.set(key, { value, expires: now() + ttl });
    }

    async function getJson<T>(path: string): Promise<T | null> {
        const hit = cache.get(path);
        if (hit && hit.expires > now()) return hit.value as T | null;
        try {
            const res = await fetchImpl(`${opts.apiUrl}${path}`, {
                headers: { accept: 'application/json' },
                signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
            });
            if (res.status === 404) {
                remember(path, null, Math.min(opts.ttlMs, NEGATIVE_TTL_MS));
                return null;
            }
            if (!res.ok) throw new ApiUnavailableError(`API answered ${res.status}`);
            const body = (await res.json()) as { success?: boolean; data?: T };
            if (!body || body.success !== true) throw new ApiUnavailableError('API answered without data');
            remember(path, body.data ?? null, opts.ttlMs);
            return (body.data ?? null) as T | null;
        } catch (err) {
            if (hit) return hit.value as T | null; // stale beats an error page
            if (err instanceof ApiUnavailableError) throw err;
            throw new ApiUnavailableError((err as Error).message);
        }
    }

    const seg = encodeURIComponent;
    return {
        getConfig: (slug) => getJson<SiteConfig>(`/api/storefront/${seg(slug)}`),
        getMenu: (slug) => getJson<SiteMenu>(`/api/storefront/${seg(slug)}/menu`),
        resolveHost: async (host) => (await getJson<{ slug: string }>(`/api/sites/resolve?host=${seg(host)}`))?.slug ?? null,
        clear: () => cache.clear(),
    };
}
