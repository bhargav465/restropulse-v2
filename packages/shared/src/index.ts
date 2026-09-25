// -------------------------------------------------------
// @restropulse/shared - Unified Types & Constants
// Single source of truth for all type definitions across
// the monorepo (web, api, publisher, content-engine, db-cli).
// -------------------------------------------------------

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
  | 'MEDIA_REQUESTED'    // media job submitted (provider queue request id captured)
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

export type ViewState = 'LANDING' | 'LOGIN' | 'ONBOARDING' | 'DASHBOARD' | 'STUDIO' | 'INPUTS' | 'STRATEGY' | 'INTELLIGENCE';

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
  /** Confirmed Google Places (New) place id for this restaurant (set once a scan
   *  place is confirmed, so future scans skip text search). */
  googlePlaceId?: string;
  /** Restaurant Intelligence per-restaurant state (competitor watchlist). */
  intelligence?: {
    watchlist?: WatchlistEntry[];
    /** Merchant-provided Zomato URL for the restaurant's own listing. */
    selfZomatoUrl?: string;
    /** Last time the owner opened the Intelligence notification feed. */
    notificationsSeenAt?: Date;
    /**
     * Action-plan progress, per report: which `priority` numbers the owner has
     * ticked off. Kept for the last few reports so the next report can say
     * "you did 3 of 5 last time".
     */
    actionProgress?: Array<{ reportId: string; done: number[]; updatedAt: Date }>;
  };
  /** Source of the data: acquisition script writes this; manual entries leave it absent. */
  dataSource?: 'kaggle-zomato' | 'osm' | 'merged' | 'manual';
  /**
   * Reference image URLs keyed by dish name. Populated by the restaurant enricher
   * via Perplexity Sonar image search. Used as img2img reference in AI media generation.
   */
  dishImages?: Record<string, string[]>;
  /**
   * Whether the content-engine may auto-materialize posts from an approved/active
   * content strategy cycle (rolling-window processor). Defaults to false when
   * absent -- content strategy cycles still get drafted for review, but no post
   * stubs are generated automatically until the owner opts in. Does not affect
   * user-initiated adhoc post generation.
   */
  autoContentEnabled?: boolean;
  /**
   * Max adhoc post creation requests (one per "create post" action, regardless of
   * how many platforms it targets) allowed per calendar day. Falls back to
   * DEFAULT_DAILY_ADHOC_POST_LIMIT when unset.
   */
  dailyAdhocPostLimit?: number;
}

/** Default daily cap on adhoc post creation requests when a restaurant has no override. */
export const DEFAULT_DAILY_ADHOC_POST_LIMIT = 5;

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
  platform: Platform;
  // Links posts created from the same request (e.g. one adhoc submission
  // targeting both platforms fans out into N single-platform documents that
  // share a groupId). Always assigned at creation; not used for UI grouping.
  groupId?: string;
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
  // Set once published: Instagram media ID or Facebook post ID, depending on `platform`.
  externalPostId?: string;
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
}

// ----- Subscription & Billing -----

export const POST_TYPE_CREDIT_COSTS: Record<PostType, number> = {
  IMAGE: 1,
  VIDEO: 2,
  STORY: 1,
  CAROUSEL: 3,
  REEL: 4,
};

// FACEBOOK excludes STORY: Facebook Page photo/video Stories publishing
// requires Stories eligibility that isn't enabled for this Page, and every
// attempt fails with Meta's generic error code 1 ("An unknown error has
// occurred"). Disabled here (the single source of truth for platform/type
// validity) until that's resolved -- remove once Facebook Stories work again.
// REEL is included for FACEBOOK -- publishToFacebook() has a full two-phase
// video_reels implementation (packages/publishing/src/publishing-service.ts);
// this constant was just missing it previously.
export const PLATFORM_POST_TYPES: Record<Platform, PostType[]> = {
  INSTAGRAM: ['IMAGE', 'CAROUSEL', 'VIDEO', 'REEL', 'STORY'],
  FACEBOOK: ['IMAGE', 'VIDEO', 'CAROUSEL', 'REEL'],
};

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
  /**
   * ISO timestamp when the no-card, full-feature free trial ends. Set at
   * onboarding to now + trialDays (DB-configurable). While now < trialEndsAt the
   * restaurant is entitled to all gated features even without a paid plan.
   */
  trialEndsAt?: string | Date;
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

