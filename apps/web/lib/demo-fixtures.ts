/**
 * *** SAMPLE DATA ONLY — demo-mode fixtures (VITE_DEMO_MODE=true) ***
 *
 * Static, plausible sample data for the merchant dashboard's static preview.
 * The "[SAMPLE] Demo Kitchen" restaurant, its menu and storefront content are
 * generated from packages/db/src/seeds/ordering-demo.ts (keep in sync when
 * the seed changes); posts / strategy / analytics / billing are dashboard-only
 * fixtures. Never imported outside demo mode code (demo-api.ts).
 */
import type {
    AccountManager,
    City,
    CustomerCohort,
    ContentStrategy,
    CreditPack,
    FeatureFlags,
    InstagramConnectionStatus,
    Invoice,
    MenuCategory,
    Order,
    OrderingMenuItem,
    PlanUsage,
    Post,
    Reservation,
    Restaurant,
    StorefrontContent,
    StrategyCycle,
    Subscription,
    SubscriptionPlan,
    User,
} from '@restropulse/shared';

export const DEMO_RESTAURANT_ID = 'demo-r1';

// ----- Date helpers (relative so the preview always looks fresh) -----

const DAY = 24 * 60 * 60 * 1000;
const MIN = 60 * 1000;
/** ISO timestamp `days` from now (negative = past). */
const days = (n: number): string => new Date(Date.now() + n * DAY).toISOString();
const minutes = (n: number): string => new Date(Date.now() + n * MIN).toISOString();
/** YYYY-MM-DD `days` from now. */
const dateOnly = (n: number): string => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);

/** Placeholder image (placehold.co) — no real assets in the demo. */
const thumb = (text: string, size = '600x600'): string =>
    `https://placehold.co/${size}/f97316/ffffff?text=${encodeURIComponent(text)}`;

// ----- Owner + restaurant (mirrors DEMO_OWNER / DEMO_RESTAURANT in the seed) -----

export const DEMO_USER: User = {
    id: 'demo-owner-u1',
    name: '[SAMPLE] Demo Owner',
    email: 'demo-owner@example.com',
    phone: '+910000000001',
    role: 'OWNER',
    emailVerified: true,
    restaurantId: DEMO_RESTAURANT_ID,
};

export const DEMO_INSTAGRAM_STATUS: InstagramConnectionStatus = {
    connected: true,
    username: 'demo.kitchen.sample',
    userId: 'demo-ig-user-1',
    pageName: '[SAMPLE] Demo Kitchen',
    connectedAt: days(-30),
    tokenStatus: 'valid',
    needsReauthorization: false,
};

export const DEMO_RESTAURANT: Restaurant = {
    id: DEMO_RESTAURANT_ID,
    name: '[SAMPLE] Demo Kitchen',
    cuisine: 'Multi-cuisine (sample data)',
    location: {
        address: '[SAMPLE] 1 Demo Lane, Bangalore, KA',
        lat: 12.9716,
        lng: 77.5946,
        mapUrl: 'https://maps.example.com/demo',
    },
    accountManager: {
        name: '[SAMPLE] Demo AM',
        phone: '+910000000003',
        email: 'demo-am@example.com',
        avatar: '',
    },
    // Pre-"connected" to a sample account (pure fixture — no Meta keys) so the
    // content approval workflow is fully interactive in the preview.
    integrations: { instagram: true },
    instagramConnection: DEMO_INSTAGRAM_STATUS,
    activeOffers: [
        '[SAMPLE] Free delivery on orders above ₹499 this week',
        '[SAMPLE] 20% off family combos, Monday–Thursday',
    ],
    chefSpecials: [
        '[SAMPLE] Slow-cooked Mutton Rogan Josh',
        '[SAMPLE] Monsoon special: Masala Chai + Pakora platter',
    ],
    menuLastUpdated: days(-6),
    description:
        '[SAMPLE] Demo Kitchen is a placeholder restaurant used to showcase the RestroPulse merchant dashboard.',
    phone: '+910000000001',
    website: 'https://example.com/demo-kitchen',
    priceRange: 'mid-range',
    operatingHours: {
        weekday_text: [
            'Monday: 11:00 AM – 11:00 PM',
            'Tuesday: 11:00 AM – 11:00 PM',
            'Wednesday: 11:00 AM – 11:00 PM',
            'Thursday: 11:00 AM – 11:00 PM',
            'Friday: 11:00 AM – 11:30 PM',
            'Saturday: 11:00 AM – 11:30 PM',
            'Sunday: 12:00 PM – 10:30 PM',
        ],
    },
    serviceOptions: { delivery: true, dineIn: true, takeout: true },
    slug: 'demo',
    storeOpen: true,
    ordering: {
        taxRatePercent: 5,
        currency: 'INR',
        delivery: {
            enabled: true,
            flatFee: 40,
            minOrder: 199,
            zones: [{ name: '[SAMPLE] Within 5km', flatFee: 40, minOrder: 199 }],
        },
        pickup: { enabled: true },
        dineIn: { enabled: true },
    },
};

// ----- Content Studio: sample generated posts across the whole workflow -----

