/**
 * Deadline processor.
 *
 * Auto-advances Posts and StrategyCycles that are still in PENDING_APPROVAL
 * or CHANGES_REQUESTED state past their approval deadline window. This keeps
 * the publisher pipeline moving even if the user misses the feedback window.
 *
 * Post deadline   = scheduledFor - postApprovalBufferHours
 *   past deadline -> status SCHEDULED
 *
 * Cycle deadline  = startDate - cycleApprovalBufferHours
 *   past deadline -> status APPROVED (rolling-window then materialises slots)
 */

import { getPostsCollection, getStrategyCyclesCollection } from '@restropulse/db';
import {
  isPostPastApprovalDeadline,
  isCyclePastApprovalDeadline,
  POST_APPROVAL_BUFFER_HOURS,
  CYCLE_APPROVAL_BUFFER_HOURS,
} from '@restropulse/shared';
import { createLogger } from '@restropulse/telemetry/server';

const logger = createLogger('content-engine:deadline-processor');
const MS_PER_HOUR = 60 * 60 * 1000;

export interface DeadlineConfig {
  postApprovalBufferHours?: number;
  cycleApprovalBufferHours?: number;
}

export async function processDeadlines(config: DeadlineConfig = {}): Promise<{
  postsAdvanced: number;
  cyclesAdvanced: number;
  failed: number;
}> {
  const postsCol = getPostsCollection();
  const cyclesCol = getStrategyCyclesCollection();
  const stats = { postsAdvanced: 0, cyclesAdvanced: 0, failed: 0 };

  const postBufferHours = config.postApprovalBufferHours ?? POST_APPROVAL_BUFFER_HOURS;
  const cycleBufferHours = config.cycleApprovalBufferHours ?? CYCLE_APPROVAL_BUFFER_HOURS;

  const now = new Date();

  // --- Posts ------------------------------------------------------------
  const postHorizon = new Date(now.getTime() + postBufferHours * MS_PER_HOUR);
  // DB prefilter: only candidates whose scheduledFor is close enough to be possibly past deadline.
  const candidatePosts = await postsCol
    .find({
      status: { $in: ['PENDING_APPROVAL', 'CHANGES_REQUESTED'] },
      scheduledFor: { $lte: postHorizon.toISOString() },
    })
    .toArray();

  for (const postDoc of candidatePosts) {
    const postId = postDoc._id.toString();
    if (!isPostPastApprovalDeadline({ scheduledFor: postDoc.scheduledFor }, now, postBufferHours)) {
      continue;
    }
    try {
      const update = await postsCol.updateOne(
        { _id: postDoc._id, status: { $in: ['PENDING_APPROVAL', 'CHANGES_REQUESTED'] } },
        { $set: { status: 'SCHEDULED', updatedAt: new Date() } },
      );
      if (update.matchedCount === 0) {
        continue;
      }
      logger.info(
        { entityType: 'post', entityId: postId, reason: 'deadline_auto_approved' },
        'Post auto-advanced past deadline',
      );
      stats.postsAdvanced++;
    } catch (error) {
      logger.error({ postId, err: error }, 'Failed to auto-advance post past deadline');
      stats.failed++;
    }
  }

  // --- Cycles -----------------------------------------------------------
  const cycleHorizon = new Date(now.getTime() + cycleBufferHours * MS_PER_HOUR);
  const candidateCycles = await cyclesCol
    .find({
      status: { $in: ['PENDING_APPROVAL', 'CHANGES_REQUESTED'] },
      startDate: { $lte: cycleHorizon.toISOString() },
    })
    .toArray();

  for (const cycleDoc of candidateCycles) {
    const cycleId = cycleDoc._id.toString();
    if (!isCyclePastApprovalDeadline({ startDate: cycleDoc.startDate }, now, cycleBufferHours)) {
      continue;
    }
    try {
      const update = await cyclesCol.updateOne(
        { _id: cycleDoc._id, status: { $in: ['PENDING_APPROVAL', 'CHANGES_REQUESTED'] } },
        { $set: { status: 'APPROVED', updatedAt: new Date() } },
      );
      if (update.matchedCount === 0) {
        continue;
      }
      logger.info(
        { entityType: 'cycle', entityId: cycleId, reason: 'deadline_auto_approved' },
        'Cycle auto-advanced past deadline',
      );
      stats.cyclesAdvanced++;
    } catch (error) {
      logger.error({ cycleId, err: error }, 'Failed to auto-advance cycle past deadline');
      stats.failed++;
    }
  }

  return stats;
}

import type { IProcessor } from '../types.js';

export function createDeadlineProcessor(cron: string, config: DeadlineConfig): IProcessor {
  return { name: 'deadlines', cron, run: async () => { await processDeadlines(config); } };
}
