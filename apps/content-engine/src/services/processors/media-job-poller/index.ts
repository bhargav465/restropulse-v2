/**
 * media-job-poller -- IProcessor that runs every 30s, finds posts in
 * PENDING_MEDIA, and delegates each to pollMediaJob. Per-post failures are
 * caught + logged so one bad job doesn't stop the loop.
 */

import { createLogger } from '@restropulse/telemetry/server';
import { findAllPendingMediaPosts } from '@restropulse/db';
import type { IProcessor } from '../types.js';
import { pollMediaJob, type PollRunnerDeps } from './poll-runner.js';

const log = createLogger('media-job-poller');

export async function processMediaJobs(deps: PollRunnerDeps): Promise<void> {
  const posts = await findAllPendingMediaPosts();
  log.info({ count: posts.length }, 'media-job-poller tick');
  for (const post of posts) {
    try {
      await pollMediaJob(post, deps);
    } catch (err) {
      log.error({ err, postId: post.id }, 'pollMediaJob threw; continuing with next post');
    }
  }
}

export function createMediaJobPollerProcessor(
  cron: string,
  deps: PollRunnerDeps,
): IProcessor {
  return {
    name: 'media-job-poller',
    cron,
    run: () => processMediaJobs(deps),
  };
}