export const DEMO_POSTS: Post[] = [
    {
        id: 'demo-post-01',
        type: 'IMAGE',
        status: 'PENDING_APPROVAL',
        thumbnail: thumb('[SAMPLE] Butter Chicken'),
        caption:
            '[SAMPLE] Velvety butter chicken, slow-simmered in tomato-butter gravy. Tag someone who needs this tonight. 🍗✨ #DemoKitchen #ButterChicken',
        platforms: ['INSTAGRAM', 'FACEBOOK'],
        restaurantId: DEMO_RESTAURANT_ID,
        scheduledFor: days(2),
        themes: ['comfort food'],
        archetype: 'CRAVING_CUE',
    },
    {
        id: 'demo-post-02',
        type: 'REEL',
        status: 'PENDING_APPROVAL',
        thumbnail: thumb('[SAMPLE] Biryani Reel'),
        videoUrl: '',
        caption:
            "[SAMPLE] Dum ka dhamaka! Watch the steam rise off our chicken biryani — layered, sealed and slow-cooked. Sound ON. 🔊 #BiryaniReel",
        platforms: ['INSTAGRAM'],
        restaurantId: DEMO_RESTAURANT_ID,
        scheduledFor: days(3),
        duration: '0:22',
        archetype: 'SIGNATURE_DISH',
    },
    {
        id: 'demo-post-03',
        type: 'IMAGE',
        status: 'CHANGES_REQUESTED',
        thumbnail: thumb('[SAMPLE] Weekend Offer'),
        caption:
            '[SAMPLE] Weekend plans sorted: 20% off family combos. Bring the whole gang! 👨‍👩‍👧‍👦',
        platforms: ['INSTAGRAM', 'FACEBOOK'],
        restaurantId: DEMO_RESTAURANT_ID,
        scheduledFor: days(4),
        feedback: '[SAMPLE] Make the offer text bigger and mention it ends Sunday.',
        archetype: 'OFFER_SPOTLIGHT',
    },
    {
        id: 'demo-post-04',
        type: 'CAROUSEL',
        status: 'PENDING_MEDIA',
        thumbnail: thumb('[SAMPLE] Generating…'),
        caption:
            '[SAMPLE] From tandoor to table: 4 breads you have to try. Swipe through → 🫓',
        platforms: ['INSTAGRAM'],
        restaurantId: DEMO_RESTAURANT_ID,
        scheduledFor: days(5),
        generationStep: 'MEDIA_REQUESTED',
        lastStepAt: minutes(-9),
        archetype: 'MENU_TOUR',
    },
    {
        id: 'demo-post-05',
        type: 'IMAGE',
        status: 'SCHEDULED',
        thumbnail: thumb('[SAMPLE] Paneer Tikka'),
        caption:
            '[SAMPLE] Char-grilled paneer tikka with mint chutney — smoky, spicy, and 100% veg. 🌱🔥',
        platforms: ['INSTAGRAM', 'FACEBOOK'],
        restaurantId: DEMO_RESTAURANT_ID,
        scheduledFor: days(1),
        archetype: 'CRAVING_CUE',
    },
    {
        id: 'demo-post-06',
        type: 'CAROUSEL',
        status: 'SCHEDULED',
        thumbnail: thumb('[SAMPLE] Dessert Trio'),
        caption:
            '[SAMPLE] Sweet endings: gulab jamun, kulfi and a monsoon-special jalebi. Which one first? 🍮',
        platforms: ['INSTAGRAM'],
        restaurantId: DEMO_RESTAURANT_ID,
        scheduledFor: days(2.5),
        archetype: 'MENU_TOUR',
    },
    {
        id: 'demo-post-07',
        type: 'IMAGE',
        status: 'POSTED',
        thumbnail: thumb('[SAMPLE] Dal Makhani'),
        caption:
            '[SAMPLE] Our dal makhani simmers overnight — 14 hours of patience in every bowl. 🖤',
        platforms: ['INSTAGRAM', 'FACEBOOK'],
        restaurantId: DEMO_RESTAURANT_ID,
        postedAt: days(-3),
        instagramMediaId: 'demo-ig-media-07',
        stats: { likes: 412, comments: 37, shares: 21, reach: 6180 },
        archetype: 'SIGNATURE_DISH',
    },
    {
        id: 'demo-post-08',
        type: 'REEL',
        status: 'POSTED',
        thumbnail: thumb('[SAMPLE] Kitchen BTS'),
        caption:
            '[SAMPLE] 6 AM at Demo Kitchen: fresh naan dough, first tadka, and a whole lot of chai. ☕',
        platforms: ['INSTAGRAM'],
        restaurantId: DEMO_RESTAURANT_ID,
        postedAt: days(-7),
        duration: '0:31',
        instagramMediaId: 'demo-ig-media-08',
        stats: { likes: 894, comments: 102, shares: 64, reach: 15420 },
        archetype: 'BEHIND_THE_SCENES',
    },
    {
        id: 'demo-post-09',
        type: 'IMAGE',
        status: 'POSTED',
        thumbnail: thumb('[SAMPLE] Thali Special'),
        caption: '[SAMPLE] Sunday thali is back — 9 items, one plate, zero regrets. 🥘',
        platforms: ['FACEBOOK'],
        restaurantId: DEMO_RESTAURANT_ID,
        postedAt: days(-12),
        facebookPostId: 'demo-fb-post-09',
        stats: { likes: 236, comments: 18, shares: 9, reach: 3940 },
        archetype: 'OFFER_SPOTLIGHT',
    },
    {
        id: 'demo-post-10',
        type: 'IMAGE',
        status: 'MISSED_DEADLINE',
        thumbnail: thumb('[SAMPLE] Missed Post'),
        caption: '[SAMPLE] Rainy-day special: hot pakoras and cutting chai.',
        platforms: ['INSTAGRAM'],
        restaurantId: DEMO_RESTAURANT_ID,
        scheduledFor: days(-2),
        feedback: '[SAMPLE] This post was not approved before its scheduled time.',
        archetype: 'CRAVING_CUE',
    },
];

