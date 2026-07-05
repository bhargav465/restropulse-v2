import { describe, it, expect } from 'vitest';
import { deriveCycleSlots } from '../../../src/services/processors/rolling-window/slots.js';

describe('deriveCycleSlots', () => {
  it('returns empty array when plannedPosts is missing or empty', () => {
    expect(
      deriveCycleSlots({
        cycle: { startDate: '2026-03-01T00:00:00.000Z', plannedPosts: [] },
      }),
    ).toEqual([]);

    expect(
      deriveCycleSlots({
        cycle: { startDate: '2026-03-01T00:00:00.000Z' },
      }),
    ).toEqual([]);
  });

  it('is deterministic: same inputs always produce the same slots', () => {
    const a = deriveCycleSlots({
      cycle: {
        startDate: '2026-03-01T00:00:00.000Z',
        plannedPosts: [{ category: 'Food & Menu', count: 2 }],
      },
      strategy: { postsPerWeek: 3, bestTime: '10:00' },
    });
    const b = deriveCycleSlots({
      cycle: {
        startDate: '2026-03-01T00:00:00.000Z',
        plannedPosts: [{ category: 'Food & Menu', count: 2 }],
      },
      strategy: { postsPerWeek: 3, bestTime: '10:00' },
    });

    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i].scheduledFor.toISOString()).toBe(b[i].scheduledFor.toISOString());
      expect(a[i].type).toBe(b[i].type);
      expect(a[i].archetype).toEqual(b[i].archetype);
    }
  });

  it('honours daysBetweenPosts math for postsPerWeek = 3 (every 2 days)', () => {
    const slots = deriveCycleSlots({
      cycle: {
        startDate: '2026-03-01T00:00:00.000Z',
        plannedPosts: [{ category: 'Food & Menu', count: 3 }],
      },
      strategy: { postsPerWeek: 3, bestTime: '10:00' },
    });

    expect(slots).toHaveLength(3);
    const day0 = slots[0].scheduledFor;
    const day1 = slots[1].scheduledFor;
    const day2 = slots[2].scheduledFor;
    const diff1 = (day1.getTime() - day0.getTime()) / (1000 * 60 * 60 * 24);
    const diff2 = (day2.getTime() - day1.getTime()) / (1000 * 60 * 60 * 24);
    expect(diff1).toBe(2);
    expect(diff2).toBe(2);
  });

  it('honours daysBetweenPosts math for postsPerWeek = 7 (every 1 day)', () => {
    const slots = deriveCycleSlots({
      cycle: {
        startDate: '2026-03-01T00:00:00.000Z',
        plannedPosts: [{ category: 'Food & Menu', count: 7 }],
      },
      strategy: { postsPerWeek: 7, bestTime: '10:00' },
    });

    expect(slots).toHaveLength(7);
    for (let i = 1; i < slots.length; i++) {
      const diff =
        (slots[i].scheduledFor.getTime() - slots[i - 1].scheduledFor.getTime()) /
        (1000 * 60 * 60 * 24);
      expect(diff).toBe(1);
    }
  });

  it('clamps to at least 1 day between posts when postsPerWeek > 7', () => {
    const slots = deriveCycleSlots({
      cycle: {
        startDate: '2026-03-01T00:00:00.000Z',
        plannedPosts: [{ category: 'Food & Menu', count: 3 }],
      },
      strategy: { postsPerWeek: 14, bestTime: '10:00' },
    });

    expect(slots).toHaveLength(3);
    const diff =
      (slots[1].scheduledFor.getTime() - slots[0].scheduledFor.getTime()) /
      (1000 * 60 * 60 * 24);
    expect(diff).toBe(1);
  });

  it('defaults postsPerWeek to 3 (every 2 days) when strategy has no value', () => {
    const slots = deriveCycleSlots({
      cycle: {
        startDate: '2026-03-01T00:00:00.000Z',
        plannedPosts: [{ category: 'Food & Menu', count: 2 }],
      },
    });

    const diff =
      (slots[1].scheduledFor.getTime() - slots[0].scheduledFor.getTime()) /
      (1000 * 60 * 60 * 24);
    expect(diff).toBe(2);
  });

  it('iterates plannedPosts in order, emitting `count` slots per entry before moving on', () => {
    const slots = deriveCycleSlots({
      cycle: {
        startDate: '2026-03-01T00:00:00.000Z',
        plannedPosts: [
          { category: 'Food & Menu', count: 2 },
          { category: 'Offers', count: 1 },
        ],
      },
      strategy: { postsPerWeek: 7, bestTime: '09:00' },
    });

    expect(slots.map((s) => s.archetype)).toEqual(['Food & Menu', 'Food & Menu', 'Offers']);
  });

  it('applies bestTime hour/minute to every slot', () => {
    const slots = deriveCycleSlots({
      cycle: {
        startDate: '2026-03-01T00:00:00.000Z',
        plannedPosts: [{ category: 'Food & Menu', count: 3 }],
      },
      strategy: { postsPerWeek: 3, bestTime: '09:15' },
    });

    for (const slot of slots) {
      expect(slot.scheduledFor.getHours()).toBe(9);
      expect(slot.scheduledFor.getMinutes()).toBe(15);
    }
  });

  it('defaults bestTime to 10:00 when strategy.bestTime is malformed', () => {
    const slots = deriveCycleSlots({
      cycle: {
        startDate: '2026-03-01T00:00:00.000Z',
        plannedPosts: [{ category: 'Food & Menu', count: 1 }],
      },
      strategy: { postsPerWeek: 3, bestTime: 'bad' },
    });

    expect(slots[0].scheduledFor.getHours()).toBe(10);
    expect(slots[0].scheduledFor.getMinutes()).toBe(0);
  });

  it('honours entry.postType when provided, defaulting to IMAGE', () => {
    const slots = deriveCycleSlots({
      cycle: {
        startDate: '2026-03-01T00:00:00.000Z',
        plannedPosts: [
          { category: 'Food & Menu', count: 1, postType: 'CAROUSEL' },
          { category: 'Chef Specials', count: 1 },
        ],
      },
      strategy: { postsPerWeek: 3, bestTime: '10:00' },
    });

    expect(slots[0].type).toBe('CAROUSEL');
    expect(slots[1].type).toBe('IMAGE');
  });

  it('uses default platforms [INSTAGRAM, FACEBOOK] when none provided', () => {
    const slots = deriveCycleSlots({
      cycle: {
        startDate: '2026-03-01T00:00:00.000Z',
        plannedPosts: [{ category: 'Food & Menu', count: 1 }],
      },
      strategy: { postsPerWeek: 3, bestTime: '10:00' },
    });

    expect(slots[0].platforms).toEqual(['INSTAGRAM', 'FACEBOOK']);
  });

  it('honours explicit defaultPlatforms override', () => {
    const slots = deriveCycleSlots({
      cycle: {
        startDate: '2026-03-01T00:00:00.000Z',
        plannedPosts: [{ category: 'Food & Menu', count: 1 }],
      },
      strategy: { postsPerWeek: 3, bestTime: '10:00' },
      defaultPlatforms: ['INSTAGRAM'],
    });

    expect(slots[0].platforms).toEqual(['INSTAGRAM']);
  });

  it('filters out plannedPosts entries with count <= 0', () => {
    const slots = deriveCycleSlots({
      cycle: {
        startDate: '2026-03-01T00:00:00.000Z',
        plannedPosts: [
          { category: 'Food & Menu', count: 2 },
          { category: 'Drop me', count: 0 },
        ],
      },
      strategy: { postsPerWeek: 7, bestTime: '10:00' },
    });

    expect(slots).toHaveLength(2);
    expect(slots.every((s) => s.archetype === 'Food & Menu')).toBe(true);
  });

  it('carries themes from PlannedPostEntry into CycleSlot', () => {
    const slots = deriveCycleSlots({
      cycle: {
        startDate: new Date('2026-06-03').toISOString(),
        endDate: new Date('2026-06-09').toISOString(),
        plannedPosts: [
          { category: 'FESTIVAL_TIE_IN', count: 1, themes: ['Eid', 'biryani-tradition'] },
          { category: 'CRAVING_CUE', count: 1 },
        ],
      },
      strategy: { postsPerWeek: 5, bestTime: '10:00' },
    });

    expect(slots[0].archetype).toBe('FESTIVAL_TIE_IN');
    expect(slots[0].themes).toEqual(['Eid', 'biryani-tradition']);

    expect(slots[1].archetype).toBe('CRAVING_CUE');
    expect(slots[1].themes).toBeUndefined();
  });
});
