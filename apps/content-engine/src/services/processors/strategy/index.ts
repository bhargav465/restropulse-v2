/**
 * Strategy Processor
 *
 * processPendingCycles: cycles in PENDING_GENERATION get a draft summary +
 * plannedPosts + focus from the content generator, then advance to PENDING_APPROVAL.
 *
 * Activation (APPROVED -> ACTIVE) is handled by the rolling-window processor
 * once the cycle's startDate enters the 48h window.
 */

import {
  getStrategyCyclesCollection,
  getContentStrategiesCollection,
  findRestaurantById,
} from '@restropulse/db';
import { createLogger } from '@restropulse/telemetry/server';
import type { PlannedSlot } from '@restropulse/shared';
import { getContentGenerator, ContentGenerationError } from '../../content-generator/index.js';
import { deriveCycleSlots } from '../rolling-window/slots.js';

const logger = createLogger('content-engine:strategy-processor');

export function parseDateOrFallback(value: unknown, fallback: Date): Date {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return new Date(fallback);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date(fallback);
  }

  return parsed;
}

export function parseBestTime(value: unknown): { hours: number; minutes: number } {
  if (typeof value !== 'string') {
    return { hours: 10, minutes: 0 };
  }

  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return { hours: 10, minutes: 0 };
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return { hours: 10, minutes: 0 };
  }

  return { hours, minutes };
}

/**
 * Draft new cycles by asking the generator for summary + plannedPosts + focus.
 * Looks for cycles with status PENDING_GENERATION.
 */
export async function processPendingCycles(): Promise<{ processed: number; failed: number }> {
  const cyclesCol = getStrategyCyclesCollection();
  const generator = getContentGenerator();
  const stats = { processed: 0, failed: 0 };

  const pendingCycles = await cyclesCol.find({ status: 'PENDING_GENERATION' }).toArray();

  if (pendingCycles.length === 0) {
    return stats;
  }

  logger.info(
    { count: pendingCycles.length, generator: generator.name },
    'Found cycles pending draft generation',
  );

  for (const cycleDoc of pendingCycles) {
    const cycleId = cycleDoc._id.toString();

    try {
      const restaurant = cycleDoc.restaurantId
        ? await findRestaurantById(cycleDoc.restaurantId)
        : null;

      const draft = await generator.draftCycle(
        {
          period: cycleDoc.period || '',
          strategyFocus: Array.isArray(cycleDoc.strategyFocus)
            ? (cycleDoc.strategyFocus as string[])
            : undefined,
        },
        {
          correlationId: cycleId,
          restaurantId: cycleDoc.restaurantId,
          restaurantName: restaurant?.name,
          restaurantProfile: restaurant ? {
            cuisine: restaurant.cuisine,
            description: restaurant.description,
            menu: restaurant.menu,
            chefSpecials: restaurant.chefSpecials,
            activeOffers: restaurant.activeOffers,
          } : undefined,
        },
      );

      const strategy = cycleDoc.restaurantId
        ? await getContentStrategiesCollection().findOne({ restaurantId: cycleDoc.restaurantId })
        : null;

      const slots = deriveCycleSlots({
        cycle: {
          startDate: cycleDoc.startDate,
          endDate: cycleDoc.endDate,
          plannedPosts: draft.plannedPosts,
        },
        strategy: strategy
          ? { postsPerWeek: strategy.postsPerWeek, bestTime: strategy.bestTime }
          : null,
      });

      const plannedSchedule: PlannedSlot[] = slots.map(slot => ({
        scheduledFor: slot.scheduledFor.toISOString(),
        category: slot.archetype,
        postType: slot.type,
        themes: slot.themes?.length ? slot.themes : draft.focus,
      }));

      const result = await cyclesCol.updateOne(
        { _id: cycleDoc._id, status: 'PENDING_GENERATION' },
        {
          $set: {
            status: 'PENDING_APPROVAL',
            summary: draft.summary,
            plannedPosts: draft.plannedPosts,
            focus: draft.focus,
            plannedSchedule,
            updatedAt: new Date(),
          },
        },
      );

      if (result.matchedCount === 0) {
        logger.warn({ cycleId }, 'Cycle no longer in PENDING_GENERATION; skipping advance');
        continue;
      }

      logger.info({ cycleId, generator: generator.name }, 'Drafted cycle');
      stats.processed++;
    } catch (error) {
      if (error instanceof ContentGenerationError) {
        logger.error({ cycleId, code: error.code, err: error }, 'Cycle draft failed');
      } else {
        logger.error({ cycleId, err: error }, 'Failed to draft cycle');
      }
      stats.failed++;
    }
  }

  return stats;
}

import type { IProcessor } from '../types.js';

export function createStrategyProcessor(cron: string): IProcessor {
  return { name: 'pending-cycles', cron, run: async () => { await processPendingCycles(); } };
}
