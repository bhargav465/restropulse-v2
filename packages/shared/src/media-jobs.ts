/**
 * Per-media-generation job record persisted in the mediaJobs collection.
 *
 * Phase 4 writes one row per external media-provider image call (always
 * status=COMPLETED). Phase 5 introduces PENDING/RUNNING transitions for slow
 * video generation (Kling/MiniMax) and a media-job-poller cron that watches
 * RUNNING rows.
 *
 * The schema ships now so phase 5 only needs to layer the polling cron
 * without changing the document shape.
 */

import type { PostType } from './index.js';

export type MediaJobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
export type MediaJobProvider = 'placeholder-media' | 'replicate';

/** Whether another attempt could succeed. Content-policy rejections are permanent. */
export type MediaFailureClass = 'retryable' | 'permanent';

/** One finished (failed) attempt of a long-running media job, kept for support and cost audit. */
export interface MediaJobAttempt {
  attempt: number;
  modelId: string;
  providerJobId?: string;
  startedAt: Date;
  endedAt: Date;
  error: string;
  errorClass: MediaFailureClass;
}

/**
 * What a video job needs to be submitted again. Stored on the job at first
 * submission so the media-job-poller can retry without the original
 * generation pipeline. Jobs without it (images, rows written before A3) are
 * never retried by the poller.
 */
export interface MediaJobVideoRequest {
  prompt: string;
}

export interface MediaJobRecord {
  id?: string;
  /** Stable client-side id (UUID). */
  jobId: string;
  /** Provider-side request id (e.g. Replicate prediction id). Empty for synchronous providers. */
  providerJobId?: string;
  provider: MediaJobProvider;
  /** Concrete model that produced this job (e.g. 'black-forest-labs/flux-dev'). */
  modelId: string;
  /** Post type this job is intended for. */
  postType: PostType;
  status: MediaJobStatus;

  /** Single-image and video result URL. */
  mediaUrl?: string;
  /** Multi-image carousel result URLs. */
  mediaUrls?: string[];
  /** Thumbnail URL (for video and carousel). */
  thumbnail?: string;
  /** Width/height/duration metadata when known. */
  metadata?: {
    widthPx?: number;
    heightPx?: number;
    durationSeconds?: number;
  };

  /** Failure detail when status=FAILED. */
  error?: string;
  /** Submission attempts so far, including the one in flight. */
  attempts: number;
  /** Video only: inputs needed to resubmit (see MediaJobVideoRequest). */
  request?: MediaJobVideoRequest;
  /** Video only: every attempt that failed and was retried or given up on. */
  attemptHistory?: MediaJobAttempt[];
  /** Video only: when status=PENDING, the earliest time the poller resubmits. */
  nextAttemptAt?: Date | null;
  /** Video only: when the first attempt started; bounds the total retry window. */
  firstStartedAt?: Date;

  /** Cost-attribution labels (denormalized for fast dashboards). */
  restaurantId?: string;
  postId?: string;
  cycleId?: string;

  /** Lifecycle timestamps. */
  startedAt: Date;
  lastPolledAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
