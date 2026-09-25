import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
  findRestaurantById: vi.fn().mockResolvedValue(null),
}));

import { getPostsCollection, getStrategyCyclesCollection } from '@restropulse/db';
import { processRevisions } from '../../src/services/processors/revision/index.js';
import {
  setContentGenerator,
  resetContentGenerator,
  ContentGenerationError,
  type IContentGenerator,
} from '../../src/services/content-generator/index.js';

const mockGetPostsCollection = vi.mocked(getPostsCollection);
const mockGetStrategyCyclesCollection = vi.mocked(getStrategyCyclesCollection);

function emptyCol() {
  return {
    find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    updateOne: vi.fn(),
  };
}

function makeStub(overrides: Partial<IContentGenerator> = {}): IContentGenerator {
  return {
    name: 'stub',
    draftCycle: async () => ({ summary: '', plannedPosts: [], focus: [] }),
    reviseCycle: async () => ({
      summary: 'Revised',
      plannedPosts: [{ category: 'Food & Menu', count: 1 }],
      focus: ['Food & Menu'],
    }),
    generatePost: async () => ({ caption: '', thumbnail: '' }),
    revisePost: async () => ({ caption: 'Revised caption', thumbnail: 'http://x/y.jpg' }),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  resetContentGenerator();
});

describe('processRevisions -> post revision', () => {
  it('revises post, flips to PENDING_APPROVAL, stamps resolution', async () => {
    const postDoc = {
      _id: { toString: () => 'post-1' },
      type: 'IMAGE',
      platforms: ['INSTAGRAM'],
      caption: 'old',
      feedback: JSON.stringify({ tags: ['caption'], details: {}, note: 'make it punchier' }),
      status: 'CHANGES_REQUESTED',
    };
    const postsCol = {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([postDoc]) }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    };

    mockGetPostsCollection.mockReturnValue(postsCol as never);
    mockGetStrategyCyclesCollection.mockReturnValue(emptyCol() as never);
    setContentGenerator(makeStub());

    const result = await processRevisions();

    expect(result.postsRevised).toBe(1);
    expect(result.failed).toBe(0);
    const [filter, update] = postsCol.updateOne.mock.calls[0];
    expect(filter).toMatchObject({ status: 'CHANGES_REQUESTED' });
    expect(update.$set.status).toBe('PENDING_APPROVAL');
    expect(update.$set.caption).toBe('Revised caption');
    const parsedFeedback = JSON.parse(update.$set.feedback);
    expect(parsedFeedback.resolution).toContain('make it punchier');
  });

  it('skips posts that already have a resolution (second-pass idempotency)', async () => {
    const postDoc = {
      _id: { toString: () => 'post-2' },
      type: 'IMAGE',
      platforms: ['INSTAGRAM'],
      caption: 'old',
      feedback: JSON.stringify({
        tags: [],
        details: {},
        note: 'already addressed',
        resolution: 'already done',
      }),
      status: 'CHANGES_REQUESTED',
    };
    const postsCol = {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([postDoc]) }),
      updateOne: vi.fn(),
    };

    mockGetPostsCollection.mockReturnValue(postsCol as never);
    mockGetStrategyCyclesCollection.mockReturnValue(emptyCol() as never);
    setContentGenerator(makeStub());

    const result = await processRevisions();

    expect(result.postsRevised).toBe(0);
    expect(postsCol.updateOne).not.toHaveBeenCalled();
  });

  it('counts failure and leaves post untouched when generator throws ContentGenerationError', async () => {
    const postDoc = {
      _id: { toString: () => 'post-3' },
      type: 'IMAGE',
      platforms: ['INSTAGRAM'],
      caption: 'old',
      feedback: JSON.stringify({ tags: [], details: {}, note: 'x' }),
      status: 'CHANGES_REQUESTED',
    };
    const postsCol = {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([postDoc]) }),
      updateOne: vi.fn(),
    };

    mockGetPostsCollection.mockReturnValue(postsCol as never);
    mockGetStrategyCyclesCollection.mockReturnValue(emptyCol() as never);
    setContentGenerator(
      makeStub({
        revisePost: async () => {
          throw new ContentGenerationError('RATE_LIMITED', 'slow');
        },
      }),
    );

    const result = await processRevisions();

    expect(result.postsRevised).toBe(0);
    expect(result.failed).toBe(1);
    expect(postsCol.updateOne).not.toHaveBeenCalled();
  });

  it('passes archetype from post document to revisePost', async () => {
    const revisePost = vi.fn().mockResolvedValue({ caption: 'Revised', thumbnail: '' });
    setContentGenerator(makeStub({ revisePost }));

    const post = {
      _id: { toString: () => 'p1' },
      status: 'CHANGES_REQUESTED',
      type: 'IMAGE',
      platforms: ['INSTAGRAM'],
      caption: 'Original caption about a slow-motion food reveal.',
      themes: ['CRAVING_CUE'],
      archetype: 'CRAVING_CUE',
      restaurantId: 'r1',
      feedback: JSON.stringify({ tags: ['caption'], details: {}, note: 'Not sensory enough', resolution: '' }),
    };

    mockGetPostsCollection.mockReturnValue({
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([post]) }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
    } as never);
    mockGetStrategyCyclesCollection.mockReturnValue(emptyCol() as never);

    await processRevisions();

    expect(revisePost).toHaveBeenCalledOnce();
    const call = revisePost.mock.calls[0][0];
    expect(call.existingPost.archetype).toBe('CRAVING_CUE');
  });

  it('falls back to themes[0] when archetype field is absent (old post documents)', async () => {
    const revisePost = vi.fn().mockResolvedValue({ caption: 'Revised', thumbnail: '' });
    setContentGenerator(makeStub({ revisePost }));

    const post = {
      _id: { toString: () => 'p2' },
      status: 'CHANGES_REQUESTED',
      type: 'IMAGE',
      platforms: ['INSTAGRAM'],
      caption: 'Original caption.',
      themes: ['SEASONAL_MENU'],
      // archetype field absent -- pre-fix document
      restaurantId: 'r1',
      feedback: JSON.stringify({ tags: ['caption'], details: {}, note: 'Too generic', resolution: '' }),
    };

    mockGetPostsCollection.mockReturnValue({
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([post]) }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
    } as never);
    mockGetStrategyCyclesCollection.mockReturnValue(emptyCol() as never);

    await processRevisions();

    expect(revisePost).toHaveBeenCalledOnce();
    const call = revisePost.mock.calls[0][0];
    expect(call.existingPost.archetype).toBe('SEASONAL_MENU');
  });

  it('skips advance when concurrent writer already changed post status (race)', async () => {
    const postDoc = {
      _id: { toString: () => 'post-race' },
      type: 'IMAGE',
      platforms: ['INSTAGRAM'],
      caption: 'old',
      feedback: JSON.stringify({ tags: [], details: {}, note: 'x' }),
      status: 'CHANGES_REQUESTED',
    };
    const postsCol = {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([postDoc]) }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 }),
    };

    mockGetPostsCollection.mockReturnValue(postsCol as never);
    mockGetStrategyCyclesCollection.mockReturnValue(emptyCol() as never);
    setContentGenerator(makeStub());

    const result = await processRevisions();

    expect(result.postsRevised).toBe(0);
    expect(result.failed).toBe(0);
  });
});

