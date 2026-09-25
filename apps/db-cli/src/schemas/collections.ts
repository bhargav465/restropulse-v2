import { CreateIndexesOptions, IndexSpecification } from 'mongodb';

export interface CollectionSchema {
    name: string;
    indexes: Array<{
        spec: IndexSpecification;
        options?: CreateIndexesOptions;
    }>;
    validator?: object;
}

export const COLLECTIONS: CollectionSchema[] = [
    {
        name: 'users',
        indexes: [
            { spec: { email: 1 }, options: { unique: true } },
            { spec: { restaurantId: 1 } },
            { spec: { role: 1 } },
        ],
        validator: {
            $jsonSchema: {
                bsonType: 'object',
                required: ['email', 'name', 'role'],
                properties: {
                    email: { bsonType: 'string', description: 'User email address' },
                    name: { bsonType: 'string', description: 'User full name' },
                    phone: { bsonType: 'string' },
                    role: { enum: ['OWNER', 'MANAGER', 'ADMIN'], description: 'User role' },
                    restaurantId: { bsonType: 'string' },
                    createdAt: { bsonType: 'date' },
                    updatedAt: { bsonType: 'date' },
                },
            },
        },
    },
    {
        name: 'restaurants',
        indexes: [
            { spec: { 'location.lat': 1, 'location.lng': 1 } },
        ],
        validator: {
            $jsonSchema: {
                bsonType: 'object',
                required: ['name', 'cuisine'],
                properties: {
                    name: { bsonType: 'string', description: 'Restaurant name' },
                    cuisine: { bsonType: 'string', description: 'Cuisine type' },
                    location: {
                        bsonType: 'object',
                        properties: {
                            address: { bsonType: 'string' },
                            lat: { bsonType: 'double' },
                            lng: { bsonType: 'double' },
                            mapUrl: { bsonType: 'string' },
                        },
                    },
                    accountManager: {
                        bsonType: 'object',
                        properties: {
                            name: { bsonType: 'string' },
                            phone: { bsonType: 'string' },
                            email: { bsonType: 'string' },
                            avatar: { bsonType: 'string' },
                        },
                    },
                    integrations: {
                        bsonType: 'object',
                        properties: {
                            whatsapp: { bsonType: 'bool' },
                            instagram: { bsonType: 'bool' },
                            facebook: { bsonType: 'bool' },
                        },
                    },
                    activeOffers: { bsonType: 'array', items: { bsonType: 'string' } },
                    chefSpecials: { bsonType: 'array', items: { bsonType: 'string' } },
                    menuLastUpdated: { bsonType: 'string' },
                    description:    { bsonType: 'string' },
                    phone:          { bsonType: 'string' },
                    website:        { bsonType: 'string' },
                    priceRange:     { enum: ['budget', 'mid-range', 'upscale', 'fine-dining'] },
                    operatingHours: {
                        bsonType: 'object',
                        properties: {
                            weekday_text: { bsonType: 'array', items: { bsonType: 'string' } },
                        },
                    },
                    serviceOptions: {
                        bsonType: 'object',
                        properties: {
                            delivery: { bsonType: 'bool' },
                            dineIn:   { bsonType: 'bool' },
                            takeout:  { bsonType: 'bool' },
                        },
                    },
                    menu: {
                        bsonType: 'array',
                        items: {
                            bsonType: 'object',
                            required: ['id', 'category', 'name', 'isVeg', 'isAvailable'],
                            properties: {
                                id:           { bsonType: 'string' },
                                category:     { bsonType: 'string' },
                                name:         { bsonType: 'string' },
                                description:  { bsonType: 'string' },
                                price:        { bsonType: ['double', 'int'] },
                                isVeg:        { bsonType: 'bool' },
                                isBestSeller: { bsonType: 'bool' },
                                isAvailable:  { bsonType: 'bool' },
                            },
                        },
                    },
                    sourceCity:  { bsonType: 'string' },
                    dataSource:  { enum: ['kaggle-zomato', 'osm', 'merged', 'manual'] },
                    autoContentEnabled:  { bsonType: 'bool', description: 'Opt-in: content-engine may auto-materialize posts from an approved strategy cycle. Default false when absent.' },
                    dailyAdhocPostLimit: { bsonType: 'int', description: 'Max adhoc post creation requests per day. Default DEFAULT_DAILY_ADHOC_POST_LIMIT (5) when absent.' },
                    createdAt: { bsonType: 'date' },
                    updatedAt: { bsonType: 'date' },
                },
            },
        },
    },
    {
        name: 'posts',
        indexes: [
            { spec: { restaurantId: 1 } },
            { spec: { status: 1 } },
            { spec: { platform: 1 } },
            { spec: { groupId: 1 } },
            { spec: { scheduledFor: 1 } },
            { spec: { postedAt: -1 } },
            { spec: { restaurantId: 1, status: 1 } },
        ],
        validator: {
            $jsonSchema: {
                bsonType: 'object',
                required: ['type', 'status', 'platform'],
                properties: {
                    type: { enum: ['IMAGE', 'VIDEO', 'CAROUSEL', 'REEL', 'STORY'] },
                    status: { enum: ['PENDING_CONTENT', 'PENDING_APPROVAL', 'CHANGES_REQUESTED', 'SCHEDULED', 'PUBLISHING', 'POSTED', 'MISSED_DEADLINE'] },
                    thumbnail: { bsonType: 'string' },
                    videoUrl: { bsonType: 'string' },
                    mediaUrls: { bsonType: 'array', items: { bsonType: 'string' } },
                    caption: { bsonType: 'string' },
                    platform: { enum: ['INSTAGRAM', 'FACEBOOK'] },
                    groupId: { bsonType: 'string' },
                    scheduledFor: { bsonType: 'string' },
                    postedAt: { bsonType: 'string' },
                    duration: { bsonType: 'string' },
                    feedback: { bsonType: 'string' },
                    stats: {
                        bsonType: 'object',
                        properties: {
                            likes: { bsonType: 'int' },
                            shares: { bsonType: 'int' },
                            comments: { bsonType: 'int' },
                            reach: { bsonType: 'int' },
                        },
                    },
                    restaurantId: { bsonType: 'string' },
                    createdAt: { bsonType: 'date' },
                    updatedAt: { bsonType: 'date' },
                },
            },
        },
    },
    {
        name: 'strategyCycles',
        indexes: [
            { spec: { restaurantId: 1 } },
            { spec: { status: 1 } },
            { spec: { startDate: 1, endDate: 1 } },
        ],
        validator: {
            $jsonSchema: {
                bsonType: 'object',
                required: ['period', 'status'],
                properties: {
                    period: { bsonType: 'string', description: 'Cycle period label' },
                    startDate: { bsonType: 'string' },
                    endDate: { bsonType: 'string' },
                    status: { enum: ['PENDING_INPUT', 'ACTIVE', 'APPROVED', 'HISTORY'] },
                    summary: { bsonType: 'string' },
                    plannedPosts: {
                        bsonType: 'array',
                        items: {
                            bsonType: 'object',
                            properties: {
                                category: { bsonType: 'string' },
                                count: { bsonType: 'int' },
                            },
                        },
                    },
                    focus: { bsonType: 'array', items: { bsonType: 'string' } },
                    feedback: { bsonType: 'string' },
                    restaurantId: { bsonType: 'string' },
                    createdAt: { bsonType: 'date' },
                    updatedAt: { bsonType: 'date' },
                },
            },
        },
    },
    {
        name: 'contentStrategies',
        indexes: [
            { spec: { restaurantId: 1 }, options: { unique: true } },
        ],
        validator: {
            $jsonSchema: {
                bsonType: 'object',
                required: ['restaurantId'],
                properties: {
                    postsPerWeek: { bsonType: 'int' },
                    focusCategories: { bsonType: 'array', items: { bsonType: 'string' } },
                    bestTime: { bsonType: 'string' },
                    nextScheduledDate: { bsonType: 'string' },
                    theme: { bsonType: 'string' },
                    restaurantId: { bsonType: 'string' },
                    createdAt: { bsonType: 'date' },
                    updatedAt: { bsonType: 'date' },
                },
            },
        },
    },
    {
        name: 'sessions',
        indexes: [
            { spec: { token: 1 }, options: { unique: true } },
            { spec: { userId: 1 } },
            { spec: { expiresAt: 1 }, options: { expireAfterSeconds: 0 } },
        ],
        validator: {
            $jsonSchema: {
                bsonType: 'object',
                required: ['token', 'userId', 'expiresAt'],
                properties: {
                    token: { bsonType: 'string' },
                    userId: { bsonType: 'string' },
                    expiresAt: { bsonType: 'date' },
                    createdAt: { bsonType: 'date' },
                },
            },
        },
    },
    {
        name: 'otpChallenges',
        indexes: [
            { spec: { phone: 1 } },
            { spec: { expiresAt: 1 }, options: { expireAfterSeconds: 0 } },
        ],
    },
    {
        name: 'oauthSessions',
        indexes: [
            // sparse: this collection also stores { type: 'oauth_state', state, ... }
            // documents that have no sessionId field -- a non-sparse unique index
            // treats every one of those as sessionId: null and rejects all but the first.
            { spec: { sessionId: 1 }, options: { unique: true, sparse: true } },
            { spec: { expiresAt: 1 }, options: { expireAfterSeconds: 0 } },
        ],
    },
    {
        name: 'accountManagers',
        indexes: [
            { spec: { city: 1 } },
            { spec: { city: 1, zone: 1 } },
        ],
        validator: {
            $jsonSchema: {
                bsonType: 'object',
                required: ['name', 'phone', 'email', 'city', 'zone'],
                properties: {
                    name: { bsonType: 'string', description: 'Manager full name' },
                    phone: { bsonType: 'string', description: 'Contact phone' },
                    email: { bsonType: 'string', description: 'Contact email' },
                    avatar: { bsonType: 'string', description: 'Avatar URL' },
                    city: { bsonType: 'string', description: 'City name' },
                    zone: { bsonType: 'string', description: 'Zone within city' },
                    createdAt: { bsonType: 'date' },
                    updatedAt: { bsonType: 'date' },
                },
            },
        },
    },
    {
        name: 'cities',
        indexes: [
            { spec: { name: 1 }, options: { unique: true } },
        ],
        validator: {
            $jsonSchema: {
                bsonType: 'object',
                required: ['name', 'defaultZone'],
                properties: {
                    name: { bsonType: 'string' },
                    defaultZone: { bsonType: 'string' },
                    createdAt: { bsonType: 'date' },
                    updatedAt: { bsonType: 'date' },
                },
            },
        },
    },
    {
        name: 'dataDeletionAudits',
        indexes: [
            { spec: { confirmationCode: 1 }, options: { unique: true } },
            { spec: { expiresAt: 1 }, options: { expireAfterSeconds: 0 } },
        ],
    },
    {
        name: 'subscriptionPlans',
        indexes: [
            { spec: { slug: 1, version: -1 }, options: { unique: true } },
            { spec: { isCurrentVersion: 1 } },
        ],
        validator: {
            $jsonSchema: {
                bsonType: 'object',
                required: ['slug', 'version', 'tier', 'name'],
                properties: {
                    slug: { bsonType: 'string' },
                    version: { bsonType: 'int' },
                    isCurrentVersion: { bsonType: 'bool' },
                    tier: { enum: ['STARTER', 'GROWTH', 'PREMIUM'] },
                    name: { bsonType: 'string' },
                    limits: {
                        bsonType: 'object',
                        properties: {
                            reelsPerWeek: { bsonType: 'int' },
                            instagramPostsPerWeek: { bsonType: 'int' },
                            carouselPostsPerWeek: { bsonType: 'int' },
                        },
                    },
                    pricing: {
                        bsonType: 'object',
                        properties: {
                            monthly: { bsonType: 'int' },
                            annual: { bsonType: 'int' },
                            currency: { bsonType: 'string' },
                        },
                    },
                    features: { bsonType: 'array', items: { bsonType: 'string' } },
                    createdAt: { bsonType: 'date' },
                    updatedAt: { bsonType: 'date' },
                },
            },
        },
    },
    {
        name: 'subscriptions',
        indexes: [
            { spec: { restaurantId: 1 }, options: { unique: true, partialFilterExpression: { endedAt: null } } },
            { spec: { razorpaySubscriptionId: 1 }, options: { unique: true, sparse: true } },
            { spec: { status: 1 } },
        ],
        validator: {
            $jsonSchema: {
                bsonType: 'object',
                required: ['restaurantId', 'status', 'credits'],
                properties: {
                    restaurantId: { bsonType: 'string' },
                    status: { enum: ['NONE', 'CREATED', 'AUTHENTICATED', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'HALTED'] },
                    credits: { bsonType: 'int' },
                    billingCycle: { enum: ['MONTHLY', 'ANNUAL'] },
                    razorpaySubscriptionId: { bsonType: 'string' },
                    razorpayCustomerId: { bsonType: 'string' },
                    couponCode: { bsonType: 'string' },
                    endedAt: { bsonType: ['string', 'null'] },
                    createdAt: { bsonType: 'date' },
                    updatedAt: { bsonType: 'date' },
                },
            },
        },
    },
    {
        name: 'coupons',
        indexes: [
            { spec: { code: 1 }, options: { unique: true } },
            { spec: { status: 1 } },
            { spec: { createdBy: 1 } },
            { spec: { assignedTo: 1 }, options: { sparse: true } },
        ],
        validator: {
            $jsonSchema: {
                bsonType: 'object',
                required: ['code', 'type', 'value', 'status', 'createdBy', 'validFrom'],
                properties: {
                    code: { bsonType: 'string' },
                    type: { enum: ['PERCENTAGE', 'FLAT'] },
                    value: { bsonType: 'int' },
                    status: { enum: ['ACTIVE', 'DISABLED', 'EXPIRED'] },
                    redemptionCount: { bsonType: 'int' },
                    createdBy: { bsonType: 'string' },
                    validFrom: { bsonType: 'date' },
                    createdAt: { bsonType: 'date' },
                    updatedAt: { bsonType: 'date' },
                },
            },
        },
    },
    {
        name: 'couponRedemptions',
        indexes: [
            { spec: { couponId: 1 } },
            { spec: { restaurantId: 1 } },
            { spec: { couponId: 1, restaurantId: 1 }, options: { unique: true } },
        ],
    },
    {
        name: 'creditPurchases',
        indexes: [
            { spec: { restaurantId: 1 } },
            { spec: { razorpayOrderId: 1 }, options: { unique: true } },
        ],
        validator: {
            $jsonSchema: {
                bsonType: 'object',
                required: ['restaurantId', 'userId', 'status'],
                properties: {
                    restaurantId: { bsonType: 'string' },
                    userId: { bsonType: 'string' },
                    status: { enum: ['PENDING', 'PAID', 'FAILED'] },
                    creditsAdded: { bsonType: 'int' },
                    amountPaise: { bsonType: 'int' },
                    razorpayOrderId: { bsonType: 'string' },
                    createdAt: { bsonType: 'date' },
                    updatedAt: { bsonType: 'date' },
                },
            },
        },
    },
    {
        name: 'creditPacks',
        indexes: [
            { spec: { isActive: 1 } },
        ],
        validator: {
            $jsonSchema: {
                bsonType: 'object',
                required: ['name', 'credits', 'priceInPaise'],
                properties: {
                    name: { bsonType: 'string' },
                    description: { bsonType: 'string' },
                    credits: { bsonType: 'int' },
                    priceInPaise: { bsonType: 'int' },
                    isActive: { bsonType: 'bool' },
                    sortOrder: { bsonType: 'int' },
                    createdAt: { bsonType: 'date' },
                    updatedAt: { bsonType: 'date' },
                },
            },
        },
    },
    {
        name: 'invoices',
        indexes: [
            { spec: { restaurantId: 1 } },
            { spec: { razorpayInvoiceId: 1 }, options: { unique: true, sparse: true } },
            { spec: { razorpayPaymentId: 1 }, options: { sparse: true } },
            { spec: { type: 1 } },
            { spec: { restaurantId: 1, createdAt: -1 } },
        ],
        validator: {
            $jsonSchema: {
                bsonType: 'object',
                required: ['restaurantId', 'type', 'amountPaise', 'currency', 'status', 'description'],
                properties: {
                    restaurantId: { bsonType: 'string' },
                    type: { enum: ['SUBSCRIPTION', 'CREDIT_PURCHASE'] },
                    amountPaise: { bsonType: 'int' },
                    currency: { bsonType: 'string' },
                    status: { bsonType: 'string' },
                    description: { bsonType: 'string' },
                    razorpayInvoiceId: { bsonType: 'string' },
                    razorpayPaymentId: { bsonType: 'string' },
                    razorpaySubscriptionId: { bsonType: 'string' },
                    razorpayOrderId: { bsonType: 'string' },
                    pdfUrl: { bsonType: 'string' },
                    createdAt: { bsonType: 'date' },
                    updatedAt: { bsonType: 'date' },
                },
            },
        },
    },
    {
        name: 'archivedAccounts',
        indexes: [
            { spec: { restaurantId: 1 } },
            { spec: { userPhone: 1 } },
            { spec: { archivedAt: -1 } },
            { spec: { restaurantId: 1, archivedAt: -1 } },
        ],
    },
    // ----- Restaurant Intelligence -----
    {
        name: 'intelligenceScans',
        indexes: [
            { spec: { restaurantId: 1, createdAt: -1 } },
        ],
    },
    {
        name: 'intelligenceReports',
        indexes: [
            { spec: { restaurantId: 1, generatedAt: -1 } },
        ],
    },
    {
        name: 'competitorCache',
        indexes: [
            { spec: { placeId: 1 }, options: { unique: true } },
            // 7-day TTL on Places (New) results to control cost.
            { spec: { fetchedAt: 1 }, options: { expireAfterSeconds: 7 * 24 * 60 * 60 } },
        ],
    },
    {
        name: 'intelligenceSnapshots',
        indexes: [
            // Unique per target x source x day makes the daily job an idempotent upsert.
            { spec: { restaurantId: 1, targetPlaceId: 1, source: 1, date: 1 }, options: { unique: true } },
            { spec: { restaurantId: 1, date: -1 } },
        ],
    },
    {
        name: 'nearbySightings',
        indexes: [
            { spec: { restaurantId: 1, placeId: 1 }, options: { unique: true } },
            { spec: { restaurantId: 1, firstSeenAt: -1 } },
        ],
    },
    {
        name: 'zomatoManualEntries',
        indexes: [
            { spec: { restaurantId: 1, targetPlaceId: 1, date: -1 } },
        ],
    },
    {
        // Best-effort internal analytics signals (intelligence worker scan/alert events).
        name: 'events',
        indexes: [
            { spec: { restaurantId: 1, ts: -1 } },
            { spec: { name: 1, ts: -1 } },
        ],
    },
    {
        // Operator-editable app settings, stored as a singleton document (_id: 'app').
        // Holds e.g. trialDays (free-trial length). No indexes needed.
        name: 'settings',
        indexes: [],
    },
    // ----- Public Grader (Lead Generation) -----
    {
        name: 'graderScans',
        indexes: [
            { spec: { createdAt: 1 }, options: { expireAfterSeconds: 7 * 24 * 60 * 60 } },
            { spec: { name: 1, city: 1 } },
        ],
    },
    {
        name: 'graderLeads',
        indexes: [
            { spec: { createdAt: 1 }, options: { expireAfterSeconds: 7 * 24 * 60 * 60 } },
            { spec: { phone: 1, email: 1 } },
        ],
    },
];
