/**
 * demo-api.ts — DEMO MODE implementation of the merchant dashboard API client.
 *
 * Active only when VITE_DEMO_MODE=true; api.ts swaps these objects in for the
 * real fetch-backed client, so the rest of the app never knows which is
 * active (the `typeof real*` annotations in api.ts guarantee both clients
 * expose the exact same interface). Everything is served/simulated locally
 * from SAMPLE fixtures (lib/demo-fixtures.ts):
 *
 *   - auth                → any credentials sign in the sample owner (no Firebase)
 *   - restaurant/posts/strategy/menu/orders/reservations/content
 *                         → in-memory state seeded from fixtures; mutations
 *                           (approve/reject/schedule, CRUD, status changes)
 *                           update local state only — nothing persists
 *   - analytics/billing   → static plausible numbers
 *   - Instagram           → "connected" to a sample account (pure fixture, no
 *                           Meta keys); OAuth/connect flows are unavailable
 *   - payments (Razorpay) → unavailable; calls fail with a friendly message
 *
 * Simulated backend writes trigger the once-per-session
 * "Demo preview — backend not connected" notice (lib/demo.ts).
 */
import type {
    AuthResponse,
    CampaignQueuedResponse,
    CampaignSendRequest,
    CustomerCohort,
    City,
    ContentStrategy,
    FeatureFlags,
    InstagramConnectionStatus,
    Invoice,
    LoginRequest,
    MenuCategory,
    MenuItemAvailability,
    Order,
    OrderStatus,
    OrderingMenuItem,
    PlanUsage,
    Post,
    Reservation,
    ReservationStatus,
    Restaurant,
    StorefrontContent,
    StrategyCycle,
    Subscription,
    AccountManager,
    CreditPack,
    SubscriptionPlan,
    InstagramAccount,
    InstagramConnectionError,
    IntelligenceScan,
    IntelligenceReport,
    IntelligenceReportSummary,
    IntelligenceSelfMetrics,
    ScanStatus,
    RestaurantProfilePatch,
    WatchlistEntry,
    CompareRow,
    DailySnapshot,
    NearbyPlaceSighting,
    RegisterRequest,
} from '@restropulse/shared';
import type { OrderingSettingsData, OrderingSettingsPatch } from './api';
import { RESTAURANT_PROFILE_FIELDS, WATCHLIST_MAX } from '@restropulse/shared';
import type {
    ContentDraftResponse,
    GeneratePostTone,
    MenuCsvImportReport,
    MenuItemUpsertInput,
    OrderingAnalyticsSummary,
    SnapshotSeriesResponse,
    SnapshotQuery,
    WatchlistResponse,
    WatchlistInput,
    CompareQuery,
    ZomatoManualInput,
    FeedbackDay,
    NewOpening,
} from './api';
import { notifyDemoBackendAction } from './lib/demo';
import {
    DEMO_ACCOUNT_MANAGERS,
    DEMO_ANALYTICS,
    DEMO_CITIES,
    DEMO_COHORTS,
    DEMO_CREDIT_PACKS,
    DEMO_CYCLES,
    DEMO_FEATURE_FLAGS,
    DEMO_FUNNEL_EVENTS,
    DEMO_INSTAGRAM_STATUS,
    DEMO_INVOICES,
    DEMO_MENU_CATEGORIES,
    DEMO_MENU_ITEMS,
    DEMO_ORDERS,
    DEMO_PLANS,
    DEMO_POSTS,
    DEMO_RESERVATIONS,
    DEMO_RESTAURANT,
    DEMO_STOREFRONT_CONTENT,
    DEMO_STRATEGY,
    DEMO_SUBSCRIPTION,
    DEMO_USAGE,
    DEMO_USER,
} from './lib/demo-fixtures';

/** Simulated latency so loading states stay visible in the static preview. */
const DEMO_LATENCY_MS = 200;

const delay = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, DEMO_LATENCY_MS));

/** Longer simulated latency for "AI" generation so the loading state reads as real work. */
const DEMO_GENERATE_LATENCY_MS = 800;

const generateDelay = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, DEMO_GENERATE_LATENCY_MS));

const randomSuffix = (): string => Math.random().toString(36).slice(2, 8);

/** Deep-copy so callers can never mutate the module-level demo state. */
function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

const demoUnavailable = (what: string): Error =>
    new Error(`${what} is not available in the demo preview.`);

// ----- In-memory demo state (seeded from fixtures; mutations are local) -----

const state = {
    restaurant: clone(DEMO_RESTAURANT),
    posts: clone(DEMO_POSTS),
    strategy: clone(DEMO_STRATEGY),
    cycles: clone(DEMO_CYCLES),
    subscription: clone(DEMO_SUBSCRIPTION),
    menuCategories: clone(DEMO_MENU_CATEGORIES),
    menuItems: clone(DEMO_MENU_ITEMS),
    orders: clone(DEMO_ORDERS),
    reservations: clone(DEMO_RESERVATIONS),
    contentDraft: clone(DEMO_STOREFRONT_CONTENT),
    publishedVersion: 1 as number,
    versions: [{ version: 1, publishedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString() }],
};

function startDemoSession(): AuthResponse & { refreshToken?: string } {
    localStorage.setItem('rp_token', `demo-token-${randomSuffix()}`);
    localStorage.setItem('rp_refresh_token', `demo-refresh-${randomSuffix()}`);
    localStorage.setItem('rp_restaurant_id', state.restaurant.id);
    return { success: true, user: clone(DEMO_USER), token: localStorage.getItem('rp_token')!, refreshToken: localStorage.getItem('rp_refresh_token')! };
}

