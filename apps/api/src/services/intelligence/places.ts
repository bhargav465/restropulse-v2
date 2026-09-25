/**
 * Google Places API (New) client for the intelligence scan pipeline.
 * All lookups go through `places.googleapis.com/v1` (legacy Places/Geocoding
 * APIs are unavailable on new Google Cloud projects).
 *
 * Ported from the predecessor (RESTROGRADECLAUSDETEST): field masks, the
 * price-level map, exclusion lists, `toLegacyPlace`, and the 3-page × 20 / 7km
 * nearby pagination are kept verbatim. Added for the monorepo: every resolved
 * place is upserted into `competitor_cache` with `fetchedAt: Date` (the 7-day
 * TTL index fires on it), and per-place detail lookups hit the cache first —
 * the cost-control rule in the module CLAUDE.md §9.
 *
 * `GOOGLE_MAPS_API_KEY` is read from the server environment only. A missing key
 * raises a 503 StageError; upstream failures raise 502.
 */

import { getCompetitorCacheCollection } from '@restropulse/db';
import type { PlaceCandidate } from '@restropulse/shared';
import { createLogger } from '@restropulse/telemetry/server';
import { StageError } from './errors.js';
import { getDistanceKm, threatScore } from './scoring.js';

const log = createLogger('intelligence-places');

const PLACES_BASE = 'https://places.googleapis.com/v1';

function getGoogleKey(): string {
    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) {
        throw new StageError(
            'Location search is not configured on the server (missing GOOGLE_MAPS_API_KEY).',
            503,
            'FETCHING_PLACES',
        );
    }
    return key;
}

// ---- Field masks / maps / exclusion lists (ported verbatim) ----

const PLACES_SEARCH_FIELDS = [
    'places.id',
    'places.displayName',
    'places.shortFormattedAddress',
    'places.rating',
    'places.userRatingCount',
    'places.location',
    'places.types',
    'places.priceLevel',
    'places.photos',
].join(',');

const BASE_DETAIL_FIELD_MASK =
    'id,location,priceLevel,displayName,rating,userRatingCount,websiteUri,googleMapsUri,nationalPhoneNumber,regularOpeningHours,photos,reviews,editorialSummary,businessStatus,formattedAddress,addressComponents';

