/**
 * Pending Posts Processor
 *
 * Polls for posts with status PENDING_CONTENT and generates content for them.
 * These are posts created by users via the API's /posts/generate endpoint,
 * and stub posts inserted by the rolling-window processor for upcoming cycle
 * slots. Both flow through the same generator call.
 */

import { getPostsCollection, findRestaurantById } from '@restropulse/db';
import type { PostType, Platform } from '@restropulse/shared';
import { createLogger } from '@restropulse/telemetry/server';
import { getContentGenerator, ContentGenerationError } from '../../content-generator/index.js';

const logger = createLogger('content-engine:adhoc-processor');

export async function processPendingPosts(): Promise<{ processed: number; failed: number }> {
  const col = getPostsCollection();
  const generator = getContentGenerator();
  const stats = { processed: 0, failed: 0 };

  const pendingPosts = await col
    .find({ status: 'PENDING_CONTENT' })
    .sort({ createdAt: 1 })
    .toArray();

  if (pendingPosts.length === 0) {
    return stats;
  }

  logger.info(
    { count: pendingPosts.length, generator: generator.name },
    'Found adhoc posts pending content generation',
  );

  for (const postDoc of pendingPosts) {
    const postId = postDoc._id.toString();

    try {
      const restaurant = postDoc.restaurantId
        ? await findRestaurantById(postDoc.restaurantId)
        : null;

      const themes = Array.isArray(postDoc.themes) ? (postDoc.themes as string[]) : undefined;
      const archetype = (postDoc as any).archetype as string | undefined
        ?? themes?.[0];

      const content = await generator.generatePost(
        {
          concept: postDoc.caption || postDoc.concept || '',
          type: (postDoc.type as PostType) || 'IMAGE',
          platform: (postDoc.platform as Platform) || 'INSTAGRAM',
          themes,
          archetype,
        },
        {
          correlationId: postId,
          restaurantId: postDoc.restaurantId,
          restaurantName: restaurant?.name,
          restaurantProfile: restaurant ? {
            cuisine: restaurant.cuisine,
            description: restaurant.description,
            menu: restaurant.menu,
            chefSpecials: restaurant.chefSpecials,
            activeOffers: restaurant.activeOffers,
            priceRange: restaurant.priceRange,
          } : undefined,
        },
      );

      if (content.pendingMedia && content.mediaJobId) {
        const result = await col.updateOne(
          { _id: postDoc._id, status: 'PENDING_CONTENT' },
          {
            $set: {
              caption: content.caption,
              status: 'PENDING_MEDIA',
              mediaJobId: content.mediaJobId,
              generationStep: content.generationStep ?? 'MEDIA_REQUESTED',
              lastStepAt: new Date().toISOString(),
              updatedAt: new Date(),
            },
          },
        );
        if (result.matchedCount === 0) {
          logger.warn({ postId }, 'Post no longer in PENDING_CONTENT; skipping advance');
          continue;
        }
        logger.info({ postId, mediaJobId: content.mediaJobId }, 'Post advanced to PENDING_MEDIA awaiting media provider');
        stats.processed++;
        continue;
      }

      const result = await col.updateOne(
        { _id: postDoc._id, status: 'PENDING_CONTENT' },
        {
          $set: {
            caption: content.caption,
            thumbnail: content.thumbnail,
            mediaUrls: content.mediaUrls || null,
            videoUrl: content.videoUrl || null,
            status: 'PENDING_APPROVAL',
            updatedAt: new Date(),
          },
        },
      );

      if (result.matchedCount === 0) {
        logger.warn({ postId }, 'Post no longer in PENDING_CONTENT; skipping advance');
        continue;
      }

      logger.info({ postId, generator: generator.name }, 'Generated content for post');
      stats.processed++;
    } catch (error) {
      if (error instanceof ContentGenerationError) {
        logger.error({ postId, code: error.code, err: error }, 'Content generation failed');
      } else {
        logger.error({ postId, err: error }, 'Failed to generate content for post');
      }
      stats.failed++;
    }
  }

  return stats;
}

import type { IProcessor } from '../types.js';

export function createAdhocProcessor(cron: string): IProcessor {
  return { name: 'pending-posts', cron, run: async () => { await processPendingPosts(); } };
}