// ----- Auth: any credentials sign in the sample owner -----

export const authAPI = {
    loginWithFirebase: async (_firebaseIdToken: string): Promise<AuthResponse & { refreshToken?: string }> => {
        await delay();
        return startDemoSession();
    },

    login: async (_credentials: LoginRequest): Promise<AuthResponse & { refreshToken?: string }> => {
        await delay();
        return startDemoSession();
    },

    register: async (_payload: RegisterRequest): Promise<AuthResponse & { refreshToken?: string; restaurant?: { id: string; slug: string } }> => {
        await delay();
        notifyDemoBackendAction();
        const session = startDemoSession();
        return { ...session, restaurant: { id: state.restaurant.id, slug: state.restaurant.slug ?? 'demo' } };
    },

    // Demo login form funnels through here: any email/password works.
    verifyOtp: async (_phone: string, _otp: string): Promise<AuthResponse & { refreshToken?: string }> => {
        await delay();
        return startDemoSession();
    },

    refreshToken: async (_refreshToken: string): Promise<boolean> => true,

    logout: async (): Promise<void> => {
        await delay();
        localStorage.removeItem('rp_token');
        localStorage.removeItem('rp_refresh_token');
        localStorage.removeItem('rp_session');
        localStorage.removeItem('rp_restaurant_id');
    },

    checkSession: async (): Promise<AuthResponse> => {
        await delay();
        if (!localStorage.getItem('rp_token')) return { success: false, message: 'Not signed in' };
        return { success: true, user: clone(DEMO_USER) };
    },

    verifyEmail: async (_idToken: string): Promise<void> => {
        await delay();
        notifyDemoBackendAction();
    },
};

// ----- Restaurant -----

export const restaurantAPI = {
    create: async (_data: {
        name: string;
        cuisine: string;
        userName?: string;
        email?: string;
        location?: Restaurant['location'];
        accountManager?: Restaurant['accountManager'];
    }): Promise<{ restaurant: Restaurant; token: string; refreshToken: string }> => {
        await delay();
        notifyDemoBackendAction();
        const session = startDemoSession();
        return { restaurant: clone(state.restaurant), token: session.token!, refreshToken: session.refreshToken! };
    },

    get: async (_id: string): Promise<Restaurant> => {
        await delay();
        return clone(state.restaurant);
    },

    update: async (_id: string, data: Partial<Restaurant>): Promise<Restaurant> => {
        await delay();
        notifyDemoBackendAction();
        state.restaurant = { ...state.restaurant, ...clone(data) };
        return clone(state.restaurant);
    },

    updateOffers: async (_id: string, action: 'ADD' | 'DELETE', payload: string | number): Promise<Restaurant> => {
        await delay();
        notifyDemoBackendAction();
        const offers = state.restaurant.activeOffers ?? [];
        state.restaurant.activeOffers =
            action === 'ADD' ? [...offers, String(payload)] : offers.filter((_, i) => i !== Number(payload));
        return clone(state.restaurant);
    },

    updateSpecials: async (_id: string, action: 'ADD' | 'DELETE', payload: string | number): Promise<Restaurant> => {
        await delay();
        notifyDemoBackendAction();
        const specials = state.restaurant.chefSpecials ?? [];
        state.restaurant.chefSpecials =
            action === 'ADD' ? [...specials, String(payload)] : specials.filter((_, i) => i !== Number(payload));
        return clone(state.restaurant);
    },

    updateMenu: async (_id: string): Promise<Restaurant> => {
        await delay();
        notifyDemoBackendAction();
        state.restaurant.menuLastUpdated = new Date().toISOString();
        return clone(state.restaurant);
    },

    getAnalytics: async (_id: string): Promise<{
        postsPerWeek: { week: number; posts: number }[];
        contentMix: { type: string; count: number }[];
        platformMix: { platform: string; count: number }[];
    }> => {
        await delay();
        return clone(DEMO_ANALYTICS);
    },

    // ----- Restaurant Details (Brief 04) — in-session state, zero network -----
    getProfile: async (): Promise<Restaurant> => {
        await delay();
        return clone(state.restaurant);
    },

    updateProfile: async (patch: RestaurantProfilePatch): Promise<Restaurant> => {
        await delay();
        notifyDemoBackendAction();
        // Mirror the server whitelist: keep only known profile keys; null clears.
        const next: Record<string, unknown> = { ...state.restaurant };
        for (const key of RESTAURANT_PROFILE_FIELDS) {
            if (!(key in patch)) continue;
            const value = (patch as Record<string, unknown>)[key];
            if (value === null) delete next[key];
            else next[key] = value;
        }
        state.restaurant = clone(next) as unknown as Restaurant;
        return clone(state.restaurant);
    },

    // Local object URL, no persistence, ZERO network (never saved into fixtures).
    uploadAsset: async (file: File, _kind: 'logo' | 'cover'): Promise<{ assetId: string; url: string }> => {
        await delay();
        notifyDemoBackendAction();
        demoAssetCounter += 1;
        return { assetId: `demo-asset-${demoAssetCounter}`, url: URL.createObjectURL(file) };
    },
};

/** Monotonic id source for demo asset uploads (session-scoped). */
let demoAssetCounter = 0;

// ----- Posts (Content Studio) -----

