/**
 * demo-restaurants.ts — the set of [SAMPLE] restaurants a demo build can sign
 * in as (demo builds only; VITE_DEMO_MODE=true).
 *
 * The signed-in restaurant is whatever `rp_restaurant_id` holds, the same key
 * the real app uses after login, so each demo twin (CMS, orders, delivery,
 * sites, and the core-API stand-in in demo-backend.ts) keeps one state per
 * restaurant and serves the current one.
 *
 * demo-r1 keeps the original hand-written fixtures in each twin, which the
 * tests rely on. The others are built here from a short profile.
 */
import type {
    MenuCategory, Offer, OrderingMenuItem, OrderStatus, OrderType, PostType, Platform, RestaurantDeliverySettings,
    RestaurantOrderingSettings, StorefrontContent,
} from '@restropulse/shared';
import { resolveDeliverySettings, resolveOrderingSettings } from '@restropulse/shared';
import type { AdminOrder } from '../api';

export const DEFAULT_DEMO_RESTAURANT_ID = 'demo-r1';

interface ProfileItem {
    name: string;
    price: number;
    isVeg: boolean;
    best?: boolean;
    desc?: string;
    out?: boolean;
    variants?: Array<[string, number]>;
    addons?: Array<[string, number]>;
}

interface ProfileOrder {
    status: OrderStatus;
    type: OrderType;
    customer: string;
    items: Array<[string, number]>;
    ageMin: number;
    cash?: boolean;
    street?: string;
    notes?: string;
    table?: string;
}

interface ProfilePost {
    type: PostType;
    status: 'PENDING_APPROVAL' | 'SCHEDULED' | 'POSTED';
    platform: Platform;
    label: string;
    caption: string;
    dayOffset: number;
    hour: number;
    hue: number;
    stats?: { likes: number; shares: number; comments: number; reach: number };
}

export interface DemoRestaurantProfile {
    id: string;
    /** Login number (10 digits, without +91) that signs in as this restaurant. */
    loginPhone: string;
    name: string;
    cuisine: string;
    city: string;
    area: string;
    address: string;
    lat: number;
    lng: number;
    description: string;
    /** What this sample is good for trying, shown on the login screen. */
    blurb: string;
    ownerName: string;
    instagramHandle: string;
    activeOffers: string[];
    chefSpecials: string[];
    menu: Array<{ category: string; items: ProfileItem[] }>;
    offers: Offer[];
    slug: string | null;
    ordering: RestaurantOrderingSettings;
    delivery: RestaurantDeliverySettings;
    content: StorefrontContent;
    /** false = site content is a draft that has never been published. */
    contentPublished: boolean;
    orders: ProfileOrder[];
    posts: ProfilePost[];
    strategyTheme: string;
    strategyFocus: string[];
    orderPrefix: string;
}

const hours = (open: string, close: string, closedDays: string[] = []) =>
    ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
        .map((day) => (closedDays.includes(day) ? { day, open: '00:00', close: '00:00', closed: true } : { day, open, close }));

const offer = (id: string, rid: string, over: Partial<Offer> & Pick<Offer, 'title' | 'reward'>): Offer => ({
    id, restaurantId: rid, scope: { kind: 'all' }, schedule: { startsAt: '2026-11-01T00:00:00.000Z' },
    showOnSite: true, promoteInContent: false, status: 'active', ...over,
});

