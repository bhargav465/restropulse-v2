/**
 * Cycle Sync Processor
 *
 * Ensures every restaurant with an active subscription has a StrategyCycle
 * for their current billing period. Runs on a cron schedule so cycles are
 * created reliably regardless of whether Razorpay webhooks fired or were missed.
 *
 * The billing period dates (currentPeriodStart / currentPeriodEnd) are stored
 * on the Subscription document by the webhook handlers, so this processor
 * only needs to read them — no Razorpay API calls required.
 */

import {
  ObjectId,
  getSubscriptionsCollection,
  getContentStrategiesCollection,
  getStrategyCyclesCollection,
} from '@restropulse/db';
import { createLogger } from '@restropulse/telemetry/server';

const logger = createLogger('content-engine:cycle-sync-processor');

const POSTS_PER_WEEK_BY_TIER: Record<string, number> = {
  starter: 5,
  growth: 7,
  premium: 14,
};

function postsPerWeekForSlug(planSlug: string): number {
  return POSTS_PER_WEEK_BY_TIER[planSlug.toLowerCase()] ?? 5;
}

function formatPeriod(start: Date, end: Date): string {
  const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) =>
    d.toLocaleDateString('en-US', opts);
  const startStr = fmt(start, { month: 'short', day: 'numeric' });
  const endStr   = fmt(end,   { month: 'short', day: 'numeric', year: 'numeric' });
  return `${startStr} – ${endStr}`;
  // e.g. "May 1 – May 31, 2026"
}

async function ensureCycleForRestaurant(
  restaurantId: string,
  planSlug: string,
  billingPeriod: { start: Date; end: Date },
): Promise<void> {
  const strategiesCol = getContentStrategiesCollection();
  const cyclesCol = getStrategyCyclesCollection();
  const postsPerWeek = postsPerWeekForSlug(planSlug);

  // Upsert ContentStrategy with current postsPerWeek
  const existingStrategy = await strategiesCol.findOne({ restaurantId });
  if (!existingStrategy) {
    await strategiesCol.insertOne({
      restaurantId,
      postsPerWeek,
      focusCategories: [],
      bestTime: '10:00',
      nextScheduledDate: '',
      theme: '',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);
    logger.info({ restaurantId, postsPerWeek }, 'Created new ContentStrategy');
  } else {
    await strategiesCol.updateOne(
      { restaurantId },
      { $set: { postsPerWeek, updatedAt: new Date() } },
    );
  }

  // Archive ACTIVE/APPROVED cycles from expired billing periods
  const archiveResult = await cyclesCol.updateMany(
    {
      restaurantId,
      status: { $in: ['ACTIVE', 'APPROVED'] },
      endDate: { $lt: billingPeriod.start.toISOString() },
    },
    { $set: { status: 'HISTORY', updatedAt: new Date() } },
  );
  if (archiveResult.modifiedCount > 0) {
    logger.info(
      { restaurantId, archivedCount: archiveResult.modifiedCount },
      'Archived expired cycles',
    );
  }

  // Idempotency check — ±3 day tolerance around billing period start
  const lowerBound = new Date(billingPeriod.start.getTime() - 3 * 86_400_000).toISOString();
  const upperBound = new Date(billingPeriod.start.getTime() + 3 * 86_400_000).toISOString();

  const existingCycle = await cyclesCol.findOne({
    restaurantId,
    startDate: { $gte: lowerBound, $lte: upperBound },
    status: { $ne: 'HISTORY' },
  });

  if (existingCycle) return; // already exists for this period

  // Create new cycle in PENDING_GENERATION status
  await cyclesCol.insertOne({
    _id: new ObjectId(),
    restaurantId,
    status: 'PENDING_GENERATION',
    period: formatPeriod(billingPeriod.start, billingPeriod.end),
    startDate: billingPeriod.start.toISOString(),
    endDate: billingPeriod.end.toISOString(),
    plannedPosts: [],
    focus: [],
    summary: '',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any);

  logger.info(
    { restaurantId, period: formatPeriod(billingPeriod.start, billingPeriod.end) },
    'Created new cycle for billing period',
  );
}

export async function processCycleSync(): Promise<{
  checked: number;
  created: number;
  failed: number;
}> {
  const stats = { checked: 0, created: 0, failed: 0 };

  const subscriptionsCol = getSubscriptionsCollection();
  const cyclesCol = getStrategyCyclesCollection();

  // Find all subscriptions with an active billing period stored
  const subscriptions = await subscriptionsCol.find({
    status: { $in: ['ACTIVE', 'AUTHENTICATED', 'PAST_DUE'] },
    endedAt: null,
    currentPeriodStart: { $exists: true, $ne: null },
    currentPeriodEnd:   { $exists: true, $ne: null },
  }).toArray();

  for (const sub of subscriptions) {
    const restaurantId = (sub as any).restaurantId as string;
    const planSlug     = (sub as any).planSnapshot?.slug as string | undefined;
    if (!restaurantId || !planSlug) continue;

    const start = new Date((sub as any).currentPeriodStart);
    const end   = new Date((sub as any).currentPeriodEnd);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) continue;

    stats.checked++;

    try {
      // Quick idempotency pre-check before acquiring any locks
      const lowerBound = new Date(start.getTime() - 3 * 86_400_000).toISOString();
      const upperBound = new Date(start.getTime() + 3 * 86_400_000).toISOString();
      const existing = await cyclesCol.findOne({
        restaurantId,
        startDate: { $gte: lowerBound, $lte: upperBound },
        status: { $ne: 'HISTORY' },
      });

      if (existing) continue; // cycle already present — nothing to do

      await ensureCycleForRestaurant(restaurantId, planSlug, { start, end });
      stats.created++;
    } catch (err) {
      logger.error({ err, restaurantId }, 'Failed to sync cycle for restaurant');
      stats.failed++;
    }
  }

  if (stats.created > 0 || stats.failed > 0) {
    logger.info(stats, 'Cycle sync complete');
  }

  return stats;
}

import type { IProcessor } from '../types.js';

export function createCycleSyncProcessor(cron: string): IProcessor {
  return { name: 'cycle-sync', cron, run: async () => { await processCycleSync(); } };
}