/** Tone-specific body lines, emoji and hashtags for the demo caption template. */
const DEMO_TONE_FLAVOR: Record<GeneratePostTone, { body: string[]; emoji: string; tags: string[] }> = {
    fun: {
        body: [
            "Tag the friend who's always hungry — this one's for you two.",
            'Come hungry, leave happy (and maybe a little smug about it).',
        ],
        emoji: '😋🎉',
        tags: ['#FoodieFun', '#WeekendVibes'],
    },
    elegant: {
        body: [
            'Thoughtfully plated, seasoned with patience, and served warm.',
            'An evening at our table is time well spent.',
        ],
        emoji: '✨🥂',
        tags: ['#FineDining', '#CulinaryCraft'],
    },
    spicy: {
        body: [
            'Fair warning: this one bites back.',
            'Extra napkins on standby — you have been warned.',
        ],
        emoji: '🔥🌶️',
        tags: ['#SpicyFood', '#HeatSeekers'],
    },
};

/**
 * Template: hook line from the brief + 2 tone-matched sentences + emoji +
 * 5–6 hashtags (always including #DemoKitchen).
 */
function buildDemoGeneratedCaption(brief: string, tone: GeneratePostTone = 'fun'): string {
    const flavor = DEMO_TONE_FLAVOR[tone] ?? DEMO_TONE_FLAVOR.fun;

    // Hook: first sentence of the brief, capitalised, trimmed.
    const firstSentence = brief.split(/[.!?\n]/)[0]?.trim() || brief.trim();
    const hook = (firstSentence.charAt(0).toUpperCase() + firstSentence.slice(1)).slice(0, 120);

    // Brief-derived hashtags: up to 2 distinctive words from the brief.
    const briefTags = Array.from(
        new Set(
            brief
                .toLowerCase()
                .replace(/[^a-z\s]/g, ' ')
                .split(/\s+/)
                .filter((w) => w.length >= 5)
                .slice(0, 2)
                .map((w) => `#${w.charAt(0).toUpperCase()}${w.slice(1)}`),
        ),
    );
    const hashtags = Array.from(new Set(['#DemoKitchen', ...briefTags, ...flavor.tags, '#Foodie', '#EatLocal'])).slice(0, 6);

    return `[SAMPLE] ${hook} ${flavor.emoji}\n\n${flavor.body.join(' ')} Only at Demo Kitchen — see you at the table.\n\n${hashtags.join(' ')}`;
}

export const postsAPI = {
    getAll: async (): Promise<Post[]> => {
        await delay();
        return clone(state.posts);
    },

    getById: async (id: string): Promise<Post> => {
        await delay();
        const post = state.posts.find((p) => p.id === id);
        if (!post) throw new Error('Post not found');
        return clone(post);
    },

    create: async (post: Omit<Post, 'id'>): Promise<Post> => {
        await delay();
        notifyDemoBackendAction();
        const created: Post = { ...clone(post), id: `demo-post-${randomSuffix()}` };
        state.posts = [created, ...state.posts];
        return clone(created);
    },

    generate: async (params: {
        concept: string;
        type: Post['type'];
        platforms: Post['platforms'];
        scheduledFor?: string;
        asap?: boolean;
    }): Promise<Post> => {
        await delay();
        notifyDemoBackendAction();
        const created: Post = {
            id: `demo-post-${randomSuffix()}`,
            type: params.type,
            status: 'PENDING_APPROVAL',
            thumbnail: `https://placehold.co/600x600/f97316/ffffff?text=${encodeURIComponent(`[SAMPLE] ${params.concept.slice(0, 24)}`)}`,
            caption: `[SAMPLE] ${params.concept} — freshly generated demo caption. ✨ #DemoKitchen`,
            platforms: params.platforms,
            restaurantId: state.restaurant.id,
            scheduledFor: params.scheduledFor ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            isAdhoc: true,
        };
        state.posts = [created, ...state.posts];
        return clone(created);
    },

    // "Create a new post" generator: brief + tone → plausible caption, added
    // to local posts as PENDING_APPROVAL (mirrors realPostsAPI.generatePost).
    generatePost: async (params: { brief: string; tone?: GeneratePostTone }): Promise<Post> => {
        await generateDelay();
        notifyDemoBackendAction();
        const created: Post = {
            id: `demo-post-${randomSuffix()}`,
            type: 'IMAGE',
            status: 'PENDING_APPROVAL',
            thumbnail: `https://placehold.co/600x600/f97316/ffffff?text=${encodeURIComponent(`[SAMPLE] ${params.brief.slice(0, 26)}`)}`,
            caption: buildDemoGeneratedCaption(params.brief, params.tone),
            platforms: ['INSTAGRAM', 'FACEBOOK'],
            restaurantId: state.restaurant.id,
            scheduledFor: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            isAdhoc: true,
        };
        state.posts = [created, ...state.posts];
        return clone(created);
    },

    update: async (id: string, post: Partial<Post>): Promise<Post> => {
        await delay();
        notifyDemoBackendAction();
        const idx = state.posts.findIndex((p) => p.id === id);
        if (idx === -1) throw new Error('Post not found');
        state.posts[idx] = { ...state.posts[idx], ...clone(post) };
        return clone(state.posts[idx]);
    },

    delete: async (id: string): Promise<void> => {
        await delay();
        notifyDemoBackendAction();
        state.posts = state.posts.filter((p) => p.id !== id);
    },
};

// ----- Strategy -----