export const DEMO_RESTAURANTS: DemoRestaurantProfile[] = [
    {
        id: 'demo-r1',
        loginPhone: '9000000001',
        name: '[SAMPLE] RestroPulse Demo Kitchen',
        cuisine: 'Biryani & North Indian',
        city: 'Bengaluru',
        area: 'Indiranagar',
        address: '[SAMPLE] 12 Sample Street, Indiranagar, Bengaluru',
        lat: 12.9719, lng: 77.6412,
        description: '[SAMPLE] A family kitchen serving slow-cooked biryani, kebabs and curries.',
        blurb: 'Busy kitchen: live orders, delivery with a test rider partner, published website.',
        ownerName: '[SAMPLE] Asha Rao',
        instagramHandle: 'demo_kitchen_sample',
        activeOffers: ['[SAMPLE] 15% off weekday lunch'],
        chefSpecials: ['[SAMPLE] Hyderabadi dum biryani'],
        // The twins keep their own hand-written data for demo-r1; these fields are unused for it.
        menu: [], offers: [], slug: 'demo-kitchen',
        ordering: resolveOrderingSettings({}), delivery: resolveDeliverySettings({}),
        content: { heroImages: [] }, contentPublished: true, orders: [], posts: [],
        strategyTheme: '[SAMPLE] Comfort food for busy weekdays',
        strategyFocus: ['Weekday lunch', 'Chef specials'],
        orderPrefix: 'RP-DEMO',
    },
    {
        id: 'demo-r2',
        loginPhone: '9000000002',
        name: '[SAMPLE] Coastal Curry House',
        cuisine: 'Kerala & seafood',
        city: 'Kochi',
        area: 'Fort Kochi',
        address: '[SAMPLE] 4 Harbour Lane, Fort Kochi, Kochi',
        lat: 9.9658, lng: 76.2421,
        description: '[SAMPLE] Kerala home cooking by the harbour: fish curries, appams and seafood fry.',
        blurb: 'Delivery and dine-in, rider booked automatically when food is ready, weekend offer live.',
        ownerName: '[SAMPLE] Thomas Varghese',
        instagramHandle: 'coastal_curry_sample',
        activeOffers: ['[SAMPLE] Free appam with every curry on weekends'],
        chefSpecials: ['[SAMPLE] Karimeen pollichathu'],
        menu: [
            { category: '[SAMPLE] Small plates', items: [
                { name: 'Kallumakkaya Fry', price: 340, isVeg: false, desc: 'Mussels, chilli, curry leaf' },
                { name: 'Banana Chips', price: 90, isVeg: true },
            ] },
            { category: '[SAMPLE] Curries', items: [
                { name: 'Kerala Fish Curry', price: 420, isVeg: false, best: true, desc: 'Kudampuli and coconut', addons: [['Extra appam', 40]] },
                { name: 'Prawn Moilee', price: 480, isVeg: false },
                { name: 'Vegetable Stew', price: 260, isVeg: true, variants: [['Regular', 260], ['Family', 460]] },
            ] },
            { category: '[SAMPLE] Breads & rice', items: [
                { name: 'Appam (2 pcs)', price: 80, isVeg: true, best: true },
                { name: 'Kerala Parotta', price: 60, isVeg: true },
            ] },
            { category: '[SAMPLE] Desserts', items: [
                { name: 'Palada Payasam', price: 150, isVeg: true, out: true },
            ] },
        ],
        offers: [
            offer('demo-r2-offer-1', 'demo-r2', {
                title: '[SAMPLE] Weekend appam', reward: { kind: 'flat_off', amount: 80 }, minOrderValue: 600,
                schedule: { startsAt: '2026-11-01T00:00:00.000Z', days: ['sat', 'sun'] }, promoteInContent: true,
            }),
            offer('demo-r2-offer-2', 'demo-r2', {
                title: '[SAMPLE] First order', reward: { kind: 'percent_off', percent: 10, maxDiscount: 100 }, code: 'HELLO10',
            }),
        ],
        slug: 'coastal-curry-house',
        ordering: resolveOrderingSettings({
            storeOpen: true, taxRatePercent: 5, cashAccepted: true,
            delivery: { enabled: true, flatFee: 50, minOrder: 300, freeAbove: 1000 },
            pickup: { enabled: true }, dineIn: { enabled: true },
        }),
        delivery: resolveDeliverySettings({ dispatchEnabled: true, dispatchAt: 'READY', providers: ['mock', 'self'] }),
        content: {
            heroImages: [],
            tagline: '[SAMPLE] Coconut, curry leaf and the catch of the day',
            announcement: { text: '[SAMPLE] Free appam with every curry this weekend', enabled: true },
            about: '[SAMPLE] Three generations of Fort Kochi cooks, one harbour-side kitchen.',
            hours: hours('12:00', '22:30', ['Monday']),
            contact: { phone: '+91 00000 00002', address: '[SAMPLE] 4 Harbour Lane, Fort Kochi' },
            seo: { title: '[SAMPLE] Coastal Curry House', description: '[SAMPLE] Kerala seafood in Fort Kochi.' },
        },
        contentPublished: true,
        orders: [
            { status: 'RECEIVED', type: 'delivery', customer: '[SAMPLE] Anjali', items: [['Kerala Fish Curry', 1], ['Appam (2 pcs)', 2]], ageMin: 2, street: '[SAMPLE] 9 Beach Road', notes: 'Extra gravy' },
            { status: 'READY', type: 'delivery', customer: '[SAMPLE] Joseph', items: [['Prawn Moilee', 1], ['Kerala Parotta', 3]], ageMin: 18, street: '[SAMPLE] 22 Princess Street' },
            { status: 'PREPARING', type: 'dine_in', customer: '[SAMPLE] Table guests', items: [['Kallumakkaya Fry', 1], ['Vegetable Stew', 1]], ageMin: 9, cash: true, table: '7' },
            { status: 'COMPLETED', type: 'pickup', customer: '[SAMPLE] Mariam', items: [['Kerala Fish Curry', 2]], ageMin: 240 },
        ],
        posts: [
            { type: 'IMAGE', status: 'PENDING_APPROVAL', platform: 'INSTAGRAM', label: 'Fish Curry', caption: '[SAMPLE] Kudampuli, coconut and the morning catch. Kerala fish curry, the way Ammachi made it.', dayOffset: 1, hour: 13, hue: 15 },
            { type: 'REEL', status: 'SCHEDULED', platform: 'INSTAGRAM', label: 'Appam Reel', caption: '[SAMPLE] Lacy edges, soft centre. Watch the appam pan at work.', dayOffset: 2, hour: 19, hue: 45 },
            { type: 'IMAGE', status: 'POSTED', platform: 'FACEBOOK', label: 'Weekend Appam', caption: '[SAMPLE] Free appam with every curry, Saturday and Sunday.', dayOffset: -3, hour: 18, hue: 190, stats: { likes: 96, shares: 14, comments: 9, reach: 1480 } },
        ],
        strategyTheme: '[SAMPLE] Seafood weekends and harbour sunsets',
        strategyFocus: ['Weekend offer', 'Seafood'],
        orderPrefix: 'CCH-',
    },
    {
        id: 'demo-r3',
        loginPhone: '9000000003',
        name: '[SAMPLE] Bombay Chaat Co.',
        cuisine: 'Street food & chaat',
        city: 'Mumbai',
        area: 'Bandra West',
        address: '[SAMPLE] 31 Hill Road, Bandra West, Mumbai',
        lat: 19.0544, lng: 72.8406,
        description: '[SAMPLE] Pani puri, pav bhaji and vada pav, made to order.',
        blurb: 'Pickup and dine-in only (no delivery), cash at the counter, quick turnover.',
        ownerName: '[SAMPLE] Rohan Mehta',
        instagramHandle: 'bombay_chaat_sample',
        activeOffers: ['[SAMPLE] Combo: pav bhaji + lassi'],
        chefSpecials: ['[SAMPLE] Cheese chilli pav bhaji'],
        menu: [
            { category: '[SAMPLE] Chaat', items: [
                { name: 'Pani Puri', price: 70, isVeg: true, best: true },
                { name: 'Sev Puri', price: 90, isVeg: true },
                { name: 'Dahi Batata Puri', price: 110, isVeg: true },
            ] },
            { category: '[SAMPLE] Pav', items: [
                { name: 'Pav Bhaji', price: 160, isVeg: true, best: true, variants: [['Regular', 160], ['Cheese', 200]], addons: [['Extra pav', 30]] },
                { name: 'Vada Pav', price: 40, isVeg: true },
            ] },
            { category: '[SAMPLE] Drinks', items: [
                { name: 'Sweet Lassi', price: 80, isVeg: true },
                { name: 'Masala Chaas', price: 50, isVeg: true },
            ] },
        ],
        offers: [
            offer('demo-r3-offer-1', 'demo-r3', {
                title: '[SAMPLE] Pav bhaji + lassi combo', reward: { kind: 'flat_off', amount: 30 }, minOrderValue: 240,
                scope: { kind: 'all' }, promoteInContent: true,
            }),
            offer('demo-r3-offer-2', 'demo-r3', {
                title: '[SAMPLE] Monsoon special', reward: { kind: 'percent_off', percent: 20, maxDiscount: 80 },
                schedule: { startsAt: '2026-06-01T00:00:00.000Z', endsAt: '2026-09-30T23:59:00.000Z' }, status: 'archived',
            }),
        ],
        slug: 'bombay-chaat-co',
        ordering: resolveOrderingSettings({
            storeOpen: true, taxRatePercent: 5, cashAccepted: true,
            delivery: { enabled: false, flatFee: 0, minOrder: 0 },
            pickup: { enabled: true }, dineIn: { enabled: true },
        }),
        delivery: resolveDeliverySettings({ dispatchEnabled: false, providers: ['self'] }),
        content: {
            heroImages: [],
            tagline: '[SAMPLE] Bandra’s favourite chaat stop since 2009',
            about: '[SAMPLE] Street-side flavours, made fresh in front of you.',
            hours: hours('16:00', '23:30'),
            contact: { phone: '+91 00000 00003' },
            seo: { title: '[SAMPLE] Bombay Chaat Co.', description: '[SAMPLE] Chaat and pav bhaji in Bandra.' },
        },
        contentPublished: true,
        orders: [
            { status: 'RECEIVED', type: 'pickup', customer: '[SAMPLE] Neha', items: [['Pani Puri', 2], ['Sweet Lassi', 2]], ageMin: 1 },
            { status: 'PREPARING', type: 'dine_in', customer: '[SAMPLE] Table guests', items: [['Pav Bhaji', 2], ['Masala Chaas', 2]], ageMin: 6, cash: true, table: '3' },
            { status: 'READY', type: 'pickup', customer: '[SAMPLE] Arjun', items: [['Vada Pav', 4]], ageMin: 11, cash: true },
            { status: 'COMPLETED', type: 'dine_in', customer: '[SAMPLE] Table guests', items: [['Sev Puri', 1], ['Dahi Batata Puri', 1]], ageMin: 95, table: '1' },
            { status: 'CANCELLED', type: 'pickup', customer: '[SAMPLE] Kabir', items: [['Pav Bhaji', 1]], ageMin: 130 },
        ],
        posts: [
            { type: 'CAROUSEL', status: 'PENDING_APPROVAL', platform: 'INSTAGRAM', label: 'Chaat Platter', caption: '[SAMPLE] Tangy, crunchy, spicy. Which one are you ordering first?', dayOffset: 1, hour: 17, hue: 50 },
            { type: 'STORY', status: 'PENDING_APPROVAL', platform: 'INSTAGRAM', label: 'Rain Special', caption: '[SAMPLE] Rain outside, hot vada pav inside.', dayOffset: 1, hour: 18, hue: 210 },
            { type: 'IMAGE', status: 'POSTED', platform: 'INSTAGRAM', label: 'Pav Bhaji', caption: '[SAMPLE] Butter on butter. Cheese pav bhaji is here.', dayOffset: -1, hour: 19, hue: 25, stats: { likes: 512, shares: 61, comments: 74, reach: 8120 } },
        ],
        strategyTheme: '[SAMPLE] Evening snack cravings',
        strategyFocus: ['Combos', 'Evening rush'],
        orderPrefix: 'BCC-',
    },
    {
        id: 'demo-r4',
        loginPhone: '9000000004',
        name: '[SAMPLE] Delhi Tandoor Room',
        cuisine: 'North Indian & Mughlai',
        city: 'New Delhi',
        area: 'Hauz Khas',
        address: '[SAMPLE] 8 Village Lane, Hauz Khas, New Delhi',
        lat: 28.5535, lng: 77.1946,
        description: '[SAMPLE] Kebabs, curries and breads from a charcoal tandoor.',
        blurb: 'Just joined: website not set up, ordering closed, no orders yet. Try setting it up.',
        ownerName: '[SAMPLE] Simran Kaur',
        instagramHandle: 'delhi_tandoor_sample',
        activeOffers: [],
        chefSpecials: ['[SAMPLE] Galouti kebab'],
        menu: [
            { category: '[SAMPLE] Kebabs', items: [
                { name: 'Galouti Kebab', price: 420, isVeg: false, best: true },
                { name: 'Tandoori Malai Broccoli', price: 320, isVeg: true },
            ] },
            { category: '[SAMPLE] Curries', items: [
                { name: 'Butter Chicken', price: 460, isVeg: false, best: true, variants: [['Half', 300], ['Full', 460]] },
                { name: 'Paneer Lababdar', price: 380, isVeg: true },
            ] },
            { category: '[SAMPLE] Breads', items: [
                { name: 'Garlic Naan', price: 80, isVeg: true },
                { name: 'Lachha Paratha', price: 70, isVeg: true },
            ] },
        ],
        offers: [],
        slug: null,
        ordering: resolveOrderingSettings({}),
        delivery: resolveDeliverySettings({}),
        content: {
            heroImages: [],
            tagline: '[SAMPLE] Charcoal, smoke and slow-cooked gravies',
            about: '[SAMPLE] A new tandoor kitchen in Hauz Khas village.',
        },
        contentPublished: false,
        orders: [],
        posts: [
            { type: 'IMAGE', status: 'PENDING_APPROVAL', platform: 'INSTAGRAM', label: 'Galouti Kebab', caption: '[SAMPLE] Melt-in-the-mouth galouti, straight off the tawa. We open for orders soon.', dayOffset: 2, hour: 19, hue: 10 },
        ],
        strategyTheme: '[SAMPLE] Launch month: introduce the kitchen',
        strategyFocus: ['Launch', 'Signature kebabs'],
        orderPrefix: 'DTR-',
    },
];

