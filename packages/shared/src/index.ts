// -------------------------------------------------------
// @restropulse/shared - Unified Types & Constants
// Single source of truth for all type definitions across
// the monorepo (web, api, publisher, content-engine, db-cli).
// -------------------------------------------------------

import type { RestaurantOrderingSettings } from './ordering.js';
import type { WatchlistEntry } from './intelligence.js';

// ----- Enums / Literal Unions -----

export type SubscriptionTier = 'STARTER' | 'GROWTH' | 'PREMIUM';

export type SubscriptionStatus = 'NONE' | 'CREATED' | 'AUTHENTICATED' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'HALTED';

export type UserRole = 'OWNER' | 'MANAGER' | 'ADMIN';

export type BillingCycle = 'MONTHLY' | 'ANNUAL';

export type CouponType = 'PERCENTAGE' | 'FLAT';

export type CouponStatus = 'ACTIVE' | 'DISABLED' | 'EXPIRED';

export type CreditPurchaseStatus = 'PENDING' | 'PAID' | 'FAILED';

export type InvoiceType = 'SUBSCRIPTION' | 'CREDIT_PURCHASE';

export type PostType = 'IMAGE' | 'VIDEO' | 'CAROUSEL' | 'STORY' | 'REEL';

export type PostStatus =
  | 'PENDING_CONTENT'        // Awaiting content generation by content-engine
  | 'PENDING_MEDIA'          // Caption ready; media generation in flight (phase 5)
  | 'PENDING_APPROVAL'       // Content created, awaiting user review
  | 'CHANGES_REQUESTED'      // User requested changes
  | 'SCHEDULED'              // Approved and scheduled for publishing
  | 'PUBLISHING'             // Currently being published by publisher worker
  | 'POSTED'                 // Successfully published
  | 'MISSED_DEADLINE';       // Failed after max retries

export type GenerationStep =
  | 'SEARCHING_TRENDS'   // currentAffairsHints being fetched (rare; sync)
  | 'CAPTION_DONE'       // LLM caption produced
  | 'MEDIA_REQUESTED'    // media job submitted (fal queue request_id captured)
  | 'MEDIA_DONE';        // media URL retrieved and applied to post

export type Platform = 'INSTAGRAM' | 'FACEBOOK';

export type StrategyCycleStatus =
  | 'PENDING_GENERATION'     // Awaiting strategy generation by content-engine
  | 'ACTIVE'                 // Currently active cycle
  | 'PENDING_APPROVAL'       // Awaiting user review
  | 'APPROVED'               // Approved, ready for content generation
  | 'CHANGES_REQUESTED'      // User requested changes
  | 'HISTORY';               // Archived

export type TokenStatus = 'valid' | 'expiring_soon' | 'expired';

export type EmailVerificationStatus = 'idle' | 'sending' | 'sent' | 'link_ready' | 'verifying' | 'verified' | 'error';

export type ViewState = 'LOGIN' | 'ONBOARDING' | 'DASHBOARD' | 'STUDIO' | 'INPUTS' | 'STRATEGY' | 'ORDERING';

export type InstagramConnectionError =
  | 'NO_PAGES_FOUND'
  | 'NO_IG_ACCOUNT_FOUND'
  | 'PERMISSIONS_MISSING'
  | 'INVALID_STATE'
  | 'TOKEN_EXCHANGE_FAILED'
  | 'API_ERROR'
  | 'ACCOUNT_TYPE_MISMATCH'
  | 'RATE_LIMITED'
  | 'CONFIG_ERROR'
  | 'TIMEOUT';

// ----- Interfaces -----

export interface AccountManager {
  id: string;
  name: string;
  phone: string;
  email: string;
  avatar: string;
  city: string;
  zone: string;
}

export interface City {
  id: string;
  name: string;
  defaultZone: string;
}

export interface InstagramConnectionStatus {
  connected: boolean;
  username?: string;
  userId?: string;
  pageName?: string;
  connectedAt?: string | Date;
  tokenStatus?: TokenStatus;
  needsReauthorization?: boolean;
}

/** Server-side only -- never sent to frontend */
export interface InstagramCredentials {
  userId: string;
  username: string;
  pageId: string;
  pageName: string;
  accessToken: string; // Encrypted at rest
  tokenExpiresAt: Date;
  scopes: string[];
  connectedAt: Date;
  lastRefreshedAt?: Date;
}

export interface InstagramAccount {
  id: string;
  username: string;
  name?: string;
  profilePictureUrl?: string;
  pageName: string;
  pageId?: string;
  pageAccessToken?: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: UserRole;
  firebaseUid?: string;
  emailVerified?: boolean;
  restaurantId: string;
  razorpayCustomerId?: string;
  /** bcrypt hash for email/phone + password login. Never returned to clients. */
  passwordHash?: string;
}