export const strategyAPI = {
    getStrategy: async (): Promise<ContentStrategy & { suggestCreateCycle?: boolean }> => {
        await delay();
        return { ...clone(state.strategy), suggestCreateCycle: false };
    },

    updateStrategy: async (strategy: Partial<ContentStrategy>): Promise<ContentStrategy> => {
        await delay();
        notifyDemoBackendAction();
        state.strategy = { ...state.strategy, ...clone(strategy) };
        return clone(state.strategy);
    },

    getAllCycles: async (): Promise<StrategyCycle[]> => {
        await delay();
        return clone(state.cycles);
    },

    getCycleById: async (id: string): Promise<StrategyCycle> => {
        await delay();
        const cycle = state.cycles.find((c) => c.id === id);
        if (!cycle) throw new Error('Cycle not found');
        return clone(cycle);
    },

    createCycle: async (cycle: Omit<StrategyCycle, 'id'>): Promise<StrategyCycle> => {
        await delay();
        notifyDemoBackendAction();
        const created: StrategyCycle = { ...clone(cycle), id: `demo-cycle-${randomSuffix()}` };
        state.cycles = [created, ...state.cycles];
        return clone(created);
    },

    updateCycle: async (id: string, cycle: Partial<StrategyCycle>): Promise<StrategyCycle> => {
        await delay();
        notifyDemoBackendAction();
        const idx = state.cycles.findIndex((c) => c.id === id);
        if (idx === -1) throw new Error('Cycle not found');
        state.cycles[idx] = { ...state.cycles[idx], ...clone(cycle) };
        return clone(state.cycles[idx]);
    },
};

// ----- Instagram integration: sample connection, no Meta keys, no OAuth -----

export const instagramAPI = {
    getOAuthUrl: async (_restaurantId: string, _useOnboarding: boolean = false): Promise<{ oauthUrl: string; state: string }> => {
        await delay();
        throw demoUnavailable('Connecting a Meta account');
    },

    handleCallback: async (_code: string, _state: string): Promise<{
        success: boolean;
        account?: InstagramAccount;
        accounts?: InstagramAccount[];
        selectionId?: string;
        requiresSelection?: boolean;
        error?: InstagramConnectionError;
        message?: string;
    }> => {
        await delay();
        return { success: false, error: 'CONFIG_ERROR', message: 'Instagram connection is not available in the demo preview.' };
    },

    getPendingAccounts: async (_selectionId: string): Promise<InstagramAccount[]> => {
        await delay();
        return [];
    },

    selectAccount: async (_selectionId: string, _accountId: string, _restaurantId: string): Promise<{ username: string; message: string }> => {
        await delay();
        throw demoUnavailable('Connecting a Meta account');
    },

    getStatus: async (_restaurantId: string): Promise<InstagramConnectionStatus> => {
        await delay();
        return state.restaurant.integrations.instagram
            ? clone(DEMO_INSTAGRAM_STATUS)
            : { connected: false };
    },

    disconnect: async (_restaurantId: string): Promise<void> => {
        await delay();
        notifyDemoBackendAction();
        state.restaurant.integrations.instagram = false;
        state.restaurant.instagramConnection = { connected: false };
    },

    refreshToken: async (_restaurantId: string): Promise<boolean> => {
        await delay();
        return true;
    },

    validate: async (_restaurantId: string): Promise<{ valid: boolean; needsReauthorization: boolean }> => {
        await delay();
        return { valid: state.restaurant.integrations.instagram, needsReauthorization: false };
    },

    getProfile: async (_restaurantId: string): Promise<any> => {
        await delay();
        return {
            username: DEMO_INSTAGRAM_STATUS.username,
            name: '[SAMPLE] Demo Kitchen',
            followers_count: 1284,
            media_count: 86,
        };
    },

    getConfig: async (): Promise<{ instagram: { configured: boolean } }> => {
        await delay();
        // No Meta keys in the demo preview.
        return { instagram: { configured: false } };
    },
};

// ----- Subscription & billing (read-only; payments disabled) -----

export const subscriptionAPI = {
    getPlans: async (): Promise<SubscriptionPlan[]> => {
        await delay();
        return clone(DEMO_PLANS);
    },

    getCurrent: async (): Promise<{ subscription: Subscription | null; usage: PlanUsage | null }> => {
        await delay();
        return { subscription: clone(state.subscription), usage: clone(DEMO_USAGE) };
    },

    subscribe: async (_planSlug: string, _couponCode?: string): Promise<{ subscriptionId: string; keyId: string }> => {
        await delay();
        throw demoUnavailable('Checkout');
    },

    cancel: async (): Promise<void> => {
        await delay();
        notifyDemoBackendAction();
        state.subscription = { ...state.subscription, cancelAtPeriodEnd: true, cancelledAt: new Date().toISOString() };
    },

    changePlan: async (planSlug: string, _opts?: { mode?: 'now' | 'cycle_end' }): Promise<{
        effective: 'immediate' | 'cycle_end';
        planName: string;
        currentPeriodEnd?: string | Date;
        requiresCheckout?: boolean;
        subscriptionId?: string;
        keyId?: string;
    }> => {
        await delay();
        notifyDemoBackendAction();
        const target = DEMO_PLANS.find((p) => p.slug === planSlug);
        return {
            effective: 'cycle_end',
            planName: target?.name ?? planSlug,
            currentPeriodEnd: state.subscription.currentPeriodEnd,
        };
    },

    reactivate: async (): Promise<{ requiresCheckout: true; subscriptionId: string; keyId: string }> => {
        await delay();
        throw demoUnavailable('Checkout');
    },

    purchaseCredits: async (_creditPackId: string): Promise<{ orderId: string; amount: number; currency: string; keyId: string; credits: number }> => {
        await delay();
        throw demoUnavailable('Payments');
    },

    verifyCredits: async (_razorpayOrderId: string, _razorpayPaymentId: string, _razorpaySignature: string): Promise<void> => {
        await delay();
        throw demoUnavailable('Payments');
    },

    verifySubscription: async (
        _razorpayPaymentId: string,
        _razorpaySubscriptionId: string,
        _razorpaySignature: string,
    ): Promise<{ status: string; subscriptionId: string }> => {
        await delay();
        throw demoUnavailable('Payments');
    },
};

