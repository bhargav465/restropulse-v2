/**
 * @restropulse/db - Subscriptions collection helpers
 */

import {
  getSubscriptionsCollection,
  getPostsCollection,
  toApiFormat,
  toObjectId,
} from './connection.js';
import type { Subscription, PostType, Platform } from '@restropulse/shared';

export async function findActiveSubscription(restaurantId: string): Promise<Subscription | null> {
  const col = getSubscriptionsCollection();
  const doc = await col.findOne({ restaurantId, endedAt: null });
  return toApiFormat(doc) as Subscription | null;
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

export async function findSubscriptionByRazorpayId(
  razorpaySubscriptionId: string,
): Promise<Subscription | null> {
  const col = getSubscriptionsCollection();
  const doc = await col.findOne({ razorpaySubscriptionId });
  return toApiFormat(doc) as Subscription | null;
}

export async function findSubscriptionByPendingRazorpayId(
  pendingRazorpaySubscriptionId: string,
): Promise<Subscription | null> {
  const col = getSubscriptionsCollection();
  const doc = await col.findOne({ pendingRazorpaySubscriptionId, endedAt: null });
  return toApiFormat(doc) as Subscription | null;
}

/**
 * Get weekly post counts for a restaurant, grouped by platform and post type.
 * Counts posts created in the current ISO week (Mon-Sun).
 * Unwinds the platforms array so each platform gets its own count.
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
      { $unwind: '$platforms' },
      { $group: { _id: { type: '$type', platform: '$platforms' }, count: { $sum: 1 } } },
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
      { $unwind: '$platforms' },
      { $group: { _id: { type: '$type', platform: '$platforms' }, count: { $sum: 1 } } },
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
