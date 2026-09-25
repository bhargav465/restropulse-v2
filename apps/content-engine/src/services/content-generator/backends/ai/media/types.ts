/**
 * IMediaGenerator -- the seam between AIContentGenerator orchestration and
 * media providers (image/video). Phase 2 ships PlaceholderMediaGenerator as
 * the only impl. Phase 4 introduces ReplicateMediaGenerator and the MongoDB-backed
 * mediaJobs durable polling pattern. Phase 5 extends to long-running video.
 *
 * Phase 2's contract is intentionally synchronous (Promise<MediaGenJob with
 * status 'COMPLETED' immediately); phase 5 will introduce the PENDING/RUNNING
 * states without changing this interface shape -- callers must already handle
 * the wider state space.
 */

import type { Platform, PostType } from '@restropulse/shared';

export type MediaJobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface MediaGenJob {
  jobId: string;
  status: MediaJobStatus;
  /** Public URL of the resulting media. Required when status is COMPLETED. */
  mediaUrl?: string;
  /** Carousel sets resolve with multiple URLs. */
  mediaUrls?: string[];
  /** Thumbnail URL (for video and carousel). */
  thumbnail?: string;
  /** Width/height/duration metadata when available. */
  metadata?: {
    widthPx?: number;
    heightPx?: number;
    durationSeconds?: number;
  };
  /** Failure detail when status is FAILED. */
  error?: string;
}

export interface ImageGenInput {
  postType: PostType;          // IMAGE | CAROUSEL | STORY (this method's domain)
  platform: Platform;
  concept: string;
  themes?: string[];
  caption?: string;
  /** Optional: edit a user-provided image (img2img) instead of generating from scratch. */
  baseImageUrl?: string;
  /** Visual direction fragment from the domain specialization (food photography style, angle, surface). Appended to the model prompt to ground the image in the correct aesthetic. */
  promptSuffix?: string;
  // Phase 4 -- optional, used for cost attribution + audit
  restaurantId?: string;
  postId?: string;
  cycleId?: string;
}

export interface VideoGenInput {
  postType: 'REEL' | 'VIDEO' | 'STORY';
  platform: Platform;
  concept: string;
  themes?: string[];
  caption?: string;
  // Phase 4 -- optional
  restaurantId?: string;
  postId?: string;
  cycleId?: string;
}

export interface CarouselGenInput {
  platform: Platform;
  concept: string;
  themes?: string[];
  caption?: string;
  /** Number of slides to generate. Default: 3. */
  slideCount?: number;
  /** Visual direction fragment from domain specialization. */
  promptSuffix?: string;
  /**
   * Per-slide visual briefs from the LLM (carouselSlides in PostCaptionSchema).
   * When provided, drives `slideCount` and overrides the hardcoded fallback directions.
   * Each string describes a distinct moment/facet/stage to show in that slide.
   */
  slideDirections?: string[];
  // Phase 4 -- optional
  restaurantId?: string;
  postId?: string;
  cycleId?: string;
}

export interface IMediaGenerator {
  readonly name: string;
  generateImage(input: ImageGenInput): Promise<MediaGenJob>;
  generateCarousel(input: CarouselGenInput): Promise<MediaGenJob>;
  generateVideo(input: VideoGenInput): Promise<MediaGenJob>;
  /** Phase 5: poll a previously-submitted job. Phase 2 impls return COMPLETED jobs immediately so this is a no-op for them. */
  pollJob(jobId: string): Promise<MediaGenJob>;
}