// ----- Dashboard (restaurant performance) -----

export const DEMO_ANALYTICS = {
    // 30 days of publishing activity, bucketed by week (most recent first, as the API returns it).
    postsPerWeek: [
        { week: 4, posts: 7 },
        { week: 3, posts: 5 },
        { week: 2, posts: 6 },
        { week: 1, posts: 4 },
    ],
    contentMix: [
        { type: 'IMAGE', count: 12 },
        { type: 'REEL', count: 5 },
        { type: 'CAROUSEL', count: 3 },
        { type: 'STORY', count: 2 },
    ],
    platformMix: [
        { platform: 'INSTAGRAM', count: 15 },
        { platform: 'FACEBOOK', count: 7 },
    ],
};

// ----- Strategy + Inputs -----
//
// Theme system: a restaurant-marketing content catalog. Each planned post row
// is one theme (emoji + name + one-line description + example post) with a
// weight expressed as a monthly post count. The active cycle also carries a
// weekly cadence recommendation rendered by the Strategy view.

export const DEMO_STRATEGY: ContentStrategy = {
    id: 'demo-strategy-1',
    restaurantId: DEMO_RESTAURANT_ID,
    postsPerWeek: 5,
    focusCategories: ['Signature Dishes', 'Offers & Combos', 'Behind the Scenes', 'Festivals & Seasonal'],
    bestTime: '7:00 PM – 9:00 PM',
    nextScheduledDate: days(1),
    theme: '[SAMPLE] Monsoon comfort food, festive warm-ups',
};

/**
 * The 8-theme catalog with default weights (% of a 20-post month → counts).
 * Signature 25%, Offers 20%, BTS 15%, Festivals 15%, Customer Love 10%,
 * Local 5%, Weekday drivers 5%, Launches 5%.
 */
const THEME_CATALOG = {
    signature: {
        category: 'Signature Dishes',
        emoji: '🍛',
        description: 'Hero the dishes people already drive across town for.',
        examplePost: '"14 hours of dum, one pot of biryani. Some things can\'t be rushed. 🍛"',
    },
    bts: {
        category: 'Behind the Scenes',
        emoji: '👨‍🍳',
        description: 'Kitchen, chef and prep stories — the trust builders.',
        examplePost: '"6 AM: fresh naan dough, first tadka, and chef\'s third chai. ☕"',
    },
    offers: {
        category: 'Offers & Combos',
        emoji: '🎟️',
        description: 'Family combos, meal deals and limited-time discounts.',
        examplePost: '"Weekend sorted: 20% off family combos till Sunday. Bring the gang! 👨‍👩‍👧‍👦"',
    },
    festivals: {
        category: 'Festivals & Seasonal',
        emoji: '🪔',
        description: 'Diwali, Holi, Christmas, NYE — plan the calendar spikes early.',
        examplePost: '"Diwali thali bookings open — saffron kheer on the house. 🪔✨"',
    },
    customerLove: {
        category: 'Customer Love',
        emoji: '💬',
        description: 'Reviews, regulars and reposted customer photos (UGC).',
        examplePost: '"\'Best butter chicken in Indiranagar\' — thanks Ananya, we\'re framing this. 🧡"',
    },
    local: {
        category: 'Local & Community',
        emoji: '📍',
        description: 'City events, cricket match days, neighbourhood moments.',
        examplePost: '"Match day! Big screen on, jersey discounts live. India, let\'s go! 🏏"',
    },
    weekday: {
        category: 'Weekday Traffic Drivers',
        emoji: '🍽️',
        description: 'Lunch specials and happy hours that fill quiet weekdays.',
        examplePost: '"₹199 lunch thali, out in 15 minutes — your lunch break can handle it. ⏱️"',
    },
    launches: {
        category: 'New Launches',
        emoji: '🚀',
        description: 'New dishes and menu drops, teased before they land.',
        examplePost: '"Something smoky joins the menu Friday. Hint: it comes on a sizzler. 👀"',
    },
} as const;

type ThemeKey = keyof typeof THEME_CATALOG;

/** One planned-posts row: theme + monthly count (weight). */
const themed = (key: ThemeKey, count: number, themes?: string[]) => ({
    ...THEME_CATALOG[key],
    count,
    ...(themes ? { themes } : {}),
});

/** Default monthly mix — 20 posts split by the standard weights. */
const STANDARD_MIX = [
    themed('signature', 5),                       // 25%
    themed('offers', 4),                          // 20%
    themed('bts', 3),                             // 15%
    themed('festivals', 3, ['Diwali warm-up']),   // 15%
    themed('customerLove', 2),                    // 10%
    themed('local', 1, ['cricket match days']),   // 5%
    themed('weekday', 1, ['lunch specials']),     // 5%
    themed('launches', 1),                        // 5%
];

/** Weekly cadence recommendation rendered on the cycle card. */
const WEEKLY_CADENCE = [
    { day: 'Mon', theme: '🍽️ Lunch-driver', note: 'catch the weekday lunch crowd early' },
    { day: 'Wed', theme: '👨‍🍳 Behind the Scenes', note: 'mid-week trust builder' },
    { day: 'Fri', theme: '🎟️ Offer', note: 'weekend decision window opens' },
    { day: 'Sat', theme: '🍛 Signature dish', note: 'prime dinner-scroll hours' },
    { day: 'Sun', theme: '💬 Family & Customer Love', note: 'family-outing planning day' },
];

