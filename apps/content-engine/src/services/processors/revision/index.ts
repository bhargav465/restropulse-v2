/**
 * Revision processor.
 *
 * Picks up Posts and StrategyCycles that were marked CHANGES_REQUESTED via the
 * UI, asks the content generator for a revised version informed by the
 * feedback payload, writes the result back, and stamps a `resolution` string
 * on the feedback so the UI can show what was addressed.
 *
 * Both entity feedback shapes live in the `feedback` field on the document.
 * The UI stores feedback as a JSON-encoded string (see ContentStudio.tsx
 * parseFeedback). We parse it here, enrich the resolution, and re-stringify.
 *
 * Skips entities that already have a non-empty `resolution` — this lets
 * concurrent ticks be idempotent and leaves human-edited resolutions intact.
 */

import {
  getPostsCollection,
  getStrategyCyclesCollection,
  findRestaurantById,
} from '@restropulse/db';
import type { PostType, Platform } from '@restropulse/shared';
import { createLogger } from '@restropulse/telemetry/server';
import {
  getContentGenerator,
  ContentGenerationError,
  type CycleFeedback,
  type PostFeedback,
} from '../../content-generator/index.js';

const logger = createLogger('content-engine:revision-processor');

interface ParsedFeedback {
  tags?: string[];
  areas?: string[];
  details?: Record<string, string>;
  note?: string;
  resolution?: string;
}

function parseFeedback(raw: unknown): ParsedFeedback {
  if (typeof raw !== 'string' || raw.length === 0) return {};
  try {
    const parsed = JSON.parse(raw) as ParsedFeedback;
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    // Treat plain-text feedback as a single note.
    return { note: raw };
  }
  return {};
}

function stringifyFeedback(feedback: ParsedFeedback): string {
  return JSON.stringify(feedback);
}

function hasResolution(feedback: ParsedFeedback): boolean {
  return typeof feedback.resolution === 'string' && feedback.resolution.trim().length > 0;
}

function buildResolutionText(kind: 'post' | 'cycle', feedback: ParsedFeedback): string {
  const note = feedback.note?.trim() || '';
  const label = kind === 'post' ? 'post' : 'cycle';
  if (note.length > 0) {
    return `Auto-revised ${label}: addressed "${note}"`;
  }
  return `Auto-revised ${label} based on requested changes`;
}

