// Reference/config data for seeding the database.

export const SEED_DATA: Record<string, any[]> = {
    cities: [
        { _id: 'city-bangalore', name: 'Bangalore', defaultZone: 'HQ' },
        { _id: 'city-delhi', name: 'Delhi', defaultZone: 'HQ' },
        { _id: 'city-hyderabad', name: 'Hyderabad', defaultZone: 'HQ' },
        { _id: 'city-mumbai', name: 'Mumbai', defaultZone: 'HQ' },
    ],

    accountManagers: [
        {
            _id: 'am-default-bangalore',
            name: 'RestroPulse Bangalore',
            phone: '+91 00000 00001',
            email: 'bangalore@restropulse.ai',
            avatar: '',
            city: 'Bangalore',
            zone: 'HQ',
        },
        {
            _id: 'am-default-delhi',
            name: 'RestroPulse Delhi',
            phone: '+91 00000 00002',
            email: 'delhi@restropulse.ai',
            avatar: '',
            city: 'Delhi',
            zone: 'HQ',
        },
        {
            _id: 'am-default-hyderabad',
            name: 'RestroPulse Hyderabad',
            phone: '+91 00000 00003',
            email: 'hyderabad@restropulse.ai',
            avatar: '',
            city: 'Hyderabad',
            zone: 'HQ',
        },
        {
            _id: 'am-default-mumbai',
            name: 'RestroPulse Mumbai',
            phone: '+91 00000 00004',
            email: 'mumbai@restropulse.ai',
            avatar: '',
            city: 'Mumbai',
            zone: 'HQ',
        },
    ],

    subscriptionPlans: [
        {
            _id: 'plan-starter-v1',
            slug: 'starter',
            version: 1,
            isCurrentVersion: true,
            tier: 'STARTER',
            name: 'Starter',
            limits: {
                weekly: { INSTAGRAM: { IMAGE: 2, STORY: 2, CAROUSEL: 1, REEL: 1, VIDEO: 1 } },
                dailyAdhoc: { INSTAGRAM: { IMAGE: 1, STORY: 1, CAROUSEL: 1, REEL: 1, VIDEO: 1 } },
            },
            pricing: { monthly: 299900, annual: 2999000, currency: 'INR' },
            razorpayPlanIds: { monthly: '', annual: '' },
            features: ['INSTAGRAM'],
        },
        {
            _id: 'plan-growth-v1',
            slug: 'growth',
            version: 1,
            isCurrentVersion: true,
            tier: 'GROWTH',
            name: 'Growth',
            limits: {
                weekly: { INSTAGRAM: { IMAGE: 3, STORY: 3, CAROUSEL: 2, REEL: 2, VIDEO: 2 }, FACEBOOK: { IMAGE: 3, CAROUSEL: 2, VIDEO: 2, STORY: 2 } },
                dailyAdhoc: { INSTAGRAM: { IMAGE: 2, STORY: 2, CAROUSEL: 1, REEL: 1, VIDEO: 1 }, FACEBOOK: { IMAGE: 2, CAROUSEL: 1, VIDEO: 1, STORY: 1 } },
            },
            pricing: { monthly: 999900, annual: 9999000, currency: 'INR' },
            razorpayPlanIds: { monthly: '', annual: '' },
            features: ['INSTAGRAM', 'FACEBOOK'],
        },
        {
            _id: 'plan-premium-v1',
            slug: 'premium',
            version: 1,
            isCurrentVersion: true,
            tier: 'PREMIUM',
            name: 'Premium',
            limits: {
                weekly: { INSTAGRAM: { IMAGE: 10, STORY: 10, CAROUSEL: 5, REEL: 5, VIDEO: 5 }, FACEBOOK: { IMAGE: 10, CAROUSEL: 5, VIDEO: 5, STORY: 5 } },
                dailyAdhoc: { INSTAGRAM: { IMAGE: 3, STORY: 3, CAROUSEL: 2, REEL: 2, VIDEO: 2 }, FACEBOOK: { IMAGE: 3, CAROUSEL: 2, VIDEO: 2, STORY: 2 } },
            },
            pricing: { monthly: 1699900, annual: 16999000, currency: 'INR' },
            razorpayPlanIds: { monthly: '', annual: '' },
            features: ['INSTAGRAM', 'FACEBOOK'],
        },
    ],

    creditPacks: [
        {
            _id: 'cp-20',
            name: '20 Credits',
            description: 'Create up to 20 posts or 4 reels',
            credits: 20,
            priceInPaise: 19900,
            isActive: true,
            sortOrder: 1,
        },
        {
            _id: 'cp-50',
            name: '50 Credits',
            description: 'Create up to 50 posts or 10 reels',
            credits: 50,
            priceInPaise: 44900,
            isActive: true,
            sortOrder: 2,
        },
        {
            _id: 'cp-100',
            name: '100 Credits',
            description: 'Create up to 100 posts or 20 reels',
            credits: 100,
            priceInPaise: 79900,
            isActive: true,
            sortOrder: 3,
        },
    ],

    // Operator-editable app settings (singleton). trialDays controls the no-card
    // free-trial length granted at onboarding; change it in the DB anytime.
    settings: [
        { _id: 'app', trialDays: 14 },
    ],
};
