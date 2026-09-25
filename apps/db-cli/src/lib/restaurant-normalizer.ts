import { randomUUID } from 'node:crypto';

export type PriceRange = 'budget' | 'mid-range' | 'upscale' | 'fine-dining';
export type DataSource = 'kaggle-zomato' | 'osm' | 'merged' | 'manual';

export interface RestaurantFixture {
    _id: string;
    id: string;
    name: string;
    cuisine: string;
    cuisines: string[];
    location: {
        address: string;
        lat: number;
        lng: number;
        mapUrl: string;
    };
    accountManager: {
        name: string;
        phone: string;
        email: string;
        avatar: string;
    };
    integrations: { instagram: boolean };
    activeOffers: string[];
    chefSpecials: string[];
    menuLastUpdated: string;
    priceRange: PriceRange;
    rating?: number;
    ratingCount?: number;
    serviceOptions: {
        delivery: boolean;
        dineIn: boolean;
        takeout: boolean;
    };
    averageCostForTwo?: number;
    sourceCity: string;
    dataSource: DataSource;
    phone?: string;
    website?: string;
    operatingHours?: { weekday_text: string[] };
    menu?: Array<{
        id: string;
        category: string;
        name: string;
        isVeg: boolean;
        isAvailable: boolean;
        isBestSeller?: boolean;
    }>;
}

const CUISINE_PRIORITY = [
    'Biryani', 'South Indian', 'North Indian', 'Mughlai', 'Andhra',
    'Tamil', 'Kerala', 'Chettinad', 'Hyderabadi', 'Bengali',
    'Punjabi', 'Rajasthani', 'Gujarati', 'Maharashtrian',
    'Chinese', 'Italian', 'Continental', 'Mediterranean',
    'Fast Food', 'Street Food', 'Cafe', 'Bakery', 'Pizza', 'Burger',
];

export function normalizeCuisine(raw: string): { primary: string; all: string[] } {
    const all = raw.split(',').map(c => c.trim()).filter(Boolean);
    const primary = all.find(c =>
        CUISINE_PRIORITY.some(p => c.toLowerCase().includes(p.toLowerCase()))
    ) ?? all[0] ?? 'Multi-cuisine';
    return { primary, all };
}

export function normalizePriceRange(priceRangeInt: number): PriceRange {
    switch (priceRangeInt) {
        case 1: return 'budget';
        case 2: return 'mid-range';
        case 3: return 'upscale';
        case 4: return 'fine-dining';
        default: return 'mid-range';
    }
}

const DEFAULT_ACCOUNT_MANAGER = {
    hyderabad: { name: 'RestroPulse Hyderabad', phone: '+91 00000 00003', email: 'hyderabad@restropulse.ai', avatar: 'https://picsum.photos/seed/am-hyd/100/100' },
    mumbai:    { name: 'RestroPulse Mumbai',    phone: '+91 00000 00001', email: 'mumbai@restropulse.ai',    avatar: 'https://picsum.photos/seed/am-mum/100/100' },
    bangalore: { name: 'RestroPulse Bangalore', phone: '+91 00000 00002', email: 'bangalore@restropulse.ai', avatar: 'https://picsum.photos/seed/am-blr/100/100' },
};

