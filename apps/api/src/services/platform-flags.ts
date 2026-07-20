/**
 * Platform-wide feature flags (super-admin controlled).
 * Stored as a singleton doc { _id: 'global' } in the `platform_flags`
 * collection. All flags default to TRUE when absent. Reads are cached for
 * 30 seconds — storefront config / order routes call this on every request.
 */
import { getDB } from '@restropulse/db';
import type { PlatformFlags } from '@restropulse/shared';
import { PLATFORM_FLAG_KEYS } from '@restropulse/shared';

export const DEFAULT_PLATFORM_FLAGS: PlatformFlags = {
    ordering: true,
    reservations: true,
    dineIn: true,
    campaigns: true,
    contentEngine: true,
    intelligence: true,
};

const CACHE_TTL_MS = 30_000;
let cache: { flags: PlatformFlags; at: number } | null = null;

export function invalidatePlatformFlagsCache(): void {
    cache = null;
}

export async function getPlatformFlags(): Promise<PlatformFlags> {
    if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.flags;
    try {
        const doc = await getDB().collection('platform_flags').findOne({ _id: 'global' as never });
        const flags = { ...DEFAULT_PLATFORM_FLAGS };
        if (doc) {
            for (const key of PLATFORM_FLAG_KEYS) {
                if (typeof (doc as Record<string, unknown>)[key] === 'boolean') {
                    flags[key] = (doc as Record<string, unknown>)[key] as boolean;
                }
            }
        }
        cache = { flags, at: Date.now() };
        return flags;
    } catch {
        return cache?.flags ?? DEFAULT_PLATFORM_FLAGS;
    }
}

export async function setPlatformFlags(patch: Partial<PlatformFlags>): Promise<PlatformFlags> {
    const update: Record<string, boolean> = {};
    for (const key of PLATFORM_FLAG_KEYS) {
        if (typeof patch[key] === 'boolean') update[key] = patch[key] as boolean;
    }
    await getDB().collection('platform_flags').updateOne(
        { _id: 'global' as never },
        { $set: { ...update, updatedAt: new Date() } },
        { upsert: true },
    );
    invalidatePlatformFlagsCache();
    return getPlatformFlags();
}
