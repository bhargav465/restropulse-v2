/**
 * Nearby sweep + New-Openings first-seen registry (Brief 08 §1.4).
 *
 * One 7 km sweep per restaurant upserts `nearby_sightings`:
 *   - INSERT (first ever sighting) stamps `firstSeenAt`, `ratingAtFirstSeen`,
 *     `reviewsAtFirstSeen`, and `lastSeenAt`.
 *   - UPDATE (place seen before) only refreshes `lastSeenAt` (and drifting
 *     name/distance), never the first-seen baseline.
 * A newly-inserted place within 5 km emits `intelligence.alert.new_competitor`
 * exactly once (only on the insert path — a re-sighting never re-alerts).
 *
 * The sweep source is injectable (`searchNearby`). The default reuses the
 * `competitor_cache` the api already warms (haversine-filtered to 7 km), so the
 * worker performs zero extra Places calls in the common path; the `places_calls`
 * counter still increments once per sweep for cost monitoring.
 */

import { getNearbySightingsCollection, getDB, insertAnalyticsEvent } from '@restropulse/db';
import type { NearbyPlaceSighting } from '@restropulse/shared';
import { incrementCounter } from '@restropulse/telemetry/server';

/** New-competitor alerts fire for insertions within this radius (Brief 08 §1.4). */
export const NEW_COMPETITOR_RADIUS_KM = 5;

/** The 7 km sweep radius (matches the api's `getNearbyRestaurants`). */
export const SWEEP_RADIUS_KM = 7;

export const NEW_COMPETITOR_EVENT = 'intelligence.alert.new_competitor';
export const WORKER_SESSION_ID = 'system:intelligence-worker';

/** One place returned by a sweep. */
export interface NearbyPlace {
    placeId: string;
    name: string;
    lat: number;
    lng: number;
    distanceKm: number;
    rating: number;
    reviewCount: number;
    cuisine?: string;
}

/** Sweep origin + tenant identity. */
export interface SweepOrigin {
    restaurantId: string;
    lat: number;
    lng: number;
}

/** Finds places near an origin (≤ 7 km). Injectable; defaults to the cache reader. */
export type NearbySearch = (origin: SweepOrigin) => Promise<NearbyPlace[]>;

export interface SweepDeps {
    searchNearby?: NearbySearch;
    now?: Date;
}

export interface SweepStats {
    seen: number;
    inserted: number;
    alerts: number;
}

const EARTH_RADIUS_KM = 6371;

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(bLat - aLat);
    const dLng = toRad(bLng - aLng);
    const lat1 = toRad(aLat);
    const lat2 = toRad(bLat);
    const h =
        Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
    return EARTH_RADIUS_KM * 2 * Math.asin(Math.sqrt(h));
}

interface CachePayload {
    id?: string;
    displayName?: { text?: string };
    rating?: number;
    userRatingCount?: number;
    location?: { latitude?: number; longitude?: number };
}

/**
 * Default sweep: haversine-filter the api-warmed `competitor_cache` to 7 km.
 * Zero extra Places calls — the api's scan already populated the cache.
 */
export const defaultNearbySearch: NearbySearch = async (origin) => {
    const docs = await getDB().collection('competitor_cache').find({}).toArray();
    const places: NearbyPlace[] = [];
    for (const doc of docs) {
        const p = doc.payload as CachePayload | undefined;
        const lat = p?.location?.latitude;
        const lng = p?.location?.longitude;
        const placeId = p?.id ?? (doc.placeId as string | undefined);
        if (typeof lat !== 'number' || typeof lng !== 'number' || !placeId) continue;
        const distanceKm = Number(haversineKm(origin.lat, origin.lng, lat, lng).toFixed(2));
        if (distanceKm > SWEEP_RADIUS_KM) continue;
        places.push({
            placeId,
            name: p?.displayName?.text ?? '',
            lat,
            lng,
            distanceKm,
            rating: p?.rating ?? 0,
            reviewCount: p?.userRatingCount ?? 0,
        });
    }
    return places;
};

/**
 * Sweep one restaurant: upsert every nearby place into `nearby_sightings`,
 * emitting `new_competitor` once for each first-seen place within 5 km.
 * Never throws for a single place — the caller wraps the whole tenant.
 */
export async function runNearbySweep(origin: SweepOrigin, deps: SweepDeps = {}): Promise<SweepStats> {
    const searchNearby = deps.searchNearby ?? defaultNearbySearch;
    const now = deps.now ?? new Date();
    const col = getNearbySightingsCollection();

    // One sweep = one (possibly cached) Places search; count it for cost monitoring.
    incrementCounter('placesCalls', { op: 'nearby_sweep' });

    const places = await searchNearby(origin);
    const stats: SweepStats = { seen: 0, inserted: 0, alerts: 0 };

    for (const place of places) {
        if (!place.placeId) continue;
        stats.seen += 1;

        const _id = `${origin.restaurantId}:${place.placeId}`;
        const res = await col.updateOne(
            { restaurantId: origin.restaurantId, placeId: place.placeId },
            {
                $set: {
                    name: place.name,
                    lat: place.lat,
                    lng: place.lng,
                    distanceKm: place.distanceKm,
                    ...(place.cuisine ? { cuisine: place.cuisine } : {}),
                    lastSeenAt: now,
                },
                $setOnInsert: {
                    _id,
                    restaurantId: origin.restaurantId,
                    placeId: place.placeId,
                    firstSeenAt: now,
                    ratingAtFirstSeen: place.rating,
                    reviewsAtFirstSeen: place.reviewCount,
                },
            },
            { upsert: true },
        );

        const wasInserted = res.upsertedCount === 1;
        if (!wasInserted) continue;
        stats.inserted += 1;

        // New place within 5 km → emit the competitor alert exactly once.
        if (place.distanceKm <= NEW_COMPETITOR_RADIUS_KM) {
            await insertAnalyticsEvent({
                name: NEW_COMPETITOR_EVENT,
                sessionId: WORKER_SESSION_ID,
                restaurantId: origin.restaurantId,
                payload: {
                    placeId: place.placeId,
                    name: place.name,
                    distanceKm: place.distanceKm,
                    ratingAtFirstSeen: place.rating,
                    reviewsAtFirstSeen: place.reviewCount,
                    ...(place.cuisine ? { cuisine: place.cuisine } : {}),
                },
                ts: now,
            });
            stats.alerts += 1;
        }
    }

    return stats;
}

/** Expose the sighting shape for callers that build one directly (tests/seeds). */
export type { NearbyPlaceSighting };
