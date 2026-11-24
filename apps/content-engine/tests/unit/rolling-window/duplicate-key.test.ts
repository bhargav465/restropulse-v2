import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => {
  const noop = () => {};
  const noopLogger = { info: noop, warn: noop, error: noop, debug: noop, fatal: noop, trace: noop, child: () => noopLogger };
  return { createLogger: vi.fn(() => noopLogger) };
});

const updateOne = vi.fn();
const cycle = {
  _id: { toString: () => 'cycle-1' },
  status: 'ACTIVE',
  restaurantId: 'r1',
  startDate: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
  endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
  plannedPosts: [{ category: 'Food & Menu', count: 1 }],
};

vi.mock('@restropulse/db', () => ({
  getStrategyCyclesCollection: () => ({ find: () => ({ toArray: async () => [cycle] }), updateOne: vi.fn() }),
  getPostsCollection: () => ({ updateOne }),
  getContentStrategiesCollection: () => ({ findOne: async () => ({ postsPerWeek: 7, bestTime: '10:00' }) }),
  findRestaurantById: async () => ({ autoContentEnabled: true }),
}));

const { processRollingWindow, isDuplicateKeyError } = await import(
  '../../../src/services/processors/rolling-window/index.js'
);

function duplicateKeyError(): Error {
  return Object.assign(new Error('E11000 duplicate key error collection: posts'), { code: 11000 });
}

describe('rolling-window duplicate-key handling', () => {
  beforeEach(() => {
    updateOne.mockReset();
  });

  it('recognises only E11000 as a duplicate-key error', () => {
    expect(isDuplicateKeyError(duplicateKeyError())).toBe(true);
    expect(isDuplicateKeyError(Object.assign(new Error('x'), { code: 112 }))).toBe(false);
    expect(isDuplicateKeyError(new Error('plain'))).toBe(false);
    expect(isDuplicateKeyError(null)).toBe(false);
    expect(isDuplicateKeyError('E11000')).toBe(false);
  });

  it('counts a lost insert race as skipped, not failed, and keeps going', async () => {
    updateOne
      .mockImplementationOnce(async () => {
        throw duplicateKeyError();
      })
      .mockResolvedValue({ upsertedCount: 1 });

    const result = await processRollingWindow();

    expect(result.failed).toBe(0);
    expect(result.slotsSkipped).toBe(1);
    expect(result.slotsCreated).toBe(updateOne.mock.calls.length - 1);
    expect(result.cyclesProcessed).toBe(1);
  });

  it('still fails the cycle on any other write error', async () => {
    updateOne.mockImplementation(async () => {
      throw Object.assign(new Error('not primary'), { code: 10107 });
    });

    const result = await processRollingWindow();

    expect(result.failed).toBe(1);
    expect(result.cyclesProcessed).toBe(0);
  });
});