export const DEMO_CYCLES: StrategyCycle[] = [
    {
        id: 'demo-cycle-next',
        restaurantId: DEMO_RESTAURANT_ID,
        period: '[SAMPLE] Next cycle',
        startDate: days(18),
        endDate: days(46),
        status: 'PENDING_APPROVAL',
        summary:
            '[SAMPLE] Festive quarter warm-up: lead with signature dishes (25%) and sharpen offers to 20% as Diwali approaches. Festival posts step up mid-cycle, Friday offers target the weekend decision window, and one launch teaser preps the new sizzler menu.',
        plannedPosts: [
            themed('signature', 5),
            themed('offers', 4, ['festive family combos']),
            themed('festivals', 4, ['Diwali', 'Karwa Chauth']),
            themed('bts', 3),
            themed('customerLove', 2),
            themed('local', 1, ['cricket season']),
            themed('weekday', 1, ['happy hours']),
            themed('launches', 1, ['sizzler menu']),
        ],
        focus: ['Diwali build-up', 'Sizzler menu launch', 'Weekend family combos'],
        weeklyCadence: WEEKLY_CADENCE,
        plannedSchedule: [
            { scheduledFor: days(19), category: 'Signature Dishes', postType: 'IMAGE' },
            { scheduledFor: days(21), category: 'Behind the Scenes', postType: 'REEL' },
            { scheduledFor: days(24), category: 'Offers & Combos', postType: 'IMAGE' },
            { scheduledFor: days(26), category: 'Festivals & Seasonal', postType: 'CAROUSEL' },
        ],
    },
    {
        id: 'demo-cycle-active',
        restaurantId: DEMO_RESTAURANT_ID,
        period: '[SAMPLE] Current cycle',
        startDate: days(-10),
        endDate: days(18),
        status: 'ACTIVE',
        summary:
            '[SAMPLE] Monsoon comfort-food month: signature slow-cooked classics carry the feed (25%), weekday lunch thalis and happy hours prop up rainy-day footfall, and one BTS reel a week keeps the kitchen story going. Offers run Fri–Sun when families decide where to eat.',
        plannedPosts: STANDARD_MIX,
        focus: ['Monsoon specials', 'Weekday lunch traffic', 'Signature gravies'],
        weeklyCadence: WEEKLY_CADENCE,
        plannedSchedule: [
            { scheduledFor: days(1), category: 'Signature Dishes', postType: 'IMAGE' },
            { scheduledFor: days(2.5), category: 'Weekday Traffic Drivers', postType: 'IMAGE' },
            { scheduledFor: days(4), category: 'Offers & Combos', postType: 'IMAGE' },
            { scheduledFor: days(6), category: 'Behind the Scenes', postType: 'REEL' },
        ],
    },
    {
        id: 'demo-cycle-past',
        restaurantId: DEMO_RESTAURANT_ID,
        period: '[SAMPLE] Previous cycle',
        startDate: days(-38),
        endDate: days(-10),
        status: 'HISTORY',
        summary:
            '[SAMPLE] Summer coolers wrap-up: chaas, kulfi and lighter lunch bowls. BTS reels outperformed static posts 3:1 — carried that learning into this cycle\'s cadence.',
        plannedPosts: [
            themed('signature', 6),
            themed('offers', 4),
            themed('weekday', 2, ['summer lunch bowls']),
            themed('bts', 2),
        ],
        focus: ['Summer coolers', 'Lunch bowls'],
    },
];

// ----- Feature flags -----

export const DEMO_FEATURE_FLAGS: FeatureFlags = {
    deleteAccount: false,
    topupCredits: true,
    updatesSection: true,
    minScheduleAheadMins: 150,
    postApprovalBufferMins: 120,
    cycleApprovalBufferMins: 4320,
    enabledPlatforms: ['INSTAGRAM', 'FACEBOOK'],
};

// ----- Billing: plans, subscription, usage, credit packs, invoices -----

const plan = (
    id: string,
    slug: string,
    tier: SubscriptionPlan['tier'],
    name: string,
    monthly: number,
    features: string[],
): SubscriptionPlan => ({
    id,
    slug,
    version: 1,
    isCurrentVersion: true,
    tier,
    name,
    limits: {
        weekly: {
            INSTAGRAM: { IMAGE: 3, REEL: 1, CAROUSEL: 1 },
            FACEBOOK: { IMAGE: 2 },
        },
        dailyAdhoc: { INSTAGRAM: { IMAGE: 1 } },
    },
    pricing: { monthly, annual: monthly * 10, currency: 'INR' },
    razorpayPlanIds: { monthly: `plan_demo_${slug}_m`, annual: `plan_demo_${slug}_a` },
    features,
    createdAt: days(-120),
});

export const DEMO_PLANS: SubscriptionPlan[] = [
    plan('demo-plan-starter', 'starter', 'STARTER', 'Starter', 199900, [
        '[SAMPLE] 3 posts per week',
        '[SAMPLE] Instagram publishing',
        '[SAMPLE] Monthly strategy',
    ]),
    plan('demo-plan-growth', 'growth', 'GROWTH', 'Growth', 299900, [
        '[SAMPLE] 5 posts per week',
        '[SAMPLE] Instagram + Facebook',
        '[SAMPLE] Reels & carousels',
        '[SAMPLE] Monthly strategy cycles',
    ]),
    plan('demo-plan-premium', 'premium', 'PREMIUM', 'Premium', 499900, [
        '[SAMPLE] Daily content',
        '[SAMPLE] All formats incl. video',
        '[SAMPLE] Priority account manager',
    ]),
];

