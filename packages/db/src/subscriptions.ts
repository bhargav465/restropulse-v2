/**
 * @restropulse/db - Subscriptions collection helpers
 */

import {
  getSubscriptionsCollection,
  getPostsCollection,
  toApiFormat,
  toApiFormatArray,
  toObjectId,
} from './connection.js';
import type { Subscription, PostType, Platform } from '@restropulse/shared';

export async function findActiveSubscription(restaurantId: string): Promise<Subscription | null> {
  const col = getSubscriptionsCollection();
  const doc = await col.findOne({ restaurantId, endedAt: null });
  return toApiFormat(doc) as Subscription | null;
}

/** Live subscriptions with a plan request waiting for the team (manual billing), oldest first. */
export async function findSubscriptionsWithPendingPlan(limit = 200): Promise<Subscription[]> {
  const col = getSubscriptionsCollection();
  const docs = await col
    .find({ endedAt: null, pendingPlanSnapshot: { $type: 'object' } })
    .sort({ planRequestedAt: 1, updatedAt: 1 })
    .limit(limit)
    .toArray();
  return toApiFormatArray(docs) as Subscription[];
}

export async function createSubscription(sub: Omit<Subscription, 'id'>): Promise<Subscription> {
  const col = getSubscriptionsCollection();
  const now = new Date();
  const result = await col.insertOne({
    endedAt: null,
    ...sub,
    createdAt: now,
    updatedAt: now,
  });
  return { ...sub, id: result.insertedId.toString() } as Subscription;
}

export async function updateSubscription(
  id: string,
  updates: Partial<Subscription>,
): Promise<Subscription | null> {
  const col = getSubscriptionsCollection();
  const result = await col.findOneAndUpdate(
    { _id: toObjectId(id) as any },
    { $set: { ...updates, updatedAt: new Date() } },
    { returnDocument: 'after' },
  );
  return toApiFormat(result) as Subscription | null;
}

/**
 * Get weekly post counts for a restaurant, grouped by platform and post type.
 * Counts posts created in the current ISO week (Mon-Sun).
 */
export async function getWeeklyPostCounts(
  restaurantId: string,
): Promise<Record<Platform, Record<PostType, number>>> {
  const postsCol = getPostsCollection();

  // Calculate start of current ISO week (Monday 00:00:00)
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ...
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() + mondayOffset);
  weekStart.setHours(0, 0, 0, 0);

  const counts = await postsCol
    .aggregate([
      {
        $match: {
          restaurantId,
          createdAt: { $gte: weekStart },
          status: { $nin: ['MISSED_DEADLINE'] },
        },
      },
      { $group: { _id: { type: '$type', platform: '$platform' }, count: { $sum: 1 } } },
    ])
    .toArray();

  const emptyPostTypeCounts = (): Record<PostType, number> => ({
    IMAGE: 0, VIDEO: 0, STORY: 0, CAROUSEL: 0, REEL: 0,
  });

  const result: Record<Platform, Record<PostType, number>> = {
    INSTAGRAM: emptyPostTypeCounts(),
    FACEBOOK: emptyPostTypeCounts(),
  };

  for (const item of counts) {
    const platform = item._id.platform as Platform;
    const postType = item._id.type as PostType;
    if (platform in result && postType in result[platform]) {
      result[platform][postType] = item.count;
    }
  }

  return result;
}

/**
 * Count today's distinct adhoc post creation requests for a restaurant, i.e.
 * distinct groupId values -- a single "create post" action can fan out into
 * one Post document per targeted platform, sharing a groupId, and should only
 * count once toward the restaurant's daily adhoc creation limit.
 */
export async function getDailyAdhocGroupCount(restaurantId: string): Promise<number> {
  const postsCol = getPostsCollection();

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);

  const groupIds = await postsCol.distinct('groupId', {
    restaurantId,
    isAdhoc: true,
    createdAt: { $gte: dayStart },
    status: { $nin: ['MISSED_DEADLINE'] },
  });

  return groupIds.filter((id): id is string => typeof id === 'string' && id.length > 0).length;
}

/**
 * Get today's adhoc post counts for a restaurant, grouped by platform and post type.
 * Counts only isAdhoc posts created since local midnight (mirrors getWeeklyPostCounts).
 */
export async function getDailyAdhocPostCounts(
  restaurantId: string,
): Promise<Record<Platform, Record<PostType, number>>> {
  const postsCol = getPostsCollection();

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);

  const counts = await postsCol
    .aggregate([
      {
        $match: {
          restaurantId,
          isAdhoc: true,
          createdAt: { $gte: dayStart },
          status: { $nin: ['MISSED_DEADLINE'] },
        },
      },
      { $group: { _id: { type: '$type', platform: '$platform' }, count: { $sum: 1 } } },
    ])
    .toArray();

  const emptyPostTypeCounts = (): Record<PostType, number> => ({
    IMAGE: 0, VIDEO: 0, STORY: 0, CAROUSEL: 0, REEL: 0,
  });

  const result: Record<Platform, Record<PostType, number>> = {
    INSTAGRAM: emptyPostTypeCounts(),
    FACEBOOK: emptyPostTypeCounts(),
  };

  for (const item of counts) {
    const platform = item._id.platform as Platform;
    const postType = item._id.type as PostType;
    if (platform in result && postType in result[platform]) {
      result[platform][postType] = item.count;
    }
  }

  return result;
}

export async function deductCredits(subscriptionId: string, amount: number): Promise<boolean> {
  const col = getSubscriptionsCollection();
  const result = await col.updateOne(
    { _id: toObjectId(subscriptionId) as any, credits: { $gte: amount } },
    { $inc: { credits: -amount }, $set: { updatedAt: new Date() } },
  );
  return result.modifiedCount === 1;
}

export async function addCredits(subscriptionId: string, amount: number): Promise<boolean> {
  const col = getSubscriptionsCollection();
  const result = await col.updateOne(
    { _id: toObjectId(subscriptionId) as any },
    { $inc: { credits: amount }, $set: { updatedAt: new Date() } },
  );
  return result.modifiedCount === 1;
}