export const couponAPI = {
    validate: async (_code: string, _planSlug?: string, _billingCycle?: import('@restropulse/shared').BillingCycle): Promise<{ valid: boolean; reason?: string; type?: string; value?: number; maxBillingCycles?: number }> => {
        await delay();
        return { valid: false, reason: 'Coupons are not available in the demo preview.' };
    },
};

export const creditPacksAPI = {
    getAll: async (): Promise<CreditPack[]> => {
        await delay();
        return clone(DEMO_CREDIT_PACKS);
    },
};

export const invoiceAPI = {
    getAll: async (): Promise<Invoice[]> => {
        await delay();
        return clone(DEMO_INVOICES);
    },

    getById: async (id: string): Promise<Invoice> => {
        await delay();
        const invoice = DEMO_INVOICES.find((i) => i.id === id);
        if (!invoice) throw new Error('Invoice not found');
        return clone(invoice);
    },
};

export const configAPI = {
    getFeatures: async (): Promise<FeatureFlags> => {
        await delay();
        return clone(DEMO_FEATURE_FLAGS);
    },
};

export const accountAPI = {
    delete: async (): Promise<void> => {
        await delay();
        throw demoUnavailable('Account deletion');
    },
};

export const citiesAPI = {
    getAll: async (): Promise<City[]> => {
        await delay();
        return clone(DEMO_CITIES);
    },
};

export const accountManagerAPI = {
    getByCityAndZone: async (_city: string, _zone?: string): Promise<AccountManager[]> => {
        await delay();
        return clone(DEMO_ACCOUNT_MANAGERS);
    },
};

// ----- Ordering admin: in-memory CRUD over the seed menu + sample feeds -----

