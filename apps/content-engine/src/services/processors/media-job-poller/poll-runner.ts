/**
 * pollMediaJob -- per-post poll runner. Called by the media-job-poller
 * processor for each PENDING_MEDIA post on every tick.
 *
 * State machine on each call:
 *   stored RUNNING + startedAt > 10 min  ->  FAILED, post FAILED
 *   stored RUNNING                        ->  delegate to media.pollJob
 *   after delegate: RUNNING               ->  no-op
 *   after delegate: COMPLETED             ->  applyMediaJobResultToPost
 *   after delegate: FAILED                ->  markPostFailedWithMedia
 *   stored COMPLETED                      ->  applyMediaJobResultToPost (idempotent)
 *   stored FAILED                         ->  markPostFailedWithMedia (idempotent)
 */

import { createLogger } from '@restropulse/telemetry/server';
import {
  applyMediaJobResultToPost,
  markPostFailedWithMedia,
} from '@restropulse/db';
import type { Post } from '@restropulse/shared';
import type { IMediaJobStore } from '../../content-generator/backends/ai/media/jobs/types.js';
import type { IMediaGenerator } from '../../content-generator/backends/ai/media/types.js';

const log = createLogger('media-job-poller');

const STALE_RUNNING_BUDGET_MS = 10 * 60 * 1000;  // 10 min

export interface PollRunnerDeps {
  store: IMediaJobStore;
  media: IMediaGenerator;
}

export async function pollMediaJob(post: Post, deps: PollRunnerDeps): Promise<void> {
  if (!post.mediaJobId) {
    log.debug({ postId: post.id }, 'Post has no mediaJobId; skipping');
    return;
  }

  const before = await deps.store.findById(post.mediaJobId);
  if (!before) {
    log.warn({ postId: post.id, mediaJobId: post.mediaJobId }, 'Post references missing mediaJob; marking FAILED');
    await markPostFailedWithMedia(post.id, 'mediaJob row missing');
    return;
  }

  // Reap stale RUNNING jobs (no progress for >10 min)
  if (before.status === 'RUNNING') {
    const ageMs = Date.now() - new Date(before.startedAt).getTime();
    if (ageMs > STALE_RUNNING_BUDGET_MS) {
      log.warn({ jobId: before.jobId, ageMs }, 'Reaping stale RUNNING job as FAILED');
      await deps.store.updateStatus(before.jobId, {
        status: 'FAILED',
        error: `stale RUNNING -- exceeded ${STALE_RUNNING_BUDGET_MS / 1000}s budget`,
        completedAt: new Date(),
        lastPolledAt: new Date(),
      });
      await markPostFailedWithMedia(post.id, `stale RUNNING -- exceeded 10 minute budget`);
      return;
    }
    // Delegate to the media generator's pollJob (queue-aware).
    await deps.media.pollJob(before.jobId);
  }

  // Read the (possibly updated) job state.
  const after = await deps.store.findById(post.mediaJobId);
  if (!after) return;

  if (after.status === 'COMPLETED') {
    await applyMediaJobResultToPost(post.id, after);
    log.info({ postId: post.id, jobId: after.jobId }, 'Post advanced to PENDING_APPROVAL');
    return;
  }
  if (after.status === 'FAILED') {
    await markPostFailedWithMedia(post.id, after.error ?? 'unknown media-job failure');
    log.warn({ postId: post.id, jobId: after.jobId, err: after.error }, 'Post marked FAILED from media-job poll');
    return;
  }
  // Still RUNNING / PENDING -- next tick will revisit.
}