export async function processRevisions(): Promise<{
  postsRevised: number;
  cyclesRevised: number;
  failed: number;
}> {
  const generator = getContentGenerator();
  const stats = { postsRevised: 0, cyclesRevised: 0, failed: 0 };

  const postsCol = getPostsCollection();
  const cyclesCol = getStrategyCyclesCollection();

  // --- Posts ------------------------------------------------------------
  const pendingPosts = await postsCol.find({ status: 'CHANGES_REQUESTED' }).toArray();
  for (const postDoc of pendingPosts) {
    const postId = postDoc._id.toString();
    const feedback = parseFeedback(postDoc.feedback);

    if (hasResolution(feedback)) {
      continue;
    }

    try {
      const restaurant = postDoc.restaurantId
        ? await findRestaurantById(postDoc.restaurantId)
        : null;

      const postFeedback: PostFeedback = {
        tags: Array.isArray(feedback.tags) ? feedback.tags : [],
        details: feedback.details && typeof feedback.details === 'object' ? feedback.details : {},
        note: feedback.note || '',
      };

      const themes = Array.isArray(postDoc.themes) ? (postDoc.themes as string[]) : undefined;
      const archetype = (postDoc as any).archetype as string | undefined
        ?? themes?.[0];

      const result = await generator.revisePost(
        {
          existingPost: {
            type: (postDoc.type as PostType) || 'IMAGE',
            platform: (postDoc.platform as Platform) || 'INSTAGRAM',
            caption: postDoc.caption || '',
            themes,
            archetype,
            thumbnail: (postDoc as any).thumbnail,
            mediaUrls: (postDoc as any).mediaUrls ?? undefined,
            videoUrl: (postDoc as any).videoUrl ?? undefined,
          },
          feedback: postFeedback,
        },
        {
          correlationId: postId,
          restaurantId: postDoc.restaurantId,
          restaurantName: restaurant?.name,
        },
      );

      if (result.pendingMedia && result.mediaJobId) {
        const update = await postsCol.updateOne(
          { _id: postDoc._id, status: 'CHANGES_REQUESTED' },
          {
            $set: {
              caption: result.caption,
              status: 'PENDING_MEDIA',
              mediaJobId: result.mediaJobId,
              generationStep: result.generationStep ?? 'MEDIA_REQUESTED',
              lastStepAt: new Date().toISOString(),
              updatedAt: new Date(),
            },
          },
        );
        if (update.matchedCount === 0) {
          logger.warn({ postId }, 'Post no longer CHANGES_REQUESTED; skipping advance');
          continue;
        }
        logger.info({ postId, mediaJobId: result.mediaJobId }, 'Revised post advanced to PENDING_MEDIA awaiting media provider');
        stats.postsRevised++;
        continue;
      }

      const stampedFeedback: ParsedFeedback = {
        ...feedback,
        resolution: buildResolutionText('post', feedback),
      };

      const update = await postsCol.updateOne(
        { _id: postDoc._id, status: 'CHANGES_REQUESTED' },
        {
          $set: {
            caption: result.caption,
            thumbnail: result.thumbnail,
            mediaUrls: result.mediaUrls || null,
            videoUrl: result.videoUrl || null,
            feedback: stringifyFeedback(stampedFeedback),
            status: 'PENDING_APPROVAL',
            updatedAt: new Date(),
          },
        },
      );

      if (update.matchedCount === 0) {
        logger.warn({ postId }, 'Post no longer CHANGES_REQUESTED; skipping revise');
        continue;
      }

      logger.info({ postId, generator: generator.name }, 'Revised post');
      stats.postsRevised++;
    } catch (error) {
      if (error instanceof ContentGenerationError) {
        logger.error({ postId, code: error.code, err: error }, 'Post revision failed');
      } else {
        logger.error({ postId, err: error }, 'Post revision crashed');
      }
      stats.failed++;
    }
  }

  // --- Cycles ------------------------------------------------------------
  const pendingCycles = await cyclesCol.find({ status: 'CHANGES_REQUESTED' }).toArray();
  for (const cycleDoc of pendingCycles) {
    const cycleId = cycleDoc._id.toString();
    const feedback = parseFeedback(cycleDoc.feedback);

    if (hasResolution(feedback)) {
      continue;
    }

    try {
      const restaurant = cycleDoc.restaurantId
        ? await findRestaurantById(cycleDoc.restaurantId)
        : null;

      const cycleFeedback: CycleFeedback = {
        areas: Array.isArray(feedback.areas) ? feedback.areas : [],
        note: feedback.note || '',
      };

      const revised = await generator.reviseCycle(
        {
          existingCycle: {
            period: cycleDoc.period || '',
            summary: cycleDoc.summary || '',
            plannedPosts: Array.isArray(cycleDoc.plannedPosts) ? cycleDoc.plannedPosts : [],
            focus: Array.isArray(cycleDoc.focus) ? cycleDoc.focus : [],
          },
          feedback: cycleFeedback,
        },
        {
          correlationId: cycleId,
          restaurantId: cycleDoc.restaurantId,
          restaurantName: restaurant?.name,
        },
      );

      const stampedFeedback: ParsedFeedback = {
        ...feedback,
        resolution: buildResolutionText('cycle', feedback),
      };

      const update = await cyclesCol.updateOne(
        { _id: cycleDoc._id, status: 'CHANGES_REQUESTED' },
        {
          $set: {
            summary: revised.summary,
            plannedPosts: revised.plannedPosts,
            focus: revised.focus,
            feedback: stringifyFeedback(stampedFeedback),
            status: 'PENDING_APPROVAL',
            updatedAt: new Date(),
          },
        },
      );

      if (update.matchedCount === 0) {
        logger.warn({ cycleId }, 'Cycle no longer CHANGES_REQUESTED; skipping revise');
        continue;
      }

      logger.info({ cycleId, generator: generator.name }, 'Revised cycle');
      stats.cyclesRevised++;
    } catch (error) {
      if (error instanceof ContentGenerationError) {
        logger.error({ cycleId, code: error.code, err: error }, 'Cycle revision failed');
      } else {
        logger.error({ cycleId, err: error }, 'Cycle revision crashed');
      }
      stats.failed++;
    }
  }

  return stats;
}

import type { IProcessor } from '../types.js';

export function createRevisionProcessor(cron: string): IProcessor {
  return { name: 'revisions', cron, run: async () => { await processRevisions(); } };
}