/** Extract the locality/area from a Zomato URL (e.g. zomato.com/hyderabad/gachibowli/...) */
function extractAreaFromZomatoUrl(url: string): string {
    try {
        const parts = url.replace('https://www.zomato.com/', '').split('/');
        // parts[0] = city, parts[1] = area-slug, parts[2] = restaurant-slug
        if (parts.length >= 2) {
            return parts[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        }
    } catch { /* ignore */ }
    return '';
}

/** Map average cost for two (INR) to price range tier. */
function costToPriceRange(costForTwo: number): PriceRange {
    if (costForTwo <= 300) return 'budget';
    if (costForTwo <= 800) return 'mid-range';
    if (costForTwo <= 2000) return 'upscale';
    return 'fine-dining';
}

/**
 * Aggregates menu-item-level rows (one row per dish) into RestaurantFixture objects.
 * Used for the Zomato metropolitan dataset which has columns:
 *   Restaurant Name, Dining Rating, Delivery Rating, Cuisine, Place Name, City,
 *   Item Name, Best Seller, Votes, Prices
 */
export function aggregateMenuItemRows(
    rows: Record<string, string>[],
    city: string,
): RestaurantFixture[] {
    // Group by restaurant key (name + place)
    const groups = new Map<string, Record<string, string>[]>();
    for (const row of rows) {
        const cityCol = (row['City'] ?? '').trim().toLowerCase();
        if (!cityCol.includes(city.toLowerCase())) continue;
        const name = (row['Restaurant Name'] ?? '').trim();
        if (!name) continue;
        const place = (row['Place Name'] ?? '').trim();
        const key = `${name}|||${place}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(row);
    }

    const fixtures: RestaurantFixture[] = [];
    const am = DEFAULT_ACCOUNT_MANAGER[city as keyof typeof DEFAULT_ACCOUNT_MANAGER]
        ?? DEFAULT_ACCOUNT_MANAGER.hyderabad;

    for (const [key, itemRows] of groups) {
        const [name, place] = key.split('|||');
        const first = itemRows[0];

        const cuisineRaw = (first['Cuisine '] ?? first['Cuisine'] ?? 'Multi-cuisine').trim();
        const { primary, all } = normalizeCuisine(cuisineRaw);

        const diningRating = parseFloat(first['Dining Rating'] ?? '');
        const diningVotes = parseInt(first['Dining Votes'] ?? '0', 10);
        const hasDelivery = parseFloat(first['Delivery Rating'] ?? '0') > 0;

        // Build menu from item rows
        const menu = itemRows
            .filter(r => (r['Item Name'] ?? '').trim())
            .map(r => {
                const itemName = (r['Item Name'] ?? '').trim();
                const price = parseFloat(r['Prices'] ?? '');
                const isBestSeller = (r['Best Seller'] ?? '').toUpperCase() === 'BESTSELLER';
                // Heuristic veg detection from item name
                const nonVegKeywords = /chicken|mutton|prawn|fish|egg|keema|beef|pork|lamb|meat|seafood|shrimp|crab|squid|tuna/i;
                const isVeg = !nonVegKeywords.test(itemName);
                return {
                    id: randomUUID().slice(0, 8),
                    category: primary,
                    name: itemName,
                    price: isNaN(price) ? undefined : price,
                    isVeg,
                    isAvailable: true,
                    isBestSeller,
                };
            });

        // Derive price range from average menu price
        const prices = menu.map(m => m.price).filter((p): p is number => p !== undefined);
        const avgPrice = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
        const priceRange = avgPrice > 0 ? costToPriceRange(avgPrice * 2) : 'mid-range';

        const address = [place, city, 'India'].filter(Boolean).join(', ');
        const id = `acq-${city.slice(0, 3)}-${randomUUID().slice(0, 8)}`;

        fixtures.push({
            _id: id,
            id,
            name,
            cuisine: primary,
            cuisines: all,
            location: { address, lat: 0, lng: 0, mapUrl: '' },
            accountManager: am,
            integrations: { instagram: false },
            activeOffers: [],
            chefSpecials: menu.filter(m => m.isBestSeller).slice(0, 3).map(m => m.name),
            menuLastUpdated: new Date().toISOString().split('T')[0],
            priceRange,
            rating: isNaN(diningRating) ? undefined : diningRating,
            ratingCount: isNaN(diningVotes) ? undefined : diningVotes,
            serviceOptions: { delivery: hasDelivery, dineIn: true, takeout: hasDelivery },
            sourceCity: city,
            dataSource: 'kaggle-zomato',
            menu,
        });
    }

    return fixtures;
}

export function normalizeRow(row: Record<string, string>, city: string): RestaurantFixture | null {
    // Support both Zomato standard format AND the metadata-only format
    const name = (row['Restaurant Name'] ?? row['Name'] ?? row['name'] ?? '').trim();
    if (!name) return null;

    // Coordinates — optional in the metadata-only dataset; OSM enrichment fills them in
    const latStr = row['Latitude'] ?? row['latitude'] ?? '';
    const lngStr = row['Longitude'] ?? row['longitude'] ?? '';
    const lat = parseFloat(latStr) || 0;
    const lng = parseFloat(lngStr) || 0;

    const cuisineRaw = row['Cuisines'] ?? row['cuisines'] ?? 'Multi-cuisine';
    const { primary, all } = normalizeCuisine(cuisineRaw);

    // Price: prefer explicit price_range int, fall back to cost-based derivation
    const priceRangeInt = parseInt(row['Price range'] ?? row['price_range'] ?? '', 10);
    const costForTwo = parseFloat(row['Average Cost for two'] ?? row['average_cost_for_two'] ?? row['Cost'] ?? '');
    const priceRange = !isNaN(priceRangeInt)
        ? normalizePriceRange(priceRangeInt)
        : !isNaN(costForTwo)
        ? costToPriceRange(costForTwo)
        : 'mid-range';

    const rating = parseFloat(row['Aggregate rating'] ?? row['aggregate_rating'] ?? '');
    const votes = parseInt(row['Votes'] ?? row['votes'] ?? '0', 10);

    const hasDelivery = (row['Has Online delivery'] ?? row['has_online_delivery'] ?? '').toLowerCase() === 'yes';
    const hasDineIn = (row['Has Table booking'] ?? row['has_table_booking'] ?? '').toLowerCase() === 'yes';

    // Operating hours from Timings column (metadata dataset)
    const timingsRaw = row['Timings'] ?? row['timings'] ?? '';
    const operatingHours = timingsRaw ? { weekday_text: [timingsRaw] } : undefined;

    // Address: use full address if available, else extract area from Zomato URL
    const zomatoUrl = row['Links'] ?? row['links'] ?? '';
    const area = row['Locality'] ?? row['locality'] ?? extractAreaFromZomatoUrl(zomatoUrl);
    const address = [
        row['Address'] ?? row['address'] ?? area,
        row['City'] ?? row['city'] ?? city,
        'India',
    ].filter(Boolean).join(', ');

    const id = `acq-${city.slice(0, 3)}-${randomUUID().slice(0, 8)}`;
    const am = DEFAULT_ACCOUNT_MANAGER[city as keyof typeof DEFAULT_ACCOUNT_MANAGER]
        ?? DEFAULT_ACCOUNT_MANAGER.hyderabad;

    return {
        _id: id,
        id,
        name,
        cuisine: primary,
        cuisines: all,
        location: { address, lat, lng, mapUrl: `https://www.google.com/maps?q=${lat},${lng}` },
        accountManager: am,
        integrations: { instagram: false },
        activeOffers: [],
        chefSpecials: [],
        menuLastUpdated: new Date().toISOString().split('T')[0],
        priceRange,
        rating: isNaN(rating) ? undefined : rating,
        ratingCount: isNaN(votes) ? undefined : votes,
        serviceOptions: { delivery: hasDelivery, dineIn: hasDineIn, takeout: hasDineIn },
        averageCostForTwo: isNaN(costForTwo) ? undefined : costForTwo,
        sourceCity: city,
        dataSource: 'kaggle-zomato',
        ...(operatingHours ? { operatingHours } : {}),
    };
}
