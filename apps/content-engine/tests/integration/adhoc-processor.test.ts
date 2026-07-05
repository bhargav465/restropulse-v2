import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, ObjectId } from 'mongodb';
import { setDB } from '@restropulse/db';

// Mock telemetry before any app code loads
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
  return {
    createLogger: vi.fn(() => noopLogger),
    initServerTelemetry: vi.fn(),
    shutdownServerTelemetry: vi.fn(),
  };
});

// Set ASSET_SERVER_BASE_URL before content-generator loads asset-manager
process.env['ASSET_SERVER_BASE_URL'] = 'http://localhost:3002';

const { processPendingPosts } = await import('../../src/services/processors/adhoc/index.js');
const {
  PlaceholderContentGenerator,
  setContentGenerator,
  resetContentGenerator,
} = await import('../../src/services/content-generator/index.js');

let mongod: MongoMemoryServer;
let client: MongoClient;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongod.getUri());
  setDB(client.db('content-engine-test'));
}, 60000);

afterAll(async () => {
  await client.close();
  await mongod.stop();
}, 20000);

beforeEach(async () => {
  vi.clearAllMocks();
  setContentGenerator(new PlaceholderContentGenerator());
  // Clear the posts collection before each test
  const db = client.db('content-engine-test');
  await db.collection('posts').deleteMany({});
});

afterEach(() => {
  resetContentGenerator();
});

