/**
 * demo-backend.ts — in-browser stand-in for the RestroPulse API, used only by
 * demo builds (VITE_DEMO_MODE=true).
 *
 * The Phase 2 clients (cmsAPI, ordersAPI, deliveryAPI, sitesAPI,
 * intelligenceAPI) already swap to fixtures-backed twins in demo mode, but the
 * core SaaS calls (auth, restaurant, posts, strategy, subscriptions, config)
 * and the Login screen's direct fetch still go to the API URL. A static demo
 * deploy has no API, so login failed and nothing loaded.
 *
 * installDemoBackend() wraps window.fetch: requests aimed at the API are
 * answered from the [SAMPLE] data below; everything else (static assets) goes
 * to the real network. Nothing here ever reaches a server.
 */
import type {
    AccountManager, City, ContentStrategy, EntitlementState, FeatureFlags, Platform, Post, Restaurant, StrategyCycle,
    Subscription, SubscriptionPlan, User,
} from '@restropulse/shared';
import { isDemoMode, notifyDemoBackendAction } from './lib/demo';
import {
    buildMenu, createSignedUpRestaurant, demoProfile, demoRestaurantForPhone, pendingSignupPhone,
    perRestaurant, resetDemoSignups, setPendingSignupPhone, signedUpProfile, updateSignedUpRestaurant,
    type DemoRestaurantProfile, type DemoSignupProfile,
} from './lib/demo-restaurants';

const RID = 'demo-r1';
const DEMO_OTP = '123456';

const day = 24 * 60 * 60 * 1000;
const iso = (offsetDays: number, hour = 12): string => {
    const d = new Date(Date.now() + offsetDays * day);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
};

