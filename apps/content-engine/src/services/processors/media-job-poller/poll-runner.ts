/**
 * pollMediaJob -- per-post poll runner. Called by the media-job-poller
 * processor for each PENDING_MEDIA post on every tick.
 *
 * A video post keeps retrying until it succeeds, within the ceiling in
 * video-retry-policy.ts (A3-1). The post stays PENDING_MEDIA across
 * attempts; only the media job moves.
 *
 * State machine on each call:
 *   RUNNING past the per-attempt timeout   ->  attempt failed (see below)
 *   RUNNING                                ->  delegate to media.pollJob
 *   after delegate: RUNNING                ->  no-op
 *   after delegate: COMPLETED              ->  applyMediaJobResultToPost
 *   after delegate: FAILED (attempt live)  ->  attempt failed (see below)
 *   PENDING, nextAttemptAt reached         ->  media.retryVideoJob, then as above
 *   PENDING, waiting                       ->  no-op
 *   COMPLETED                              ->  applyMediaJobResultToPost (idempotent)
 *   FAILED, already final                  ->  markPostFailedWithMedia (idempotent)
 *
 * Attempt failed:
 *   retryable and inside the ceiling       ->  job PENDING with nextAttemptAt,
 *                                              attempt appended to attemptHistory
 *   permanent, or ceiling reached          ->  job FAILED (final), post failed
 *   job has no stored request (images,     ->  job FAILED, post failed (the
 *   rows from before A3)                       pre-A3 behaviour)
 */

import { createLogger, trackEvent } from '@restropulse/telemetry/server';
import {
  applyMediaJobResultToPost,
  markPostFailedWithMedia,
} from '@restropulse/db';
import type { MediaJobAttempt, MediaJobRecord, Post } from '@restropulse/shared';
import type { IMediaJobStore } from '../../content-generator/backends/ai/media/jobs/types.js';
import type { IMediaGenerator } from '../../content-generator/backends/ai/media/types.js';
import {
  decideAfterFailure,
  loadVideoRetryPolicy,
  usesAlternateModel,
  type VideoRetryPolicy,
} from './video-retry-policy.js';

const log = createLogger('media-job-poller');

export const VIDEO_ATTEMPT_FAILED_EVENT = 'media.video_attempt_failed';
export const VIDEO_GAVE_UP_EVENT = 'media.video_gave_up';

export interface PollRunnerDeps {
  store: IMediaJobStore;
  media: IMediaGenerator;
  /** Defaults to loadVideoRetryPolicy() (env-configurable ceiling). */
  policy?: VideoRetryPolicy;
  /** Injectable clock for tests. */
  now?: () => Date;
}

/**
 * A FAILED job is final once its current attempt is in attemptHistory. While
 * an attempt is live, history holds only the earlier attempts.
 */
function isFinalFailure(job: MediaJobRecord): boolean {
  if (!job.request) return true;
  return (job.attemptHistory?.length ?? 0) >= job.attempts;
}

