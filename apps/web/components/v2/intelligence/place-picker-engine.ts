/**
 * Place-picker engine (Brief 10). Abstracts the Google Places calls behind a
 * small interface so the PlacePicker component is unit-testable with a mock and
 * renders from fixtures in demo mode with ZERO backend.
 *
 * `realPlacePickerEngine` reuses the SAME Maps JS loader as
 * `PlacesAutocompleteInput.tsx` (the `google.maps.places.*` globals become
 * available once `useMapsLibrary('places')` resolves in the component) — no
 * second loader is introduced. The demo twin is compiler-checked to the same
 * shape via `typeof realPlacePickerEngine`.
 */

export interface PlaceLatLng {
    lat: number;
    lng: number;
}

export interface PlaceSuggestion {
    placeId: string;
    description: string;
}

/** Restaurant detail shown in the preview card + emitted on confirm. */
export interface PlaceDetails {
    placeId: string;
    name: string;
    address: string;
    location: PlaceLatLng;
    rating?: number;
    totalRatings?: number;
    photoUrl?: string;
}

/** What the picker emits once the owner confirms their restaurant. */
export interface PlacePickerSelection {
    placeId: string;
    name: string;
    city: string;
    location: PlaceLatLng;
}

/** 25 km bias circle around the selected city (brief §1). */
export interface CityBias {
    center: PlaceLatLng;
    radiusKm: number;
}

export const CITY_BIAS_RADIUS_KM = 25;

export interface PlacePickerEngine {
    /** City autocomplete — `types: ['(cities)']`, India-region-coded. */
    searchCities(input: string): Promise<PlaceSuggestion[]>;
    /** Resolve a selected city's coordinates (to build the name-search bias). */
    getCityLocation(placeId: string): Promise<PlaceLatLng>;
    /**
     * Restaurant/establishment autocomplete, biased to a 25 km circle around the
     * selected city (`strictBounds: false`) so results are the owner's actual
     * in-city restaurant as they type.
     */
    searchRestaurants(input: string, bias: CityBias | null): Promise<PlaceSuggestion[]>;
    /** Place Details for the preview card + confirm payload. */
    getDetails(placeId: string): Promise<PlaceDetails>;
}

// ---------------------------------------------------------------------------
// Real Google engine — plain object over the `google.maps.places` globals.
// (Excluded from coverage in vite.config, like PlacesAutocompleteInput.)
// ---------------------------------------------------------------------------

/* c8 ignore start */
async function fetchSuggestions(request: Record<string, unknown>): Promise<PlaceSuggestion[]> {
    const { suggestions } =
        await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions(
            request as unknown as google.maps.places.AutocompleteRequest,
        );
    return suggestions
        .filter((s) => s.placePrediction)
        .map((s) => ({
            placeId: s.placePrediction!.placeId,
            description: s.placePrediction!.text.toString(),
        }));
}

export const realPlacePickerEngine: PlacePickerEngine = {
    async searchCities(input: string): Promise<PlaceSuggestion[]> {
        return fetchSuggestions({
            input: input.trim(),
            includedPrimaryTypes: ['(cities)'],
            includedRegionCodes: ['in'],
        });
    },

    async getCityLocation(placeId: string): Promise<PlaceLatLng> {
        const place = new google.maps.places.Place({ id: placeId });
        await place.fetchFields({ fields: ['location'] });
        const loc = place.location;
        return { lat: loc?.lat() ?? 0, lng: loc?.lng() ?? 0 };
    },

    async searchRestaurants(input: string, bias: CityBias | null): Promise<PlaceSuggestion[]> {
        const request: Record<string, unknown> = {
            input: input.trim(),
            includedPrimaryTypes: ['restaurant'],
            includedRegionCodes: ['in'],
        };
        if (bias) {
            request.locationBias = {
                center: { lat: bias.center.lat, lng: bias.center.lng },
                radius: bias.radiusKm * 1000,
            };
        }
        return fetchSuggestions(request);
    },

    async getDetails(placeId: string): Promise<PlaceDetails> {
        const place = new google.maps.places.Place({ id: placeId });
        await place.fetchFields({
            fields: ['displayName', 'formattedAddress', 'location', 'rating', 'userRatingCount', 'photos'],
        });
        const loc = place.location;
        const photo = place.photos?.[0];
        return {
            placeId,
            name: place.displayName ?? '',
            address: place.formattedAddress ?? '',
            location: { lat: loc?.lat() ?? 0, lng: loc?.lng() ?? 0 },
            rating: place.rating ?? undefined,
            totalRatings: place.userRatingCount ?? undefined,
            photoUrl: photo ? photo.getURI({ maxWidth: 400, maxHeight: 300 }) : undefined,
        };
    },
};
/* c8 ignore stop */

