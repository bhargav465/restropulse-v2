// -------------------------------------------------------
// @restropulse/shared - Restaurant catalog & site CMS types (Lane B)
//
// Ported from the Vercel line (origin/feat/vercel-deploy, ordering.ts) per
// docs/LAUNCH_ARCHITECTURE.md B1/B6. This file holds the CMS half: menu
// categories + items (the canonical menu model, Section 3), offers, and the
// per-restaurant site content with draft/publish/version history.
// Order, payment and customer types land with milestone 2.
//
// NOTE: the legacy social-content `MenuItem` type already exists in index.ts
// (embedded `restaurant.menu`), so the catalog item is `OrderingMenuItem`.
// `restaurant.menu` becomes a read-only projection of these collections
// (see `projectLegacyMenu` in cms.ts).
// -------------------------------------------------------

// ----- Menu -----

export type MenuItemAvailability = 'in_stock' | 'out_of_stock' | 'hidden';

export const MENU_ITEM_AVAILABILITIES: readonly MenuItemAvailability[] = ['in_stock', 'out_of_stock', 'hidden'];

export interface MenuItemVariant {
  id: string;
  name: string;            // e.g. "Half", "Full"
  /** Absolute price for this variant (replaces the base price). */
  price: number;
}

export interface MenuItemAddon {
  id: string;
  name: string;            // e.g. "Extra Cheese"
  /** Price added on top of the item/variant price. */
  price: number;
}

export interface MenuCategory {
  id: string;
  restaurantId: string;
  name: string;
  description?: string;
  sortOrder: number;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export interface OrderingMenuItem {
  id: string;
  restaurantId: string;
  categoryId: string;
  name: string;
  description?: string;
  /** Base price in INR (used when no variant is selected). */
  price: number;
  images?: string[];
  isVeg: boolean;
  /** Carried over from the legacy embedded menu so the projection is lossless. */
  isBestSeller?: boolean;
  variants?: MenuItemVariant[];
  addons?: MenuItemAddon[];
  availability: MenuItemAvailability;
  sortOrder: number;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

// ----- Offers -----

export type OfferStatus = 'draft' | 'active' | 'paused' | 'archived';

export const OFFER_STATUSES: readonly OfferStatus[] = ['draft', 'active', 'paused', 'archived'];

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export const WEEKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** What the offer gives. Amounts are INR. */
export type OfferReward =
  | { kind: 'percent_off'; percent: number; maxDiscount?: number }
  | { kind: 'flat_off'; amount: number }
  | { kind: 'free_delivery' };

/** Which part of the order the reward applies to. */
export type OfferScope =
  | { kind: 'all' }
  | { kind: 'categories'; categoryIds: string[] }
  | { kind: 'items'; itemIds: string[] };

export interface OfferSchedule {
  /** Inclusive start, ISO timestamp. */
  startsAt: string;
  /** Exclusive end, ISO timestamp. Open-ended when absent. */
  endsAt?: string;
  /** Restrict to these weekdays (restaurant local time). All days when absent/empty. */
  days?: Weekday[];
  /** Daily window "HH:mm"-"HH:mm" in restaurant local time; may wrap past midnight. */
  from?: string;
  to?: string;
}

export interface Offer {
  id: string;
  restaurantId: string;
  title: string;            // "Weekday lunch 15% off"
  description?: string;
  reward: OfferReward;
  scope: OfferScope;
  /** Minimum order subtotal (INR) before the offer applies. */
  minOrderValue?: number;
  /** Optional coupon code; when set the customer must enter it. Stored upper-case. */
  code?: string;
  schedule: OfferSchedule;
  bannerImage?: string;
  /** Show on the restaurant site's offers strip. */
  showOnSite: boolean;
  /** Feed into the content engine's `activeOffers` so posts can promote it. */
  promoteInContent: boolean;
  status: OfferStatus;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

// ----- Site content (draft + published) -----

export interface StorefrontHoursEntry {
  day: string;             // e.g. "Monday"
  open: string;            // "11:00"
  close: string;           // "23:00"
  closed?: boolean;
}

export interface StorefrontTheme {
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  logoUrl?: string;
}

export interface StoryTimelineEntry {
  year: string;
  title: string;
  text: string;
  image?: string;
}

export interface ChefBio {
  name: string;
  title?: string;
  bio: string;
  photo?: string;
}

export interface DineInInfoBlock {
  title: string;
  text: string;
  image?: string;
}

export interface ReservationSlotConfig {
  /** How many days ahead reservations can be made. */
  daysAhead: number;
  /** Slot granularity in minutes, e.g. 30. */
  slotMinutes: number;
  maxPartySize: number;
  startTime: string;       // "12:00"
  endTime: string;         // "22:30"
}

export interface GalleryImage {
  url: string;
  caption?: string;
}

/** A simple static page on the restaurant site (e.g. /p/catering). */
export interface SitePage {
  /** URL segment: lowercase letters, digits and hyphens. Unique per restaurant. */
  slug: string;
  title: string;
  /** Plain text / light markdown. Rendered escaped by the sites host. */
  body: string;
  /** Hidden pages are kept in the CMS but not linked or served. */
  visible: boolean;
}

export interface StorefrontContent {
  heroImages: string[];
  /** Optional hero banner video (muted autoplay loop); heroImages[0] doubles as the poster/fallback. */
  videoUrl?: string;
  tagline?: string;
  announcement?: { text: string; enabled: boolean };
  about?: string;
  hours?: StorefrontHoursEntry[];
  contact?: { phone?: string; email?: string; address?: string };
  socialLinks?: { instagram?: string; facebook?: string; x?: string; youtube?: string };
  story?: StoryTimelineEntry[];
  chefs?: ChefBio[];
  /** Legacy shape was string[]; normalised to GalleryImage[] on write. */
  gallery?: GalleryImage[];
  dineIn?: DineInInfoBlock[];
  reservations?: ReservationSlotConfig;
  theme?: StorefrontTheme;
  pages?: SitePage[];
  seo?: { title?: string; description?: string };
}

export interface StorefrontVersionEntry {
  version: number;
  publishedAt: string;     // ISO timestamp
  content: StorefrontContent;
}

/** One document per restaurant in the storefront_content collection. */
export interface StorefrontContentDoc {
  id: string;
  restaurantId: string;
  draft: StorefrontContent;
  published?: StorefrontContent;
  publishedVersion?: number;
  publishedAt?: string;
  /** Version history of published snapshots, newest first, capped at STOREFRONT_VERSION_HISTORY_LIMIT. */
  versions: StorefrontVersionEntry[];
  updatedAt?: string | Date;
}

export const STOREFRONT_VERSION_HISTORY_LIMIT = 20;
