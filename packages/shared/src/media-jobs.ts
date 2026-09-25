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
  /** Submission attempts so far. Phase 4 increments at most once. */
  attempts: number;

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