export const DEMO_SUBSCRIPTION: Subscription = {
    id: 'demo-sub-1',
    restaurantId: DEMO_RESTAURANT_ID,
    planId: 'demo-plan-growth',
    planSnapshot: DEMO_PLANS[1],
    billingCycle: 'MONTHLY',
    status: 'ACTIVE',
    currentPeriodStart: days(-12),
    currentPeriodEnd: days(18),
    credits: 34,
    createdAt: days(-72),
};

export const DEMO_USAGE: PlanUsage = {
    INSTAGRAM: {
        IMAGE: { used: 2, limit: 3 },
        REEL: { used: 1, limit: 1 },
        CAROUSEL: { used: 0, limit: 1 },
    },
    FACEBOOK: {
        IMAGE: { used: 1, limit: 2 },
    },
};

export const DEMO_CREDIT_PACKS: CreditPack[] = [
    {
        id: 'demo-pack-s',
        name: '[SAMPLE] Booster 10',
        description: '10 extra content credits',
        credits: 10,
        priceInPaise: 49900,
        isActive: true,
        sortOrder: 1,
    },
    {
        id: 'demo-pack-m',
        name: '[SAMPLE] Booster 25',
        description: '25 extra content credits',
        credits: 25,
        priceInPaise: 99900,
        isActive: true,
        sortOrder: 2,
    },
];

export const DEMO_INVOICES: Invoice[] = [
    {
        id: 'demo-inv-3',
        restaurantId: DEMO_RESTAURANT_ID,
        type: 'SUBSCRIPTION',
        amountPaise: 299900,
        currency: 'INR',
        status: 'paid',
        description: '[SAMPLE] Growth plan — monthly subscription',
        billingPeriodStart: days(-12),
        billingPeriodEnd: days(18),
        paidAt: days(-12),
        createdAt: days(-12),
    },
    {
        id: 'demo-inv-2',
        restaurantId: DEMO_RESTAURANT_ID,
        type: 'CREDIT_PURCHASE',
        amountPaise: 49900,
        currency: 'INR',
        status: 'paid',
        description: '[SAMPLE] Booster 10 credit pack',
        paidAt: days(-25),
        createdAt: days(-25),
    },
    {
        id: 'demo-inv-1',
        restaurantId: DEMO_RESTAURANT_ID,
        type: 'SUBSCRIPTION',
        amountPaise: 299900,
        currency: 'INR',
        status: 'paid',
        description: '[SAMPLE] Growth plan — monthly subscription',
        billingPeriodStart: days(-42),
        billingPeriodEnd: days(-12),
        paidAt: days(-42),
        createdAt: days(-42),
    },
];

// ----- Onboarding helpers -----

export const DEMO_CITIES: City[] = [{ id: 'demo-city-blr', name: 'Bangalore', defaultZone: 'Indiranagar' }];

export const DEMO_ACCOUNT_MANAGERS: AccountManager[] = [
    {
        id: 'demo-am-1',
        name: '[SAMPLE] Demo AM',
        phone: '+910000000003',
        email: 'demo-am@example.com',
        avatar: '',
        city: 'Bangalore',
        zone: 'Indiranagar',
    },
];

// ----- Ordering: menu (mirrors the 4 categories / 14 items in the seed) -----

const menuCat = (id: string, name: string, description: string, sortOrder: number): MenuCategory => ({
    id,
    restaurantId: DEMO_RESTAURANT_ID,
    name,
    description,
    sortOrder,
});

export const DEMO_MENU_CATEGORIES: MenuCategory[] = [
    menuCat('demo-cat-starters', 'Starters', '[SAMPLE] Small plates to begin with', 1),
    menuCat('demo-cat-mains', 'Mains', '[SAMPLE] Hearty main courses', 2),
    menuCat('demo-cat-breads-rice', 'Breads & Rice', '[SAMPLE] Fresh breads and fragrant rice', 3),
    menuCat('demo-cat-desserts', 'Desserts & Drinks', '[SAMPLE] Sweet endings and refreshers', 4),
];

type ItemInput = Omit<OrderingMenuItem, 'restaurantId' | 'images' | 'description'> & { description: string };

/** Per-category placeholder palette (kept in sync with the db seed) so demo menu images look like food, not grey boxes. */
const CATEGORY_IMAGE_COLORS: Record<string, { bg: string; text: string }> = {
    'demo-cat-starters': { bg: 'f97316', text: 'ffffff' },     // warm orange
    'demo-cat-mains': { bg: 'b91c1c', text: 'ffffff' },        // deep red
    'demo-cat-breads-rice': { bg: 'f59e0b', text: '7c2d12' },  // amber
    'demo-cat-desserts': { bg: 'ec4899', text: 'ffffff' },     // pink
};

const dishImage = (categoryId: string, name: string): string => {
    const { bg, text } = CATEGORY_IMAGE_COLORS[categoryId] ?? { bg: '64748b', text: 'ffffff' };
    return `https://placehold.co/600x400/${bg}/${text}?text=${encodeURIComponent(name)}`;
};

const menuItem = (partial: ItemInput): OrderingMenuItem => ({
    ...partial,
    restaurantId: DEMO_RESTAURANT_ID,
    description: `[SAMPLE] ${partial.description}`,
    images: [dishImage(partial.categoryId, partial.name)],
});