export interface MenuItem {
  /** Client-generated UUID. */
  id: string;
  category: string;                   // e.g. "Starters", "Biryani", "Desserts"
  name: string;
  description?: string;
  /** Price in INR. */
  price?: number;
  isVeg: boolean;
  isBestSeller?: boolean;
  isAvailable: boolean;
}

/** Structured postal address for the restaurant profile (Brief 04, additive). */
export interface RestaurantAddress {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  /** Indian PIN code, /^[1-9][0-9]{5}$/. */
  pincode: string;
  geo?: { lat: number; lng: number };
}

export interface Restaurant {
  id: string;
  name: string;
  cuisine: string;
  location: {
    address: string;
    lat: number;
    lng: number;
    mapUrl: string;
  };
  accountManager: {
    name: string;
    phone: string;
    email: string;
    avatar: string;
  };
  integrations: {
    instagram: boolean;
  };
  /** Public-safe connection info (no tokens) */
  instagramConnection?: InstagramConnectionStatus;
  /** Server-side only -- contains encrypted access token */
  instagramCredentials?: InstagramCredentials;
  activeOffers?: string[];
  chefSpecials?: string[];
  menuLastUpdated?: string;
  /** Short restaurant bio used in AI content prompts and profile display. */
  description?: string;
  phone?: string;
  website?: string;
  priceRange?: 'budget' | 'mid-range' | 'upscale' | 'fine-dining';
  operatingHours?: {
    weekday_text: string[];           // e.g. ["Monday: 11:00 AM - 10:00 PM", ...]
  };
  serviceOptions?: {
    delivery: boolean;
    dineIn: boolean;
    takeout: boolean;
  };
  menu?: MenuItem[];
  /** City this record was sourced from. Set by the acquire-restaurants script. */
  sourceCity?: string;
  /**
   * Confirmed Google Places placeId for this restaurant (Brief 10). Set when the
   * owner picks their restaurant via the Google place picker; lets the scan
   * pipeline skip text-search disambiguation. Owner-editable (whitelisted).
   */
  googlePlaceId?: string;
  /** Source of the data: acquisition script writes this; manual entries leave it absent. */
  dataSource?: 'kaggle-zomato' | 'osm' | 'merged' | 'manual';
  /**
   * Reference image URLs keyed by dish name. Populated by the restaurant enricher
   * via Perplexity Sonar image search. Used as img2img reference in AI media generation.
   */
  dishImages?: Record<string, string[]>;
  // ----- Restaurant profile (Brief 04, additive — all optional; existing docs stay valid) -----
  /** Registered legal/business name (distinct from the public display `name`). */
  legalName?: string;
  /** Structured cuisine tags (chip input). The legacy `cuisine` string stays for prompts/display. */
  cuisineTags?: string[];
  /** Business contact email (distinct from the account owner's login email). */
  email?: string;
  /** Structured postal address. `location` stays for back-compat / map pin. */
  address?: RestaurantAddress;
  /** GSTIN (format-validated, no checksum). */
  gstin?: string;
  /** FSSAI licence number (14 digits, format-validated). */
  fssaiLicense?: string;
  /** Logo image URL — points at /api/assets/:id (or an external https URL). */
  logoUrl?: string;
  /** Cover image URL — points at /api/assets/:id (or an external https URL). */
  coverImageUrl?: string;
  // ----- Online ordering (v1, additive) -----
  /** URL slug for the public storefront, e.g. /api/storefront/:slug. Unique. */
  slug?: string;
  /** Whether the storefront is currently accepting orders. */
  storeOpen?: boolean;
  /** Ordering configuration: tax rate, delivery fee/min order, enabled order types. */
  ordering?: RestaurantOrderingSettings;
  // ----- Intelligence v2 (Brief 06, additive — optional; existing docs stay valid) -----
  /** Intelligence v2 settings: competitor watchlist (server-enforced ≤ WATCHLIST_MAX) + self Zomato URL. */
  intelligence?: {
    watchlist: WatchlistEntry[];        // server-enforced ≤ WATCHLIST_MAX
    selfZomatoUrl?: string;
  };
}

/**
 * Single source of truth for the owner-editable restaurant profile whitelist.
 * Imported by the server route sanitizer (`PATCH /profile`, hardened `PUT /:id`),
 * the client, and the tests — never duplicate this list literally elsewhere.
 * = NEXT.md §10 mass-assignment contract + Brief-04 profile fields.
 */
export const RESTAURANT_PROFILE_FIELDS = [
  'name', 'legalName', 'cuisine', 'cuisineTags', 'description', 'phone', 'email', 'website',
  'priceRange', 'address', 'location', 'operatingHours', 'serviceOptions',
  'activeOffers', 'chefSpecials', 'gstin', 'fssaiLicense', 'logoUrl', 'coverImageUrl',
  'googlePlaceId', // Brief 10: confirmed Google Places id from the place picker.
] as const;

