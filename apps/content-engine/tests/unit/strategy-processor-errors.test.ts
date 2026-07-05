import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock telemetry
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

// Mock @restropulse/db so no real DB connection is needed
vi.mock('@restropulse/db', () => ({
  getStrategyCyclesCollection: vi.fn(),
  findRestaurantById: vi.fn().mockResolvedValue(null),
}));

import { getStrategyCyclesCollection } from '@restropulse/db';
import {
  processPendingCycles,
} from '../../src/services/processors/strategy/index.js';
import {
  setContentGenerator,
  resetContentGenerator,
  ContentGenerationError,
  type IContentGenerator,
} from '../../src/services/content-generator/index.js';

const mockGetStrategyCyclesCollection = vi.mocked(getStrategyCyclesCollection);

function makeStub(overrides: Partial<IContentGenerator> = {}): IContentGenerator {
  return {
    name: 'stub',
    draftCycle: async () => ({
      summary: 'Draft summary',
      plannedPosts: [{ category: 'Food & Menu', count: 2 }],
      focus: ['Food & Menu'],
    }),
    reviseCycle: async () => ({ summary: '', plannedPosts: [], focus: [] }),
    generatePost: async () => ({ caption: '', thumbnail: '' }),
    revisePost: async () => ({ caption: '', thumbnail: '' }),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  resetContentGenerator();
});

// ---------------------------------------------------------------------------
// processPendingCycles error paths
// ---------------------------------------------------------------------------
describe('processPendingCycles error paths', () => {
  it('increments failed counter when draftCycle throws a plain Error', async () => {
    const fakeId = { toString: () => 'cycle-d1' };
    const fakeCycle = { _id: fakeId, period: 'March 2026' };

    const mockCyclesCol = {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([fakeCycle]),
      }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    };

    mockGetStrategyCyclesCollection.mockReturnValue(mockCyclesCol as never);
    setContentGenerator(
      makeStub({
        draftCycle: async () => {
          throw new Error('AI service down');
        },
      }),
    );

    const result = await processPendingCycles();

    expect(result).toEqual({ processed: 0, failed: 1 });
  });

  it('increments failed counter when draftCycle throws ContentGenerationError(INVALID_INPUT)', async () => {
    const fakeId = { toString: () => 'cycle-d2' };
    const fakeCycle = { _id: fakeId, period: 'March 2026' };

    const mockCyclesCol = {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([fakeCycle]),
      }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    };

    mockGetStrategyCyclesCollection.mockReturnValue(mockCyclesCol as never);
    setContentGenerator(
      makeStub({
        draftCycle: async () => {
          throw new ContentGenerationError('INVALID_INPUT', 'period required');
        },
      }),
    );

    const result = await processPendingCycles();

    expect(result).toEqual({ processed: 0, failed: 1 });
  });

  it('increments failed counter when cyclesCol.updateOne throws after draft succeeds', async () => {
    const fakeId = { toString: () => 'cycle-d3' };
    const fakeCycle = { _id: fakeId, period: 'April 2026' };

    const mockCyclesCol = {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([fakeCycle]),
      }),
      updateOne: vi.fn().mockRejectedValue(new Error('DB write failed')),
    };

    mockGetStrategyCyclesCollection.mockReturnValue(mockCyclesCol as never);
    setContentGenerator(makeStub());

    const result = await processPendingCycles();

    expect(result).toEqual({ processed: 0, failed: 1 });
  });

  it('processes successes and failures in a mixed batch', async () => {
    const goodCycle = { _id: { toString: () => 'cycle-ok' }, period: 'April 2026' };
    const badCycle = { _id: { toString: () => 'cycle-fail' }, period: 'May 2026' };

    const mockCyclesCol = {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([goodCycle, badCycle]),
      }),
      updateOne: vi
        .fn()
        .mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 })
        .mockRejectedValueOnce(new Error('DB error')),
    };

    mockGetStrategyCyclesCollection.mockReturnValue(mockCyclesCol as never);
    setContentGenerator(makeStub());

    const result = await processPendingCycles();

    expect(result).toEqual({ processed: 1, failed: 1 });
  });

  it('skips advance when a concurrent writer already moved cycle out of PENDING_GENERATION', async () => {
    const fakeCycle = { _id: { toString: () => 'cycle-race' }, period: 'June 2026' };

    const mockCyclesCol = {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([fakeCycle]),
      }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 }),
    };

    mockGetStrategyCyclesCollection.mockReturnValue(mockCyclesCol as never);
    setContentGenerator(makeStub());

    const result = await processPendingCycles();

    expect(result).toEqual({ processed: 0, failed: 0 });
  });
});