/** Inline SVG thumbnail so posts render without any external image host. */
function thumb(label: string, hue: number): string {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">`
        + `<rect width="600" height="600" fill="hsl(${hue},60%,62%)"/>`
        + `<text x="300" y="300" font-family="sans-serif" font-size="40" fill="white" text-anchor="middle" dominant-baseline="middle">${label}</text>`
        + `</svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

interface DemoBackendState {
    user: User;
    restaurant: Restaurant;
    posts: Post[];
    strategy: ContentStrategy;
    cycles: StrategyCycle[];
}

function buildState(id: string): DemoBackendState {
    const signup = signedUpProfile(id);
    if (signup) return buildFromSignup(signup);
    if (id !== RID) return buildFromProfile(demoProfile(id));
    const profile = demoProfile(RID);
    const user: User = {
        id: 'demo-user-1',
        name: profile.ownerName,
        email: 'owner@demo-kitchen.example',
        phone: `+91${profile.loginPhone}`,
        role: 'OWNER',
        emailVerified: true,
        restaurantId: RID,
    };
    const restaurant: Restaurant = {
        id: RID,
        name: '[SAMPLE] RestroPulse Demo Kitchen',
        cuisine: 'Biryani & North Indian',
        description: '[SAMPLE] A family kitchen serving slow-cooked biryani, kebabs and curries.',
        phone: '+91 80 0000 0000',
        priceRange: 'mid-range',
        location: { address: '[SAMPLE] 12 Sample Street, Indiranagar, Bengaluru', lat: 12.9719, lng: 77.6412, mapUrl: '' },
        accountManager: { name: '[SAMPLE] Account Manager', phone: '+91 80 0000 0001', email: 'manager@restropulse.example', avatar: '' },
        // A sample connection, so approving and creating posts can be tried. Nothing is ever published.
        integrations: { instagram: true },
        instagramConnection: { connected: true, username: 'demo_kitchen_sample', pageName: '[SAMPLE] RestroPulse Demo Kitchen', tokenStatus: 'valid' },
        activeOffers: ['[SAMPLE] 15% off weekday lunch'],
        chefSpecials: ['[SAMPLE] Hyderabadi dum biryani'],
        menuLastUpdated: iso(-3),
        menuSource: 'catalog',
        slug: 'demo-kitchen',
        operatingHours: {
            weekday_text: [
                'Monday: 11:00 AM - 10:30 PM', 'Tuesday: 11:00 AM - 10:30 PM', 'Wednesday: 11:00 AM - 10:30 PM',
                'Thursday: 11:00 AM - 10:30 PM', 'Friday: 11:00 AM - 11:00 PM', 'Saturday: 11:00 AM - 11:00 PM',
                'Sunday: 11:00 AM - 10:00 PM',
            ],
        },
        serviceOptions: { delivery: true, dineIn: true, takeout: true },
        menu: [
            { id: 'demo-m1', category: '[SAMPLE] Starters', name: 'Paneer Tikka', price: 280, isVeg: true, isBestSeller: true, isAvailable: true },
            { id: 'demo-m2', category: '[SAMPLE] Starters', name: 'Chicken 65', price: 320, isVeg: false, isAvailable: true },
            { id: 'demo-m3', category: '[SAMPLE] Mains', name: 'Hyderabadi Dum Biryani', price: 420, isVeg: false, isBestSeller: true, isAvailable: true },
            { id: 'demo-m4', category: '[SAMPLE] Mains', name: 'Dal Makhani', price: 260, isVeg: true, isAvailable: true },
            { id: 'demo-m5', category: '[SAMPLE] Desserts', name: 'Double Ka Meetha', price: 180, isVeg: true, isAvailable: true },
        ],
        sourceCity: 'Bengaluru',
        autoContentEnabled: false,
    };
    const posts: Post[] = [
        { id: 'demo-post-1', type: 'IMAGE', status: 'PENDING_APPROVAL', platform: 'INSTAGRAM', restaurantId: RID,
          thumbnail: thumb('Dum Biryani', 20), caption: '[SAMPLE] Sealed, slow-cooked and fragrant. Our Hyderabadi dum biryani is back on the lunch menu.',
          scheduledFor: iso(1, 13), archetype: 'CHEFS_PICK' },
        { id: 'demo-post-2', type: 'CAROUSEL', status: 'PENDING_APPROVAL', platform: 'FACEBOOK', restaurantId: RID,
          thumbnail: thumb('Weekday Lunch', 200), mediaUrls: [thumb('Weekday Lunch', 200), thumb('Thali', 160)],
          caption: '[SAMPLE] Weekday lunch, sorted. 15% off with code LUNCH15, Monday to Friday.', scheduledFor: iso(2, 12) },
        { id: 'demo-post-3', type: 'IMAGE', status: 'SCHEDULED', platform: 'INSTAGRAM', restaurantId: RID,
          thumbnail: thumb('Paneer Tikka', 40), caption: '[SAMPLE] Straight from the tandoor.', scheduledFor: iso(3, 19) },
        { id: 'demo-post-4', type: 'IMAGE', status: 'POSTED', platform: 'INSTAGRAM', restaurantId: RID,
          thumbnail: thumb('Double Ka Meetha', 330), caption: '[SAMPLE] Something sweet to end the week.', postedAt: iso(-2, 20),
          stats: { likes: 184, shares: 12, comments: 21, reach: 2310 } },
        { id: 'demo-post-5', type: 'REEL', status: 'POSTED', platform: 'INSTAGRAM', restaurantId: RID,
          thumbnail: thumb('Kitchen Reel', 270), caption: '[SAMPLE] Behind the pass on a Friday night.', postedAt: iso(-5, 21),
          duration: '0:24', stats: { likes: 402, shares: 37, comments: 48, reach: 6120 } },
    ];
    const strategy: ContentStrategy = {
        id: 'demo-strategy-1', restaurantId: RID, postsPerWeek: 4,
        focusCategories: ['CHEFS_PICK', 'OFFER_SPOTLIGHT', 'BEHIND_THE_SCENES'],
        bestTime: '7:00 PM', nextScheduledDate: iso(1, 19), theme: '[SAMPLE] Comfort food for busy weekdays',
    };
    const cycles: StrategyCycle[] = [
        { id: 'demo-cycle-1', restaurantId: RID, period: 'This week', startDate: iso(-2, 0), endDate: iso(5, 0), status: 'ACTIVE',
          summary: '[SAMPLE] Push weekday lunch and the chef specials, with one behind-the-scenes reel.',
          plannedPosts: [{ category: 'OFFER_SPOTLIGHT', count: 2 }, { category: 'CHEFS_PICK', count: 1 }, { category: 'BEHIND_THE_SCENES', count: 1 }],
          focus: ['Weekday lunch', 'Chef specials'] },
        { id: 'demo-cycle-2', restaurantId: RID, period: 'Next week', startDate: iso(5, 0), endDate: iso(12, 0), status: 'PENDING_APPROVAL',
          summary: '[SAMPLE] Weekend family dinners and the new dessert.',
          plannedPosts: [{ category: 'CHEFS_PICK', count: 2 }, { category: 'OFFER_SPOTLIGHT', count: 2 }],
          focus: ['Family dinners', 'Desserts'] },
    ];
    return { user, restaurant, posts, strategy, cycles };
}


function buildFromProfile(p: DemoRestaurantProfile): DemoBackendState {
    const user: User = {
        id: `${p.id}-owner`, name: p.ownerName, email: `owner@${p.instagramHandle.replace(/_/g, '-')}.example`,
        phone: `+91${p.loginPhone}`, role: 'OWNER', emailVerified: true, restaurantId: p.id,
    };
    const { categories, items } = buildMenu(p);
    const restaurant: Restaurant = {
        id: p.id, name: p.name, cuisine: p.cuisine, description: p.description,
        phone: p.content.contact?.phone, priceRange: 'mid-range',
        location: { address: p.address, lat: p.lat, lng: p.lng, mapUrl: '' },
        accountManager: { name: '[SAMPLE] Account Manager', phone: '+91 80 0000 0001', email: 'manager@restropulse.example', avatar: '' },
        integrations: { instagram: true },
        instagramConnection: { connected: true, username: p.instagramHandle, pageName: p.name, tokenStatus: 'valid' },
        activeOffers: [...p.activeOffers], chefSpecials: [...p.chefSpecials],
        menuLastUpdated: iso(-2), menuSource: 'catalog',
        ...(p.slug ? { slug: p.slug } : {}),
        ...(p.content.hours?.length ? { operatingHours: { weekday_text: p.content.hours.map((h) => (h.closed ? `${h.day}: Closed` : `${h.day}: ${h.open} - ${h.close}`)) } } : {}),
        serviceOptions: { delivery: p.ordering.delivery.enabled, dineIn: p.ordering.dineIn.enabled, takeout: p.ordering.pickup.enabled },
        menu: items.map((it) => ({
            id: it.id, category: categories.find((c) => c.id === it.categoryId)?.name ?? '', name: it.name, price: it.price,
            isVeg: it.isVeg, isBestSeller: it.isBestSeller, isAvailable: it.availability === 'in_stock',
        })),
        sourceCity: p.city,
        autoContentEnabled: false,
    };
    const posts: Post[] = p.posts.map((post, i) => ({
        id: `${p.id}-post-${i + 1}`, type: post.type, status: post.status, platform: post.platform, restaurantId: p.id,
        thumbnail: thumb(post.label, post.hue), caption: post.caption,
        ...(post.status === 'POSTED' ? { postedAt: iso(post.dayOffset, post.hour) } : { scheduledFor: iso(post.dayOffset, post.hour) }),
        ...(post.stats ? { stats: post.stats } : {}),
    }));
    const strategy: ContentStrategy = {
        id: `${p.id}-strategy`, restaurantId: p.id, postsPerWeek: 3,
        focusCategories: ['CHEFS_PICK', 'OFFER_SPOTLIGHT'], bestTime: '7:00 PM', nextScheduledDate: iso(1, 19), theme: p.strategyTheme,
    };
    const cycles: StrategyCycle[] = [
        { id: `${p.id}-cycle-1`, restaurantId: p.id, period: 'This week', startDate: iso(-2, 0), endDate: iso(5, 0), status: 'ACTIVE',
          summary: `${p.strategyTheme}.`, plannedPosts: [{ category: 'CHEFS_PICK', count: 2 }, { category: 'OFFER_SPOTLIGHT', count: 1 }],
          focus: [...p.strategyFocus] },
        { id: `${p.id}-cycle-2`, restaurantId: p.id, period: 'Next week', startDate: iso(5, 0), endDate: iso(12, 0), status: 'PENDING_APPROVAL',
          summary: `[SAMPLE] Keep the momentum: ${p.strategyFocus.join(' and ').toLowerCase()}.`,
          plannedPosts: [{ category: 'CHEFS_PICK', count: 1 }, { category: 'BEHIND_THE_SCENES', count: 1 }, { category: 'OFFER_SPOTLIGHT', count: 1 }],
          focus: [...p.strategyFocus] },
    ];
    return { user, restaurant, posts, strategy, cycles };
}

/**
 * A restaurant that just finished onboarding: what the owner typed and
 * nothing else. No menu, posts, offers or website yet, and Instagram not
 * connected, like a real first sign-in. Its first strategy cycle waits for
 * approval, as the live app prepares one right after onboarding.
 */
function buildFromSignup(p: DemoSignupProfile): DemoBackendState {
    const user: User = {
        id: `${p.id}-owner`, name: p.ownerName, email: p.signup.email, phone: `+91${p.loginPhone}`,
        role: 'OWNER', emailVerified: true, restaurantId: p.id,
    };
    const connected = !!p.signup.instagramConnected;
    const restaurant: Restaurant = {
        id: p.id, name: p.name, cuisine: p.cuisine, description: '',
        location: { address: p.address, lat: p.lat, lng: p.lng, mapUrl: p.signup.mapUrl },
        accountManager: { ...p.signup.accountManager },
        integrations: { instagram: connected },
        instagramConnection: connected
            ? { connected: true, username: p.instagramHandle, pageName: p.name, tokenStatus: 'valid' }
            : { connected: false },
        activeOffers: [], chefSpecials: [], menu: [],
        sourceCity: p.city,
        autoContentEnabled: false,
    };
    const strategy: ContentStrategy = {
        id: `${p.id}-strategy`, restaurantId: p.id, postsPerWeek: 3,
        focusCategories: ['CHEFS_PICK', 'OFFER_SPOTLIGHT'], bestTime: '7:00 PM', nextScheduledDate: iso(1, 19),
        theme: `[SAMPLE] ${p.strategyTheme}`,
    };
    const cycles: StrategyCycle[] = [
        { id: `${p.id}-cycle-1`, restaurantId: p.id, period: 'This week', startDate: iso(0, 0), endDate: iso(7, 0), status: 'PENDING_APPROVAL',
          summary: `[SAMPLE] A first week to introduce ${p.name}: what you cook, who you are and where to find you.`,
          plannedPosts: [{ category: 'CHEFS_PICK', count: 2 }, { category: 'BEHIND_THE_SCENES', count: 1 }],
          focus: [...p.strategyFocus] },
    ];
    return { user, restaurant, posts: [], strategy, cycles };
}

// ---------------------------------------------------------------------------
// Sign-up (a number that isn't one of the samples)
// ---------------------------------------------------------------------------

/** Signed in with a new number, onboarding not finished: no restaurant yet. */
function pendingUser(phone: string): User {
    return { id: 'demo-new-owner', name: '', email: '', phone, role: 'OWNER', emailVerified: false, restaurantId: '' };
}

const signedInRestaurantId = (): string | null => {
    try {
        return localStorage.getItem('rp_restaurant_id');
    } catch {
        return null;
    }
};

/** The session's user: the new owner mid-onboarding, or the signed-in restaurant's owner. */
function sessionUser(): User {
    const pending = pendingSignupPhone();
    if (pending && !signedInRestaurantId()) return pendingUser(pending);
    return S().user;
}

const DEMO_CITIES: Array<{ name: string; zones: string[] }> = [
    { name: 'Bengaluru', zones: ['Indiranagar', 'Koramangala'] },
    { name: 'Mumbai', zones: ['Bandra', 'Lower Parel'] },
    { name: 'New Delhi', zones: ['Hauz Khas', 'Connaught Place'] },
    { name: 'Hyderabad', zones: ['Banjara Hills', 'Gachibowli'] },
    { name: 'Chennai', zones: ['T. Nagar', 'Adyar'] },
    { name: 'Kochi', zones: ['Fort Kochi', 'Kakkanad'] },
    { name: 'Pune', zones: ['Koregaon Park', 'Baner'] },
];

const cities: City[] = DEMO_CITIES.map((c) => ({ id: c.name.toLowerCase().replace(/[^a-z]+/g, '-'), name: c.name, defaultZone: c.zones[0] }));

const MANAGER_NAMES = ['Priya', 'Arjun', 'Neha', 'Karthik'];

function accountManagers(city: string, zone: string | null): AccountManager[] {
    const c = DEMO_CITIES.find((x) => x.name.toLowerCase() === city.toLowerCase());
    if (!c) return [];
    return c.zones
        .filter((z) => !zone || z === zone)
        .map((z) => {
            const n = c.zones.indexOf(z) + DEMO_CITIES.indexOf(c);
            const name = MANAGER_NAMES[n % MANAGER_NAMES.length];
            return {
                id: `demo-am-${cities.find((x) => x.name === c.name)!.id}-${c.zones.indexOf(z) + 1}`,
                name: `[SAMPLE] ${name}`, phone: '+91 80 0000 0001', email: `${name.toLowerCase()}@restropulse.example`,
                avatar: '', city: c.name, zone: z,
            };
        });
}

/** Onboarding's POST /restaurant: saves a new, empty restaurant in this browser. */
function createRestaurant(body: any): DemoReply {
    const phone = pendingSignupPhone();
    if (!phone || signedInRestaurantId()) {
        // A sample owner (already has a restaurant) re-running setup: keep theirs.
        return { body: { success: true, data: { restaurant: S().restaurant, token: 'demo-token', refreshToken: 'demo-refresh-token' } } };
    }
    const text = (v: unknown, fallback = ''): string => (typeof v === 'string' && v.trim() ? v.trim() : fallback);
    const loc = body?.location ?? {};
    const am = body?.accountManager ?? {};
    const profile = createSignedUpRestaurant({
        phone,
        userName: text(body?.userName, 'Owner'),
        email: text(body?.email),
        name: text(body?.name, 'My Restaurant'),
        cuisine: text(body?.cuisine),
        city: text(body?.sourceCity, 'Bengaluru'),
        address: text(loc.address),
        lat: typeof loc.lat === 'number' ? loc.lat : 0,
        lng: typeof loc.lng === 'number' ? loc.lng : 0,
        mapUrl: text(loc.mapUrl),
        accountManager: { name: text(am.name), phone: text(am.phone), email: text(am.email), avatar: text(am.avatar) },
    });
    setPendingSignupPhone(null);
    const restaurant = store.peek(profile.id).restaurant;
    return { body: { success: true, data: { restaurant, token: 'demo-token', refreshToken: 'demo-refresh-token' } } };
}

/**
 * Instagram can't really be connected from the demo. For the signed-in
 * restaurant it marks a sample account as connected and points the popup at a
 * static page that tells the opener it worked, like the live OAuth callback.
 */
function simulateInstagramConnect(): DemoReply {
    const r = S().restaurant;
    const username = signedUpProfile(r.id)?.instagramHandle ?? r.instagramConnection?.username ?? 'demo_kitchen_sample';
    S().restaurant = {
        ...r, integrations: { ...r.integrations, instagram: true },
        instagramConnection: { connected: true, username, pageName: r.name, tokenStatus: 'valid' },
    };
    if (signedUpProfile(r.id)) updateSignedUpRestaurant(r.id, { instagramConnected: true });
    const params = new URLSearchParams({ username });
    return ok({ oauthUrl: `/demo-instagram-connect.html?${params.toString()}`, state: 'demo-state' });
}

// One account per restaurant; the signed-in one (rp_restaurant_id) is served.
const store = perRestaurant(buildState);
const S = store.get;

const features: FeatureFlags = {
    deleteAccount: false,
    topupCredits: false,
    updatesSection: true,
    minScheduleAheadMins: 150,
    postApprovalBufferMins: 120,
    cycleApprovalBufferMins: 4320,
    enabledPlatforms: ['INSTAGRAM', 'FACEBOOK'],
    webTheme: 'orchid-admin',
};

function subscription(): { subscription: Subscription; usage: Record<string, never>; entitlement: EntitlementState } {
    return {
        subscription: { id: 'demo-sub-1', restaurantId: S().restaurant.id, status: 'NONE', credits: 20, trialEndsAt: iso(14, 0) },
        usage: {},
        entitlement: { entitled: true, inTrial: true, activePlan: false, trialEndsAt: iso(14, 0), trialDaysLeft: 14 },
    };
}

const plans: SubscriptionPlan[] = [
    { id: 'demo-plan-starter', slug: 'starter', version: 1, isCurrentVersion: true, tier: 'STARTER', name: '[SAMPLE] Starter',
      limits: { weekly: { INSTAGRAM: { IMAGE: 3 } } }, pricing: { monthly: 99900, annual: 999000, currency: 'INR' },
      razorpayPlanIds: { monthly: '', annual: '' }, features: ['[SAMPLE] 3 posts a week'] },
    { id: 'demo-plan-growth', slug: 'growth', version: 1, isCurrentVersion: true, tier: 'GROWTH', name: '[SAMPLE] Growth',
      limits: { weekly: { INSTAGRAM: { IMAGE: 5, REEL: 1 }, FACEBOOK: { IMAGE: 3 } } }, pricing: { monthly: 249900, annual: 2499000, currency: 'INR' },
      razorpayPlanIds: { monthly: '', annual: '' }, features: ['[SAMPLE] 8 posts a week', '[SAMPLE] Reels'] },
];

// ---------------------------------------------------------------------------
// Request handling
// ---------------------------------------------------------------------------

interface DemoReply { status?: number; body: unknown }
type Handler = (m: RegExpMatchArray, body: any, query: URLSearchParams) => DemoReply | Promise<DemoReply>;

const ok = (data?: unknown): DemoReply => ({ body: data === undefined ? { success: true } : { success: true, data } });
const err = (status: number, message: string): DemoReply => ({ status, body: { success: false, message, error: message } });

function writeNotice(method: string): void {
    if (method !== 'GET') notifyDemoBackendAction();
}

const routes: Array<[string, RegExp, Handler]> = [
    // --- auth ---------------------------------------------------------------
    ['POST', /^\/auth\/send-otp$/, (_m, body) => {
        const phone = typeof body?.phone === 'string' ? body.phone : '';
        if (!/^\+91\d{10}$/.test(phone)) return err(400, 'Enter a 10-digit phone number.');
        return { body: { success: true, message: 'Demo preview: code filled in for you.', devOtp: DEMO_OTP } };
    }],
    ['POST', /^\/auth\/verify-otp$/, (_m, body) => {
        if (body?.otp !== DEMO_OTP) return err(400, `Demo preview: use code ${DEMO_OTP}.`);
        const phone = typeof body?.phone === 'string' ? body.phone : '';
        // A sample's number (or one signed up in this browser) signs in as that
        // restaurant; the client then stores its id as rp_restaurant_id.
        const profile = demoRestaurantForPhone(phone);
        if (!profile) {
            // Any other number is a new owner: no restaurant, so the app opens onboarding.
            setPendingSignupPhone(phone);
            return { body: { success: true, user: pendingUser(phone), token: 'demo-token', refreshToken: 'demo-refresh-token' } };
        }
        setPendingSignupPhone(null);
        const user = { ...store.peek(profile.id).user, phone };
        return { body: { success: true, user, token: 'demo-token', refreshToken: 'demo-refresh-token' } };
    }],
    ['POST', /^\/auth\/(login|firebase)$/, () => ({ body: { success: true, user: sessionUser(), token: 'demo-token', refreshToken: 'demo-refresh-token' } })],
    ['GET', /^\/auth\/session$/, () => ({ body: { success: true, user: sessionUser() } })],
    ['POST', /^\/auth\/refresh$/, () => ({ body: { success: true, token: 'demo-token' } })],
    ['POST', /^\/auth\/logout$/, () => { setPendingSignupPhone(null); return ok(); }],
    ['POST', /^\/auth\/verify-email$/, () => {
        if (!pendingSignupPhone()) S().user = { ...S().user, emailVerified: true };
        return ok();
    }],

    // --- config / billing ----------------------------------------------------
    ['GET', /^\/config\/features$/, () => ok(features)],
    ['GET', /^\/subscriptions\/current$/, () => ok(subscription())],
    ['GET', /^\/subscriptions\/plans$/, () => ok(plans)],
    ['POST', /^\/subscriptions\//, () => err(400, 'Payments are turned off in the demo preview.')],
    ['POST', /^\/coupons\/validate$/, () => err(400, 'Coupons are turned off in the demo preview.')],
    ['GET', /^\/credit-packs$/, () => ok([])],
    ['GET', /^\/invoices$/, () => ok([])],
    ['DELETE', /^\/account$/, () => err(400, 'Account deletion is turned off in the demo preview.')],

    // --- restaurant ------------------------------------------------------------
    ['GET', /^\/restaurant\/cities$/, () => ok(cities)],
    ['GET', /^\/restaurant\/account-managers$/, (_m, _body, q) => ok(accountManagers(q.get('city') ?? '', q.get('zone')))],
    ['GET', /^\/restaurant\/([^/]+)\/analytics$/, () => ok({
        postsPerWeek: [{ week: 1, posts: 3 }, { week: 2, posts: 4 }, { week: 3, posts: 4 }, { week: 4, posts: 5 }],
        contentMix: [{ type: 'IMAGE', count: 9 }, { type: 'CAROUSEL', count: 4 }, { type: 'REEL', count: 3 }],
        platformMix: [{ platform: 'INSTAGRAM', count: 12 }, { platform: 'FACEBOOK', count: 4 }],
    })],
    ['PATCH', /^\/restaurant\/([^/]+)\/(offers|specials)$/, (m, body) => {
        const key = m[2] === 'offers' ? 'activeOffers' : 'chefSpecials';
        const list = [...(S().restaurant[key] ?? [])];
        if (body?.action === 'ADD' && typeof body.payload === 'string') list.push(body.payload);
        if (body?.action === 'DELETE' && typeof body.payload === 'number') list.splice(body.payload, 1);
        S().restaurant = { ...S().restaurant, [key]: list };
        return ok(S().restaurant);
    }],
    ['PATCH', /^\/restaurant\/([^/]+)\/menu$/, () => {
        S().restaurant = { ...S().restaurant, menuLastUpdated: new Date().toISOString() };
        return ok(S().restaurant);
    }],
    ['GET', /^\/restaurant\/([^/]+)$/, () => ok(S().restaurant)],
    ['PUT', /^\/restaurant\/([^/]+)$/, (_m, body) => {
        S().restaurant = { ...S().restaurant, ...(body ?? {}), id: S().restaurant.id };
        return ok(S().restaurant);
    }],
    ['POST', /^\/restaurant$/, (_m, body) => createRestaurant(body)],

    // --- posts -------------------------------------------------------------------
    ['GET', /^\/posts$/, () => ok(S().posts)],
    ['POST', /^\/posts\/generate$/, (_m, body) => {
        const platforms: Platform[] = Array.isArray(body?.platforms) && body.platforms.length ? body.platforms : ['INSTAGRAM'];
        const concept = typeof body?.concept === 'string' && body.concept.trim() ? body.concept.trim() : 'today\'s special';
        const groupId = `demo-group-${Date.now()}`;
        const created: Post[] = platforms.map((platform, i) => ({
            id: `demo-post-${Date.now()}-${i}`, groupId, type: body?.type ?? 'IMAGE', status: 'PENDING_APPROVAL', platform,
            restaurantId: S().restaurant.id, isAdhoc: true, thumbnail: thumb('New post', 280 + i * 30),
            caption: `[SAMPLE] A caption written for "${concept}". In the live app this is written by AI from your menu and offers.`,
            scheduledFor: typeof body?.scheduledFor === 'string' ? body.scheduledFor : iso(1, 19),
        }));
        S().posts = [...created, ...S().posts];
        return ok(created);
    }],
    ['POST', /^\/posts\/([^/]+)\/publish$/, (m) => {
        const post = S().posts.find((p) => p.id === m[1]);
        if (!post) return err(404, 'Post not found');
        Object.assign(post, { status: 'POSTED', postedAt: new Date().toISOString() });
        return ok(post);
    }],
    ['GET', /^\/posts\/([^/]+)\/download$/, () => err(400, 'Downloads are turned off in the demo preview.')],
    ['GET', /^\/posts\/([^/]+)$/, (m) => {
        const post = S().posts.find((p) => p.id === m[1]);
        return post ? ok(post) : err(404, 'Post not found');
    }],
    ['PUT', /^\/posts\/([^/]+)$/, (m, body) => {
        const post = S().posts.find((p) => p.id === m[1]);
        if (!post) return err(404, 'Post not found');
        Object.assign(post, body ?? {}, { id: post.id });
        return ok(post);
    }],
    ['PATCH', /^\/posts\/([^/]+)$/, (m, body) => {
        const post = S().posts.find((p) => p.id === m[1]);
        if (!post) return err(404, 'Post not found');
        Object.assign(post, body ?? {}, { id: post.id });
        return ok(post);
    }],
    ['DELETE', /^\/posts\/([^/]+)$/, (m) => {
        S().posts = S().posts.filter((p) => p.id !== m[1]);
        return ok();
    }],
    ['POST', /^\/posts$/, (_m, body) => {
        const post: Post = {
            id: `demo-post-${Date.now()}`, type: 'IMAGE', status: 'PENDING_CONTENT', platform: 'INSTAGRAM', restaurantId: S().restaurant.id,
            thumbnail: thumb('New post', 280), caption: '', isAdhoc: true, ...(body ?? {}),
        };
        S().posts = [post, ...S().posts];
        return ok(post);
    }],

    // --- strategy ----------------------------------------------------------------
    ['GET', /^\/strategy$/, () => ok({ ...S().strategy, suggestCreateCycle: false })],
    ['PUT', /^\/strategy$/, (_m, body) => { S().strategy = { ...S().strategy, ...(body ?? {}) }; return ok(S().strategy); }],
    ['GET', /^\/strategy\/cycles$/, () => ok(S().cycles)],
    ['GET', /^\/strategy\/cycles\/([^/]+)$/, (m) => {
        const cycle = S().cycles.find((c) => c.id === m[1]);
        return cycle ? ok(cycle) : err(404, 'Cycle not found');
    }],
    ['PUT', /^\/strategy\/cycles\/([^/]+)$/, (m, body) => {
        const cycle = S().cycles.find((c) => c.id === m[1]);
        if (!cycle) return err(404, 'Cycle not found');
        Object.assign(cycle, body ?? {}, { id: cycle.id });
        return ok(cycle);
    }],
    ['POST', /^\/strategy\/cycles$/, (_m, body) => {
        const cycle = { ...(body ?? {}), id: `demo-cycle-${Date.now()}`, restaurantId: S().restaurant.id } as StrategyCycle;
        S().cycles = [...S().cycles, cycle];
        return ok(cycle);
    }],

    // --- integrations ------------------------------------------------------------
    ['GET', /^\/integrations\/config$/, () => ok({ instagram: { configured: true } })],
    ['GET', /^\/integrations\/instagram\/status\/([^/]+)$/, () => ok(S().restaurant.instagramConnection ?? { connected: false })],
    ['GET', /^\/integrations\/instagram\/profile\/([^/]+)$/, () => {
        const r = S().restaurant;
        if (!r.integrations.instagram) return ok(null);
        const fresh = !!signedUpProfile(r.id);
        return ok({
            username: r.instagramConnection?.username ?? 'demo_kitchen_sample', name: r.name,
            followers_count: fresh ? 0 : 2480, media_count: fresh ? 0 : 86,
        });
    }],
    ['GET', /^\/integrations\/instagram\/oauth-url$/, () => simulateInstagramConnect()],
    ['GET', /^\/integrations\/instagram\//, () => err(400, 'Connecting Instagram is turned off in the demo preview.')],
    ['POST', /^\/integrations\/instagram\/validate\/([^/]+)$/, () => ok({ valid: S().restaurant.integrations.instagram, needsReauthorization: false })],
    ['POST', /^\/integrations\/instagram\/refresh\/([^/]+)$/, () => ok()],
    ['POST', /^\/integrations\//, () => err(400, 'Connecting Instagram is turned off in the demo preview.')],
    ['DELETE', /^\/integrations\/instagram\/disconnect\/([^/]+)$/, () => {
        S().restaurant = { ...S().restaurant, integrations: { instagram: false }, instagramConnection: { connected: false } };
        if (signedUpProfile(S().restaurant.id)) updateSignedUpRestaurant(S().restaurant.id, { instagramConnected: false });
        return ok();
    }],
];

/** Requests the demo backend answers: anything aimed at the API, never static assets. */
function apiPath(input: RequestInfo | URL): string | null {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    let url: URL;
    try {
        url = new URL(raw, window.location.href);
    } catch {
        return null;
    }
    // The demo build has no VITE_API_URL, so the client falls back to
    // http://localhost:3001/api. Same-origin /api/ calls are covered too.
    const isApiHost = url.host === 'localhost:3001' || url.host === window.location.host;
    if (isApiHost && url.pathname.startsWith('/api/')) return url.pathname.slice(4) + url.search;
    return null;
}

export async function handleDemoRequest(path: string, method: string, body: unknown): Promise<DemoReply> {
    const [pathname, search = ''] = path.split('?');
    const query = new URLSearchParams(search);
    for (const [verb, pattern, handler] of routes) {
        if (verb !== method) continue;
        const m = pathname.match(pattern);
        if (m) {
            writeNotice(method);
            return handler(m, body, query);
        }
    }
    // Unknown route: a harmless empty answer so a screen shows its empty S()
    // instead of a network error. Logged so gaps are easy to spot.
    console.info(`[demo] no sample data for ${method} ${pathname}`);
    writeNotice(method);
    return method === 'GET' ? ok([]) : ok({});
}

/** Answers API calls from sample data. Call once, before the app boots. */
export function installDemoBackend(): void {
    if (!isDemoMode() || typeof window === 'undefined') return;
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        // No runtime config in the demo: fall back to the build-time defaults.
        if (raw === '/config.json' || raw.endsWith('/config.json')) {
            return new Response('Not found', { status: 404 });
        }
        const path = apiPath(input);
        if (path === null) return realFetch(input, init);
        const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
        let body: unknown;
        if (typeof init?.body === 'string') {
            try { body = JSON.parse(init.body); } catch { body = undefined; }
        }
        await new Promise((r) => setTimeout(r, 80));
        const reply = await handleDemoRequest(path, method, body);
        return new Response(JSON.stringify(reply.body), {
            status: reply.status ?? 200,
            headers: { 'Content-Type': 'application/json' },
        });
    };
}

/** Test hook: back to the first sample S(). */
export function resetDemoBackend(): void {
    store.reset();
    resetDemoSignups();
}
