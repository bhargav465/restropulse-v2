/**
 * runPostResumeOnBoot -- worker startup scan that picks up posts stuck in
 * PENDING_MEDIA after a crash. Idempotent: pollMediaJob is the same call the
 * media-job-poller cron makes every 30s, so re-running on boot just gets the
 * post one tick early.
 */

import { createLogger } from '@restropulse/telemetry/server';
import { findStalePendingMediaPosts } from '@restropulse/db';
import {
  pollMediaJob,
  type PollRunnerDeps,
} from './processors/media-job-poller/poll-runner.js';

const log = createLogger('post-resume');

const STALE_BOOT_BUDGET_MS = 5 * 60 * 1000;  // 5 min

export async function runPostResumeOnBoot(deps: PollRunnerDeps): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_BOOT_BUDGET_MS);
  const stalePosts = await findStalePendingMediaPosts(cutoff);
  log.info({ count: stalePosts.length, cutoff: cutoff.toISOString() }, 'post-resume scan');
  for (const post of stalePosts) {
    try {
      await pollMediaJob(post, deps);
    } catch (err) {
      log.error({ err, postId: post.id }, 'post-resume pollMediaJob threw; continuing');
    }
  }
}
