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
    ContentStrategy, EntitlementState, FeatureFlags, Platform, Post, Restaurant, StrategyCycle, Subscription,
    SubscriptionPlan, User,
} from '@restropulse/shared';
import { isDemoMode, notifyDemoBackendAction } from './lib/demo';

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

function buildState(phone = '+919876543210'): DemoBackendState {
    const user: User = {
        id: 'demo-user-1',
        name: '[SAMPLE] Demo Owner',
        email: 'owner@demo-kitchen.example',
        phone,
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

let state: DemoBackendState = buildState();

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
        subscription: { id: 'demo-sub-1', restaurantId: RID, status: 'NONE', credits: 20, trialEndsAt: iso(14, 0) },
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
type Handler = (m: RegExpMatchArray, body: any, method: string) => DemoReply | Promise<DemoReply>;

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
        state = buildState(typeof body?.phone === 'string' ? body.phone : undefined);
        return { body: { success: true, user: state.user, token: 'demo-token', refreshToken: 'demo-refresh-token' } };
    }],
    ['POST', /^\/auth\/(login|firebase)$/, () => ({ body: { success: true, user: state.user, token: 'demo-token', refreshToken: 'demo-refresh-token' } })],
    ['GET', /^\/auth\/session$/, () => ({ body: { success: true, user: state.user } })],
    ['POST', /^\/auth\/refresh$/, () => ({ body: { success: true, token: 'demo-token' } })],
    ['POST', /^\/auth\/logout$/, () => ok()],
    ['POST', /^\/auth\/verify-email$/, () => { state.user = { ...state.user, emailVerified: true }; return ok(); }],

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
    ['GET', /^\/restaurant\/cities$/, () => ok([{ id: 'bengaluru', name: 'Bengaluru', defaultZone: 'Indiranagar' }])],
    ['GET', /^\/restaurant\/([^/]+)\/analytics$/, () => ok({
        postsPerWeek: [{ week: 1, posts: 3 }, { week: 2, posts: 4 }, { week: 3, posts: 4 }, { week: 4, posts: 5 }],
        contentMix: [{ type: 'IMAGE', count: 9 }, { type: 'CAROUSEL', count: 4 }, { type: 'REEL', count: 3 }],
        platformMix: [{ platform: 'INSTAGRAM', count: 12 }, { platform: 'FACEBOOK', count: 4 }],
    })],
    ['PATCH', /^\/restaurant\/([^/]+)\/(offers|specials)$/, (m, body) => {
        const key = m[2] === 'offers' ? 'activeOffers' : 'chefSpecials';
        const list = [...(state.restaurant[key] ?? [])];
        if (body?.action === 'ADD' && typeof body.payload === 'string') list.push(body.payload);
        if (body?.action === 'DELETE' && typeof body.payload === 'number') list.splice(body.payload, 1);
        state.restaurant = { ...state.restaurant, [key]: list };
        return ok(state.restaurant);
    }],
    ['PATCH', /^\/restaurant\/([^/]+)\/menu$/, () => {
        state.restaurant = { ...state.restaurant, menuLastUpdated: new Date().toISOString() };
        return ok(state.restaurant);
    }],
    ['GET', /^\/restaurant\/([^/]+)$/, () => ok(state.restaurant)],
    ['PUT', /^\/restaurant\/([^/]+)$/, (_m, body) => {
        state.restaurant = { ...state.restaurant, ...(body ?? {}), id: RID };
        return ok(state.restaurant);
    }],
    ['POST', /^\/restaurant$/, () => ({ body: { success: true, data: { restaurant: state.restaurant, token: 'demo-token', refreshToken: 'demo-refresh-token' } } })],

    // --- posts -------------------------------------------------------------------
    ['GET', /^\/posts$/, () => ok(state.posts)],
    ['POST', /^\/posts\/generate$/, (_m, body) => {
        const platforms: Platform[] = Array.isArray(body?.platforms) && body.platforms.length ? body.platforms : ['INSTAGRAM'];
        const concept = typeof body?.concept === 'string' && body.concept.trim() ? body.concept.trim() : 'today\'s special';
        const groupId = `demo-group-${Date.now()}`;
        const created: Post[] = platforms.map((platform, i) => ({
            id: `demo-post-${Date.now()}-${i}`, groupId, type: body?.type ?? 'IMAGE', status: 'PENDING_APPROVAL', platform,
            restaurantId: RID, isAdhoc: true, thumbnail: thumb('New post', 280 + i * 30),
            caption: `[SAMPLE] A caption written for "${concept}". In the live app this is written by AI from your menu and offers.`,
            scheduledFor: typeof body?.scheduledFor === 'string' ? body.scheduledFor : iso(1, 19),
        }));
        state.posts = [...created, ...state.posts];
        return ok(created);
    }],
    ['POST', /^\/posts\/([^/]+)\/publish$/, (m) => {
        const post = state.posts.find((p) => p.id === m[1]);
        if (!post) return err(404, 'Post not found');
        Object.assign(post, { status: 'POSTED', postedAt: new Date().toISOString() });
        return ok(post);
    }],
    ['GET', /^\/posts\/([^/]+)\/download$/, () => err(400, 'Downloads are turned off in the demo preview.')],
    ['GET', /^\/posts\/([^/]+)$/, (m) => {
        const post = state.posts.find((p) => p.id === m[1]);
        return post ? ok(post) : err(404, 'Post not found');
    }],
    ['PUT', /^\/posts\/([^/]+)$/, (m, body) => {
        const post = state.posts.find((p) => p.id === m[1]);
        if (!post) return err(404, 'Post not found');
        Object.assign(post, body ?? {}, { id: post.id });
        return ok(post);
    }],
    ['PATCH', /^\/posts\/([^/]+)$/, (m, body) => {
        const post = state.posts.find((p) => p.id === m[1]);
        if (!post) return err(404, 'Post not found');
        Object.assign(post, body ?? {}, { id: post.id });
        return ok(post);
    }],
    ['DELETE', /^\/posts\/([^/]+)$/, (m) => {
        state.posts = state.posts.filter((p) => p.id !== m[1]);
        return ok();
    }],
    ['POST', /^\/posts$/, (_m, body) => {
        const post: Post = {
            id: `demo-post-${Date.now()}`, type: 'IMAGE', status: 'PENDING_CONTENT', platform: 'INSTAGRAM', restaurantId: RID,
            thumbnail: thumb('New post', 280), caption: '', isAdhoc: true, ...(body ?? {}),
        };
        state.posts = [post, ...state.posts];
        return ok(post);
    }],

    // --- strategy ----------------------------------------------------------------
    ['GET', /^\/strategy$/, () => ok({ ...state.strategy, suggestCreateCycle: false })],
    ['PUT', /^\/strategy$/, (_m, body) => { state.strategy = { ...state.strategy, ...(body ?? {}) }; return ok(state.strategy); }],
    ['GET', /^\/strategy\/cycles$/, () => ok(state.cycles)],
    ['GET', /^\/strategy\/cycles\/([^/]+)$/, (m) => {
        const cycle = state.cycles.find((c) => c.id === m[1]);
        return cycle ? ok(cycle) : err(404, 'Cycle not found');
    }],
    ['PUT', /^\/strategy\/cycles\/([^/]+)$/, (m, body) => {
        const cycle = state.cycles.find((c) => c.id === m[1]);
        if (!cycle) return err(404, 'Cycle not found');
        Object.assign(cycle, body ?? {}, { id: cycle.id });
        return ok(cycle);
    }],
    ['POST', /^\/strategy\/cycles$/, (_m, body) => {
        const cycle = { ...(body ?? {}), id: `demo-cycle-${Date.now()}`, restaurantId: RID } as StrategyCycle;
        state.cycles = [...state.cycles, cycle];
        return ok(cycle);
    }],

    // --- integrations ------------------------------------------------------------
    ['GET', /^\/integrations\/config$/, () => ok({ instagram: { configured: true } })],
    ['GET', /^\/integrations\/instagram\/status\/([^/]+)$/, () => ok(state.restaurant.instagramConnection ?? { connected: false })],
    ['GET', /^\/integrations\/instagram\/profile\/([^/]+)$/, () => ok(state.restaurant.integrations.instagram
        ? { username: 'demo_kitchen_sample', name: '[SAMPLE] RestroPulse Demo Kitchen', followers_count: 2480, media_count: 86 }
        : null)],
    ['GET', /^\/integrations\/instagram\//, () => err(400, 'Connecting Instagram is turned off in the demo preview.')],
    ['POST', /^\/integrations\/instagram\/validate\/([^/]+)$/, () => ok({ valid: state.restaurant.integrations.instagram, needsReauthorization: false })],
    ['POST', /^\/integrations\/instagram\/refresh\/([^/]+)$/, () => ok()],
    ['POST', /^\/integrations\//, () => err(400, 'Connecting Instagram is turned off in the demo preview.')],
    ['DELETE', /^\/integrations\/instagram\/disconnect\/([^/]+)$/, () => {
        state.restaurant = { ...state.restaurant, integrations: { instagram: false }, instagramConnection: { connected: false } };
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
    const pathname = path.split('?')[0];
    for (const [verb, pattern, handler] of routes) {
        if (verb !== method) continue;
        const m = pathname.match(pattern);
        if (m) {
            writeNotice(method);
            return handler(m, body, method);
        }
    }
    // Unknown route: a harmless empty answer so a screen shows its empty state
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

/** Test hook: back to the first sample state. */
export function resetDemoBackend(): void {
    state = buildState();
}