// ---------------------------------------------------------------------------
// Demo engine — [SAMPLE] fixtures; same keyboard/dropdown behavior, no network.
// Compiler-checked to the real engine's shape via `typeof realPlacePickerEngine`.
// ---------------------------------------------------------------------------

const DEMO_CITIES: Array<PlaceSuggestion & { location: PlaceLatLng }> = [
    { placeId: 'demo-city-bengaluru', description: 'Bengaluru, Karnataka, India', location: { lat: 12.9716, lng: 77.5946 } },
    { placeId: 'demo-city-mumbai', description: 'Mumbai, Maharashtra, India', location: { lat: 19.076, lng: 72.8777 } },
    { placeId: 'demo-city-hyderabad', description: 'Hyderabad, Telangana, India', location: { lat: 17.385, lng: 78.4867 } },
];

interface DemoRestaurant extends PlaceDetails {
    description: string;
}

const DEMO_RESTAURANTS: DemoRestaurant[] = [
    {
        placeId: 'demo-place-spice-lounge',
        description: '[SAMPLE] The Spice Lounge, Indiranagar, Bengaluru',
        name: '[SAMPLE] The Spice Lounge',
        address: '100 Feet Rd, Indiranagar, Bengaluru 560038',
        location: { lat: 12.9719, lng: 77.6412 },
        rating: 4.6,
        totalRatings: 820,
    },
    {
        placeId: 'demo-place-royal-biryani',
        description: '[SAMPLE] Royal Biryani House, Koramangala, Bengaluru',
        name: '[SAMPLE] Royal Biryani House',
        address: '5th Block, Koramangala, Bengaluru 560095',
        location: { lat: 12.9352, lng: 77.6245 },
        rating: 4.3,
        totalRatings: 5400,
    },
    {
        placeId: 'demo-place-coastal-curry',
        description: '[SAMPLE] Coastal Curry Co., HSR Layout, Bengaluru',
        name: '[SAMPLE] Coastal Curry Co.',
        address: '27th Main, HSR Layout, Bengaluru 560102',
        location: { lat: 12.9121, lng: 77.6446 },
        rating: 4.5,
        totalRatings: 2100,
    },
];

function includesCI(haystack: string, needle: string): boolean {
    return haystack.toLowerCase().includes(needle.trim().toLowerCase());
}

export const demoPlacePickerEngine: typeof realPlacePickerEngine = {
    async searchCities(input: string): Promise<PlaceSuggestion[]> {
        if (!input.trim()) return [];
        return DEMO_CITIES.filter((c) => includesCI(c.description, input)).map(({ placeId, description }) => ({
            placeId,
            description,
        }));
    },

    async getCityLocation(placeId: string): Promise<PlaceLatLng> {
        return DEMO_CITIES.find((c) => c.placeId === placeId)?.location ?? DEMO_CITIES[0].location;
    },

    async searchRestaurants(input: string): Promise<PlaceSuggestion[]> {
        if (!input.trim()) return [];
        return DEMO_RESTAURANTS.filter((r) => includesCI(r.description, input)).map((r) => ({
            placeId: r.placeId,
            description: r.description,
        }));
    },

    async getDetails(placeId: string): Promise<PlaceDetails> {
        const r = DEMO_RESTAURANTS.find((x) => x.placeId === placeId) ?? DEMO_RESTAURANTS[0];
        const { description: _description, ...details } = r;
        return details;
    },
};