/**
 * Feature-entitlement snapshot returned by GET /subscriptions/current. A
 * restaurant may use the gated features (Content Engine, Restaurant
 * Intelligence, Strategy) when `entitled` is true -- i.e. it has an active paid
 * plan OR is inside its free-trial window.
 */
export interface EntitlementState {
  entitled: boolean;
  inTrial: boolean;
  activePlan: boolean;
  trialEndsAt?: string;
  trialDaysLeft: number;
}

const ENTITLEMENT_DAY_MS = 24 * 60 * 60 * 1000;
const ENTITLEMENT_ACTIVE_STATUSES = new Set<SubscriptionStatus>(['ACTIVE', 'PAST_DUE']);

/**
 * Single source of truth for feature entitlement, shared by the API
 * (requireEntitlement, enforcePlanLimits, /subscriptions/current) and the
 * content-engine (cycle-sync processor, which must also create strategy
 * cycles for restaurants still inside their free trial).
 */
export function getEntitlement(sub: Subscription | null | undefined, now: Date = new Date()): EntitlementState {
  if (!sub) {
    return { entitled: false, inTrial: false, activePlan: false, trialDaysLeft: 0 };
  }
  const activePlan = ENTITLEMENT_ACTIVE_STATUSES.has(sub.status);
  const trialEndsMs = sub.trialEndsAt ? new Date(sub.trialEndsAt).getTime() : 0;
  const inTrial = trialEndsMs > now.getTime();
  const trialDaysLeft = inTrial ? Math.ceil((trialEndsMs - now.getTime()) / ENTITLEMENT_DAY_MS) : 0;
  return {
    entitled: activePlan || inTrial,
    inTrial,
    activePlan,
    trialEndsAt: trialEndsMs ? new Date(trialEndsMs).toISOString() : undefined,
    trialDaysLeft,
  };
}

export function isEntitled(sub: Subscription | null | undefined, now?: Date): boolean {
  return getEntitlement(sub, now).entitled;
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
export type WebThemeName = 'legacy' | 'orchid-admin';

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
  // Active web theme. When absent, the frontend must fall back to orchid-admin.
  webTheme?: WebThemeName;
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
  email: string;
  password: string;
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

export interface ClientConfig {
  apiUrl: string;
  appUrl: string;
  googleMapsApiKey: string;
  razorpayKeyId: string;
  appInsightsConnectionString: string;
  telemetrySampleRate: number;
  deployment?: {
    gitSha: string;
    runId: string;
    deployedAt: string;
    artifactSha256?: string;
  };
  firebase: {
    apiKey: string;
    authDomain: string;
    projectId: string;
    storageBucket: string;
    messagingSenderId: string;
    appId: string;
  };
}

export { loadEnvFile, validateEnv, loadAndValidateEnv, z } from './env.js';

export {
  POST_APPROVAL_BUFFER_HOURS,
  CYCLE_APPROVAL_BUFFER_HOURS,
  ROLLING_WINDOW_HOURS,
  MIN_SCHEDULE_AHEAD_HOURS,
  POST_PUBLISH_GRACE_HOURS,
  computePostApprovalDeadline,
  computeCycleApprovalDeadline,
  isPostPastApprovalDeadline,
  isCyclePastApprovalDeadline,
  isPostPastPublishGrace,
  validateTimingConstraints,
} from './approval-deadlines.js';
export type { TimingConstraintConfig } from './approval-deadlines.js';

export * from './cost-events.js';
export * from './media-jobs.js';
export * from './intelligence.js';
