import type { RestaurantFixture } from './restaurant-normalizer.js';

function normalizedNameStem(name: string): string {
    return name
        .toLowerCase()
        .replace(/\b(restaurant|cafe|bar|grill|kitchen|house|the|and|&)\b/g, '')
        .replace(/[^a-z0-9]/g, '')
        .trim();
}

function spatialKey(lat: number, lng: number): string {
    // Round to ~50m precision (4 decimal places)
    return `${Math.round(lat * 10000)}_${Math.round(lng * 10000)}`;
}

function fieldsPopulated(record: RestaurantFixture): number {
    return Object.values(record as Record<string, unknown>)
        .filter(v => v !== undefined && v !== null && v !== '').length;
}

export function deduplicate(records: RestaurantFixture[]): RestaurantFixture[] {
    const seen = new Map<string, RestaurantFixture>();

    for (const record of records) {
        const nameKey = normalizedNameStem(record.name);
        const geoKey = spatialKey(record.location.lat, record.location.lng);
        const fingerprint = `${geoKey}__${nameKey}`;

        const existing = seen.get(fingerprint);
        if (!existing) {
            seen.set(fingerprint, record);
            continue;
        }

        // Keep whichever record has more populated fields
        if (fieldsPopulated(record) > fieldsPopulated(existing)) {
            seen.set(fingerprint, record);
        }
    }

    return Array.from(seen.values());
}
