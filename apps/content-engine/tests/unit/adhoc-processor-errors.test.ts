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
  getPostsCollection: vi.fn(),
  findRestaurantById: vi.fn().mockResolvedValue(null),
}));

import { getPostsCollection } from '@restropulse/db';
import { processPendingPosts } from '../../src/services/processors/adhoc/index.js';
import {
  setContentGenerator,
  resetContentGenerator,
  ContentGenerationError,
  type IContentGenerator,
} from '../../src/services/content-generator/index.js';

const mockGetPostsCollection = vi.mocked(getPostsCollection);

function makeStub(overrides: Partial<IContentGenerator> = {}): IContentGenerator {
  return {
    name: 'stub',
    draftCycle: async () => ({ summary: '', plannedPosts: [], focus: [] }),
    reviseCycle: async () => ({ summary: '', plannedPosts: [], focus: [] }),
    generatePost: async () => ({ caption: 'Generated', thumbnail: 'http://x/y.jpg' }),
    revisePost: async () => ({ caption: 'Revised', thumbnail: 'http://x/y.jpg' }),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  resetContentGenerator();
});

describe('adhoc-processor error paths', () => {
  it('increments failed counter when generator throws a plain Error', async () => {
    const fakePost = {
      _id: { toString: () => 'post-id-1' },
      caption: 'test',
      concept: undefined,
      type: 'IMAGE',
      platforms: ['INSTAGRAM'],
    };

    const mockCollection = {
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([fakePost]),
        }),
      }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    };

    mockGetPostsCollection.mockReturnValue(mockCollection as never);
    setContentGenerator(
      makeStub({
        generatePost: async () => {
          throw new Error('AI service unavailable');
        },
      }),
    );

    const result = await processPendingPosts();

    expect(result).toEqual({ processed: 0, failed: 1 });
  });

  it('increments failed counter when generator throws ContentGenerationError(RATE_LIMITED)', async () => {
    const fakePost = {
      _id: { toString: () => 'post-id-rl' },
      caption: 'test',
      type: 'IMAGE',
      platforms: ['INSTAGRAM'],
    };

    const mockCollection = {
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([fakePost]),
        }),
      }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    };

    mockGetPostsCollection.mockReturnValue(mockCollection as never);
    setContentGenerator(
      makeStub({
        generatePost: async () => {
          throw new ContentGenerationError('RATE_LIMITED', 'slow down');
        },
      }),
    );

    const result = await processPendingPosts();

    expect(result).toEqual({ processed: 0, failed: 1 });
  });

  it('increments failed counter when updateOne throws', async () => {
    const fakePost = {
      _id: { toString: () => 'post-id-2' },
      caption: 'test',
      concept: undefined,
      type: 'IMAGE',
      platforms: ['INSTAGRAM'],
    };

    const mockCollection = {
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([fakePost]),
        }),
      }),
      updateOne: vi.fn().mockRejectedValue(new Error('DB write failed')),
    };

    mockGetPostsCollection.mockReturnValue(mockCollection as never);
    setContentGenerator(makeStub());

    const result = await processPendingPosts();

    expect(result).toEqual({ processed: 0, failed: 1 });
  });

  it('processes successes and failures in a mixed batch', async () => {
    const goodPost = {
      _id: { toString: () => 'post-good' },
      type: 'IMAGE',
      platforms: ['INSTAGRAM'],
    };
    const badPost = {
      _id: { toString: () => 'post-bad' },
      type: 'IMAGE',
      platforms: ['INSTAGRAM'],
    };

    const mockCollection = {
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([goodPost, badPost]),
        }),
      }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    };

    mockGetPostsCollection.mockReturnValue(mockCollection as never);

    const generatePost = vi
      .fn()
      .mockResolvedValueOnce({ caption: 'Good', thumbnail: 'http://x/a.jpg' })
      .mockRejectedValueOnce(new Error('fail'));
    setContentGenerator(makeStub({ generatePost }));

    const result = await processPendingPosts();

    expect(result).toEqual({ processed: 1, failed: 1 });
  });

  it('skips advance when a concurrent writer already moved the post out of PENDING_CONTENT', async () => {
    const fakePost = {
      _id: { toString: () => 'post-race' },
      type: 'IMAGE',
      platforms: ['INSTAGRAM'],
    };

    const mockCollection = {
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([fakePost]),
        }),
      }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 }),
    };

    mockGetPostsCollection.mockReturnValue(mockCollection as never);
    setContentGenerator(makeStub());

    const result = await processPendingPosts();

    expect(result).toEqual({ processed: 0, failed: 0 });
    expect(mockCollection.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PENDING_CONTENT' }),
      expect.anything(),
    );
  });
});
