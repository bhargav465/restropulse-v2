import {
    getUsersCollection,
    getRestaurantsCollection,
    getContentStrategiesCollection,
    getStrategyCyclesCollection,
    getSubscriptionsCollection,
} from '@restropulse/db';

/**
 * Seeds the test database with initial data needed by all tests
 * Skips seeding if collections are mocked (for unit tests)
 */
export async function seedTestData() {
    // Seed Users
    const usersCol = getUsersCollection();

    // Check if this is a mocked collection (unit test) - skip seeding
    if (!usersCol.deleteMany || typeof usersCol.deleteMany !== 'function') {
        console.log('[Test Setup] Skipping seed data (mocked collections detected)');
        return;
    }

    await usersCol.deleteMany({});

    await usersCol.insertMany([
        {
            _id: 'u1',
            id: 'u1',
            name: 'Arjun Mehta',
            email: 'arjun@spicelounge.com',
            emailVerified: true,
            phone: '+919999999999',
            role: 'OWNER',
            restaurantId: 'r1',
            createdAt: new Date(),
            updatedAt: new Date()
        }
    ] as any);

    // Seed Restaurants
    const restaurantsCol = getRestaurantsCollection();

    // Check if this is a mocked collection (unit test) - skip seeding
    if (!restaurantsCol || !restaurantsCol.deleteMany || typeof restaurantsCol.deleteMany !== 'function') {
        console.log('[Test Setup] Skipping seed data (mocked restaurant collection detected)');
        return;
    }

    await restaurantsCol.deleteMany({});
    await restaurantsCol.insertMany([
        {
            _id: 'r1',
            id: 'r1',
            name: 'The Spice Lounge',
            cuisine: 'Modern Indian Fusion',
            location: {
                address: '12, Indiranagar, Bangalore, KA',
                lat: 12.9716,
                lng: 77.5946,
                mapUrl: 'https://www.google.com/maps/test'
            },
            accountManager: {
                name: 'Sarah Jenkins',
                phone: '+91 99999 88888',
                email: 'sarah@restropulse.ai',
                avatar: 'https://picsum.photos/100/100'
            },
            integrations: {
                whatsapp: true,
                instagram: false,
                facebook: true
            },
            activeOffers: ['Flat 15% Off on Weekday Lunch Buffets'],
            chefSpecials: ['Truffle Mushroom Risotto'],
            menuLastUpdated: '2024-05-10',
            createdAt: new Date(),
            updatedAt: new Date()
        }
    ] as any);

    // Seed Content Strategy
    const strategiesCol = getContentStrategiesCollection();
    await strategiesCol.deleteMany({});
    await strategiesCol.insertMany([
        {
            _id: 'cs1',
            id: 'cs1',
            restaurantId: 'r1',
            postsPerWeek: 7,
            focusCategories: ['Food Photography', 'Behind the Scenes', 'Customer Testimonials'],
            bestTime: '6:00 PM - 8:00 PM',
            theme: 'Modern, vibrant visuals with a focus on storytelling',
            createdAt: new Date(),
            updatedAt: new Date()
        }
    ] as any);

    // Seed Strategy Cycles
    const cyclesCol = getStrategyCyclesCollection();
    await cyclesCol.deleteMany({});
    await cyclesCol.insertMany([
        {
            _id: 'sc1',
            id: 'sc1',
            restaurantId: 'r1',
            period: 'June 2024',
            startDate: '2024-06-01',
            endDate: '2024-06-30',
            status: 'ACTIVE',
            summary: 'Summer menu launch campaign',
            plannedPosts: [
                { category: 'Food Photography', count: 12 },
                { category: 'Behind the Scenes', count: 5 },
                { category: 'Customer Testimonials', count: 3 }
            ],
            focus: ['New Summer Menu', 'Outdoor Dining', 'Seasonal Cocktails'],
            createdAt: new Date(),
            updatedAt: new Date()
        },
        {
            _id: 'sc2',
            id: 'sc2',
            restaurantId: 'r1',
            period: 'May 2024',
            startDate: '2024-05-01',
            endDate: '2024-05-31',
            status: 'COMPLETED',
            summary: 'Spring celebration posts',
            plannedPosts: [
                { category: 'Food Photography', count: 10 },
                { category: 'Events', count: 5 }
            ],
            focus: ['Spring Specials', 'Mother\'s Day'],
            createdAt: new Date(),
            updatedAt: new Date()
        }
    ] as any);

    // Seed Subscription for r1 (active plan with high limits for testing)
    const subscriptionsCol = getSubscriptionsCollection();
    await subscriptionsCol.deleteMany({});
    await subscriptionsCol.insertMany([
        {
            _id: 'sub-r1',
            restaurantId: 'r1',
            status: 'ACTIVE',
            credits: 100,
            planId: 'plan-growth-v1',
            planSnapshot: {
                slug: 'growth',
                tier: 'GROWTH',
                name: 'Growth',
                limits: { weekly: { INSTAGRAM: { IMAGE: 100, STORY: 100, CAROUSEL: 100, REEL: 100, VIDEO: 100 }, FACEBOOK: { IMAGE: 100, CAROUSEL: 100, VIDEO: 100, STORY: 100 } } },
                pricing: { monthly: 999900, annual: 9999000, currency: 'INR' },
                features: ['INSTAGRAM', 'FACEBOOK'],
            },
            billingCycle: 'MONTHLY',
            createdAt: new Date(),
            updatedAt: new Date(),
        }
    ] as any);

    console.log('[Seed] Seeded: 1 user, 1 restaurant, 1 subscription, 1 content strategy, 2 strategy cycles');
}