export function demoProfile(id: string): DemoRestaurantProfile {
    return DEMO_RESTAURANTS.find((r) => r.id === id) ?? DEMO_RESTAURANTS[0];
}

/** The restaurant the demo is signed in as (the real app's `rp_restaurant_id`). */
export function currentDemoRestaurantId(): string {
    try {
        const id = typeof localStorage !== 'undefined' ? localStorage.getItem('rp_restaurant_id') : null;
        if (id && DEMO_RESTAURANTS.some((r) => r.id === id)) return id;
    } catch {
        /* storage blocked: fall back to the default sample */
    }
    return DEFAULT_DEMO_RESTAURANT_ID;
}

/** Login number -> sample restaurant. Any other number signs in as the first one. */
export function demoRestaurantForPhone(phone: string): DemoRestaurantProfile {
    const digits = phone.replace(/\D/g, '').slice(-10);
    return DEMO_RESTAURANTS.find((r) => r.loginPhone === digits) ?? DEMO_RESTAURANTS[0];
}

/** Per-restaurant state for a demo twin: built lazily, kept until reset. */
export function perRestaurant<T>(build: (id: string) => T): { get: () => T; peek: (id: string) => T; reset: () => void } {
    const states = new Map<string, T>();
    const peek = (id: string): T => {
        let s = states.get(id);
        if (!s) {
            s = build(id);
            states.set(id, s);
        }
        return s;
    };
    return {
        get: () => peek(currentDemoRestaurantId()),
        peek,
        reset: () => states.clear(),
    };
}

