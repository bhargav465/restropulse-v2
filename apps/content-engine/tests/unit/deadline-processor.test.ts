import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  getPostsCollection: vi.fn(),
  getStrategyCyclesCollection: vi.fn(),
}));

import { getPostsCollection, getStrategyCyclesCollection } from '@restropulse/db';
import {
  POST_APPROVAL_BUFFER_HOURS,
  CYCLE_APPROVAL_BUFFER_HOURS,
} from '@restropulse/shared';
import { processDeadlines } from '../../src/services/processors/deadline/index.js';

const mockGetPostsCollection = vi.mocked(getPostsCollection);
const mockGetStrategyCyclesCollection = vi.mocked(getStrategyCyclesCollection);

const MS_PER_HOUR = 60 * 60 * 1000;

function emptyCol() {
  return {
    find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    updateOne: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('processDeadlines -> posts', () => {
  it('advances a PENDING_APPROVAL post past its deadline to SCHEDULED', async () => {
    // scheduledFor is 1h from now, buffer is 2h, so deadline was 1h ago => past.
    const scheduledFor = new Date(Date.now() + 1 * MS_PER_HOUR).toISOString();
    const postDoc = {
      _id: { toString: () => 'post-past' },
      scheduledFor,
      status: 'PENDING_APPROVAL',
    };
    const postsCol = {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([postDoc]) }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    };

    mockGetPostsCollection.mockReturnValue(postsCol as never);
    mockGetStrategyCyclesCollection.mockReturnValue(emptyCol() as never);

    const result = await processDeadlines();

    expect(result.postsAdvanced).toBe(1);
    expect(result.failed).toBe(0);
    const [filter, update] = postsCol.updateOne.mock.calls[0];
    expect(filter).toMatchObject({
      status: { $in: ['PENDING_APPROVAL', 'CHANGES_REQUESTED'] },
    });
    expect(update.$set.status).toBe('SCHEDULED');
  });

  it('leaves a PENDING_APPROVAL post before its deadline untouched', async () => {
    // scheduledFor far in the future -> deadline is far in the future too.
    const scheduledFor = new Date(Date.now() + 10 * 24 * MS_PER_HOUR).toISOString();
    const postDoc = {
      _id: { toString: () => 'post-future' },
      scheduledFor,
      status: 'PENDING_APPROVAL',
    };
    const postsCol = {
      // DB pre-filter would exclude this doc; simulate that by returning an empty array.
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      updateOne: vi.fn(),
    };

    mockGetPostsCollection.mockReturnValue(postsCol as never);
    mockGetStrategyCyclesCollection.mockReturnValue(emptyCol() as never);

    const result = await processDeadlines();

    expect(result.postsAdvanced).toBe(0);
    expect(postsCol.updateOne).not.toHaveBeenCalled();
    // Sanity: buffer/constant imported (keeps linters happy).
    expect(POST_APPROVAL_BUFFER_HOURS).toBeGreaterThan(0);
    expect(postDoc.status).toBe('PENDING_APPROVAL');
  });

  it('advances a CHANGES_REQUESTED post past its deadline to SCHEDULED', async () => {
    const scheduledFor = new Date(Date.now() + 1 * MS_PER_HOUR).toISOString();
    const postDoc = {
      _id: { toString: () => 'post-cr' },
      scheduledFor,
      status: 'CHANGES_REQUESTED',
    };
    const postsCol = {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([postDoc]) }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    };

    mockGetPostsCollection.mockReturnValue(postsCol as never);
    mockGetStrategyCyclesCollection.mockReturnValue(emptyCol() as never);

    const result = await processDeadlines();

    expect(result.postsAdvanced).toBe(1);
    const [, update] = postsCol.updateOne.mock.calls[0];
    expect(update.$set.status).toBe('SCHEDULED');
  });

  it('skips candidate that clears DB pre-filter but is still before deadline (JS guard)', async () => {
    // Buffer is 2h; scheduledFor is 3h from now -> deadline is 1h from now (future, not past).
    // DB pre-filter (<= now + 2h) excludes in prod, but simulate a borderline pass here.
    const scheduledFor = new Date(Date.now() + 3 * MS_PER_HOUR).toISOString();
    const postDoc = {
      _id: { toString: () => 'post-borderline' },
      scheduledFor,
      status: 'PENDING_APPROVAL',
    };
    const postsCol = {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([postDoc]) }),
      updateOne: vi.fn(),
    };

    mockGetPostsCollection.mockReturnValue(postsCol as never);
    mockGetStrategyCyclesCollection.mockReturnValue(emptyCol() as never);

    const result = await processDeadlines();

    expect(result.postsAdvanced).toBe(0);
    expect(result.failed).toBe(0);
    expect(postsCol.updateOne).not.toHaveBeenCalled();
  });

  it('counts failures when post updateOne throws', async () => {
    const scheduledFor = new Date(Date.now() + 1 * MS_PER_HOUR).toISOString();
    const postDoc = {
      _id: { toString: () => 'post-bad' },
      scheduledFor,
      status: 'PENDING_APPROVAL',
    };
    const postsCol = {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([postDoc]) }),
      updateOne: vi.fn().mockRejectedValue(new Error('db down')),
    };

    mockGetPostsCollection.mockReturnValue(postsCol as never);
    mockGetStrategyCyclesCollection.mockReturnValue(emptyCol() as never);

    const result = await processDeadlines();

    expect(result.postsAdvanced).toBe(0);
    expect(result.failed).toBe(1);
  });

  it('does not advance when a concurrent writer already changed status (matchedCount=0)', async () => {
    const scheduledFor = new Date(Date.now() + 1 * MS_PER_HOUR).toISOString();
    const postDoc = {
      _id: { toString: () => 'post-race' },
      scheduledFor,
      status: 'PENDING_APPROVAL',
    };
    const postsCol = {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([postDoc]) }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 }),
    };

    mockGetPostsCollection.mockReturnValue(postsCol as never);
    mockGetStrategyCyclesCollection.mockReturnValue(emptyCol() as never);

    const result = await processDeadlines();

    expect(result.postsAdvanced).toBe(0);
    expect(result.failed).toBe(0);
  });
});

