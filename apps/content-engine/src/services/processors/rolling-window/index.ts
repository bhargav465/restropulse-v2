/**
 * Rolling-window processor.
 *
 * For each StrategyCycle that is ACTIVE, or APPROVED and within the activation
 * window, materialise post stubs (status: PENDING_CONTENT) for every slot whose
 * scheduledFor falls within the next ROLLING_WINDOW_HOURS.
 *
 * Activation rule: an APPROVED cycle flips to ACTIVE here (not via a separate
 * processor) once its startDate <= now AND endDate > now. Cycles approved for a
 * future date remain APPROVED until that date arrives.
 *
 * Archival rule: any ACTIVE or APPROVED cycle whose endDate has passed is
 * transitioned to HISTORY here rather than silently skipped.
 *
 * Idempotency: each stub is keyed by the compound { cycleId, scheduledFor, platform }
 * -- one slot fans out into one post per target platform, each upserted
 * independently so a platform added after a prior tick doesn't collide with
 * the platform(s) already materialised for that slot. The migration adds a
 * matching compound index; we use updateOne with $setOnInsert + upsert:true
 * so concurrent ticks never produce duplicates.
 */

import { randomUUID } from 'node:crypto';
import {
  getStrategyCyclesCollection,
  getPostsCollection,
  getContentStrategiesCollection,
  findRestaurantById,
} from '@restropulse/db';
import { ROLLING_WINDOW_HOURS as DEFAULT_ROLLING_WINDOW_HOURS, PLATFORM_POST_TYPES } from '@restropulse/shared';
import { createLogger } from '@restropulse/telemetry/server';
import { deriveCycleSlots, DEFAULT_PLATFORMS, type CycleSlot } from './slots.js';

const logger = createLogger('content-engine:rolling-window');
const MS_PER_HOUR = 60 * 60 * 1000;

export interface RollingWindowConfig {
  rollingWindowHours?: number;
}

