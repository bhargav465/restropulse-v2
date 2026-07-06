/**
 * *** SAMPLE DATA ONLY — demo-mode fixtures (VITE_DEMO_MODE=true) ***
 *
 * Static copies of what the real API returns for the "demo" storefront:
 *   - /api/storefront/demo/config  → DEMO_FIXTURE_CONFIG
 *   - /api/storefront/demo/menu    → DEMO_FIXTURE_MENU
 *
 * Values are generated from packages/db/src/seeds/ordering-demo.ts (the demo
 * restaurant seed) with the public-API transforms applied: hidden menu items
 * are excluded and out-of-stock items are exposed as soldOut. Keep in sync
 * with the seed when it changes. Never imported outside demo mode code.
 */
import type { PublicCustomer, StorefrontContent } from '@restropulse/shared';
import type { PublicMenuCategory, PublicMenuItem, StorefrontConfig } from '../types';

const DEMO_RESTAURANT_ID = 'demo-r1';

/** Per-category placeholder palette (kept in sync with the db seed) so demo menu images look like food, not grey boxes. */
const CATEGORY_IMAGE_COLORS: Record<string, { bg: string; text: string }> = {
  'demo-cat-starters': { bg: 'f97316', text: 'ffffff' },     // warm orange
  'demo-cat-mains': { bg: 'b91c1c', text: 'ffffff' },        // deep red
  'demo-cat-breads-rice': { bg: 'f59e0b', text: '7c2d12' },  // amber
  'demo-cat-desserts': { bg: 'ec4899', text: 'ffffff' },     // pink
};

const img = (categoryId: string, name: string): string[] => {
  const { bg, text } = CATEGORY_IMAGE_COLORS[categoryId] ?? { bg: '64748b', text: 'ffffff' };
  return [`https://placehold.co/600x400/${bg}/${text}?text=${encodeURIComponent(name)}`];
};

type ItemInput =
  Omit<PublicMenuItem, 'images' | 'variants' | 'addons'> &
  Partial<Pick<PublicMenuItem, 'images' | 'variants' | 'addons'>>;

const item = (partial: ItemInput): PublicMenuItem => ({
  images: img(partial.categoryId, partial.name),
  variants: [],
  addons: [],
  ...partial,
});

