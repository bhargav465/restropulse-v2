import type { RestaurantFixture } from './restaurant-normalizer.js';

const OVERPASS_API = 'https://overpass-api.de/api/interpreter';

// [south, west, north, east]
const CITY_BBOXES: Record<string, [number, number, number, number]> = {
    hyderabad: [17.25, 78.30, 17.55, 78.60],
    mumbai:    [18.87, 72.75, 19.27, 72.98],
    bangalore: [12.85, 77.45, 13.10, 77.75],
};

interface OsmNode {
    id: number;
    lat: number;
    lon: number;
    tags: Record<string, string>;
}

async function fetchOsmRestaurants(city: string): Promise<OsmNode[]> {
    const bbox = CITY_BBOXES[city];
    if (!bbox) return [];

    const [south, west, north, east] = bbox;
    const query = `
[out:json][timeout:60];
(
  node["amenity"="restaurant"](${south},${west},${north},${east});
  node["amenity"="cafe"](${south},${west},${north},${east});
  node["amenity"="fast_food"](${south},${west},${north},${east});
);
out body;
    `.trim();

    const res = await fetch(OVERPASS_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
    });

    if (!res.ok) throw new Error(`Overpass API returned ${res.status}`);

    const data = await res.json() as { elements: OsmNode[] };
    return data.elements;
}

function osmNameKey(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export async function enrichWithOsm(
    records: RestaurantFixture[],
    city: string,
    onProgress?: (msg: string) => void,
): Promise<RestaurantFixture[]> {
    onProgress?.(`Fetching OSM data for ${city}...`);

    let osmNodes: OsmNode[];
    try {
        osmNodes = await fetchOsmRestaurants(city);
        onProgress?.(`Found ${osmNodes.length} OSM nodes`);
    } catch (err) {
        onProgress?.(`OSM fetch failed (${(err as Error).message}) — skipping enrichment`);
        return records;
    }

    const osmByName = new Map<string, OsmNode>();
    for (const node of osmNodes) {
        if (node.tags['name']) osmByName.set(osmNameKey(node.tags['name']), node);
    }

    const bbox = CITY_BBOXES[city];
    let enriched = 0;

    const result = records.map(record => {
        const match = osmByName.get(osmNameKey(record.name));
        if (!match) return record;

        const updated: RestaurantFixture = { ...record, dataSource: 'merged' };

        // Use OSM coordinates only if they fall within the expected city bounding box
        if (match.lat && match.lon && bbox) {
            const [south, west, north, east] = bbox;
            if (match.lat >= south && match.lat <= north && match.lon >= west && match.lon <= east) {
                updated.location = {
                    ...updated.location,
                    lat: match.lat,
                    lng: match.lon,
                    mapUrl: `https://www.google.com/maps?q=${match.lat},${match.lon}`,
                };
            }
        }

        if (match.tags['opening_hours'] && !updated.operatingHours) {
            updated.operatingHours = { weekday_text: [match.tags['opening_hours']] };
        }
        if (match.tags['phone'] && !updated.phone) updated.phone = match.tags['phone'];
        if (match.tags['website'] && !updated.website) updated.website = match.tags['website'];

        enriched++;
        return updated;
    });

    onProgress?.(`OSM enriched ${enriched} of ${records.length} records`);
    return result;
}
