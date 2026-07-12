// -------------------------------------------------------
// @restropulse/shared - Online Ordering Types (v1)
// Types for the public storefront + ordering backend.
// Additive to the existing social-media SaaS types.
// NOTE: the legacy social-content `MenuItem` type already exists in
// index.ts, so the ordering menu item is exported as `OrderingMenuItem`.
// -------------------------------------------------------

// ----- Enums / Literal Unions -----

export type MenuItemAvailability = 'in_stock' | 'out_of_stock' | 'hidden';

export type OrderType = 'delivery' | 'pickup' | 'dine_in';

export type OrderStatus =
  | 'PENDING_PAYMENT'    // Created, awaiting payment capture (Razorpay checkout)
  | 'PAYMENT_FAILED'     // Payment attempt failed; customer may retry (re-arms payment)
  | 'RECEIVED'           // Restaurant has the order
  | 'PREPARING'          // Kitchen working on it
  | 'READY'              // Ready for pickup / handoff to rider
  | 'OUT_FOR_DELIVERY'   // Rider on the way (delivery orders only)
  | 'COMPLETED'          // Delivered / picked up / served
  | 'CANCELLED';         // Cancelled by restaurant or customer

export type ReservationStatus = 'pending' | 'confirmed' | 'declined' | 'no_show';

// ----- Menu -----

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
  /** Base price (used when no variant is selected). */
  price: number;
  images?: string[];
  isVeg: boolean;
  variants?: MenuItemVariant[];
  addons?: MenuItemAddon[];
  availability: MenuItemAvailability;
  sortOrder: number;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

// ----- Orders -----

export interface OrderTotals {
  subtotal: number;
  tax: number;
  deliveryFee: number;
  discount: number;
  total: number;
}

/** Immutable snapshot of what was ordered (prices resolved server-side). */
export interface OrderItemSnapshot {
  menuItemId: string;
  name: string;
  qty: number;
  /** Resolved per-unit price (variant price if selected, else base price). */
  unitPrice: number;
  variant?: { id: string; name: string; price: number };
  addons?: Array<{ id: string; name: string; price: number }>;
  /** (unitPrice + sum(addons)) * qty */
  lineTotal: number;
}

export interface OrderAddress {
  label?: string;
  line1: string;
  line2?: string;
  city?: string;
  pincode?: string;
  phone?: string;
  notes?: string;
}

export interface OrderStatusHistoryEntry {
  status: OrderStatus;
  at: string;              // ISO timestamp
  note?: string;
}

export interface Order {
  id: string;
  restaurantId: string;
  customerId: string;
  /** Short human-friendly reference, e.g. ORD-K3X9F2. */
  orderNumber: string;
  orderType: OrderType;
  items: OrderItemSnapshot[];
  totals: OrderTotals;
  status: OrderStatus;
  statusHistory: OrderStatusHistoryEntry[];
  address?: OrderAddress;
  customerName?: string;
  customerPhone?: string;
  /** Client-supplied Idempotency-Key header value used for dedupe. */
  idempotencyKey?: string;
  createdAt: string | Date;
  updatedAt: string | Date;
}

// ----- Reservations -----