export async function pollMediaJob(post: Post, deps: PollRunnerDeps): Promise<void> {
  if (!post.mediaJobId) {
    log.debug({ postId: post.id }, 'Post has no mediaJobId; skipping');
    return;
  }
  const policy = deps.policy ?? loadVideoRetryPolicy();
  const now = deps.now ?? (() => new Date());

  let job = await deps.store.findById(post.mediaJobId);
  if (!job) {
    log.warn({ postId: post.id, mediaJobId: post.mediaJobId }, 'Post references missing mediaJob; marking FAILED');
    await markPostFailedWithMedia(post.id, 'mediaJob row missing');
    return;
  }

  // A parked video job whose wait is over gets its next attempt.
  if (job.status === 'PENDING') {
    const due = !job.nextAttemptAt || new Date(job.nextAttemptAt).getTime() <= now().getTime();
    if (!due) return;
    if (!deps.media.retryVideoJob || !job.request) {
      await giveUp(post, job, 'video job cannot be resubmitted by this media generator', deps, now());
      return;
    }
    await deps.media.retryVideoJob(job.jobId, {
      useAlternateModel: usesAlternateModel(job.attempts + 1, policy),
    });
    const resubmitted = await deps.store.findById(job.jobId);
    if (!resubmitted) return;
    job = resubmitted;
    if (job.status === 'RUNNING') return; // poll it next tick
  }

  if (job.status === 'RUNNING') {
    const ageMs = now().getTime() - new Date(job.startedAt).getTime();
    if (ageMs > policy.attemptTimeoutMs) {
      log.warn({ jobId: job.jobId, ageMs, attempt: job.attempts }, 'Media attempt exceeded its time budget');
      await onAttemptFailed(
        post,
        job,
        `stale RUNNING -- attempt exceeded the ${Math.round(policy.attemptTimeoutMs / 60000)} minute budget`,
        deps,
        policy,
        now(),
      );
      return;
    }
    await deps.media.pollJob(job.jobId);
    const after = await deps.store.findById(job.jobId);
    if (!after) return;
    job = after;
  }

  if (job.status === 'COMPLETED') {
    await applyMediaJobResultToPost(post.id, job);
    log.info({ postId: post.id, jobId: job.jobId, attempts: job.attempts }, 'Post advanced to PENDING_APPROVAL');
    return;
  }

  if (job.status === 'FAILED') {
    if (isFinalFailure(job)) {
      await markPostFailedWithMedia(post.id, job.error ?? 'unknown media-job failure');
      log.warn({ postId: post.id, jobId: job.jobId, err: job.error }, 'Post marked FAILED from media-job poll');
      return;
    }
    await onAttemptFailed(post, job, job.error ?? 'unknown media-job failure', deps, policy, now());
  }
  // Still RUNNING / PENDING -- next tick will revisit.
}

function attemptRecord(
  job: MediaJobRecord,
  error: string,
  errorClass: MediaJobAttempt['errorClass'],
  endedAt: Date,
): MediaJobAttempt {
  return {
    attempt: job.attempts,
    modelId: job.modelId,
    ...(job.providerJobId ? { providerJobId: job.providerJobId } : {}),
    startedAt: job.startedAt,
    endedAt,
    error,
    errorClass,
  };
}

async function onAttemptFailed(
  post: Post,
  job: MediaJobRecord,
  error: string,
  deps: PollRunnerDeps,
  policy: VideoRetryPolicy,
  now: Date,
): Promise<void> {
  if (!job.request) {
    // Not resumable (images, rows written before A3): fail as before.
    await giveUp(post, job, error, deps, now);
    return;
  }

  const decision = decideAfterFailure(job, error, now, policy);
  const history = [...(job.attemptHistory ?? []), attemptRecord(job, error, decision.errorClass, now)];
  const labels: Record<string, string> = {
    postId: post.id,
    restaurantId: job.restaurantId ?? post.restaurantId ?? '',
    jobId: job.jobId,
    attempt: String(job.attempts),
    modelId: job.modelId,
    errorClass: decision.errorClass,
  };

  if (decision.action === 'retry') {
    await deps.store.updateStatus(job.jobId, {
      status: 'PENDING',
      error,
      nextAttemptAt: decision.nextAttemptAt,
      attemptHistory: history,
      lastPolledAt: now,
    });
    trackEvent(VIDEO_ATTEMPT_FAILED_EVENT, { ...labels, nextAttemptAt: decision.nextAttemptAt.toISOString() });
    log.warn(
      { ...labels, err: error, nextAttemptAt: decision.nextAttemptAt },
      'Video attempt failed; another attempt is scheduled',
    );
    return;
  }

  await deps.store.updateStatus(job.jobId, {
    status: 'FAILED',
    error: decision.reason,
    nextAttemptAt: null,
    attemptHistory: history,
    completedAt: now,
    lastPolledAt: now,
  });
  await markPostFailedWithMedia(post.id, decision.reason);
  trackEvent(VIDEO_GAVE_UP_EVENT, labels);
  log.error({ ...labels, reason: decision.reason }, 'Video post failed for good');
}

async function giveUp(post: Post, job: MediaJobRecord, error: string, deps: PollRunnerDeps, now: Date): Promise<void> {
  if (job.status !== 'FAILED') {
    await deps.store.updateStatus(job.jobId, {
      status: 'FAILED',
      error,
      completedAt: now,
      lastPolledAt: now,
    });
  }
  await markPostFailedWithMedia(post.id, error);
  log.warn({ postId: post.id, jobId: job.jobId, err: error }, 'Post marked FAILED from media-job poll');
}