export const DEMO_MENU_ITEMS: OrderingMenuItem[] = [
    // Starters
    menuItem({ id: 'demo-mi-01', categoryId: 'demo-cat-starters', name: 'Crispy Corn Chaat', description: 'Golden fried corn tossed with onions and chaat masala.', price: 180, isVeg: true, availability: 'in_stock', sortOrder: 1 }),
    menuItem({ id: 'demo-mi-02', categoryId: 'demo-cat-starters', name: 'Paneer Tikka', description: 'Char-grilled cottage cheese with mint chutney.', price: 260, isVeg: true, availability: 'in_stock', sortOrder: 2, addons: [{ id: 'demo-ad-cheese', name: 'Extra Cheese', price: 40 }] }),
    menuItem({ id: 'demo-mi-03', categoryId: 'demo-cat-starters', name: 'Chicken 65', description: 'South-Indian style spicy fried chicken.', price: 290, isVeg: false, availability: 'in_stock', sortOrder: 3 }),
    menuItem({ id: 'demo-mi-04', categoryId: 'demo-cat-starters', name: 'Fish Amritsari', description: 'Batter-fried river fish with carom seeds.', price: 340, isVeg: false, availability: 'out_of_stock', sortOrder: 4 }),
    // Mains
    menuItem({ id: 'demo-mi-05', categoryId: 'demo-cat-mains', name: 'Butter Chicken', description: 'Tandoori chicken simmered in tomato-butter gravy.', price: 380, isVeg: false, availability: 'in_stock', sortOrder: 1, variants: [{ id: 'demo-va-bc-half', name: 'Half', price: 240 }, { id: 'demo-va-bc-full', name: 'Full', price: 380 }] }),
    menuItem({ id: 'demo-mi-06', categoryId: 'demo-cat-mains', name: 'Paneer Butter Masala', description: 'Cottage cheese in rich makhani gravy.', price: 320, isVeg: true, availability: 'in_stock', sortOrder: 2, variants: [{ id: 'demo-va-pbm-half', name: 'Half', price: 200 }, { id: 'demo-va-pbm-full', name: 'Full', price: 320 }] }),
    menuItem({ id: 'demo-mi-07', categoryId: 'demo-cat-mains', name: 'Dal Makhani', description: 'Black lentils slow-cooked overnight.', price: 280, isVeg: true, availability: 'in_stock', sortOrder: 3 }),
    menuItem({ id: 'demo-mi-08', categoryId: 'demo-cat-mains', name: 'Mutton Rogan Josh', description: 'Kashmiri-style lamb curry.', price: 450, isVeg: false, availability: 'in_stock', sortOrder: 4 }),
    menuItem({ id: 'demo-mi-09', categoryId: 'demo-cat-mains', name: 'Seasonal Chef Special', description: 'Rotating special — hidden until announced.', price: 400, isVeg: true, availability: 'hidden', sortOrder: 5 }),
    // Breads & Rice
    menuItem({ id: 'demo-mi-10', categoryId: 'demo-cat-breads-rice', name: 'Butter Naan', description: 'Tandoor-baked leavened bread.', price: 60, isVeg: true, availability: 'in_stock', sortOrder: 1, addons: [{ id: 'demo-ad-garlic', name: 'Garlic Topping', price: 15 }] }),
    menuItem({ id: 'demo-mi-11', categoryId: 'demo-cat-breads-rice', name: 'Chicken Biryani', description: 'Dum-cooked basmati rice with chicken.', price: 340, isVeg: false, availability: 'in_stock', sortOrder: 2, variants: [{ id: 'demo-va-cb-half', name: 'Half', price: 220 }, { id: 'demo-va-cb-full', name: 'Full', price: 340 }], addons: [{ id: 'demo-ad-raita', name: 'Extra Raita', price: 30 }] }),
    menuItem({ id: 'demo-mi-12', categoryId: 'demo-cat-breads-rice', name: 'Veg Pulao', description: 'Fragrant rice with garden vegetables.', price: 240, isVeg: true, availability: 'in_stock', sortOrder: 3 }),
    // Desserts & Drinks
    menuItem({ id: 'demo-mi-13', categoryId: 'demo-cat-desserts', name: 'Gulab Jamun', description: 'Warm milk dumplings in saffron syrup (2 pcs).', price: 120, isVeg: true, availability: 'in_stock', sortOrder: 1 }),
    menuItem({ id: 'demo-mi-14', categoryId: 'demo-cat-desserts', name: 'Masala Chaas', description: 'Spiced buttermilk with roasted cumin.', price: 80, isVeg: true, availability: 'in_stock', sortOrder: 2 }),
];

// ----- Ordering: orders feed (sample orders across statuses) -----

interface DemoOrderInput {
    id: string;
    orderNumber: string;
    orderType: Order['orderType'];
    status: Order['status'];
    minutesAgo: number;
    customerName: string;
    customerPhone: string;
    items: Array<{ menuItemId: string; name: string; qty: number; unitPrice: number; variant?: { id: string; name: string; price: number } }>;
    deliveryFee?: number;
    address?: Order['address'];
}

