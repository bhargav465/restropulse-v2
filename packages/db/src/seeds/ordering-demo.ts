/**
 * @restropulse/db - Demo seed data for the online ordering feature (v1).
 *
 * ALL DATA IN THIS FILE IS SAMPLE/PLACEHOLDER DATA for the "demo" storefront.
 * It is consumed by the db-cli `seed-ordering` command and must never be
 * imported by application runtime code.
 */

// Stable string _ids so re-seeding upserts instead of duplicating.
const R = 'demo-r1';

/** Demo credentials — sample only, safe to commit (dev/demo environments). */
export const DEMO_OWNER = {
  _id: 'demo-owner-u1',
  name: '[SAMPLE] Demo Owner',
  email: 'demo-owner@example.com',
  phone: '+910000000001',
  role: 'OWNER',
  restaurantId: R,
  emailVerified: true,
};

export const DEMO_CUSTOMER_EMAIL = 'demo-customer@example.com';
/** Plaintext demo password — hashed by the seed command at seed time. */
export const DEMO_CUSTOMER_PASSWORD = 'DemoPass123!';

export const DEMO_CUSTOMER = {
  _id: 'demo-customer-c1',
  restaurantId: R,
  email: DEMO_CUSTOMER_EMAIL,
  name: '[SAMPLE] Demo Customer',
  phone: '+910000000002',
  role: 'customer',
  addresses: [
    {
      id: 'demo-addr-1',
      label: 'Home',
      line1: '[SAMPLE] 42 Placeholder Street',
      line2: 'Apt 3B',
      city: 'Bangalore',
      pincode: '560038',
      phone: '+910000000002',
    },
  ],
};