describe('adhoc-processor integration', () => {
  describe('processPendingPosts()', () => {
    it('returns { processed: 0, failed: 0 } when no PENDING_CONTENT posts exist', async () => {
      const result = await processPendingPosts();
      expect(result).toEqual({ processed: 0, failed: 0 });
    });

    it('does not process posts that are not PENDING_CONTENT', async () => {
      const db = client.db('content-engine-test');
      await db.collection('posts').insertOne({
        _id: new ObjectId(),
        type: 'IMAGE',
        status: 'SCHEDULED',
        platforms: ['INSTAGRAM'],
        caption: 'A scheduled post',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await processPendingPosts();
      expect(result).toEqual({ processed: 0, failed: 0 });
    });

    it('processes a PENDING_CONTENT IMAGE post and advances status to PENDING_APPROVAL', async () => {
      const db = client.db('content-engine-test');
      const postId = new ObjectId();
      await db.collection('posts').insertOne({
        _id: postId,
        type: 'IMAGE',
        status: 'PENDING_CONTENT',
        platforms: ['INSTAGRAM'],
        concept: 'Weekend special',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await processPendingPosts();
      expect(result).toEqual({ processed: 1, failed: 0 });

      const updatedPost = await db.collection('posts').findOne({ _id: postId });
      expect(updatedPost?.status).toBe('PENDING_APPROVAL');
      expect(typeof updatedPost?.caption).toBe('string');
      expect(typeof updatedPost?.thumbnail).toBe('string');
    });

    it('processes a PENDING_CONTENT CAROUSEL post and stores mediaUrls', async () => {
      const db = client.db('content-engine-test');
      const postId = new ObjectId();
      await db.collection('posts').insertOne({
        _id: postId,
        type: 'CAROUSEL',
        status: 'PENDING_CONTENT',
        platforms: ['INSTAGRAM'],
        concept: 'Menu highlights',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await processPendingPosts();
      expect(result.processed).toBe(1);

      const updatedPost = await db.collection('posts').findOne({ _id: postId });
      expect(updatedPost?.status).toBe('PENDING_APPROVAL');
      expect(Array.isArray(updatedPost?.mediaUrls)).toBe(true);
    });

    it('processes a PENDING_CONTENT REEL post and stores videoUrl', async () => {
      const db = client.db('content-engine-test');
      const postId = new ObjectId();
      await db.collection('posts').insertOne({
        _id: postId,
        type: 'REEL',
        status: 'PENDING_CONTENT',
        platforms: ['INSTAGRAM'],
        concept: 'Chef highlight reel',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await processPendingPosts();
      expect(result.processed).toBe(1);

      const updatedPost = await db.collection('posts').findOne({ _id: postId });
      expect(updatedPost?.status).toBe('PENDING_APPROVAL');
      expect(typeof updatedPost?.videoUrl).toBe('string');
    });

    it('processes multiple PENDING_CONTENT posts in a single call', async () => {
      const db = client.db('content-engine-test');
      await db.collection('posts').insertMany([
        {
          _id: new ObjectId(),
          type: 'IMAGE',
          status: 'PENDING_CONTENT',
          platforms: ['INSTAGRAM'],
          concept: 'Post 1',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          _id: new ObjectId(),
          type: 'IMAGE',
          status: 'PENDING_CONTENT',
          platforms: ['FACEBOOK'],
          concept: 'Post 2',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const result = await processPendingPosts();
      expect(result).toEqual({ processed: 2, failed: 0 });
    });

    it('under concurrent ticks, only one run advances a given post (race-safe via status filter)', async () => {
      const db = client.db('content-engine-test');
      const postId = new ObjectId();
      await db.collection('posts').insertOne({
        _id: postId,
        type: 'IMAGE',
        status: 'PENDING_CONTENT',
        platforms: ['INSTAGRAM'],
        concept: 'Concurrency check',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const [a, b] = await Promise.all([processPendingPosts(), processPendingPosts()]);

      // Exactly one of the two runs matched+advanced the post; the other was a no-op.
      expect(a.processed + b.processed).toBe(1);

      const updatedPost = await db.collection('posts').findOne({ _id: postId });
      expect(updatedPost?.status).toBe('PENDING_APPROVAL');
    });

    it('passes correlationId = postId to the generator', async () => {
      const db = client.db('content-engine-test');
      const postId = new ObjectId();
      const calls: unknown[] = [];
      setContentGenerator({
        name: 'spy',
        draftCycle: async () => ({ summary: '', plannedPosts: [], focus: [] }),
        reviseCycle: async () => ({ summary: '', plannedPosts: [], focus: [] }),
        generatePost: async (_input, ctx) => {
          calls.push(ctx);
          return { caption: 'hi', thumbnail: 'http://x/y.jpg' };
        },
        revisePost: async () => ({ caption: '', thumbnail: '' }),
      });

      await db.collection('posts').insertOne({
        _id: postId,
        type: 'IMAGE',
        status: 'PENDING_CONTENT',
        platforms: ['INSTAGRAM'],
        concept: 'With ctx',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await processPendingPosts();

      expect(calls).toHaveLength(1);
      expect((calls[0] as { correlationId?: string }).correlationId).toBe(postId.toString());
    });

    it('processes a PENDING_CONTENT STORY post and stores a single thumbnail without mediaUrls', async () => {
      const db = client.db('content-engine-test');
      const postId = new ObjectId();
      await db.collection('posts').insertOne({
        _id: postId,
        type: 'STORY',
        status: 'PENDING_CONTENT',
        platforms: ['INSTAGRAM'],
        concept: 'Story post concept',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await processPendingPosts();
      expect(result.processed).toBe(1);

      const updatedPost = await db.collection('posts').findOne({ _id: postId });
      expect(updatedPost?.status).toBe('PENDING_APPROVAL');
      expect(typeof updatedPost?.thumbnail).toBe('string');
      // STORY posts must never have carousel-style mediaUrls; videoUrl is allowed (video story)
      expect(updatedPost?.mediaUrls).toBeFalsy();
    });

    it('CAROUSEL post stores mediaUrls with multiple slides (not just one)', async () => {
      const db = client.db('content-engine-test');
      const postId = new ObjectId();
      await db.collection('posts').insertOne({
        _id: postId,
        type: 'CAROUSEL',
        status: 'PENDING_CONTENT',
        platforms: ['INSTAGRAM'],
        archetype: 'FOOD_PAIRING',
        themes: ['FOOD_PAIRING'],
        concept: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await processPendingPosts();

      const updatedPost = await db.collection('posts').findOne({ _id: postId });
      expect(updatedPost?.status).toBe('PENDING_APPROVAL');
      expect(Array.isArray(updatedPost?.mediaUrls)).toBe(true);
      expect((updatedPost?.mediaUrls as string[]).length).toBeGreaterThan(1);
      // CAROUSEL posts have no video; processor stores null via $set, so check falsy not undefined
      expect(updatedPost?.videoUrl).toBeFalsy();
    });

    it('uses caption field as concept when concept is absent', async () => {
      const db = client.db('content-engine-test');
      const postId = new ObjectId();
      await db.collection('posts').insertOne({
        _id: postId,
        type: 'IMAGE',
        status: 'PENDING_CONTENT',
        platforms: ['INSTAGRAM'],
        caption: 'Caption used as concept',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await processPendingPosts();
      expect(result.processed).toBe(1);

      const updatedPost = await db.collection('posts').findOne({ _id: postId });
      expect(updatedPost?.status).toBe('PENDING_APPROVAL');
    });
  });
});