export type RestaurantProfileField = (typeof RESTAURANT_PROFILE_FIELDS)[number];
export type RestaurantProfilePatch = Partial<Pick<Restaurant, RestaurantProfileField>>;

export interface PostStats {
  likes: number;
  shares: number;
  comments: number;
  reach: number;
}

export interface Post {
  id: string;
  type: PostType;
  status: PostStatus;
  thumbnail: string;
  mediaUrls?: string[];
  videoUrl?: string;
  caption: string;
  platforms: Platform[];
  restaurantId?: string;
  scheduledFor?: string;
  postedAt?: string;
  feedback?: string;
  publishError?: string;
  publishAttempts?: number;
  duration?: string;
  cycleId?: string;
  // Phase 5 -- async media generation lifecycle
  mediaJobId?: string;          // FK to mediaJobs.jobId when status=PENDING_MEDIA
  generationStep?: GenerationStep;
  lastStepAt?: string;          // ISO; updated when generationStep advances
  isAdhoc?: boolean;
  instagramMediaId?: string;
  facebookPostId?: string;
  stats?: PostStats;
  themes?: string[];
  archetype?: string;    // archetype ID this post was generated from (e.g. 'CRAVING_CUE')
}

export interface ContentStrategy {
  id?: string;
  restaurantId?: string;
  postsPerWeek: number;
  focusCategories: string[];
  bestTime: string;
  nextScheduledDate: string;
  theme: string;
}

export interface PlannedPost {
  category: string;
  count: number;
  themes?: string[];   // current-affairs/cultural context keywords (e.g. 'Eid', 'India-cricket-win')
  // --- Optional presentation metadata (additive; used by theme-catalog strategies) ---
  emoji?: string;         // e.g. '🍛'
  description?: string;   // one-line owner-facing description of the theme
  examplePost?: string;   // sample caption the owner would recognise
}

export interface PlannedSlot {
  scheduledFor: string;  // ISO date string
  category: string;      // archetype ID e.g. 'CHEFS_PICK'
  postType: PostType;
  themes?: string[];   // carries through from PlannedPost
}

export interface StrategyCycle {
  id: string;
  restaurantId?: string;
  period: string;
  startDate: string;
  endDate: string;
  status: StrategyCycleStatus;
  summary: string;
  plannedPosts: PlannedPost[];
  focus: string[];
  feedback?: string;
  plannedSchedule?: PlannedSlot[];  // computed at PENDING_APPROVAL, consumed by rolling-window
  /** Optional weekly posting cadence recommendation (additive, fixture/AM-authored). */
  weeklyCadence?: Array<{ day: string; theme: string; note?: string }>;
}

// ----- Subscription & Billing -----

export const POST_TYPE_CREDIT_COSTS: Record<PostType, number> = {
  IMAGE: 1,
  VIDEO: 2,
  STORY: 1,
  CAROUSEL: 3,
  REEL: 4,
};

export const PLATFORM_POST_TYPES: Record<Platform, PostType[]> = {
  INSTAGRAM: ['IMAGE', 'CAROUSEL', 'VIDEO', 'REEL', 'STORY'],
  FACEBOOK: ['IMAGE', 'VIDEO', 'CAROUSEL', 'STORY'],
};

export const FREE_SIGNUP_CREDITS = 20;

export type PostTypeLimits = Partial<Record<PostType, number>>;
export interface PlanLimits {
  weekly: Partial<Record<Platform, PostTypeLimits>>;
  dailyAdhoc?: Partial<Record<Platform, PostTypeLimits>>;
}

export interface PlanPricing {
  monthly: number;   // in paise
  annual: number;    // in paise
  currency: string;
}