export async function processRollingWindow(config: RollingWindowConfig = {}): Promise<{
  cyclesProcessed: number;
  slotsCreated: number;
  slotsSkipped: number;
  failed: number;
  activated: number;
  archived: number;
  autoContentDisabled: number;
}> {
  const cyclesCol = getStrategyCyclesCollection();
  const postsCol = getPostsCollection();
  const strategiesCol = getContentStrategiesCollection();

  const stats = { cyclesProcessed: 0, slotsCreated: 0, slotsSkipped: 0, failed: 0, activated: 0, archived: 0, autoContentDisabled: 0 };

  const rollingWindowHours = config.rollingWindowHours ?? DEFAULT_ROLLING_WINDOW_HOURS;
  const now = new Date();
  const horizon = new Date(now.getTime() + rollingWindowHours * MS_PER_HOUR);

  const candidateCycles = await cyclesCol
    .find({ status: { $in: ['ACTIVE', 'APPROVED'] } })
    .toArray();

  if (candidateCycles.length === 0) {
    return stats;
  }

  for (const cycle of candidateCycles) {
    const cycleId = cycle._id.toString();

    try {
      const endDate = new Date(cycle.endDate as string);

      // Archive cycles whose time period has ended, regardless of current status.
      if (endDate <= now) {
        await cyclesCol.updateOne(
          { _id: cycle._id, status: cycle.status },
          { $set: { status: 'HISTORY', updatedAt: now } },
        );
        logger.info({ cycleId, previousStatus: cycle.status }, 'Cycle archived to HISTORY');
        stats.archived++;
        continue;
      }

      if (cycle.status === 'APPROVED') {
        const startDate = new Date(cycle.startDate as string);

        if (startDate > now) {
          // Cycle hasn't started yet. Pre-generate post stubs if it starts
          // within the rolling window, but do NOT flip to ACTIVE — the cycle
          // is still "upcoming" and the status reflects that in the UI.
          if (startDate > horizon) {
            continue; // Starts more than ROLLING_WINDOW_HOURS away; check later.
          }
          // Falls through to slot materialisation below without status change.
        } else {
          // startDate <= now: cycle has started. Flip APPROVED -> ACTIVE.
          // Conditional update guards against concurrent ticks doing the same flip.
          const flipResult = await cyclesCol.updateOne(
            { _id: cycle._id, status: 'APPROVED' },
            { $set: { status: 'ACTIVE', updatedAt: now } },
          );

          if (flipResult.matchedCount === 0) {
            continue; // Another tick already activated this cycle.
          }

          logger.info({ cycleId }, 'Cycle activated by rolling window');
          stats.activated++;
        }
      }

      // Post-stub materialization is opt-in per restaurant (Restaurant.autoContentEnabled,
      // default false/absent). Cycle activation above always runs regardless -- gating the
      // whole processor would leave APPROVED cycles stuck forever and risk the deadline
      // processor marking them MISSED_DEADLINE. Only auto-generation of post stubs from
      // strategy slots is gated; user-initiated adhoc posts are unaffected (separate processor).
      const restaurant = cycle.restaurantId ? await findRestaurantById(cycle.restaurantId) : null;
      if (restaurant?.autoContentEnabled !== true) {
        stats.autoContentDisabled++;
        continue;
      }

      const strategy = cycle.restaurantId
        ? await strategiesCol.findOne({ restaurantId: cycle.restaurantId })
        : null;

      // Use pre-computed schedule stored at PENDING_APPROVAL time when available.
      // Falls back to live derivation for cycles that pre-date this field.
      const storedSchedule = (cycle as any).plannedSchedule as Array<{ scheduledFor: string; category: string; postType: string }> | undefined;

      const allSlots: CycleSlot[] = storedSchedule?.length
        ? storedSchedule.map(s => ({
            scheduledFor: new Date(s.scheduledFor),
            type: s.postType as CycleSlot['type'],
            platforms: DEFAULT_PLATFORMS,
            archetype: s.category,          // was: themes: [s.category]
            themes: (s as any).themes,      // carry stored themes if present
          }))
        : deriveCycleSlots({
            cycle: {
              startDate: cycle.startDate,
              endDate: cycle.endDate,
              plannedPosts: cycle.plannedPosts,
            },
            strategy: strategy ? { postsPerWeek: strategy.postsPerWeek, bestTime: strategy.bestTime } : null,
          });

      const dueSlots = allSlots.filter((slot: CycleSlot) => slot.scheduledFor <= horizon);

      let created = 0;
      let skipped = 0;

      for (const slot of dueSlots) {
        const scheduledForIso = slot.scheduledFor.toISOString();
        // One slot fans out into one post per target platform. groupId links
        // the platform-posts created together for this slot (traceability +
        // a single credit charge upstream where applicable); each platform is
        // upserted independently so a platform added on a later tick doesn't
        // collide with ones already materialised for this slot.
        const groupId = randomUUID();

        for (const platform of slot.platforms) {
          // Skip a (platform, type) combination that isn't supported (e.g.
          // FACEBOOK + STORY is currently disabled -- see PLATFORM_POST_TYPES).
          if (!PLATFORM_POST_TYPES[platform].includes(slot.type)) {
            logger.debug(
              { cycleId, platform, type: slot.type, scheduledFor: scheduledForIso },
              'Skipping unsupported platform/type combination for this slot',
            );
            continue;
          }

          const updateResult = await postsCol.updateOne(
            { cycleId, scheduledFor: scheduledForIso, platform },
            {
              $setOnInsert: {
                cycleId,
                scheduledFor: scheduledForIso,
                type: slot.type,
                platform,
                groupId,
                themes: slot.themes ?? [],          // additional context only, archetype excluded
                archetype: slot.archetype,          // was: slot.themes[0] ?? null
                status: 'PENDING_CONTENT',
                restaurantId: cycle.restaurantId ?? null,
                isAdhoc: false,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            },
            { upsert: true },
          );

          if (updateResult.upsertedCount === 1) {
            created++;
          } else {
            skipped++;
          }
        }
      }

      if (created > 0 || skipped > 0) {
        logger.info(
          { cycleId, slotsCreated: created, slotsSkipped: skipped },
          'Rolling window materialised slots',
        );
      }

      stats.cyclesProcessed++;
      stats.slotsCreated += created;
      stats.slotsSkipped += skipped;
    } catch (error) {
      logger.error({ cycleId, err: error }, 'Failed to process rolling-window cycle');
      stats.failed++;
    }
  }

  return stats;
}

import type { IProcessor } from '../types.js';

export function createRollingWindowProcessor(cron: string, config: RollingWindowConfig): IProcessor {
  return { name: 'rolling-window', cron, run: async () => { await processRollingWindow(config); } };
}