describe('processRevisions -> cycle revision', () => {
  it('revises cycle, flips to PENDING_APPROVAL, stamps resolution', async () => {
    const cycleDoc = {
      _id: { toString: () => 'cycle-1' },
      period: 'May 2026',
      summary: 'Old summary',
      plannedPosts: [{ category: 'Food & Menu', count: 2 }],
      focus: ['Food & Menu'],
      feedback: JSON.stringify({ areas: ['themes'], note: 'shift weekends' }),
      status: 'CHANGES_REQUESTED',
    };
    const cyclesCol = {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([cycleDoc]) }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    };

    mockGetPostsCollection.mockReturnValue(emptyCol() as never);
    mockGetStrategyCyclesCollection.mockReturnValue(cyclesCol as never);
    setContentGenerator(makeStub());

    const result = await processRevisions();

    expect(result.cyclesRevised).toBe(1);
    const [filter, update] = cyclesCol.updateOne.mock.calls[0];
    expect(filter).toMatchObject({ status: 'CHANGES_REQUESTED' });
    expect(update.$set.status).toBe('PENDING_APPROVAL');
    expect(update.$set.summary).toBe('Revised');
    const parsedFeedback = JSON.parse(update.$set.feedback);
    expect(parsedFeedback.resolution).toContain('shift weekends');
  });

  it('counts failure when reviseCycle throws', async () => {
    const cycleDoc = {
      _id: { toString: () => 'cycle-bad' },
      period: 'May 2026',
      feedback: JSON.stringify({ areas: [], note: '' }),
      status: 'CHANGES_REQUESTED',
    };
    const cyclesCol = {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([cycleDoc]) }),
      updateOne: vi.fn(),
    };

    mockGetPostsCollection.mockReturnValue(emptyCol() as never);
    mockGetStrategyCyclesCollection.mockReturnValue(cyclesCol as never);
    setContentGenerator(
      makeStub({
        reviseCycle: async () => {
          throw new Error('oops');
        },
      }),
    );

    const result = await processRevisions();

    expect(result.cyclesRevised).toBe(0);
    expect(result.failed).toBe(1);
  });

  it('counts failure when reviseCycle throws ContentGenerationError', async () => {
    const cycleDoc = {
      _id: { toString: () => 'cycle-rl' },
      period: 'May 2026',
      feedback: JSON.stringify({ areas: [], note: '' }),
      status: 'CHANGES_REQUESTED',
    };
    const cyclesCol = {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([cycleDoc]) }),
      updateOne: vi.fn(),
    };

    mockGetPostsCollection.mockReturnValue(emptyCol() as never);
    mockGetStrategyCyclesCollection.mockReturnValue(cyclesCol as never);
    setContentGenerator(
      makeStub({
        reviseCycle: async () => {
          throw new ContentGenerationError('RATE_LIMITED', 'slow');
        },
      }),
    );

    const result = await processRevisions();

    expect(result.cyclesRevised).toBe(0);
    expect(result.failed).toBe(1);
  });

  it('skips cycle advance when concurrent writer already changed status (matchedCount=0)', async () => {
    const cycleDoc = {
      _id: { toString: () => 'cycle-race' },
      period: 'May 2026',
      summary: 'old',
      plannedPosts: [],
      focus: [],
      feedback: JSON.stringify({ areas: [], note: 'fix' }),
      status: 'CHANGES_REQUESTED',
    };
    const cyclesCol = {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([cycleDoc]) }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 }),
    };

    mockGetPostsCollection.mockReturnValue(emptyCol() as never);
    mockGetStrategyCyclesCollection.mockReturnValue(cyclesCol as never);
    setContentGenerator(makeStub());

    const result = await processRevisions();

    expect(result.cyclesRevised).toBe(0);
    expect(result.failed).toBe(0);
  });
});