/** Published storefront content (mirrors DEMO_STOREFRONT_CONTENT.published). */
const DEMO_FIXTURE_CONTENT: StorefrontContent = {
  heroImages: [
    'https://placehold.co/1600x900/b33a1e/ffffff?text=%5BSAMPLE%5D+Demo+Kitchen',
    'https://placehold.co/1600x900/e8674a/ffffff?text=%5BSAMPLE%5D+Fresh+from+the+tandoor',
  ],
  // Small public sample clip; heroImages[0] doubles as the poster/fallback.
  videoUrl: `${import.meta.env.BASE_URL}media/hero-demo.mp4`, // bundled sample video (no external dependency)
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

/** Shape of GET /api/storefront/demo/config → data. */
export const DEMO_FIXTURE_CONFIG: StorefrontConfig = {
  restaurant: {
    id: DEMO_RESTAURANT_ID,
    name: '[SAMPLE] Demo Kitchen',
    slug: 'demo',
    cuisine: 'Multi-cuisine (sample data)',
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
  },
  content: DEMO_FIXTURE_CONTENT,
  storeOpen: true,
};

/**
 * Shape of GET /api/storefront/demo/menu → data.categories.
 * Note: the hidden seed item (demo-mi-09) is excluded, and the out-of-stock
 * item (demo-mi-04) is soldOut — matching the public endpoint's behavior.
 */
export const DEMO_FIXTURE_MENU: PublicMenuCategory[] = [
  {
    id: 'demo-cat-starters',
    name: 'Starters',
    description: '[SAMPLE] Small plates to begin with',
    sortOrder: 1,
    items: [
      item({ id: 'demo-mi-01', categoryId: 'demo-cat-starters', name: 'Crispy Corn Chaat', description: '[SAMPLE] Golden fried corn tossed with onions and chaat masala.', price: 180, isVeg: true, sortOrder: 1, soldOut: false }),
      item({ id: 'demo-mi-02', categoryId: 'demo-cat-starters', name: 'Paneer Tikka', description: '[SAMPLE] Char-grilled cottage cheese with mint chutney.', price: 260, isVeg: true, sortOrder: 2, soldOut: false, addons: [{ id: 'demo-ad-cheese', name: 'Extra Cheese', price: 40 }] }),
      item({ id: 'demo-mi-03', categoryId: 'demo-cat-starters', name: 'Chicken 65', description: '[SAMPLE] South-Indian style spicy fried chicken.', price: 290, isVeg: false, sortOrder: 3, soldOut: false }),
      item({ id: 'demo-mi-04', categoryId: 'demo-cat-starters', name: 'Fish Amritsari', description: '[SAMPLE] Batter-fried river fish with carom seeds.', price: 340, isVeg: false, sortOrder: 4, soldOut: true }),
    ],
  },
  {
    id: 'demo-cat-mains',
    name: 'Mains',
    description: '[SAMPLE] Hearty main courses',
    sortOrder: 2,
    items: [
      item({ id: 'demo-mi-05', categoryId: 'demo-cat-mains', name: 'Butter Chicken', description: '[SAMPLE] Tandoori chicken simmered in tomato-butter gravy.', price: 380, isVeg: false, sortOrder: 1, soldOut: false, variants: [{ id: 'demo-va-bc-half', name: 'Half', price: 240 }, { id: 'demo-va-bc-full', name: 'Full', price: 380 }] }),
      item({ id: 'demo-mi-06', categoryId: 'demo-cat-mains', name: 'Paneer Butter Masala', description: '[SAMPLE] Cottage cheese in rich makhani gravy.', price: 320, isVeg: true, sortOrder: 2, soldOut: false, variants: [{ id: 'demo-va-pbm-half', name: 'Half', price: 200 }, { id: 'demo-va-pbm-full', name: 'Full', price: 320 }] }),
      item({ id: 'demo-mi-07', categoryId: 'demo-cat-mains', name: 'Dal Makhani', description: '[SAMPLE] Black lentils slow-cooked overnight.', price: 280, isVeg: true, sortOrder: 3, soldOut: false }),
      item({ id: 'demo-mi-08', categoryId: 'demo-cat-mains', name: 'Mutton Rogan Josh', description: '[SAMPLE] Kashmiri-style lamb curry.', price: 450, isVeg: false, sortOrder: 4, soldOut: false }),
    ],
  },
  {
    id: 'demo-cat-breads-rice',
    name: 'Breads & Rice',
    description: '[SAMPLE] Fresh breads and fragrant rice',
    sortOrder: 3,
    items: [
      item({ id: 'demo-mi-10', categoryId: 'demo-cat-breads-rice', name: 'Butter Naan', description: '[SAMPLE] Tandoor-baked leavened bread.', price: 60, isVeg: true, sortOrder: 1, soldOut: false, addons: [{ id: 'demo-ad-garlic', name: 'Garlic Topping', price: 15 }] }),
      item({ id: 'demo-mi-11', categoryId: 'demo-cat-breads-rice', name: 'Chicken Biryani', description: '[SAMPLE] Dum-cooked basmati rice with chicken.', price: 340, isVeg: false, sortOrder: 2, soldOut: false, variants: [{ id: 'demo-va-cb-half', name: 'Half', price: 220 }, { id: 'demo-va-cb-full', name: 'Full', price: 340 }], addons: [{ id: 'demo-ad-raita', name: 'Extra Raita', price: 30 }] }),
      item({ id: 'demo-mi-12', categoryId: 'demo-cat-breads-rice', name: 'Veg Pulao', description: '[SAMPLE] Fragrant rice with garden vegetables.', price: 240, isVeg: true, sortOrder: 3, soldOut: false }),
    ],
  },
  {
    id: 'demo-cat-desserts',
    name: 'Desserts & Drinks',
    description: '[SAMPLE] Sweet endings and refreshers',
    sortOrder: 4,
    items: [
      item({ id: 'demo-mi-13', categoryId: 'demo-cat-desserts', name: 'Gulab Jamun', description: '[SAMPLE] Warm milk dumplings in saffron syrup (2 pcs).', price: 120, isVeg: true, sortOrder: 1, soldOut: false }),
      item({ id: 'demo-mi-14', categoryId: 'demo-cat-desserts', name: 'Masala Chaas', description: '[SAMPLE] Spiced buttermilk with roasted cumin.', price: 80, isVeg: true, sortOrder: 2, soldOut: false }),
    ],
  },
];

/** Local demo customer used by the simulated login/register session. */
export const DEMO_FIXTURE_CUSTOMER: PublicCustomer = {
  id: 'demo-customer-c1',
  restaurantId: DEMO_RESTAURANT_ID,
  email: 'demo-customer@example.com',
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