export const orderingAdminAPI = {
    // Menu: categories
    getCategories: async (): Promise<MenuCategory[]> => {
        await delay();
        return clone(state.menuCategories).sort((a, b) => a.sortOrder - b.sortOrder);
    },

    createCategory: async (data: { name: string; description?: string; sortOrder?: number }): Promise<MenuCategory> => {
        await delay();
        notifyDemoBackendAction();
        const created: MenuCategory = {
            id: `demo-cat-${randomSuffix()}`,
            restaurantId: state.restaurant.id,
            name: data.name,
            description: data.description,
            sortOrder: data.sortOrder ?? state.menuCategories.length + 1,
        };
        state.menuCategories = [...state.menuCategories, created];
        return clone(created);
    },

    updateCategory: async (id: string, data: Partial<Pick<MenuCategory, 'name' | 'description' | 'sortOrder'>>): Promise<MenuCategory> => {
        await delay();
        notifyDemoBackendAction();
        const idx = state.menuCategories.findIndex((c) => c.id === id);
        if (idx === -1) throw new Error('Category not found');
        state.menuCategories[idx] = { ...state.menuCategories[idx], ...clone(data) };
        return clone(state.menuCategories[idx]);
    },

    deleteCategory: async (id: string): Promise<void> => {
        await delay();
        notifyDemoBackendAction();
        state.menuCategories = state.menuCategories.filter((c) => c.id !== id);
        state.menuItems = state.menuItems.filter((i) => i.categoryId !== id);
    },

    reorderCategories: async (orderedIds: string[]): Promise<MenuCategory[]> => {
        await delay();
        notifyDemoBackendAction();
        state.menuCategories = state.menuCategories
            .map((c) => ({ ...c, sortOrder: orderedIds.indexOf(c.id) === -1 ? c.sortOrder : orderedIds.indexOf(c.id) + 1 }))
            .sort((a, b) => a.sortOrder - b.sortOrder);
        return clone(state.menuCategories);
    },

    // Menu: items
    getItems: async (): Promise<OrderingMenuItem[]> => {
        await delay();
        return clone(state.menuItems);
    },

    createItem: async (data: MenuItemUpsertInput & { categoryId: string; name: string; price: number }): Promise<OrderingMenuItem> => {
        await delay();
        notifyDemoBackendAction();
        const created: OrderingMenuItem = {
            isVeg: false,
            availability: 'in_stock',
            sortOrder: state.menuItems.filter((i) => i.categoryId === data.categoryId).length + 1,
            ...clone(data),
            id: `demo-mi-${randomSuffix()}`,
            restaurantId: state.restaurant.id,
            variants: (data.variants ?? []).map((v, i) => ({ ...v, id: v.id ?? `demo-va-${randomSuffix()}-${i}` })),
            addons: (data.addons ?? []).map((a, i) => ({ ...a, id: a.id ?? `demo-ad-${randomSuffix()}-${i}` })),
        };
        state.menuItems = [...state.menuItems, created];
        return clone(created);
    },

    updateItem: async (id: string, data: MenuItemUpsertInput): Promise<OrderingMenuItem> => {
        await delay();
        notifyDemoBackendAction();
        const idx = state.menuItems.findIndex((i) => i.id === id);
        if (idx === -1) throw new Error('Item not found');
        const prev = state.menuItems[idx];
        state.menuItems[idx] = {
            ...prev,
            ...clone(data),
            id: prev.id,
            restaurantId: prev.restaurantId,
            variants: data.variants ? data.variants.map((v, i) => ({ ...v, id: v.id ?? `demo-va-${randomSuffix()}-${i}` })) : prev.variants,
            addons: data.addons ? data.addons.map((a, i) => ({ ...a, id: a.id ?? `demo-ad-${randomSuffix()}-${i}` })) : prev.addons,
        };
        return clone(state.menuItems[idx]);
    },

    deleteItem: async (id: string): Promise<void> => {
        await delay();
        notifyDemoBackendAction();
        state.menuItems = state.menuItems.filter((i) => i.id !== id);
    },

    setItemAvailability: async (id: string, availability: MenuItemAvailability): Promise<OrderingMenuItem> => {
        await delay();
        notifyDemoBackendAction();
        const idx = state.menuItems.findIndex((i) => i.id === id);
        if (idx === -1) throw new Error('Item not found');
        state.menuItems[idx] = { ...state.menuItems[idx], availability };
        return clone(state.menuItems[idx]);
    },

    reorderItems: async (categoryId: string, orderedIds: string[]): Promise<void> => {
        await delay();
        notifyDemoBackendAction();
        state.menuItems = state.menuItems.map((i) =>
            i.categoryId === categoryId && orderedIds.indexOf(i.id) !== -1
                ? { ...i, sortOrder: orderedIds.indexOf(i.id) + 1 }
                : i,
        );
    },

    importMenuCsv: async (_file: File): Promise<MenuCsvImportReport> => {
        await delay();
        throw demoUnavailable('CSV import');
    },

    // Orders
    getOrders: async (filters?: { status?: OrderStatus; from?: string; to?: string; limit?: number }): Promise<Order[]> => {
        await delay();
        let orders = clone(state.orders);
        if (filters?.status) orders = orders.filter((o) => o.status === filters.status);
        if (filters?.limit) orders = orders.slice(0, filters.limit);
        return orders;
    },

    updateOrderStatus: async (id: string, status: OrderStatus, note?: string): Promise<Order> => {
        await delay();
        notifyDemoBackendAction();
        const idx = state.orders.findIndex((o) => o.id === id);
        if (idx === -1) throw new Error('Order not found');
        const now = new Date().toISOString();
        state.orders[idx] = {
            ...state.orders[idx],
            status,
            statusHistory: [...state.orders[idx].statusHistory, { status, at: now, ...(note ? { note } : {}) }],
            updatedAt: now,
        };
        return clone(state.orders[idx]);
    },

    setStoreOpen: async (open: boolean): Promise<boolean> => {
        await delay();
        notifyDemoBackendAction();
        state.restaurant.storeOpen = open;
        return open;
    },

    // ----- Ordering settings (feature toggles) -----
    getSettings: async (): Promise<OrderingSettingsData> => {
        await delay();
        return {
            storeOpen: state.restaurant.storeOpen === true,
            slug: state.restaurant.slug ?? 'demo',
            ordering: clone(state.restaurant.ordering ?? {}),
        };
    },

    updateSettings: async (patch: OrderingSettingsPatch): Promise<OrderingSettingsData> => {
        await delay();
        notifyDemoBackendAction();
        const current = state.restaurant.ordering ?? {};
        state.restaurant.ordering = {
            ...current,
            ...(patch.taxRatePercent !== undefined ? { taxRatePercent: patch.taxRatePercent } : {}),
            ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
            ...(patch.delivery !== undefined
                ? { delivery: { enabled: true, flatFee: 0, minOrder: 0, ...current.delivery, ...patch.delivery } }
                : {}),
            ...(patch.pickup !== undefined
                ? { pickup: { enabled: patch.pickup.enabled ?? current.pickup?.enabled ?? true } }
                : {}),
            ...(patch.dineIn !== undefined
                ? { dineIn: { enabled: patch.dineIn.enabled ?? current.dineIn?.enabled ?? true } }
                : {}),
        };
        if (patch.storeOpen !== undefined) state.restaurant.storeOpen = patch.storeOpen;
        return {
            storeOpen: state.restaurant.storeOpen === true,
            slug: state.restaurant.slug ?? 'demo',
            ordering: clone(state.restaurant.ordering),
        };
    },

    uploadMenuImage: async (file: File): Promise<{ assetId: string; url: string }> => {
        await delay();
        notifyDemoBackendAction();
        // Demo mode: serve the image straight from memory as an object URL.
        const url = URL.createObjectURL(file);
        return { assetId: `demo-asset-${Date.now()}`, url };
    },

    // Reservations
    getReservations: async (filters?: { status?: ReservationStatus; date?: string }): Promise<Reservation[]> => {
        await delay();
        let reservations = clone(state.reservations);
        if (filters?.status) reservations = reservations.filter((r) => r.status === filters.status);
        if (filters?.date) reservations = reservations.filter((r) => r.date === filters.date);
        return reservations;
    },

    decideReservation: async (id: string, status: Extract<ReservationStatus, 'confirmed' | 'declined' | 'no_show'>): Promise<Reservation> => {
        await delay();
        notifyDemoBackendAction();
        const idx = state.reservations.findIndex((r) => r.id === id);
        if (idx === -1) throw new Error('Reservation not found');
        state.reservations[idx] = { ...state.reservations[idx], status, updatedAt: new Date().toISOString() };
        return clone(state.reservations[idx]);
    },

    // Site content (draft / publish / rollback)
    getContentDraft: async (): Promise<ContentDraftResponse> => {
        await delay();
        return {
            draft: clone(state.contentDraft),
            publishedVersion: state.publishedVersion,
            versions: clone(state.versions),
        };
    },

    saveContentDraft: async (draft: StorefrontContent): Promise<StorefrontContent> => {
        await delay();
        notifyDemoBackendAction();
        state.contentDraft = clone(draft);
        return clone(state.contentDraft);
    },

    publishContent: async (): Promise<number> => {
        await delay();
        notifyDemoBackendAction();
        state.publishedVersion += 1;
        state.versions = [...state.versions, { version: state.publishedVersion, publishedAt: new Date().toISOString() }];
        return state.publishedVersion;
    },

    rollbackContent: async (version?: number): Promise<{ restoredFromVersion: number; publishedVersion: number }> => {
        await delay();
        notifyDemoBackendAction();
        const restoredFromVersion = version ?? Math.max(state.publishedVersion - 1, 1);
        state.publishedVersion += 1;
        state.versions = [...state.versions, { version: state.publishedVersion, publishedAt: new Date().toISOString() }];
        return { restoredFromVersion, publishedVersion: state.publishedVersion };
    },

    // Growth campaigns: fixture cohorts + simulated queued sends
    getCohorts: async (): Promise<CustomerCohort[]> => {
        await delay();
        return clone(DEMO_COHORTS);
    },

    sendCampaign: async (payload: CampaignSendRequest): Promise<CampaignQueuedResponse> => {
        await delay();
        notifyDemoBackendAction();
        const cohort = DEMO_COHORTS.find((c) => c.id === payload.cohortId);
        if (!cohort) throw new Error('Unknown cohort');
        if (payload.kind === 'discount_offer' && !payload.discount) throw new Error('Discount details are required');
        return { campaignId: `demo-camp-${randomSuffix()}`, status: 'QUEUED', audienceCount: cohort.count };
    },

    // Analytics (funnel)
    getAnalyticsSummary: async (from?: string, to?: string): Promise<OrderingAnalyticsSummary> => {
        await delay();
        return {
            from: from ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
            to: to ?? new Date().toISOString(),
            events: clone(DEMO_FUNNEL_EVENTS),
        };
    },
};

