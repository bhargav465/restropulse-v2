import type { SiteConfig, SiteMenu } from '../src/api-client.js';

export const sampleConfig = (over: Partial<SiteConfig> = {}): SiteConfig => ({
    restaurant: { id: 'r1', name: 'Bawarchi [SAMPLE]', cuisine: 'Biryani', slug: 'bawarchi', phone: '+91 98765 43210', address: 'Road 1, Hyderabad' },
    ordering: {
        storeOpen: true,
        orderTypes: { delivery: true, pickup: true, dineIn: false },
        delivery: { flatFee: 40, minOrder: 200 },
        taxRatePercent: 5,
        payment: { online: true, cash: true },
    },
    content: {
        heroImages: ['https://cdn.example.com/hero.jpg'],
        tagline: 'Hyderabadi biryani since 1978',
        announcement: { text: 'Open on Diwali', enabled: true },
        about: 'Family run.\n\nSecond paragraph\nwith a break.',
        hours: [
            { day: 'Monday', open: '11:00', close: '23:00' },
            { day: 'tue', open: '9:30', close: '22:00' },
            { day: 'Sunday', open: '11:00', close: '23:00', closed: true },
            { day: 'Holiday', open: '11:00', close: '23:00' },
        ],
        contact: { email: 'hello@bawarchi.in' },
        socialLinks: { instagram: 'https://instagram.com/bawarchi', facebook: 'javascript:alert(1)' },
        gallery: [{ url: 'https://cdn.example.com/g1.jpg', caption: 'Dum' }, { url: 'ftp://nope' }],
        theme: { primaryColor: '#aa3300', accentColor: 'red;}</style><script>', logoUrl: 'https://cdn.example.com/logo.png' },
        pages: [
            { slug: 'catering', title: 'Catering', body: 'We cater weddings.', visible: true },
            { slug: 'secret', title: 'Secret', body: 'hidden', visible: false },
        ],
        seo: { title: 'Bawarchi | Best biryani in Hyderabad' },
    },
    ...over,
});

export const sampleMenu = (): SiteMenu => ({
    categories: [
        { id: 'c2', name: 'Drinks', sortOrder: 2 },
        { id: 'c1', name: 'Biryani', description: 'Slow cooked', sortOrder: 1 },
        { id: 'c3', name: 'Empty', sortOrder: 3 },
    ],
    items: [
        {
            id: 'i1', categoryId: 'c1', name: 'Chicken Dum Biryani <b>', description: 'Signature', price: 320, isVeg: false, isBestSeller: true,
            images: ['https://cdn.example.com/i1.jpg'],
            variants: [{ id: 'v1', name: 'Half', price: 220 }, { id: 'v2', name: 'Full', price: 320 }],
            addons: [{ id: 'a1', name: 'Raita', price: 30 }], availability: 'in_stock', sortOrder: 1,
        },
        { id: 'i2', categoryId: 'c1', name: 'Veg Biryani', price: 250, isVeg: true, variants: [{ id: 'v3', name: 'Full', price: 250 }], availability: 'out_of_stock', sortOrder: 2 },
        { id: 'i3', categoryId: 'c2', name: 'Lassi', price: 90.5, isVeg: true, availability: 'in_stock', sortOrder: 1 },
        { id: 'i4', categoryId: 'c2', name: 'Hidden', price: 10, isVeg: true, availability: 'hidden', sortOrder: 2 },
    ],
    offers: [{ id: 'o1', title: 'Weekday lunch', summary: '15% off', code: 'LUNCH15', description: 'Mon to Fri', bannerImage: 'https://cdn.example.com/o.jpg' }],
});