export interface SubscriptionPlan {
  id: string;
  slug: string;
  version: number;
  isCurrentVersion: boolean;
  tier: SubscriptionTier;
  name: string;
  limits: PlanLimits;
  pricing: PlanPricing;
  razorpayPlanIds: { monthly: string; annual: string };
  features: string[];
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export interface Subscription {
  id: string;
  restaurantId: string;
  planId?: string;
  planSnapshot?: SubscriptionPlan | null;
  billingCycle?: BillingCycle;
  status: SubscriptionStatus;
  razorpaySubscriptionId?: string;
  razorpayCustomerId?: string;
  currentPeriodStart?: string | Date;
  currentPeriodEnd?: string | Date;
  credits: number;
  couponCode?: string;
  cancelledAt?: string | Date;
  cancelAtPeriodEnd?: boolean;
  pendingPlanId?: string;
  pendingPlanSnapshot?: SubscriptionPlan | null;
  pendingRazorpaySubscriptionId?: string | null;
  endedAt?: string | null;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export interface Coupon {
  id: string;
  code: string;
  type: CouponType;
  value: number;
  maxBillingCycles?: number;
  maxRedemptions?: number;
  redemptionCount: number;
  assignedTo?: string;
  applicablePlans?: string[];
  applicableCycles?: BillingCycle[];
  validFrom: string | Date;
  validUntil?: string | Date;
  status: CouponStatus;
  razorpayOfferId?: string;
  createdBy: string;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export interface CouponRedemption {
  id: string;
  couponId: string;
  couponCode: string;
  restaurantId: string;
  userId: string;
  subscriptionId: string;
  discountAppliedPaise: number;
  redeemedAt: string | Date;
}

export interface CreditPurchase {
  id: string;
  restaurantId: string;
  userId: string;
  creditPackId: string;
  creditsAdded: number;
  amountPaise: number;
  razorpayOrderId: string;
  razorpayPaymentId?: string;
  status: CreditPurchaseStatus;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export interface CreditPack {
  id: string;
  name: string;
  description: string;
  credits: number;
  priceInPaise: number;
  isActive: boolean;
  sortOrder: number;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export interface Invoice {
  id: string;
  restaurantId: string;
  type: InvoiceType;
  razorpayInvoiceId?: string;
  razorpayPaymentId?: string;
  razorpaySubscriptionId?: string;
  razorpayOrderId?: string;
  amountPaise: number;
  currency: string;
  status: string;
  description: string;
  billingPeriodStart?: string | Date;
  billingPeriodEnd?: string | Date;
  pdfUrl?: string;
  paidAt?: string | Date;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export type PostTypeUsage = Partial<Record<PostType, { used: number; limit: number }>>;
export type PlanUsage = Partial<Record<Platform, PostTypeUsage>>;

export interface SubscribeRequest {
  planSlug: string;
  couponCode?: string;
}

// ----- Feature Flags -----

export interface FeatureFlags {
  deleteAccount: boolean;
  topupCredits: boolean;
  updatesSection: boolean;
  // Runtime scheduling config — optional so existing tests don't need updating.
  // The frontend falls back to compile-time constants when absent.
  minScheduleAheadMins?: number;
  postApprovalBufferMins?: number;
  cycleApprovalBufferMins?: number;
  // Which social platforms are active. When absent, all platforms are enabled.
  enabledPlatforms?: Platform[];
}

// ----- Account Deletion / Archive -----

export type AccountDeletionInitiator = 'CLI' | 'API' | 'ADMIN';

export interface ArchivedAccount {
  restaurantId: string;
  userPhone?: string;
  archivedAt: Date;
  initiator: AccountDeletionInitiator;
  database: string;
  data: {
    users:             Record<string, unknown>[];
    restaurants:       Record<string, unknown>[];
    posts:             Record<string, unknown>[];
    contentStrategies: Record<string, unknown>[];
    strategyCycles:    Record<string, unknown>[];
    subscriptions:     Record<string, unknown>[];
    couponRedemptions: Record<string, unknown>[];
    creditPurchases:   Record<string, unknown>[];
    invoices:          Record<string, unknown>[];
  };
}

// ----- API Types (request/response) -----

export interface LoginRequest {
  /** Email or phone — at least one must be provided. */
  email?: string;
  phone?: string;
  password: string;
}

/** Restaurant self-signup: creates the OWNER user + the restaurant in one step. */
export interface RegisterRequest {
  name: string;
  restaurantName: string;
  email: string;
  phone: string;
  password: string;
  cuisine?: string;
}

export interface OtpRequest {
  phone: string;
}

export interface OtpVerifyRequest {
  phone: string;
  otp: string;
}

export interface AuthResponse {
  success: boolean;
  user?: User;
  token?: string;
  message?: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface GeneratePostRequest {
  concept: string;
  type: PostType;
  platforms: Platform[];
  scheduledFor?: string;
}

export interface ContentCyclePost {
  id: string;
  type: PostType;
  caption: string;
  thumbnail: string;
  scheduledFor: string;
}

export interface ContentCycle {
  id: string;
  posts: ContentCyclePost[];
}

export interface GeneratePostResponse {
  post: Post;
}

export { loadEnvFile, validateEnv, loadAndValidateEnv, z } from './env.js';

export {
  POST_APPROVAL_BUFFER_HOURS,
  CYCLE_APPROVAL_BUFFER_HOURS,
  ROLLING_WINDOW_HOURS,
  MIN_SCHEDULE_AHEAD_HOURS,
  computePostApprovalDeadline,
  computeCycleApprovalDeadline,
  isPostPastApprovalDeadline,
  isCyclePastApprovalDeadline,
  validateTimingConstraints,
} from './approval-deadlines.js';
export type { TimingConstraintConfig } from './approval-deadlines.js';

export * from './cost-events.js';
export * from './media-jobs.js';
export * from './ordering.js';
export * from './intelligence.js';
export * from './types/payment.js';
