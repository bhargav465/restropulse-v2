/**
 * IContentGenerator contract.
 *
 * Frozen interface that every backend implementation must satisfy. The placeholder
 * lives behind this contract; a future AI-driven backend swaps in via setContentGenerator()
 * without any processor edits.
 */

import type { PlannedPost, Platform, PostType, MenuItem } from '@restropulse/shared';

// ---------------------------------------------------------------------------
// Context + error types
// ---------------------------------------------------------------------------

/** Stable restaurant data passed through the generation pipeline to enrich prompts. */
export interface RestaurantProfile {
  cuisine?: string;
  /** Prose bio synthesised by the restaurant enricher. */
  description?: string;
  menu?: MenuItem[];
  chefSpecials?: string[];
  activeOffers?: string[];
  priceRange?: string;
  /** Reference image URLs keyed by dish name; used as img2img reference in media generation. */
  dishImages?: Record<string, string[]>;
}

export interface GenerationContext {
  correlationId?: string;
  restaurantId?: string;
  restaurantName?: string;
  locale?: string;
  /** Full restaurant profile; populated by processors from the DB document. */
  restaurantProfile?: RestaurantProfile;
}

export type ContentGenerationErrorCode =
  | 'INVALID_INPUT'
  | 'ASSET_UNAVAILABLE'
  | 'BACKEND_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'UNKNOWN';

export class ContentGenerationError extends Error {
  readonly code: ContentGenerationErrorCode;
  readonly cause?: unknown;

  constructor(code: ContentGenerationErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'ContentGenerationError';
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// Cycle inputs / outputs
// ---------------------------------------------------------------------------

export interface DraftCycleInput {
  restaurantId?: string;
  period: string;
  startDate?: string;
  endDate?: string;
  strategyFocus?: string[];
  strategyThemes?: string[];
  currentAffairsHints?: string[];
  excludeArchetypes?: string[];   // archetype IDs to exclude from this cycle's plan
}

export interface CycleFeedback {
  areas: string[];
  note: string;
  resolution?: string;
}

export interface ReviseCycleInput {
  existingCycle: {
    restaurantId?: string;
    period: string;
    startDate?: string;
    endDate?: string;
    summary: string;
    plannedPosts: PlannedPost[];
    focus: string[];
  };
  feedback: CycleFeedback;
  currentAffairsHints?: string[];
}

export interface GeneratedCycle {
  summary: string;
  plannedPosts: PlannedPost[];
  focus: string[];
  rationale?: string;
}

// ---------------------------------------------------------------------------
// Post inputs / outputs
// ---------------------------------------------------------------------------

export interface GeneratePostInput {
  concept: string;
  type: PostType;
  platforms: Platform[];
  themes?: string[];
  archetype?: string;
  scheduledFor?: string;
  cycleId?: string;
  currentAffairsHints?: string[];
  /** Pre-resolved dish name from restaurant menu; injected by pipeline, not by callers. */
  selectedDish?: string;
}

export interface PostFeedback {
  tags: string[];
  details: Record<string, string>;
  note: string;
  resolution?: string;
}

export interface RevisePostInput {
  existingPost: {
    type: PostType;
    platforms: Platform[];
    caption: string;
    thumbnail?: string;
    mediaUrls?: string[];
    videoUrl?: string;
    themes?: string[];
    archetype?: string;
  };
  feedback: PostFeedback;
  currentAffairsHints?: string[];
}

export interface MediaMetadata {
  widthPx?: number;
  heightPx?: number;
  durationSeconds?: number;
  fileSizeBytes?: number;
}

export interface GeneratedPost {
  caption: string;
  thumbnail: string;
  mediaUrls?: string[];
  videoUrl?: string;
  mediaMetadata?: MediaMetadata;
  // Phase 5 -- async media flow markers
  pendingMedia?: boolean;       // true means caller should set post.status=PENDING_MEDIA
  mediaJobId?: string;          // present when pendingMedia=true
  generationStep?: 'CAPTION_DONE' | 'MEDIA_REQUESTED' | 'MEDIA_DONE';
  /** 1-2 sentence creative rationale explaining why this specific content was generated. */
  motivation?: string;
}

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

export interface IContentGenerator {
  readonly name: string;
  draftCycle(input: DraftCycleInput, ctx?: GenerationContext): Promise<GeneratedCycle>;
  reviseCycle(input: ReviseCycleInput, ctx?: GenerationContext): Promise<GeneratedCycle>;
  generatePost(input: GeneratePostInput, ctx?: GenerationContext): Promise<GeneratedPost>;
  revisePost(input: RevisePostInput, ctx?: GenerationContext): Promise<GeneratedPost>;
  healthCheck?(): Promise<{ ok: boolean; detail?: string }>;
}