const demoOrder = (o: DemoOrderInput): Order => {
    const items = o.items.map((it) => ({ ...it, lineTotal: it.unitPrice * it.qty }));
    const subtotal = items.reduce((sum, it) => sum + it.lineTotal, 0);
    const tax = Math.round(subtotal * 0.05 * 100) / 100;
    const deliveryFee = o.deliveryFee ?? 0;
    return {
        id: o.id,
        restaurantId: DEMO_RESTAURANT_ID,
        customerId: 'demo-customer-c1',
        orderNumber: o.orderNumber,
        orderType: o.orderType,
        items,
        totals: { subtotal, tax, deliveryFee, discount: 0, total: subtotal + tax + deliveryFee },
        status: o.status,
        statusHistory: [
            { status: 'RECEIVED', at: minutes(-o.minutesAgo) },
            ...(o.status !== 'RECEIVED' ? [{ status: o.status, at: minutes(-Math.max(o.minutesAgo - 10, 1)) }] : []),
        ],
        address: o.address,
        customerName: o.customerName,
        customerPhone: o.customerPhone,
        createdAt: minutes(-o.minutesAgo),
        updatedAt: minutes(-Math.max(o.minutesAgo - 10, 1)),
    };
};

export const DEMO_ORDERS: Order[] = [
    demoOrder({
        id: 'demo-ord-01', orderNumber: 'ORD-4K2M1A', orderType: 'delivery', status: 'RECEIVED', minutesAgo: 8,
        customerName: '[SAMPLE] Ananya Rao', customerPhone: '+910000000011',
        items: [
            { menuItemId: 'demo-mi-05', name: 'Butter Chicken', qty: 1, unitPrice: 380, variant: { id: 'demo-va-bc-full', name: 'Full', price: 380 } },
            { menuItemId: 'demo-mi-10', name: 'Butter Naan', qty: 2, unitPrice: 60 },
        ],
        deliveryFee: 40,
        address: { label: 'Home', line1: '[SAMPLE] 42 Placeholder Street', line2: 'Apt 3B', city: 'Bangalore', pincode: '560038', phone: '+910000000011' },
    }),
    demoOrder({
        id: 'demo-ord-02', orderNumber: 'ORD-7Q9RZP', orderType: 'pickup', status: 'PREPARING', minutesAgo: 24,
        customerName: '[SAMPLE] Vikram Shetty', customerPhone: '+910000000012',
        items: [
            { menuItemId: 'demo-mi-11', name: 'Chicken Biryani', qty: 1, unitPrice: 340, variant: { id: 'demo-va-cb-full', name: 'Full', price: 340 } },
            { menuItemId: 'demo-mi-13', name: 'Gulab Jamun', qty: 1, unitPrice: 120 },
        ],
    }),
    demoOrder({
        id: 'demo-ord-03', orderNumber: 'ORD-2XN8LT', orderType: 'delivery', status: 'OUT_FOR_DELIVERY', minutesAgo: 47,
        customerName: '[SAMPLE] Meera Iyer', customerPhone: '+910000000013',
        items: [
            { menuItemId: 'demo-mi-06', name: 'Paneer Butter Masala', qty: 1, unitPrice: 320, variant: { id: 'demo-va-pbm-full', name: 'Full', price: 320 } },
            { menuItemId: 'demo-mi-07', name: 'Dal Makhani', qty: 1, unitPrice: 280 },
            { menuItemId: 'demo-mi-10', name: 'Butter Naan', qty: 3, unitPrice: 60 },
        ],
        deliveryFee: 40,
        address: { label: 'Office', line1: '[SAMPLE] 12 Sample Tech Park', city: 'Bangalore', pincode: '560103' },
    }),
    demoOrder({
        id: 'demo-ord-04', orderNumber: 'ORD-9BC3VD', orderType: 'dine_in', status: 'READY', minutesAgo: 15,
        customerName: '[SAMPLE] Rahul Verma', customerPhone: '+910000000014',
        items: [
            { menuItemId: 'demo-mi-01', name: 'Crispy Corn Chaat', qty: 1, unitPrice: 180 },
            { menuItemId: 'demo-mi-14', name: 'Masala Chaas', qty: 2, unitPrice: 80 },
        ],
    }),
    demoOrder({
        id: 'demo-ord-05', orderNumber: 'ORD-5TW6HJ', orderType: 'pickup', status: 'COMPLETED', minutesAgo: 60 * 26,
        customerName: '[SAMPLE] Sana Khan', customerPhone: '+910000000015',
        items: [
            { menuItemId: 'demo-mi-08', name: 'Mutton Rogan Josh', qty: 1, unitPrice: 450 },
            { menuItemId: 'demo-mi-12', name: 'Veg Pulao', qty: 1, unitPrice: 240 },
        ],
    }),
    demoOrder({
        id: 'demo-ord-06', orderNumber: 'ORD-8PL4QS', orderType: 'delivery', status: 'CANCELLED', minutesAgo: 60 * 50,
        customerName: '[SAMPLE] Arjun Nair', customerPhone: '+910000000016',
        items: [{ menuItemId: 'demo-mi-03', name: 'Chicken 65', qty: 1, unitPrice: 290 }],
        deliveryFee: 40,
        address: { line1: '[SAMPLE] 7 Demo Gardens', city: 'Bangalore', pincode: '560095' },
    }),
];

// ----- Ordering: reservations -----

