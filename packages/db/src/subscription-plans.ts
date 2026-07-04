/**
 * @restropulse/db - Subscription Plans collection helpers
 */

import { getSubscriptionPlansCollection, toApiFormat, toApiFormatArray, toObjectId } from './connection.js';
import type { SubscriptionPlan } from '@restropulse/shared';

export async function findCurrentPlans(): Promise<SubscriptionPlan[]> {
  const col = getSubscriptionPlansCollection();
  const docs = await col.find({ isCurrentVersion: true }).sort({ 'pricing.monthly': 1 }).toArray();
  return toApiFormatArray(docs) as SubscriptionPlan[];
}

export async function findPlanBySlug(slug: string, version?: number): Promise<SubscriptionPlan | null> {
  const col = getSubscriptionPlansCollection();
  const filter: any = { slug };
  if (version !== undefined) {
    filter.version = version;
  } else {
    filter.isCurrentVersion = true;
  }
  const doc = await col.findOne(filter);
  return toApiFormat(doc) as SubscriptionPlan | null;
}

export async function findPlanById(id: string): Promise<SubscriptionPlan | null> {
  const col = getSubscriptionPlansCollection();
  const doc = await col.findOne({ _id: toObjectId(id) as any });
  return toApiFormat(doc) as SubscriptionPlan | null;
}

export async function createPlan(plan: Omit<SubscriptionPlan, 'id'>): Promise<SubscriptionPlan> {
  const col = getSubscriptionPlansCollection();
  const now = new Date();
  const result = await col.insertOne({
    ...plan,
    createdAt: now,
    updatedAt: now,
  });
  return { ...plan, id: result.insertedId.toString() } as SubscriptionPlan;
}

/**
 * Create a new version of an existing plan.
 * Marks the old version as non-current and inserts a new version.
 */
export async function versionPlan(
  slug: string,
  updates: Partial<Pick<SubscriptionPlan, 'limits' | 'pricing' | 'razorpayPlanIds' | 'features' | 'name'>>,
): Promise<SubscriptionPlan> {
  const col = getSubscriptionPlansCollection();

  // Find current version
  const current = await col.findOne({ slug, isCurrentVersion: true });
  if (!current) {
    throw new Error(`No current plan found for slug: ${slug}`);
  }

  // Mark old version as non-current
  await col.updateOne(
    { _id: current._id },
    { $set: { isCurrentVersion: false, updatedAt: new Date() } },
  );

  // Create new version
  const newVersion = current.version + 1;
  const now = new Date();
  const newPlan = {
    slug: current.slug,
    version: newVersion,
    isCurrentVersion: true,
    tier: current.tier,
    name: updates.name ?? current.name,
    limits: updates.limits ?? current.limits,
    pricing: updates.pricing ?? current.pricing,
    razorpayPlanIds: updates.razorpayPlanIds ?? current.razorpayPlanIds,
    features: updates.features ?? current.features,
    createdAt: now,
    updatedAt: now,
  };

  const result = await col.insertOne(newPlan as any);
  return { ...newPlan, id: result.insertedId.toString() } as SubscriptionPlan;
}