export interface Reservation {
  id: string;
  restaurantId: string;
  date: string;            // YYYY-MM-DD
  time: string;            // HH:mm (24h)
  partySize: number;
  name: string;
  phone: string;
  email?: string;
  notes?: string;
  status: ReservationStatus;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

// ----- Storefront content (draft + published) -----

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

export interface StorefrontContent {
  heroImages: string[];
  /** Optional hero banner video (muted autoplay loop); heroImages[0] doubles as the poster/fallback. */
  videoUrl?: string;
  announcement?: { text: string; enabled: boolean };
  about?: string;
  hours?: StorefrontHoursEntry[];
  contact?: { phone?: string; email?: string; address?: string };
  socialLinks?: { instagram?: string; facebook?: string; x?: string; youtube?: string };
  story?: StoryTimelineEntry[];
  chefs?: ChefBio[];
  gallery?: string[];
  dineIn?: DineInInfoBlock[];
  reservations?: ReservationSlotConfig;
  theme?: StorefrontTheme;
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
  /** Version history of published snapshots, capped at STOREFRONT_VERSION_HISTORY_LIMIT. */
  versions: StorefrontVersionEntry[];
  updatedAt?: string | Date;
}

export const STOREFRONT_VERSION_HISTORY_LIMIT = 20;

// ----- Growth campaigns (merchant admin: cohort nudges & offers) -----

export type CohortId = 'drop_off_cart' | 'non_transacted' | 'lapsed_30d';

/** A computed customer segment shown on the Campaigns dashboard. */
export interface CustomerCohort {
  id: CohortId;
  name: string;
  emoji: string;
  description: string;
  count: number;
}

export type CampaignKind = 'whatsapp_nudge' | 'discount_offer';

/**
 * Lifecycle of a queued campaign. v1 only ever persists `'QUEUED'`
 * (POST /campaigns); the delivery worker (docs/NEXT.md §9) transitions
 * `QUEUED → SENDING → SENT | FAILED`. Shipping the full union now makes those
 * transitions persistable without a later shared-types change.
 */
export type CampaignStatus = 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED';

export interface CampaignDiscount {
  percentOff: number;      // 1–100
  code: string;            // e.g. "COMEBACK20"
  expiryDays: number;      // validity window from send time
}

export interface CampaignSendRequest {
  cohortId: CohortId;
  kind: CampaignKind;
  /** Required when kind === 'discount_offer'. */
  discount?: CampaignDiscount;
}

/**
 * One document per queued campaign in the `campaigns` collection.
 * v1 records the intent (status QUEUED); actual WhatsApp delivery is a
 * worker seam documented in docs/NEXT.md.
 */
export interface CampaignRecord {
  id: string;
  restaurantId: string;
  cohortId: CohortId;
  kind: CampaignKind;
  discount?: CampaignDiscount;
  /** Cohort size at queue time. */
  audienceCount: number;
  /**
   * Delivery lifecycle. POST /campaigns always writes `'QUEUED'`; later states
   * are set by the delivery worker (docs/NEXT.md §9).
   */
  status: CampaignStatus;
  createdAt: string | Date;
}

export interface CampaignQueuedResponse {
  campaignId: string;
  status: 'QUEUED';
  audienceCount: number;
}

// ----- Customers (storefront accounts, distinct from merchant users) -----

export interface CustomerAddress {
  id: string;
  label?: string;
  line1: string;
  line2?: string;
  city?: string;
  pincode?: string;
  phone?: string;
}

export interface Customer {
  id: string;
  restaurantId: string;
  email: string;
  name?: string;
  phone?: string;
  /** bcrypt hash — server-side only, must never be sent to clients. */
  passwordHash?: string;
  addresses: CustomerAddress[];
  role: 'customer';
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

/** Customer shape safe to return from the API (no passwordHash). */
export type PublicCustomer = Omit<Customer, 'passwordHash'>;

// ----- Analytics events -----

export interface AnalyticsEvent {
  id?: string;
  name: string;            // e.g. "menu_viewed", "order_placed", "login_prompt"
  sessionId: string;
  restaurantId: string;
  customerId?: string;
  payload?: Record<string, unknown>;
  ts: string | Date;
}

// ----- Restaurant ordering settings (embedded on Restaurant) -----

export interface DeliveryZone {
  name: string;
  flatFee: number;
  minOrder: number;
}

export interface RestaurantOrderingSettings {
  /** Tax percentage applied to the order subtotal, e.g. 5 => 5%. */
  taxRatePercent?: number;
  currency?: string;       // e.g. "INR"
  delivery?: {
    enabled: boolean;
    /** Flat delivery fee (v1). */
    flatFee: number;
    /** Minimum subtotal for delivery orders. */
    minOrder: number;
    /** Optional named zones (v1: informational, flat fee still applies). */
    zones?: DeliveryZone[];
  };
  pickup?: { enabled: boolean };
  dineIn?: { enabled: boolean };
}