// ----- Restaurant Intelligence (fixtures + fake 3-poll scan) -----
//
// The big [SAMPLE] report fixture is lazy-loaded (dynamic import) so it only
// ships in the chunk the Intelligence tab pulls in — other buckets don't pay
// for it (INTEGRATION.md §7). getScan fakes a 3-poll completion so gh-pages
// visitors experience the pipeline stepper (QUEUED shown client-side →
// FETCHING_PLACES → ANALYZING → COMPLETED).
const intelScanPolls = new Map<string, number>();

const intelFixtures = () => import('./lib/demo-fixtures-intelligence');

export const intelligenceAPI = {
    startScan: async (_body: { name?: string; city?: string; force?: boolean; placeId?: string }): Promise<{ scanId: string }> => {
        await delay();
        notifyDemoBackendAction();
        const scanId = `demo-scan-${randomSuffix()}`;
        intelScanPolls.set(scanId, 0);
        return { scanId };
    },

    getScan: async (scanId: string): Promise<IntelligenceScan> => {
        await delay();
        const n = (intelScanPolls.get(scanId) ?? 0) + 1;
        intelScanPolls.set(scanId, n);
        const { DEMO_INTELLIGENCE_REPORT_ID, DEMO_INTELLIGENCE_RESTAURANT_ID } = await intelFixtures();
        const status: ScanStatus = n >= 3 ? 'COMPLETED' : n === 1 ? 'FETCHING_PLACES' : 'ANALYZING';
        return {
            _id: scanId,
            restaurantId: DEMO_INTELLIGENCE_RESTAURANT_ID,
            query: { name: DEMO_RESTAURANT.name, city: 'Bengaluru' },
            status,
            reportId: status === 'COMPLETED' ? DEMO_INTELLIGENCE_REPORT_ID : undefined,
            requestedBy: 'demo-owner-u1',
            createdAt: new Date(),
            updatedAt: new Date(),
        };
    },

    getReports: async (): Promise<IntelligenceReportSummary[]> => {
        await delay();
        const { DEMO_INTELLIGENCE_REPORT_SUMMARIES } = await intelFixtures();
        return clone(DEMO_INTELLIGENCE_REPORT_SUMMARIES);
    },

    getReport: async (_reportId: string): Promise<IntelligenceReport> => {
        await delay();
        const { DEMO_INTELLIGENCE_REPORT } = await intelFixtures();
        return clone(DEMO_INTELLIGENCE_REPORT);
    },

    getLatestReport: async (): Promise<IntelligenceReport | null> => {
        await delay();
        const { DEMO_INTELLIGENCE_REPORT } = await intelFixtures();
        return clone(DEMO_INTELLIGENCE_REPORT);
    },

    getSelfMetrics: async (): Promise<IntelligenceSelfMetrics> => {
        await delay();
        const { DEMO_INTELLIGENCE_SELF_METRICS } = await intelFixtures();
        return clone(DEMO_INTELLIGENCE_SELF_METRICS);
    },

    // ----- v2: two-bucket dashboard (fixtures-backed, in-memory mutations) -----

    getWatchlist: async (): Promise<WatchlistResponse> => {
        await delay();
        const { state } = await intelV2State();
        return { entries: clone(state.watchlist), max: WATCHLIST_MAX };
    },

    putWatchlist: async (entries: WatchlistInput[]): Promise<WatchlistResponse> => {
        await delay();
        const { state } = await intelV2State();
        // Enforce the cap locally, surfacing the server's 422 message shape.
        if (entries.length > WATCHLIST_MAX) {
            throw new Error(`Watchlist exceeds the maximum of ${WATCHLIST_MAX} competitors.`);
        }
        const seen = new Set<string>();
        for (const e of entries) {
            if (!e.placeId) throw new Error('each entry needs a placeId');
            if (seen.has(e.placeId)) throw new Error('watchlist contains duplicate placeIds');
            seen.add(e.placeId);
        }
        const byPlace = new Map(state.watchlist.map((w) => [w.placeId, w.addedAt]));
        state.watchlist = entries.map((e) => ({
            placeId: e.placeId,
            name: e.name?.trim() || e.placeId,
            addedAt: byPlace.get(e.placeId) ?? new Date(),
            ...(e.zomatoUrl?.trim() ? { zomatoUrl: e.zomatoUrl.trim() } : {}),
        }));
        notifyDemoBackendAction();
        return { entries: clone(state.watchlist), max: WATCHLIST_MAX };
    },

    getSnapshots: async (query: SnapshotQuery): Promise<SnapshotSeriesResponse> => {
        await delay();
        const { m, state } = await intelV2State();
        const target = query.target ?? 'self';
        const targetPlaceId = target === 'self' ? m.DEMO_V2_SELF_PLACE_ID : target;
        const source = query.source ?? 'both';
        const points = m.deriveSeries(state.snapshots, {
            targetPlaceId,
            source,
            from: query.from,
            to: query.to,
            granularity: query.granularity,
        });
        return { target, source, granularity: query.granularity, points: clone(points) };
    },

    getFeedbackChanges: async (query: { from?: string; to?: string } = {}): Promise<{ days: FeedbackDay[] }> => {
        await delay();
        const { m, state } = await intelV2State();
        const to = query.to ?? state.anchor;
        const from = query.from ?? new Date(Date.parse(`${to}T00:00:00Z`) - 30 * 86400000).toISOString().slice(0, 10);
        return clone(m.deriveFeedbackDays(state.snapshots, from, to));
    },

    getCompare: async (query: CompareQuery): Promise<CompareRow[]> => {
        await delay();
        const { m, state } = await intelV2State();
        const value = query.granularity === 'month' ? (query.month ?? state.anchor.slice(0, 7)) : (query.date ?? state.anchor);
        return clone(m.deriveCompareRows(state.snapshots, state.watchlist, DEMO_RESTAURANT.name, query.granularity, value));
    },

    getNewOpenings: async (query: { sinceDays?: 30 | 60 | 90; radiusKm?: number } = {}): Promise<NewOpening[]> => {
        await delay();
        const { m, state } = await intelV2State();
        const now = Date.parse(`${state.anchor}T00:00:00.000Z`);
        return clone(m.deriveNewOpenings(state.sightings, query.radiusKm ?? 5, query.sinceDays ?? 30, now));
    },

    postZomatoManual: async (body: ZomatoManualInput): Promise<{ snapshotWritten: boolean }> => {
        await delay();
        const { m, state } = await intelV2State();
        const targetPlaceId = !body.target || body.target === 'self' ? m.DEMO_V2_SELF_PLACE_ID : body.target;
        const date = state.anchor;
        // Replace today's zomato snapshot for the target so the series appears live.
        state.snapshots = state.snapshots.filter(
            (s) => !(s.targetPlaceId === targetPlaceId && s.source === 'zomato' && s.date === date),
        );
        const snap: DailySnapshot = {
            _id: `snapv2-${targetPlaceId}-zomato-${date}`,
            restaurantId: DEMO_RESTAURANT.id,
            targetPlaceId,
            isSelf: targetPlaceId === m.DEMO_V2_SELF_PLACE_ID,
            source: 'zomato',
            date,
            rating: body.rating,
            reviewCount: body.reviewCount,
            photoCount: body.photoCount,
            newReviews: [],
            capturedAt: new Date(),
        };
        state.snapshots.push(snap);
        notifyDemoBackendAction();
        return { snapshotWritten: true };
    },

    captureNow: async (): Promise<{ captured: number }> => {
        // Intentional 1.5s "fresh capture" delay (Brief 09 §4).
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const { state } = await intelV2State();
        notifyDemoBackendAction();
        // self google + zomato + one per watchlist source that exists.
        return { captured: 2 + state.watchlist.length };
    },
};

// ----- In-memory v2 intelligence state (lazy; built once per session) -----
type IntelV2Module = typeof import('./lib/demo-fixtures-intelligence-v2');
interface IntelV2State {
    anchor: string;
    snapshots: DailySnapshot[];
    watchlist: WatchlistEntry[];
    sightings: NearbyPlaceSighting[];
}
let intelV2: IntelV2State | null = null;

async function intelV2State(): Promise<{ m: IntelV2Module; state: IntelV2State }> {
    const m = (await import('./lib/demo-fixtures-intelligence-v2')) as IntelV2Module;
    if (!intelV2) {
        const anchor = m.todayStr();
        intelV2 = {
            anchor,
            snapshots: m.buildSnapshots(anchor),
            watchlist: m.buildWatchlist(anchor),
            sightings: m.buildSightings(anchor),
        };
    }
    return { m, state: intelV2 };
}

