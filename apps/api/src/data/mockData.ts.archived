import { Restaurant, Post, ContentStrategy, User, StrategyCycle } from '../models/types.js';

const CONTENT_BASE = process.env.CONTENT_BASE_URL || '/mockdata';

export const MOCK_USER: User = {
    id: 'u1',
    name: 'Arjun Mehta',
    email: 'arjun@spicelounge.com',
    phone: '+91 98765 43210',
    role: 'OWNER'
};

export const MOCK_RESTAURANT: Restaurant = {
    id: 'r1',
    name: 'The Spice Lounge',
    cuisine: 'Modern Indian Fusion',
    location: {
        address: '12, Indiranagar, Bangalore, KA',
        lat: 12.9716,
        lng: 77.5946,
        mapUrl: 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3888.003673059882!2d77.6384!3d12.9716!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x0!2zMTLCsDU4JzE3LjgiTiA3N8KwMzgnMTguMiJF!5e0!3m2!1sen!2sin!4v1620000000000!5m2!1sen!2sin'
    },
    accountManager: {
        name: 'Sarah Jenkins',
        phone: '+91 99999 88888',
        email: 'sarah@restropulse.ai',
        avatar: 'https://picsum.photos/100/100'
    },
    subscription: {
        tier: 'GOLD',
        renewalDate: '2024-12-01',
        status: 'ACTIVE'
    },
    integrations: {
        whatsapp: true,
        instagram: false,
        facebook: true
    },
    activeOffers: ['Flat 15% Off on Weekday Lunch Buffets'],
    chefSpecials: ['Truffle Mushroom Risotto'],
    menuLastUpdated: '2024-05-10'
};

const addHours = (h: number) => new Date(Date.now() + h * 60 * 60 * 1000).toISOString();

export const MOCK_POSTS: Post[] = [
    {
        id: 'p1',
        type: 'IMAGE',
        status: 'POSTED',
        thumbnail: `${CONTENT_BASE}/images/food_platter.jpg`,
        caption: 'Experience the burst of flavors with our new Tandoori Platter! #SpiceLounge #Foodie #BangaloreEats',
        platform: 'INSTAGRAM',
        postedAt: '2024-05-15T18:30:00Z',
        stats: {
            likes: 1240,
            shares: 45,
            comments: 89,
            reach: 5600
        }
    },
    {
        id: 'p2',
        type: 'CAROUSEL',
        status: 'PENDING_APPROVAL',
        thumbnail: `${CONTENT_BASE}/images/cocktails.jpg`,
        mediaUrls: [`${CONTENT_BASE}/images/cocktails.jpg`, `${CONTENT_BASE}/images/ambiance_1.jpg`, `${CONTENT_BASE}/images/crowd.jpg`],
        caption: 'Weekend Plans? Sorted. Join us for our Happy Hour every Friday from 5 PM. Buy 1 Get 1 on all cocktails!',
        platform: 'BOTH',
        scheduledFor: addHours(48),
        feedback: JSON.stringify({
            tags: ["Caption"],
            details: { "Caption": "Not engaging" },
            note: "Make it sound more exciting and add festive emojis!",
            resolution: "Rewrote caption with punchier text and added emojis as requested."
        })
    },
    {
        id: 'p3',
        type: 'VIDEO',
        status: 'POSTED',
        thumbnail: `${CONTENT_BASE}/images/chef_cooking.jpg`,
        videoUrl: `${CONTENT_BASE}/videos/chef_process.mp4`,
        caption: 'Behind the scenes at The Spice Lounge kitchen! Watch Chef Rajeev create magic.',
        platform: 'FACEBOOK',
        postedAt: '2024-05-12T12:00:00Z',
        duration: '0:45',
        stats: {
            likes: 890,
            shares: 120,
            comments: 56,
            reach: 8900
        }
    },
    {
        id: 'p4',
        type: 'IMAGE',
        status: 'CHANGES_REQUESTED',
        thumbnail: `${CONTENT_BASE}/images/biryani.jpg`,
        caption: 'Our signature Hyderabadi Biryani is waiting for you!',
        platform: 'INSTAGRAM',
        scheduledFor: addHours(72),
        feedback: JSON.stringify({
            tags: ["Image Quality", "Caption"],
            details: {
                "Image Quality": "Lighting seems off",
                "Caption": "Add more details about the dish"
            },
            note: "Please retake the photo with better lighting and expand the caption.",
            resolution: ""
        })
    },
    {
        id: 'p5',
        type: 'REEL',
        status: 'SCHEDULED',
        thumbnail: `${CONTENT_BASE}/images/vegetables_pan.jpg`,
        videoUrl: `${CONTENT_BASE}/videos/reel_steak.mp4`,
        caption: 'Fresh ingredients, every single day. Watch the magic happen in our kitchen!',
        platform: 'INSTAGRAM',
        duration: '0:15',
        scheduledFor: addHours(50)
    },
    {
        id: 'p6',
        type: 'STORY',
        status: 'SCHEDULED',
        thumbnail: `${CONTENT_BASE}/images/yogurt_fruit.jpg`,
        videoUrl: `${CONTENT_BASE}/videos/story_drink.mp4`,
        caption: 'Start your morning right! Healthy Breakfast Bowls now available.',
        platform: 'INSTAGRAM',
        duration: '0:15',
        scheduledFor: addHours(4)
    }
];

export const MOCK_CONTENT_STRATEGY: ContentStrategy = {
    postsPerWeek: 5,
    focusCategories: ['Food Photography', 'Behind-the-scenes', 'Customer Stories'],
    bestTime: '6:00 PM - 8:00 PM',
    nextScheduledDate: addHours(4),
    theme: 'Authentic Indian Flavors Meet Modern Dining'
};

export const MOCK_STRATEGY_CYCLES: StrategyCycle[] = [
    {
        id: 'sc1',
        period: 'June 2024',
        startDate: '2024-06-01',
        endDate: '2024-06-30',
        status: 'ACTIVE',
        summary: 'Focus on showcasing seasonal menu items and monsoon specials with increased engagement through interactive stories.',
        plannedPosts: [
            { category: 'Food Photography', count: 12 },
            { category: 'Reels', count: 8 },
            { category: 'Stories', count: 20 }
        ],
        focus: ['Monsoon Menu', 'Customer Testimonials', 'Chef Specials']
    },
    {
        id: 'sc2',
        period: 'May 2024',
        startDate: '2024-05-01',
        endDate: '2024-05-31',
        status: 'APPROVED',
        summary: 'Launch summer menu with vibrant visuals. Emphasize light, refreshing dishes and cocktail promotions.',
        plannedPosts: [
            { category: 'Food Photography', count: 10 },
            { category: 'Carousels', count: 5 },
            { category: 'Videos', count: 5 }
        ],
        focus: ['Summer Drinks', 'Outdoor Seating', 'Happy Hours']
    },
    {
        id: 'sc3',
        period: 'April 2024',
        startDate: '2024-04-01',
        endDate: '2024-04-30',
        status: 'HISTORY',
        summary: 'Festival season campaign with special thalis and traditional recipes.',
        plannedPosts: [
            { category: 'Food Photography', count: 15 },
            { category: 'Stories', count: 25 }
        ],
        focus: ['Traditional Dishes', 'Festival Offers', 'Family Dining']
    }
];