export const DEMO_RESTAURANT = {
  _id: R,
  name: '[SAMPLE] Demo Kitchen',
  cuisine: 'Multi-cuisine (sample data)',
  slug: 'demo',
  storeOpen: true,
  location: {
    address: '[SAMPLE] 1 Demo Lane, Bangalore, KA',
    lat: 12.9716,
    lng: 77.5946,
    mapUrl: 'https://maps.example.com/demo',
  },
  accountManager: { name: '[SAMPLE] Demo AM', phone: '+910000000003', email: 'demo-am@example.com', avatar: '' },
  integrations: { instagram: false },
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

const cat = (id: string, name: string, description: string, sortOrder: number) => ({
  _id: id,
  restaurantId: R,
  name,
  description,
  sortOrder,
});

export const DEMO_MENU_CATEGORIES = [
  cat('demo-cat-starters', 'Starters', '[SAMPLE] Small plates to begin with', 1),
  cat('demo-cat-mains', 'Mains', '[SAMPLE] Hearty main courses', 2),
  cat('demo-cat-breads-rice', 'Breads & Rice', '[SAMPLE] Fresh breads and fragrant rice', 3),
  cat('demo-cat-desserts', 'Desserts & Drinks', '[SAMPLE] Sweet endings and refreshers', 4),
];

interface SeedItem {
  _id: string;
  restaurantId: string;
  categoryId: string;
  name: string;
  description: string;
  price: number;
  images: string[];
  isVeg: boolean;
  variants?: Array<{ id: string; name: string; price: number }>;
  addons?: Array<{ id: string; name: string; price: number }>;
  availability: 'in_stock' | 'out_of_stock' | 'hidden';
  sortOrder: number;
}

/** Per-category placeholder palette so demo menu images look like food, not grey boxes. */
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

const item = (partial: Omit<SeedItem, 'restaurantId' | 'images'> & { images?: string[] }): SeedItem => ({
  images: [dishImage(partial.categoryId, partial.name)],
  ...partial,
  restaurantId: R,
  description: `[SAMPLE] ${partial.description}`,
});

export const DEMO_MENU_ITEMS: SeedItem[] = [
  // Starters
  item({ _id: 'demo-mi-01', categoryId: 'demo-cat-starters', name: 'Crispy Corn Chaat', description: 'Golden fried corn tossed with onions and chaat masala.', price: 180, isVeg: true, availability: 'in_stock', sortOrder: 1 }),
  item({ _id: 'demo-mi-02', categoryId: 'demo-cat-starters', name: 'Paneer Tikka', description: 'Char-grilled cottage cheese with mint chutney.', price: 260, isVeg: true, availability: 'in_stock', sortOrder: 2, addons: [{ id: 'demo-ad-cheese', name: 'Extra Cheese', price: 40 }] }),
  item({ _id: 'demo-mi-03', categoryId: 'demo-cat-starters', name: 'Chicken 65', description: 'South-Indian style spicy fried chicken.', price: 290, isVeg: false, availability: 'in_stock', sortOrder: 3 }),
  item({ _id: 'demo-mi-04', categoryId: 'demo-cat-starters', name: 'Fish Amritsari', description: 'Batter-fried river fish with carom seeds.', price: 340, isVeg: false, availability: 'out_of_stock', sortOrder: 4 }),
  // Mains
  item({ _id: 'demo-mi-05', categoryId: 'demo-cat-mains', name: 'Butter Chicken', description: 'Tandoori chicken simmered in tomato-butter gravy.', price: 380, isVeg: false, availability: 'in_stock', sortOrder: 1, variants: [{ id: 'demo-va-bc-half', name: 'Half', price: 240 }, { id: 'demo-va-bc-full', name: 'Full', price: 380 }] }),
  item({ _id: 'demo-mi-06', categoryId: 'demo-cat-mains', name: 'Paneer Butter Masala', description: 'Cottage cheese in rich makhani gravy.', price: 320, isVeg: true, availability: 'in_stock', sortOrder: 2, variants: [{ id: 'demo-va-pbm-half', name: 'Half', price: 200 }, { id: 'demo-va-pbm-full', name: 'Full', price: 320 }] }),
  item({ _id: 'demo-mi-07', categoryId: 'demo-cat-mains', name: 'Dal Makhani', description: 'Black lentils slow-cooked overnight.', price: 280, isVeg: true, availability: 'in_stock', sortOrder: 3 }),
  item({ _id: 'demo-mi-08', categoryId: 'demo-cat-mains', name: 'Mutton Rogan Josh', description: 'Kashmiri-style lamb curry.', price: 450, isVeg: false, availability: 'in_stock', sortOrder: 4 }),
  item({ _id: 'demo-mi-09', categoryId: 'demo-cat-mains', name: 'Seasonal Chef Special', description: 'Rotating special — hidden until announced.', price: 400, isVeg: true, availability: 'hidden', sortOrder: 5 }),
  // Breads & Rice
  item({ _id: 'demo-mi-10', categoryId: 'demo-cat-breads-rice', name: 'Butter Naan', description: 'Tandoor-baked leavened bread.', price: 60, isVeg: true, availability: 'in_stock', sortOrder: 1, addons: [{ id: 'demo-ad-garlic', name: 'Garlic Topping', price: 15 }] }),
  item({ _id: 'demo-mi-11', categoryId: 'demo-cat-breads-rice', name: 'Chicken Biryani', description: 'Dum-cooked basmati rice with chicken.', price: 340, isVeg: false, availability: 'in_stock', sortOrder: 2, variants: [{ id: 'demo-va-cb-half', name: 'Half', price: 220 }, { id: 'demo-va-cb-full', name: 'Full', price: 340 }], addons: [{ id: 'demo-ad-raita', name: 'Extra Raita', price: 30 }] }),
  item({ _id: 'demo-mi-12', categoryId: 'demo-cat-breads-rice', name: 'Veg Pulao', description: 'Fragrant rice with garden vegetables.', price: 240, isVeg: true, availability: 'in_stock', sortOrder: 3 }),
  // Desserts & Drinks
  item({ _id: 'demo-mi-13', categoryId: 'demo-cat-desserts', name: 'Gulab Jamun', description: 'Warm milk dumplings in saffron syrup (2 pcs).', price: 120, isVeg: true, availability: 'in_stock', sortOrder: 1 }),
  item({ _id: 'demo-mi-14', categoryId: 'demo-cat-desserts', name: 'Masala Chaas', description: 'Spiced buttermilk with roasted cumin.', price: 80, isVeg: true, availability: 'in_stock', sortOrder: 2 }),
];

const publishedContent = {
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

export const DEMO_STOREFRONT_CONTENT = {
  _id: 'demo-sfc-1',
  restaurantId: R,
  draft: publishedContent,
  published: publishedContent,
  publishedVersion: 1,
  versions: [{ version: 1, publishedAt: new Date().toISOString(), content: publishedContent }],
};

/**
 * Seed documents keyed by collection name, in insert order.
 * The demo customer's passwordHash must be added by the seeder (bcrypt of
 * DEMO_CUSTOMER_PASSWORD) — it is intentionally not stored here.
 */
export const ORDERING_DEMO_SEED: Record<string, Array<Record<string, unknown>>> = {
  restaurants: [DEMO_RESTAURANT],
  users: [DEMO_OWNER],
  customers: [DEMO_CUSTOMER],
  menu_categories: DEMO_MENU_CATEGORIES,
  menu_items: DEMO_MENU_ITEMS as unknown as Array<Record<string, unknown>>,
  storefront_content: [DEMO_STOREFRONT_CONTENT],
};