describe('processDeadlines -> cycles', () => {
  it('advances a PENDING_APPROVAL cycle past its deadline to APPROVED', async () => {
    // startDate 1h from now, buffer 48h -> deadline was 47h ago => past.
    const startDate = new Date(Date.now() + 1 * MS_PER_HOUR).toISOString();
    const cycleDoc = {
      _id: { toString: () => 'cycle-past' },
      startDate,
      status: 'PENDING_APPROVAL',
    };
    const cyclesCol = {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([cycleDoc]) }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    };

    mockGetPostsCollection.mockReturnValue(emptyCol() as never);
    mockGetStrategyCyclesCollection.mockReturnValue(cyclesCol as never);

    const result = await processDeadlines();

    expect(result.cyclesAdvanced).toBe(1);
    expect(result.failed).toBe(0);
    const [filter, update] = cyclesCol.updateOne.mock.calls[0];
    expect(filter).toMatchObject({
      status: { $in: ['PENDING_APPROVAL', 'CHANGES_REQUESTED'] },
    });
    expect(update.$set.status).toBe('APPROVED');
  });

  it('advances a CHANGES_REQUESTED cycle past its deadline to APPROVED', async () => {
    const startDate = new Date(Date.now() + 1 * MS_PER_HOUR).toISOString();
    const cycleDoc = {
      _id: { toString: () => 'cycle-cr' },
      startDate,
      status: 'CHANGES_REQUESTED',
    };
    const cyclesCol = {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([cycleDoc]) }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    };

    mockGetPostsCollection.mockReturnValue(emptyCol() as never);
    mockGetStrategyCyclesCollection.mockReturnValue(cyclesCol as never);

    const result = await processDeadlines();

    expect(result.cyclesAdvanced).toBe(1);
    const [, update] = cyclesCol.updateOne.mock.calls[0];
    expect(update.$set.status).toBe('APPROVED');
  });

  it('leaves a pre-deadline cycle untouched (DB pre-filter excludes)', async () => {
    const cyclesCol = {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      updateOne: vi.fn(),
    };

    mockGetPostsCollection.mockReturnValue(emptyCol() as never);
    mockGetStrategyCyclesCollection.mockReturnValue(cyclesCol as never);

    const result = await processDeadlines();

    expect(result.cyclesAdvanced).toBe(0);
    expect(cyclesCol.updateOne).not.toHaveBeenCalled();
    expect(CYCLE_APPROVAL_BUFFER_HOURS).toBe(72);
  });

  it('skips cycle that clears pre-filter but is still before deadline (JS guard)', async () => {
    // Buffer is 72h; startDate is 74h from now -> deadline is 2h from now (future).
    const startDate = new Date(Date.now() + 74 * MS_PER_HOUR).toISOString();
    const cycleDoc = {
      _id: { toString: () => 'cycle-borderline' },
      startDate,
      status: 'PENDING_APPROVAL',
    };
    const cyclesCol = {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([cycleDoc]) }),
      updateOne: vi.fn(),
    };

    mockGetPostsCollection.mockReturnValue(emptyCol() as never);
    mockGetStrategyCyclesCollection.mockReturnValue(cyclesCol as never);

    const result = await processDeadlines();

    expect(result.cyclesAdvanced).toBe(0);
    expect(result.failed).toBe(0);
    expect(cyclesCol.updateOne).not.toHaveBeenCalled();
  });

  it('skips cycle advance when concurrent writer already changed status (matchedCount=0)', async () => {
    const startDate = new Date(Date.now() + 1 * MS_PER_HOUR).toISOString();
    const cycleDoc = {
      _id: { toString: () => 'cycle-race' },
      startDate,
      status: 'PENDING_APPROVAL',
    };
    const cyclesCol = {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([cycleDoc]) }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 }),
    };

    mockGetPostsCollection.mockReturnValue(emptyCol() as never);
    mockGetStrategyCyclesCollection.mockReturnValue(cyclesCol as never);

    const result = await processDeadlines();

    expect(result.cyclesAdvanced).toBe(0);
    expect(result.failed).toBe(0);
  });

  it('counts failures when updateOne throws', async () => {
    const startDate = new Date(Date.now() + 1 * MS_PER_HOUR).toISOString();
    const cycleDoc = {
      _id: { toString: () => 'cycle-bad' },
      startDate,
      status: 'PENDING_APPROVAL',
    };
    const cyclesCol = {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([cycleDoc]) }),
      updateOne: vi.fn().mockRejectedValue(new Error('db down')),
    };

    mockGetPostsCollection.mockReturnValue(emptyCol() as never);
    mockGetStrategyCyclesCollection.mockReturnValue(cyclesCol as never);

    const result = await processDeadlines();

    expect(result.cyclesAdvanced).toBe(0);
    expect(result.failed).toBe(1);
  });
});
