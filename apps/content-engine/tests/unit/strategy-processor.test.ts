import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseBestTime, parseDateOrFallback } from '../../src/services/processors/strategy/index.js';

// Mocks for plannedSchedule themes test
vi.mock('@restropulse/telemetry/server', () => {
  const noopLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
    fatal: vi.fn(),
    trace: vi.fn(),
  };
  return { createLogger: vi.fn(() => noopLogger) };
});

vi.mock('@restropulse/db', () => ({
  getStrategyCyclesCollection: vi.fn(),
  getContentStrategiesCollection: vi.fn(),
  findRestaurantById: vi.fn().mockResolvedValue(null),
}));

import { getStrategyCyclesCollection, getContentStrategiesCollection } from '@restropulse/db';
import { processPendingCycles } from '../../src/services/processors/strategy/index.js';
import {
  setContentGenerator,
  resetContentGenerator,
  type IContentGenerator,
} from '../../src/services/content-generator/index.js';

const mockGetStrategyCyclesCollection = vi.mocked(getStrategyCyclesCollection);
const mockGetContentStrategiesCollection = vi.mocked(getContentStrategiesCollection);

function makeStubWithPlannedPosts(plannedPosts: Array<{ category: string; count: number; themes?: string[] }>): IContentGenerator {
  return {
    name: 'stub',
    draftCycle: async () => ({
      summary: 'Draft summary',
      plannedPosts,
      focus: ['fallback-focus', 'cycle-theme'],
    }),
    reviseCycle: async () => ({ summary: '', plannedPosts: [], focus: [] }),
    generatePost: async () => ({ caption: '', thumbnail: '' }),
    revisePost: async () => ({ caption: '', thumbnail: '' }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  resetContentGenerator();
});

describe('strategy-processor parsing helpers', () => {
  describe('parseDateOrFallback', () => {
    it('returns parsed date for a valid ISO string', () => {
      const fallback = new Date('2026-02-01T00:00:00.000Z');
      const parsed = parseDateOrFallback('2026-03-15T10:30:00.000Z', fallback);

      expect(Number.isNaN(parsed.getTime())).toBe(false);
      expect(parsed.toISOString()).toBe('2026-03-15T10:30:00.000Z');
    });

    it('returns fallback clone for invalid date input', () => {
      const fallback = new Date('2026-02-01T00:00:00.000Z');
      const parsed = parseDateOrFallback('not-a-date', fallback);

      expect(parsed.toISOString()).toBe('2026-02-01T00:00:00.000Z');
      expect(parsed).not.toBe(fallback);
    });

    it('returns fallback clone for non-string input', () => {
      const fallback = new Date('2026-02-01T00:00:00.000Z');
      const parsed = parseDateOrFallback(undefined, fallback);

      expect(parsed.toISOString()).toBe('2026-02-01T00:00:00.000Z');
      expect(parsed).not.toBe(fallback);
    });
  });

  describe('parseBestTime', () => {
    it('parses valid HH:mm values', () => {
      expect(parseBestTime('09:45')).toEqual({ hours: 9, minutes: 45 });
      expect(parseBestTime('23:59')).toEqual({ hours: 23, minutes: 59 });
    });

    it('falls back to 10:00 for malformed values', () => {
      expect(parseBestTime('bad-time')).toEqual({ hours: 10, minutes: 0 });
      expect(parseBestTime('12:3')).toEqual({ hours: 10, minutes: 0 });
      expect(parseBestTime('24:00')).toEqual({ hours: 10, minutes: 0 });
      expect(parseBestTime('11:60')).toEqual({ hours: 10, minutes: 0 });
    });

    it('falls back to 10:00 for non-string values', () => {
      expect(parseBestTime(undefined)).toEqual({ hours: 10, minutes: 0 });
      expect(parseBestTime(null)).toEqual({ hours: 10, minutes: 0 });
      expect(parseBestTime(930)).toEqual({ hours: 10, minutes: 0 });
    });
  });
});

describe('processPendingCycles plannedSchedule themes', () => {
  it('plannedSchedule slots carry per-post themes when LLM provides them', async () => {
    const fakeId = { toString: () => 'cycle-themes-1' };
    const fakeCycle = {
      _id: fakeId,
      period: 'June 2026',
      restaurantId: null,
      startDate: '2026-06-03T00:00:00.000Z',
      endDate: '2026-06-09T00:00:00.000Z',
      status: 'PENDING_GENERATION',
    };

    let capturedSetArg: Record<string, unknown> | undefined;
    const mockCyclesCol = {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([fakeCycle]),
      }),
      updateOne: vi.fn().mockImplementation((_filter: unknown, update: Record<string, unknown>) => {
        capturedSetArg = (update as Record<string, Record<string, unknown>>)['$set'];
        return Promise.resolve({ matchedCount: 1, modifiedCount: 1 });
      }),
    };
    const mockStrategiesCol = {
      findOne: vi.fn().mockResolvedValue(null),
    };

    mockGetStrategyCyclesCollection.mockReturnValue(mockCyclesCol as never);
    mockGetContentStrategiesCollection.mockReturnValue(mockStrategiesCol as never);
    setContentGenerator(
      makeStubWithPlannedPosts([
        { category: 'FESTIVAL_TIE_IN', count: 1, themes: ['Eid', 'biryani-tradition'] },
        { category: 'CRAVING_CUE', count: 1 },
      ]),
    );

    await processPendingCycles();

    expect(capturedSetArg).toBeDefined();
    const schedule = capturedSetArg!['plannedSchedule'] as Array<{ category: string; themes?: string[] }>;
    expect(schedule).toBeDefined();
    // FESTIVAL_TIE_IN slot: has LLM-provided themes
    expect(schedule[0].category).toBe('FESTIVAL_TIE_IN');
    expect(schedule[0].themes).toEqual(['Eid', 'biryani-tradition']);
    // CRAVING_CUE slot: no per-post themes, falls back to draft.focus
    expect(schedule[1].category).toBe('CRAVING_CUE');
    expect(schedule[1].themes).toEqual(['fallback-focus', 'cycle-theme']);
  });

  it('plannedSchedule slots fall back to draft.focus when LLM provides no themes', async () => {
    const fakeId = { toString: () => 'cycle-themes-2' };
    const fakeCycle = {
      _id: fakeId,
      period: 'June 2026',
      restaurantId: null,
      startDate: '2026-06-03T00:00:00.000Z',
      endDate: '2026-06-09T00:00:00.000Z',
      status: 'PENDING_GENERATION',
    };

    let capturedSetArg: Record<string, unknown> | undefined;
    const mockCyclesCol = {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([fakeCycle]),
      }),
      updateOne: vi.fn().mockImplementation((_filter: unknown, update: Record<string, unknown>) => {
        capturedSetArg = (update as Record<string, Record<string, unknown>>)['$set'];
        return Promise.resolve({ matchedCount: 1, modifiedCount: 1 });
      }),
    };
    const mockStrategiesCol = {
      findOne: vi.fn().mockResolvedValue(null),
    };

    mockGetStrategyCyclesCollection.mockReturnValue(mockCyclesCol as never);
    mockGetContentStrategiesCollection.mockReturnValue(mockStrategiesCol as never);
    setContentGenerator(
      makeStubWithPlannedPosts([
        { category: 'CHEFS_PICK', count: 1 },
        { category: 'CRAVING_CUE', count: 1 },
      ]),
    );

    await processPendingCycles();

    expect(capturedSetArg).toBeDefined();
    const schedule = capturedSetArg!['plannedSchedule'] as Array<{ category: string; themes?: string[] }>;
    for (const slot of schedule) {
      expect(slot.themes).toEqual(['fallback-focus', 'cycle-theme']);
    }
  });
});