// ---------------------------------------------------------------------------
// Builders for restaurants other than demo-r1
// ---------------------------------------------------------------------------

export function buildMenu(p: DemoRestaurantProfile): { categories: MenuCategory[]; items: OrderingMenuItem[] } {
    const categories: MenuCategory[] = [];
    const items: OrderingMenuItem[] = [];
    p.menu.forEach((cat, ci) => {
        const categoryId = `${p.id}-cat-${ci + 1}`;
        categories.push({ id: categoryId, restaurantId: p.id, name: cat.category, sortOrder: ci + 1 });
        cat.items.forEach((it, ii) => {
            items.push({
                id: `${p.id}-item-${ci + 1}-${ii + 1}`, restaurantId: p.id, categoryId, name: it.name, price: it.price, isVeg: it.isVeg,
                sortOrder: ii + 1, availability: it.out ? 'out_of_stock' : 'in_stock', images: [],
                variants: (it.variants ?? []).map(([name, price], vi) => ({ id: `v${vi + 1}`, name, price })),
                addons: (it.addons ?? []).map(([name, price], ai) => ({ id: `a${ai + 1}`, name, price })),
                ...(it.best ? { isBestSeller: true } : {}),
                ...(it.desc ? { description: it.desc } : {}),
            });
        });
    });
    return { categories, items };
}

