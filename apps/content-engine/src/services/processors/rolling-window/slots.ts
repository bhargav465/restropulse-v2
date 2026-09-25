/**
 * Rolling-window slot derivation (pure function).
 *
 * Given a StrategyCycle and its owning ContentStrategy, compute the deterministic
 * list of post slots: when each post should publish, what type it should be,
 * and what themes it rotates through. This is the same math that used to live
 * inside processApprovedCycles, lifted into a pure function so the rolling-window
 * processor can call it repeatedly with no side effects.
 *
 * Round-robin rules:
 *   - Iterate plannedPosts in order; each entry contributes `count` slots
 *     before moving on to the next.
 *   - `postType` defaults to IMAGE if unset.
 *   - Days between posts = floor(7 / postsPerWeek). Minimum 1.
 *   - bestTime (strategy.bestTime) sets the hour/minute of each slot.
 */

import type { PostType, Platform } from '@restropulse/shared';
import { parseBestTime, parseDateOrFallback } from '../strategy/index.js';

export interface PlannedPostEntry {
  category: string;
  count: number;
  postType?: PostType;
  themes?: string[];   // ADD
}

export interface DeriveSlotsInput {
  cycle: {
    startDate?: string | Date | null;
    endDate?: string | Date | null;
    plannedPosts?: PlannedPostEntry[] | null;
  };
  strategy?: {
    postsPerWeek?: number | null;
    bestTime?: string | null;
  } | null;
  defaultPlatforms?: Platform[];
}

export interface CycleSlot {
  scheduledFor: Date;
  type: PostType;
  platforms: Platform[];
  archetype: string;    // was themes[0] -- now explicit
  themes?: string[];    // additional context, does NOT contain the archetype
}

export const DEFAULT_PLATFORMS: Platform[] = (process.env.ENABLED_PLATFORMS ?? 'INSTAGRAM,FACEBOOK')
  .split(',')
  .map(p => p.trim())
  .filter((p): p is Platform => p === 'INSTAGRAM' || p === 'FACEBOOK');
const DEFAULT_POST_TYPE: PostType = 'IMAGE';

export function deriveCycleSlots(input: DeriveSlotsInput): CycleSlot[] {
  const plannedPosts = Array.isArray(input.cycle.plannedPosts)
    ? input.cycle.plannedPosts.filter((p) => p && p.count > 0)
    : [];

  if (plannedPosts.length === 0) {
    return [];
  }

  const postsPerWeekRaw =
    typeof input.strategy?.postsPerWeek === 'number' && input.strategy.postsPerWeek > 0
      ? input.strategy.postsPerWeek
      : 3;
  const daysBetweenPosts = Math.max(1, Math.floor(7 / postsPerWeekRaw));

  const bestTime = parseBestTime(input.strategy?.bestTime);
  const defaultPlatforms = input.defaultPlatforms?.length
    ? input.defaultPlatforms
    : DEFAULT_PLATFORMS;

  const now = new Date();
  const startDate = parseDateOrFallback(
    input.cycle.startDate instanceof Date
      ? input.cycle.startDate.toISOString()
      : input.cycle.startDate ?? null,
    now,
  );

  const slots: CycleSlot[] = [];
  let slotIndex = 0;

  for (const entry of plannedPosts) {
    const type: PostType = entry.postType ?? DEFAULT_POST_TYPE;

    for (let i = 0; i < entry.count; i++) {
      const scheduledFor = new Date(startDate);
      scheduledFor.setDate(scheduledFor.getDate() + slotIndex * daysBetweenPosts);
      scheduledFor.setHours(bestTime.hours, bestTime.minutes, 0, 0);

      slots.push({
        scheduledFor,
        type,
        platforms: defaultPlatforms,
        archetype: entry.category,
        themes: entry.themes,
      });

      slotIndex++;
    }
  }

  return slots;
}