const PRICE_LEVEL_MAP: Record<string, number> = {
    PRICE_LEVEL_FREE: 0,
    PRICE_LEVEL_INEXPENSIVE: 1,
    PRICE_LEVEL_MODERATE: 2,
    PRICE_LEVEL_EXPENSIVE: 3,
    PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

const EXCLUDED_TYPES = ['lodging', 'hotel', 'motel', 'campground', 'rv_park'];
const EXCLUDED_NAME_PATTERN =
    /\b(lodge|lodging|hotel|motel|resort|inn|hostel|dharamshala|guest\s*house|paying\s*guest|pg)\b/i;

// ---- Public shapes ----

/** A nearby competitor as measured by Places (New) — pre-analysis, pre-scoring. */
export interface PlaceRow {
    placeId: string;
    name: string;
    address: string;
    rating: number;
    totalRatings: number;
    lat: number;
    lng: number;
    priceLevel: number;
    photoCount: number;
    types: string[];
    distanceKm: number;
    threatScore: number;
}

/** The merchant's own restaurant, measured from Places (New) detail. */
export interface BaseRestaurant {
    placeId: string;
    name: string;
    rating: number;
    totalRatings: number;
    website: string | null;
    phone: string | null;
    hasHours: boolean;
    photoCount: number;
    /** First Places photo resource name — the listing's hero shot, when present. */
    photoName: string | null;
    hasDescription: boolean;
    recentReviews: Array<{ rating: number; text: string; time: string }>;
    ownerRespondsToReviews: boolean;
    businessStatus: string;
    location: { lat: number; lng: number };
    zone: string | null;
    formattedAddress: string | null;
    /** AOV proxy: Places price level 0–4, or null when Google has none (Brief 10). */
    priceLevel: number | null;
}

// ---- Low-level fetch ----

interface PlacesTextSearchResponse {
    places?: PlaceApi[];
    nextPageToken?: string;
    error?: { status?: string; message?: string; code?: number };
}

interface PlaceApi {
    id?: string;
    displayName?: { text?: string };
    shortFormattedAddress?: string;
    formattedAddress?: string;
    rating?: number;
    userRatingCount?: number;
    location?: { latitude?: number; longitude?: number };
    types?: string[];
    priceLevel?: string;
    photos?: Array<{ name?: string }>;
    websiteUri?: string;
    googleMapsUri?: string;
    nationalPhoneNumber?: string;
    regularOpeningHours?: { weekdayDescriptions?: string[] };
    reviews?: Array<{ rating?: number; text?: { text?: string }; relativePublishTimeDescription?: string }>;
    editorialSummary?: { text?: string };
    businessStatus?: string;
    addressComponents?: Array<{ longText?: string; shortText?: string; types?: string[] }>;
}

async function placesTextSearch(body: Record<string, unknown>, fieldMask: string): Promise<PlacesTextSearchResponse> {
    const res = await fetch(`${PLACES_BASE}/places:searchText`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': getGoogleKey(),
            'X-Goog-FieldMask': fieldMask,
        },
        body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as PlacesTextSearchResponse;
    if (!res.ok) {
        // Surface the exact Google error so misconfig (API not enabled, key
        // restriction, billing) is diagnosable instead of a generic "not found".
        log.error(
            { status: res.status, googleStatus: data?.error?.status, googleMessage: data?.error?.message, textQuery: body.textQuery },
            'Google Places searchText failed',
        );
        if (res.status === 403) {
            throw new StageError(
                `Location search was denied by Google (${data?.error?.message || 'permission denied'}). Enable "Places API (New)" on the Google Cloud project for this key and ensure billing + key restrictions allow it.`,
                503,
                'FETCHING_PLACES',
            );
        }
        throw new StageError(
            `Restaurant search failed (Places API ${res.status}: ${data?.error?.message || data?.error?.status || 'unknown error'}).`,
            502,
            'FETCHING_PLACES',
        );
    }
    return data;
}

function mapToPlaceRow(p: PlaceApi, origin: { lat: number; lng: number }): PlaceRow {
    const lat = p.location?.latitude ?? 0;
    const lng = p.location?.longitude ?? 0;
    const rating = p.rating ?? 0;
    const totalRatings = p.userRatingCount ?? 0;
    const distanceKm = Number(getDistanceKm(origin.lat, origin.lng, lat, lng).toFixed(2));
    return {
        placeId: p.id ?? '',
        name: p.displayName?.text ?? '',
        address: p.shortFormattedAddress ?? '',
        rating,
        totalRatings,
        lat,
        lng,
        priceLevel: p.priceLevel ? (PRICE_LEVEL_MAP[p.priceLevel] ?? 0) : 0,
        photoCount: Array.isArray(p.photos) ? p.photos.length : 0,
        types: p.types ?? [],
        distanceKm,
        threatScore: threatScore(rating, totalRatings, distanceKm),
    };
}

// ---- competitor_cache helpers ----

async function upsertPlaceCache(placeId: string, payload: Record<string, unknown>): Promise<void> {
    if (!placeId) return;
    await getCompetitorCacheCollection().updateOne(
        { placeId },
        { $set: { placeId, payload, fetchedAt: new Date() } },
        { upsert: true },
    );
}

async function getPlaceCache(placeId: string): Promise<Record<string, unknown> | null> {
    if (!placeId) return null;
    const doc = await getCompetitorCacheCollection().findOne({ placeId });
    return (doc?.payload as Record<string, unknown>) ?? null;
}

// ---- Public API ----

/**
 * Resolve the merchant's own restaurant to measured Places (New) detail.
 * Returns null if the restaurant cannot be found. Detail lookups hit
 * `competitor_cache` first (TTL 7 days).
 */
/**
 * Candidate listings for the "Is this you?" step. Text-search the merchant's
 * name (biased to their saved coordinates when we have them, then plain
 * "name, city"), merge unique by place id, and return the top few with the
 * fields a person needs to recognise their own restaurant: name, address,
 * rating, review count. Never throws for "no matches" — an empty list is a
 * valid answer that the UI turns into "search again".
 */
export async function searchPlaceCandidates(
    name: string,
    city: string,
    selfLocation?: { lat: number; lng: number },
    limit = 5,
    regionCode?: string,
): Promise<PlaceCandidate[]> {
    const MASK =
        'places.id,places.displayName,places.shortFormattedAddress,places.formattedAddress,places.rating,places.userRatingCount,places.location,places.photos';
    const hasValidLoc =
        !!selfLocation &&
        Number.isFinite(selfLocation.lat) && Number.isFinite(selfLocation.lng) &&
        !(selfLocation.lat === 0 && selfLocation.lng === 0) &&
        Math.abs(selfLocation.lat) <= 90 && Math.abs(selfLocation.lng) <= 180;

    const seen = new Map<string, PlaceCandidate>();
    const absorb = (res: PlacesTextSearchResponse | undefined) => {
        for (const p of res?.places ?? []) {
            if (!p.id || seen.has(p.id)) continue;
            const photoName = p.photos?.[0]?.name;
            const lat = p.location?.latitude;
            const lng = p.location?.longitude;
            seen.set(p.id, {
                placeId: p.id,
                name: p.displayName?.text ?? '',
                address: p.shortFormattedAddress ?? p.formattedAddress ?? '',
                rating: p.rating ?? 0,
                totalRatings: p.userRatingCount ?? 0,
                ...(photoName ? { photoName } : {}),
                ...(lat != null && lng != null && !(lat === 0 && lng === 0) ? { lat, lng } : {}),
            });
        }
    };

    if (hasValidLoc) {
        absorb(
            await placesTextSearch(
                {
                    textQuery: name,
                    pageSize: limit,
                    locationBias: {
                        circle: { center: { latitude: selfLocation!.lat, longitude: selfLocation!.lng }, radius: 5000.0 },
                    },
                },
                MASK,
            ),
        );
    }
    if (seen.size < limit) {
        // City is optional for public callers (the grader's autocomplete) — a bare
        // name query still returns useful candidates. Without a regionCode Google
        // defaults to US-biased results, where Indian brand names return nothing.
        absorb(
            await placesTextSearch(
                {
                    textQuery: city.trim() ? `${name}, ${city}` : name,
                    pageSize: limit,
                    ...(regionCode ? { regionCode } : {}),
                    // regionCode alone barely moves the needle — a country-bounds
                    // rectangle is the strong bias that makes bare Indian brand
                    // names ("Bawarchi") return Indian listings instead of nothing.
                    ...(regionCode === 'IN'
                        ? {
                              locationBias: {
                                  rectangle: {
                                      low: { latitude: 6.4, longitude: 68.0 },
                                      high: { latitude: 35.8, longitude: 97.5 },
                                  },
                              },
                          }
                        : {}),
                },
                MASK,
            ),
        );
    }
    return [...seen.values()].filter((c) => c.name).slice(0, limit);
}

export async function getBaseRestaurantDetails(
    name: string,
    city: string,
    placeId?: string,
    selfLocation?: { lat: number; lng: number },
): Promise<BaseRestaurant | null> {
    // Brief 10: when the owner confirmed their restaurant in the place picker, we
    // already know the placeId — skip text-search disambiguation entirely and go
    // straight to Place Details (fewer Places calls, zero wrong-restaurant scans).
    let found: PlaceApi | undefined;
    let resolvedPlaceId: string;
    if (placeId && placeId.trim()) {
        resolvedPlaceId = placeId.trim();
    } else {
        const FIND_MASK = 'places.id,places.displayName,places.rating,places.userRatingCount,places.location';
        // Reject (0,0) and out-of-range coords: onboarding defaults missing
        // location to lat:0/lng:0, which would bias the search into the ocean.
        const hasValidLoc =
            !!selfLocation &&
            Number.isFinite(selfLocation.lat) && Number.isFinite(selfLocation.lng) &&
            !(selfLocation.lat === 0 && selfLocation.lng === 0) &&
            Math.abs(selfLocation.lat) <= 90 && Math.abs(selfLocation.lng) <= 180;

        // NOTE: we intentionally do NOT swallow errors here. placesTextSearch only
        // throws on a non-OK Google response (403 API-not-enabled, 502, etc.); an
        // empty-but-OK result returns { places: [] } and falls through to attempt 2.
        // Letting a real API error propagate surfaces the true cause instead of a
        // misleading "could not find".

        // Attempt 1: name biased to the restaurant's own coordinates (most reliable).
        if (hasValidLoc) {
            const biased = await placesTextSearch(
                {
                    textQuery: name,
                    pageSize: 1,
                    locationBias: {
                        circle: {
                            center: { latitude: selfLocation!.lat, longitude: selfLocation!.lng },
                            radius: 2000.0,
                        },
                    },
                },
                FIND_MASK,
            );
            found = biased?.places?.[0];
        }

        // Attempt 2 (fallback): free-text "name, city". Runs when there were no
        // valid coords, or the biased search matched nothing (0 results).
        if (!found?.id) {
            const text = await placesTextSearch({ textQuery: `${name}, ${city}`, pageSize: 1 }, FIND_MASK);
            found = text?.places?.[0];
        }

        if (!found?.id) {
            log.warn(
                { name, city, hasValidLoc, lat: selfLocation?.lat, lng: selfLocation?.lng },
                'Places lookup returned zero matches for the restaurant',
            );
            return null;
        }
        resolvedPlaceId = found.id;
    }

    // Cache hit skips the detail call. Payloads cached before `photos` joined
    // the field mask lack the key entirely — treat those as stale so the hero
    // photo (grader scan card / report) can be resolved.
    let d = (await getPlaceCache(resolvedPlaceId)) as PlaceApi | null;
    if (d && !('photos' in d)) d = null;
    if (!d) {
        const detailRes = await fetch(`${PLACES_BASE}/places/${resolvedPlaceId}`, {
            headers: {
                'X-Goog-Api-Key': getGoogleKey(),
                'X-Goog-FieldMask': BASE_DETAIL_FIELD_MASK,
            },
        });
        d = detailRes.ok ? ((await detailRes.json()) as PlaceApi) : null;
        if (d) await upsertPlaceCache(resolvedPlaceId, d as unknown as Record<string, unknown>);
    }

    // Prefer the detail location; the search result is the fallback (text path only).
    const locSource = d?.location ?? found?.location;
    const location = locSource
        ? { lat: locSource.latitude ?? 0, lng: locSource.longitude ?? 0 }
        : { lat: 0, lng: 0 };
    const priceLevel = d?.priceLevel ? (PRICE_LEVEL_MAP[d.priceLevel] ?? null) : null;

    if (!d) {
        return {
            placeId: resolvedPlaceId,
            name: found?.displayName?.text ?? name,
            rating: found?.rating ?? 0,
            totalRatings: found?.userRatingCount ?? 0,
            website: null,
            phone: null,
            hasHours: false,
            photoCount: 0,
            photoName: null,
            hasDescription: false,
            recentReviews: [],
            ownerRespondsToReviews: false,
            businessStatus: 'OPERATIONAL',
            location,
            zone: null,
            formattedAddress: null,
            priceLevel: null,
        };
    }

    const addressComponents = d.addressComponents ?? [];
    const findZone = (t: string) => addressComponents.find((c) => (c.types ?? []).includes(t))?.longText;
    const zone =
        findZone('sublocality_level_1') ??
        findZone('sublocality') ??
        findZone('neighborhood') ??
        findZone('locality') ??
        null;

    const recentReviews = (d.reviews ?? []).slice(0, 5).map((r) => ({
        rating: r.rating ?? 0,
        text: (r.text?.text ?? '').substring(0, 200),
        time: r.relativePublishTimeDescription ?? '',
    }));

    return {
        placeId: resolvedPlaceId,
        name: d.displayName?.text ?? found?.displayName?.text ?? name,
        rating: d.rating ?? 0,
        totalRatings: d.userRatingCount ?? 0,
        website: d.websiteUri ?? null,
        phone: d.nationalPhoneNumber ?? null,
        hasHours: !!(d.regularOpeningHours?.weekdayDescriptions?.length),
        photoCount: Array.isArray(d.photos) ? d.photos.length : 0,
        photoName: d.photos?.[0]?.name ?? null,
        hasDescription: !!d.editorialSummary?.text,
        recentReviews,
        // Places API (New) exposes reviews but not owner replies; presence of
        // recent reviews is the predecessor's proxy signal.
        ownerRespondsToReviews: recentReviews.length > 0,
        businessStatus: d.businessStatus ?? 'OPERATIONAL',
        location,
        zone,
        formattedAddress: d.formattedAddress ?? null,
        priceLevel,
    };
}

/**
 * Fetch nearby restaurants (3 pages × 20, 7 km, includedType restaurant),
 * filter out lodging/hotels, map to measured PlaceRows with distance + threat.
 * Every resolved place is upserted into `competitor_cache`.
 */
export async function getNearbyRestaurants(origin: { lat: number; lng: number }): Promise<PlaceRow[]> {
    const radius = 7000;
    const raw: PlaceApi[] = [];
    let pageToken: string | undefined;

    for (let page = 0; page < 3; page++) {
        const body: Record<string, unknown> = {
            textQuery: 'restaurants',
            includedType: 'restaurant',
            pageSize: 20,
            locationBias: { circle: { center: { latitude: origin.lat, longitude: origin.lng }, radius } },
        };
        if (pageToken) body.pageToken = pageToken;

        const data = await placesTextSearch(body, `${PLACES_SEARCH_FIELDS},nextPageToken`);
        raw.push(...(data.places ?? []));
        pageToken = data.nextPageToken;
        if (!pageToken) break;
    }

    // Exclusion filters: lodging/hotel types + name patterns.
    const filtered = raw.filter((p) => {
        const types = p.types ?? [];
        if (types.some((t) => EXCLUDED_TYPES.includes(t))) return false;
        if (EXCLUDED_NAME_PATTERN.test(p.displayName?.text ?? '')) return false;
        return true;
    });

    // Warm the cache for every resolved place (best-effort; never blocks scoring).
    await Promise.all(
        filtered.map((p) => (p.id ? upsertPlaceCache(p.id, p as unknown as Record<string, unknown>) : Promise.resolve())),
    ).catch(() => undefined);

    return filtered
        .map((p) => mapToPlaceRow(p, origin))
        .filter((r) => r.placeId && r.name)
        .sort((a, b) => b.threatScore - a.threatScore);
}