export function buildOrders(p: DemoRestaurantProfile): AdminOrder[] {
    const { items } = buildMenu(p);
    const at = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
    return p.orders.map((o, i) => {
        const lines = o.items.map(([name, qty]) => {
            const item = items.find((x) => x.name === name);
            const unitPrice = item?.price ?? 100;
            return { menuItemId: item?.id ?? `${p.id}-item-x`, categoryId: item?.categoryId ?? `${p.id}-cat-x`, name, qty, unitPrice, lineTotal: unitPrice * qty };
        });
        const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
        const d = p.ordering.delivery;
        const deliveryFee = o.type === 'delivery' ? d.flatFee : 0;
        const deliveryDiscount = o.type === 'delivery' && d.freeAbove && subtotal >= d.freeAbove ? deliveryFee : 0;
        const tax = Math.round((subtotal * p.ordering.taxRatePercent) / 100);
        const created = at(o.ageMin);
        const order: AdminOrder = {
            id: `${p.id}-ord-${i + 1}`, restaurantId: p.id, orderNumber: `${p.orderPrefix}${String(i + 1).padStart(2, '0')}`,
            orderType: o.type, status: o.status, statusHistory: [{ status: o.status, at: created, by: 'customer' }],
            items: lines,
            totals: { subtotal, discount: 0, deliveryFee, deliveryDiscount, tax, total: subtotal + deliveryFee - deliveryDiscount + tax },
            paymentMethod: o.cash ? 'cash' : 'online',
            paymentStatus: o.cash ? 'not_required' : o.status === 'CANCELLED' ? 'refunded' : 'paid',
            customerName: o.customer, customerPhone: '+910000000000',
            ...(o.type === 'delivery' ? { address: { line1: o.street ?? '[SAMPLE] Street', city: p.city } } : {}),
            ...(o.table ? { table: `T${o.table}` } : {}),
            ...(o.notes ? { notes: o.notes } : {}),
            ...(o.status === 'CANCELLED' ? { cancelReason: '[SAMPLE] Customer called to cancel' } : {}),
            createdAt: created, updatedAt: created,
        };
        return order;
    });
}