export const DEMO_RESERVATIONS: Reservation[] = [
    { id: 'demo-res-01', restaurantId: DEMO_RESTAURANT_ID, date: dateOnly(1), time: '19:30', partySize: 4, name: '[SAMPLE] Ananya Rao', phone: '+910000000011', notes: 'Window table if possible', status: 'pending', createdAt: days(-0.2) },
    { id: 'demo-res-02', restaurantId: DEMO_RESTAURANT_ID, date: dateOnly(2), time: '20:00', partySize: 2, name: '[SAMPLE] Vikram Shetty', phone: '+910000000012', status: 'pending', createdAt: days(-0.5) },
    { id: 'demo-res-03', restaurantId: DEMO_RESTAURANT_ID, date: dateOnly(1), time: '13:00', partySize: 6, name: '[SAMPLE] Meera Iyer', phone: '+910000000013', email: 'meera@example.com', notes: 'Birthday lunch', status: 'confirmed', createdAt: days(-1) },
    { id: 'demo-res-04', restaurantId: DEMO_RESTAURANT_ID, date: dateOnly(-2), time: '21:00', partySize: 3, name: '[SAMPLE] Rahul Verma', phone: '+910000000014', status: 'no_show', createdAt: days(-4) },
];

// ----- Ordering: storefront site content (mirrors seed published content) -----

export const DEMO_STOREFRONT_CONTENT: StorefrontContent = {
    heroImages: [
        'https://placehold.co/1600x900?text=%5BSAMPLE%5D+Demo+Kitchen+Hero+1',
        'https://placehold.co/1600x900?text=%5BSAMPLE%5D+Demo+Kitchen+Hero+2',
    ],
    // Small public sample clip; heroImages[0] doubles as the poster/fallback.
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
    announcement: { text: '[SAMPLE] Free delivery on orders above Rs. 499 this week!', enabled: true },
    about: '[SAMPLE] Demo Kitchen is a placeholder restaurant used to showcase the RestroPulse online ordering storefront.',
    hours: [
        { day: 'Monday', open: '11:00', close: '23:00' },
        { day: 'Tuesday', open: '11:00', close: '23:00' },
        { day: 'Wednesday', open: '11:00', close: '23:00' },
        { day: 'Thursday', open: '11:00', close: '23:00' },
        { day: 'Friday', open: '11:00', close: '23:30' },
        { day: 'Saturday', open: '11:00', close: '23:30' },
        { day: 'Sunday', open: '12:00', close: '22:30' },
    ],
    contact: { phone: '+910000000001', email: 'demo-owner@example.com', address: '[SAMPLE] 1 Demo Lane, Bangalore, KA' },
    socialLinks: { instagram: 'https://instagram.com/example', facebook: 'https://facebook.com/example' },
    story: [
        { year: '2018', title: '[SAMPLE] The first stove', text: 'Started as a 4-table eatery.', image: 'https://placehold.co/800x600?text=%5BSAMPLE%5D+2018' },
        { year: '2022', title: '[SAMPLE] Going online', text: 'Launched delivery across the city.', image: 'https://placehold.co/800x600?text=%5BSAMPLE%5D+2022' },
    ],
    chefs: [
        { name: '[SAMPLE] Chef Demo', title: 'Head Chef', bio: 'Placeholder chef biography for the demo storefront.', photo: 'https://placehold.co/400x400?text=%5BSAMPLE%5D+Chef' },
    ],
    gallery: [
        'https://placehold.co/800x600/c2410c/ffffff?text=Dining+Hall',
        'https://placehold.co/800x600/9a3412/ffffff?text=Kitchen',
        'https://placehold.co/800x600/ea580c/ffffff?text=Chef%27s+Counter',
        'https://placehold.co/800x600/f59e0b/7c2d12?text=Tandoor+Station',
        'https://placehold.co/800x600/78350f/ffffff?text=Courtyard+Seating',
    ],
    dineIn: [
        { title: '[SAMPLE] Private dining', text: 'A 12-seater private room for celebrations.', image: 'https://placehold.co/800x600?text=%5BSAMPLE%5D+Dine-in' },
    ],
    reservations: { daysAhead: 14, slotMinutes: 30, maxPartySize: 10, startTime: '12:00', endTime: '22:30' },
    theme: { primaryColor: '#C2410C', secondaryColor: '#1C1917', accentColor: '#F59E0B', logoUrl: 'https://placehold.co/200x200?text=%5BSAMPLE%5D+Logo' },
};

// ----- Ordering: funnel analytics (descending storefront funnel) -----

export const DEMO_FUNNEL_EVENTS: Array<{ name: string; count: number; uniqueSessions: number }> = [
    { name: 'menu_view', count: 1284, uniqueSessions: 861 },
    { name: 'item_view', count: 986, uniqueSessions: 642 },
    { name: 'add_to_cart', count: 448, uniqueSessions: 317 },
    { name: 'begin_checkout', count: 205, uniqueSessions: 188 },
    { name: 'login_prompt', count: 152, uniqueSessions: 141 },
    { name: 'order_placed', count: 97, uniqueSessions: 92 },
];

// ----- Growth campaigns: fixture cohorts (counts are sample numbers) -----

export const DEMO_COHORTS: CustomerCohort[] = [
    {
        id: 'drop_off_cart',
        name: 'Drop-off carts',
        emoji: '🛒',
        count: 34,
        description: '[SAMPLE] Added to cart or started checkout in the last 7 days but never placed the order.',
    },
    {
        id: 'non_transacted',
        name: 'Non-transacted signups',
        emoji: '👋',
        count: 58,
        description: '[SAMPLE] Created an account but have not ordered yet — a welcome offer converts these best.',
    },
    {
        id: 'lapsed_30d',
        name: 'Lapsed 30-day',
        emoji: '💤',
        count: 21,
        description: '[SAMPLE] Ordered before, but nothing in the last 30 days. A gentle reminder brings them back.',
    },
];
