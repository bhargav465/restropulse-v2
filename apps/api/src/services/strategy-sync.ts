/**
 * Strategy Sync Service
 *
 * Ensures every restaurant with an active subscription has a StrategyCycle
 * for their current billing period. Called from subscription webhook handlers.
 *
 * Design principles:
 * - Idempotent: calling multiple times for the same billing period is safe
 * - Billing-period aligned: cycle dates = Razorpay billing period dates
 * - Archival: ACTIVE cycles from expired billing periods are moved to HISTORY
 */

import { ObjectId, getContentStrategiesCollection, getStrategyCyclesCollection } from '@restropulse/db';
import { createLogger } from '@restropulse/telemetry/server';

const log = createLogger('api:strategy-sync');

const POSTS_PER_WEEK_BY_TIER: Record<string, number> = {
    starter: 5,
    growth: 7,
    premium: 14,
};

function postsPerWeekForSlug(planSlug: string): number {
    return POSTS_PER_WEEK_BY_TIER[planSlug.toLowerCase()] ?? 5;
}

function formatPeriod(date: Date): string {
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export async function ensureCycleForRestaurant(
    restaurantId: string,
    planSlug: string,
    billingPeriod: { start: Date; end: Date },
): Promise<void> {
    const strategiesCol = getContentStrategiesCollection();
    const cyclesCol = getStrategyCyclesCollection();

    const postsPerWeek = postsPerWeekForSlug(planSlug);

    // Step 1: Find or create ContentStrategy for this restaurant
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
        log.info({ restaurantId, postsPerWeek }, 'strategy-sync: created new ContentStrategy');
    } else {
        await strategiesCol.updateOne(
            { restaurantId },
            { $set: { postsPerWeek, updatedAt: new Date() } },
        );
        log.info({ restaurantId, postsPerWeek }, 'strategy-sync: updated postsPerWeek on ContentStrategy');
    }

    // Step 2: Archive ACTIVE/APPROVED cycles whose endDate is before billing period start
    const archiveResult = await cyclesCol.updateMany(
        {
            restaurantId,
            status: { $in: ['ACTIVE', 'APPROVED'] },
            endDate: { $lt: billingPeriod.start.toISOString() },
        },
        { $set: { status: 'HISTORY', updatedAt: new Date() } },
    );
    if (archiveResult.modifiedCount > 0) {
        log.info(
            { restaurantId, archivedCount: archiveResult.modifiedCount },
            'strategy-sync: archived expired cycles',
        );
    }

    // Step 3: Idempotency check — look for any non-HISTORY cycle within ±3 days of billing period start
    const lowerBound = new Date(billingPeriod.start.getTime() - 3 * 86_400_000).toISOString();
    const upperBound = new Date(billingPeriod.start.getTime() + 3 * 86_400_000).toISOString();

    const existingCycle = await cyclesCol.findOne({
        restaurantId,
        startDate: { $gte: lowerBound, $lte: upperBound },
        status: { $ne: 'HISTORY' },
    });

    if (existingCycle) {
        log.info(
            { restaurantId, existingCycleId: existingCycle._id.toString() },
            'strategy-sync: cycle already exists for billing period, skipping',
        );
        return;
    }

    // Step 4: Create new cycle for the billing period
    await cyclesCol.insertOne({
        _id: new ObjectId(),
        restaurantId,
        status: 'PENDING_GENERATION',
        period: formatPeriod(billingPeriod.start),
        startDate: billingPeriod.start.toISOString(),
        endDate: billingPeriod.end.toISOString(),
        plannedPosts: [],
        focus: [],
        summary: '',
        createdAt: new Date(),
        updatedAt: new Date(),
    } as any);

    log.info(
        { restaurantId, period: formatPeriod(billingPeriod.start) },
        'strategy-sync: created new cycle for billing period',
    );
}
