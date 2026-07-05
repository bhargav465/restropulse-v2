import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, ObjectId } from 'mongodb';
import { setDB } from '@restropulse/db';

vi.mock('@restropulse/telemetry/server', () => {
  const noopLogger = {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    child: vi.fn().mockReturnThis(), fatal: vi.fn(), trace: vi.fn(),
  };
  return { createLogger: vi.fn(() => noopLogger), initServerTelemetry: vi.fn(), shutdownServerTelemetry: vi.fn() };
});

process.env['ASSET_SERVER_BASE_URL'] = 'http://localhost:3002';

const { processPendingPosts }  = await import('../../src/services/processors/adhoc/index.js');
const { processPendingCycles } = await import('../../src/services/processors/strategy/index.js');
const { processRollingWindow } = await import('../../src/services/processors/rolling-window/index.js');
const { processRevisions }     = await import('../../src/services/processors/revision/index.js');
const { processDeadlines }     = await import('../../src/services/processors/deadline/index.js');
const { PlaceholderContentGenerator, setContentGenerator, resetContentGenerator }
                               = await import('../../src/services/content-generator/index.js');
const { deriveCycleSlots }     = await import('../../src/services/processors/rolling-window/slots.js');

const DB_NAME = 'lifecycle-test';
let mongod: MongoMemoryServer;
let client: MongoClient;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongod.getUri());
  setDB(client.db(DB_NAME));
  await client.db(DB_NAME).collection('posts').createIndex({ cycleId: 1, scheduledFor: 1 });
}, 60_000);

afterAll(async () => {
  await client.close();
  await mongod.stop();
}, 20_000);

const FAKE_NOW = '2026-05-01T10:00:00.000Z';

beforeEach(async () => {
  vi.clearAllMocks();
  setContentGenerator(new PlaceholderContentGenerator());
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(FAKE_NOW));
  const db = client.db(DB_NAME);
  await db.collection('posts').deleteMany({});
  await db.collection('strategyCycles').deleteMany({});
  await db.collection('contentStrategies').deleteMany({});
  await db.collection('restaurants').deleteMany({});
});

afterEach(() => {
  vi.useRealTimers();
  resetContentGenerator();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setNow(iso: string): void {
  vi.setSystemTime(new Date(iso));
}

function msFromAnchor(offsetHours: number, anchor = FAKE_NOW): string {
  return new Date(new Date(anchor).getTime() + offsetHours * 3_600_000).toISOString();
}

const db = () => client.db(DB_NAME);

async function seedCycle(fields: Record<string, unknown>): Promise<ObjectId> {
  const id = new ObjectId();
  await db().collection('strategyCycles').insertOne({
    _id: id,
    restaurantId: 'r1',
    period: 'May 2026',
    plannedPosts: [],
    focus: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...fields,
  });
  return id;
}

async function seedPost(fields: Record<string, unknown>): Promise<ObjectId> {
  const id = new ObjectId();
  await db().collection('posts').insertOne({
    _id: id,
    type: 'IMAGE',
    platforms: ['INSTAGRAM'],
    isAdhoc: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...fields,
  });
  return id;
}

async function seedStrategy(restaurantId: string, overrides: Record<string, unknown> = {}): Promise<void> {
  await db().collection('contentStrategies').insertOne({
    _id: new ObjectId(),
    restaurantId,
    postsPerWeek: 7,
    bestTime: '10:00',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
}

async function getCycle(id: ObjectId) {
  return db().collection('strategyCycles').findOne({ _id: id });
}

async function getPost(id: ObjectId) {
  return db().collection('posts').findOne({ _id: id });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('lifecycle integration tests', () => {
  describe('Post status transitions', () => {
    it('T1: PENDING_CONTENT -> PENDING_APPROVAL via processPendingPosts', async () => {
      const postId = await seedPost({ status: 'PENDING_CONTENT', concept: 'weekend special' });
      const result = await processPendingPosts();
      expect(result).toEqual({ processed: 1, failed: 0 });
      const post = await getPost(postId);
      expect(post?.status).toBe('PENDING_APPROVAL');
      expect(typeof post?.caption).toBe('string');
      expect(post?.caption.length).toBeGreaterThan(0);
      expect(typeof post?.thumbnail).toBe('string');
    });

    it('T2: user approves post (PENDING_APPROVAL -> SCHEDULED, simulation)', async () => {
      const postId = await seedPost({ status: 'PENDING_APPROVAL', scheduledFor: msFromAnchor(24) });
      await db().collection('posts').updateOne({ _id: postId }, { $set: { status: 'SCHEDULED' } });
      expect((await getPost(postId))?.status).toBe('SCHEDULED');
    });

    it('T3: user requests changes on post (PENDING_APPROVAL -> CHANGES_REQUESTED, simulation)', async () => {
      const postId = await seedPost({ status: 'PENDING_APPROVAL' });
      const feedback = JSON.stringify({ note: 'more color', tags: [], details: {} });
      await db().collection('posts').updateOne({ _id: postId }, { $set: { status: 'CHANGES_REQUESTED', feedback } });
      const post = await getPost(postId);
      expect(post?.status).toBe('CHANGES_REQUESTED');
      expect(JSON.parse(post?.feedback as string).note).toBe('more color');
    });

    it('T4: CHANGES_REQUESTED -> PENDING_APPROVAL via processRevisions (post)', async () => {
      const postId = await seedPost({
        status: 'CHANGES_REQUESTED',
        caption: 'old caption',
        thumbnail: 'old.jpg',
        feedback: JSON.stringify({ note: 'make it brighter', tags: [], details: {} }),
      });
      const result = await processRevisions();
      expect(result).toEqual({ postsRevised: 1, cyclesRevised: 0, failed: 0 });
      const post = await getPost(postId);
      expect(post?.status).toBe('PENDING_APPROVAL');
      expect(JSON.parse(post?.feedback as string).resolution).toBeTruthy();
    });

    it('T5: PENDING_APPROVAL -> SCHEDULED via processDeadlines (post, deadline already past)', async () => {
      // scheduledFor = 1h from FAKE_NOW; default postApprovalBufferHours = 2h -> deadline = now - 1h (past)
      const postId = await seedPost({ status: 'PENDING_APPROVAL', scheduledFor: msFromAnchor(1) });
      const result = await processDeadlines();
      expect(result).toEqual({ postsAdvanced: 1, cyclesAdvanced: 0, failed: 0 });
      expect((await getPost(postId))?.status).toBe('SCHEDULED');
    });

    it('T6: CHANGES_REQUESTED -> SCHEDULED via processDeadlines (post, deadline past, no revision)', async () => {
      const postId = await seedPost({
        status: 'CHANGES_REQUESTED',
        scheduledFor: msFromAnchor(1),
        feedback: JSON.stringify({ note: 'fix it', tags: [], details: {} }),
      });
      const result = await processDeadlines();
      expect(result.postsAdvanced).toBe(1);
      expect((await getPost(postId))?.status).toBe('SCHEDULED');
    });
  });

  describe('Cycle status transitions', () => {
    it('T7: PENDING_GENERATION -> PENDING_APPROVAL via processPendingCycles', async () => {
      const cycleId = await seedCycle({ status: 'PENDING_GENERATION', period: 'May 2026' });
      const result = await processPendingCycles();
      expect(result).toEqual({ processed: 1, failed: 0 });
      const cycle = await getCycle(cycleId);
      expect(cycle?.status).toBe('PENDING_APPROVAL');
      expect(typeof cycle?.summary).toBe('string');
      expect(cycle?.summary.length).toBeGreaterThan(0);
      expect(Array.isArray(cycle?.plannedPosts)).toBe(true);
      expect(cycle?.plannedPosts.length).toBeGreaterThan(0);
      expect(Array.isArray(cycle?.focus)).toBe(true);
    });

    it('T8: user requests changes on cycle (simulation)', async () => {
      const cycleId = await seedCycle({ status: 'PENDING_APPROVAL' });
      const feedback = JSON.stringify({ areas: ['Tone'], note: 'too formal' });
      await db().collection('strategyCycles').updateOne({ _id: cycleId }, { $set: { status: 'CHANGES_REQUESTED', feedback } });
      const cycle = await getCycle(cycleId);
      expect(cycle?.status).toBe('CHANGES_REQUESTED');
      expect(JSON.parse(cycle?.feedback as string).areas).toEqual(['Tone']);
    });

    it('T9: user approves cycle (simulation)', async () => {
      const cycleId = await seedCycle({ status: 'PENDING_APPROVAL' });
      await db().collection('strategyCycles').updateOne({ _id: cycleId }, { $set: { status: 'APPROVED' } });
      expect((await getCycle(cycleId))?.status).toBe('APPROVED');
    });

    it('T10: CHANGES_REQUESTED -> PENDING_APPROVAL via processRevisions (cycle)', async () => {
      const cycleId = await seedCycle({
        status: 'CHANGES_REQUESTED',
        period: 'May 2026',
        summary: 'old summary',
        plannedPosts: [{ category: 'Food & Menu', count: 2 }],
        focus: ['Food & Menu'],
        feedback: JSON.stringify({ areas: ['Tone'], note: 'too formal' }),
      });
      const result = await processRevisions();
      expect(result).toEqual({ postsRevised: 0, cyclesRevised: 1, failed: 0 });
      const cycle = await getCycle(cycleId);
      expect(cycle?.status).toBe('PENDING_APPROVAL');
      expect(JSON.parse(cycle?.feedback as string).resolution).toBeTruthy();
    });

    it('T11: PENDING_APPROVAL -> APPROVED via processDeadlines (cycle, deadline already past)', async () => {
      // startDate = 24h from now; default cycleApprovalBufferHours = 48h -> deadline = now - 24h (past)
      const cycleId = await seedCycle({ status: 'PENDING_APPROVAL', startDate: msFromAnchor(24) });
      const result = await processDeadlines();
      expect(result).toEqual({ postsAdvanced: 0, cyclesAdvanced: 1, failed: 0 });
      expect((await getCycle(cycleId))?.status).toBe('APPROVED');
    });

    it('T12: CHANGES_REQUESTED -> APPROVED via processDeadlines (cycle, deadline past, no revision)', async () => {
      const cycleId = await seedCycle({
        status: 'CHANGES_REQUESTED',
        startDate: msFromAnchor(24),
        feedback: JSON.stringify({ areas: [], note: 'x' }),
      });
      const result = await processDeadlines();
      expect(result.cyclesAdvanced).toBe(1);
      expect((await getCycle(cycleId))?.status).toBe('APPROVED');
    });

    it('T13: APPROVED -> ACTIVE via processRollingWindow (startDate <= now)', async () => {
      const cycleId = await seedCycle({
        status: 'APPROVED',
        startDate: msFromAnchor(-1),        // started 1h ago
        endDate: msFromAnchor(14 * 24),
        plannedPosts: [{ category: 'Food & Menu', count: 1 }],
        focus: ['Food & Menu'],
        restaurantId: 'r-activate',
      });
      await seedStrategy('r-activate');
      const result = await processRollingWindow({ rollingWindowHours: 48 });
      expect(result.activated).toBe(1);
      expect(result.cyclesProcessed).toBe(1);
      expect((await getCycle(cycleId))?.status).toBe('ACTIVE');
      const stubs = await db().collection('posts').find({ cycleId: cycleId.toString() }).toArray();
      expect(stubs.length).toBeGreaterThan(0);
      expect(stubs.every(p => p.status === 'PENDING_CONTENT')).toBe(true);
    });
  });

  describe('End-to-end scenario', () => {
    it('walks a cycle from PENDING_GENERATION to HISTORY through all major transitions', async () => {
      const CYCLE_START = msFromAnchor(10 * 24);  // T0 + 10 days
      const CYCLE_END   = msFromAnchor(20 * 24);  // T0 + 20 days

      // --- Step 1: draft cycle ---
      setNow(FAKE_NOW);
      const cycleId = await seedCycle({
        status: 'PENDING_GENERATION',
        period: 'May 2026',
        startDate: CYCLE_START,
        endDate: CYCLE_END,
        restaurantId: 'r-e2e',
      });
      await seedStrategy('r-e2e');

      await processPendingCycles();
      let cycle = await getCycle(cycleId);
      expect(cycle?.status).toBe('PENDING_APPROVAL');
      expect(typeof cycle?.summary).toBe('string');

      // --- Step 2: user requests changes ---
      await db().collection('strategyCycles').updateOne({ _id: cycleId }, {
        $set: { status: 'CHANGES_REQUESTED', feedback: JSON.stringify({ areas: ['Focus'], note: 'needs more events' }) },
      });

      // --- Step 3: revision processor picks it up ---
      setNow(msFromAnchor(1 / 60));  // +1 minute
      await processRevisions();
      cycle = await getCycle(cycleId);
      expect(cycle?.status).toBe('PENDING_APPROVAL');
      expect(JSON.parse(cycle?.feedback as string).resolution).toBeTruthy();

      // --- Step 4: deadline auto-approves the cycle ---
      // Cycle approval deadline = startDate - 48h = T0 + 10d - 2d = T0 + 8d
      // Advance past it: T0 + 8d + 1h
      setNow(msFromAnchor(8 * 24 + 1));
      let deadlineResult = await processDeadlines({ cycleApprovalBufferHours: 48 });
      expect(deadlineResult.cyclesAdvanced).toBe(1);
      expect((await getCycle(cycleId))?.status).toBe('APPROVED');

      // --- Step 5: rolling window activates cycle and creates stubs ---
      // startDate = T0 + 10d; advance past it: T0 + 10d + 1h
      setNow(msFromAnchor(10 * 24 + 1));
      const rollingResult = await processRollingWindow({ rollingWindowHours: 48 });
      expect(rollingResult.activated).toBe(1);
      expect((await getCycle(cycleId))?.status).toBe('ACTIVE');
      const stubs = await db().collection('posts').find({ cycleId: cycleId.toString() }).toArray();
      expect(stubs.length).toBeGreaterThan(0);
      expect(stubs.every(p => p.status === 'PENDING_CONTENT')).toBe(true);

      // --- Step 6: generate content for all stubs ---
      await processPendingPosts();
      const generated = await db().collection('posts').find({ cycleId: cycleId.toString() }).toArray();
      expect(generated.every(p => p.status === 'PENDING_APPROVAL')).toBe(true);

      // --- Step 7: user requests changes on first post ---
      setNow(msFromAnchor(10 * 24 + 2));
      const firstPost = generated[0];
      await db().collection('posts').updateOne({ _id: firstPost._id }, {
        $set: { status: 'CHANGES_REQUESTED', feedback: JSON.stringify({ note: 'brighter image', tags: [], details: {} }) },
      });

      // --- Step 8: revision processor revises first post ---
      setNow(msFromAnchor(10 * 24 + 3));
      const revisionResult = await processRevisions();
      expect(revisionResult.postsRevised).toBe(1);
      const revisedPost = await getPost(firstPost._id);
      expect(revisedPost?.status).toBe('PENDING_APPROVAL');
      expect(JSON.parse(revisedPost?.feedback as string).resolution).toBeTruthy();

      // --- Step 9: deadline auto-schedules the revised post ---
      // Post approval deadline = scheduledFor - 2h. Use deriveCycleSlots to find scheduledFor.
      const slots = deriveCycleSlots({
        cycle: { startDate: CYCLE_START, endDate: CYCLE_END, plannedPosts: cycle?.plannedPosts ?? [] },
        strategy: { postsPerWeek: 7, bestTime: '10:00' },
      });
      const firstSlotMs = slots[0].scheduledFor.getTime();
      const postDeadlineMs = firstSlotMs - 2 * 3_600_000;
      setNow(new Date(postDeadlineMs + 60_000).toISOString());  // 1 min past deadline
      deadlineResult = await processDeadlines({ postApprovalBufferHours: 2 });
      expect(deadlineResult.postsAdvanced).toBeGreaterThanOrEqual(1);

      // --- Step 10: cycle endDate passes -> archived to HISTORY ---
      setNow(msFromAnchor(20 * 24 + 1));
      const archiveResult = await processRollingWindow({ rollingWindowHours: 48 });
      expect(archiveResult.archived).toBe(1);
      expect((await getCycle(cycleId))?.status).toBe('HISTORY');
    });
  });

  describe('Concurrency / idempotency', () => {
    it('concurrent processRollingWindow calls produce exactly one set of post stubs', async () => {
      const cycleId = await seedCycle({
        status: 'ACTIVE',
        startDate: msFromAnchor(-6),
        endDate: msFromAnchor(14 * 24),
        plannedPosts: [{ category: 'Food & Menu', count: 1 }],
        focus: ['Food & Menu'],
        restaurantId: 'r-race',
        isAdhoc: false,
      });
      await seedStrategy('r-race');

      const WINDOW = 48;
      const horizon = new Date(new Date(FAKE_NOW).getTime() + WINDOW * 3_600_000);
      const expectedSlots = deriveCycleSlots({
        cycle: {
          startDate: msFromAnchor(-6),
          endDate: msFromAnchor(14 * 24),
          plannedPosts: [{ category: 'Food & Menu', count: 1 }],
        },
        strategy: { postsPerWeek: 7, bestTime: '10:00' },
      }).filter(s => s.scheduledFor <= horizon).length;

      const results = await Promise.all([
        processRollingWindow({ rollingWindowHours: WINDOW }),
        processRollingWindow({ rollingWindowHours: WINDOW }),
        processRollingWindow({ rollingWindowHours: WINDOW }),
      ]);

      const totalCreated = results.reduce((s, r) => s + r.slotsCreated, 0);
      expect(totalCreated).toBe(expectedSlots);

      const posts = await db().collection('posts').find({ cycleId: cycleId.toString() }).toArray();
      expect(posts).toHaveLength(expectedSlots);
      expect(posts.every(p => p.status === 'PENDING_CONTENT')).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('E1: APPROVED cycle whose endDate already passed -> HISTORY without activating', async () => {
      const cycleId = await seedCycle({
        status: 'APPROVED',
        startDate: msFromAnchor(5),    // future -- hasn't started
        endDate: msFromAnchor(-1),     // past -- already ended
      });
      const result = await processRollingWindow({ rollingWindowHours: 48 });
      expect(result.archived).toBe(1);
      expect(result.activated).toBe(0);
      expect((await getCycle(cycleId))?.status).toBe('HISTORY');
      const posts = await db().collection('posts').find({ cycleId: cycleId.toString() }).toArray();
      expect(posts).toHaveLength(0);
    });

    it('E2: post with no scheduledFor is never auto-approved', async () => {
      const postId = await seedPost({ status: 'PENDING_APPROVAL' });  // no scheduledFor
      const result = await processDeadlines({ postApprovalBufferHours: 2 });
      expect(result).toEqual({ postsAdvanced: 0, cyclesAdvanced: 0, failed: 0 });
      expect((await getPost(postId))?.status).toBe('PENDING_APPROVAL');
    });

    it('E3: cycle with no startDate is never auto-approved', async () => {
      const cycleId = await seedCycle({ status: 'PENDING_APPROVAL' });  // no startDate
      const result = await processDeadlines({ cycleApprovalBufferHours: 48 });
      expect(result).toEqual({ postsAdvanced: 0, cyclesAdvanced: 0, failed: 0 });
      expect((await getCycle(cycleId))?.status).toBe('PENDING_APPROVAL');
    });

    it('E4: revision skipped when resolution already stamped (post)', async () => {
      const postId = await seedPost({
        status: 'CHANGES_REQUESTED',
        feedback: JSON.stringify({ note: 'make it pop', tags: [], details: {}, resolution: 'Already revised' }),
      });
      const result = await processRevisions();
      expect(result).toEqual({ postsRevised: 0, cyclesRevised: 0, failed: 0 });
      const post = await getPost(postId);
      expect(post?.status).toBe('CHANGES_REQUESTED');
      expect(JSON.parse(post?.feedback as string).resolution).toBe('Already revised');
    });

    it('E5: revision skipped when resolution already stamped (cycle)', async () => {
      const cycleId = await seedCycle({
        status: 'CHANGES_REQUESTED',
        summary: 'original summary',
        plannedPosts: [{ category: 'Food & Menu', count: 1 }],
        focus: ['Food & Menu'],
        feedback: JSON.stringify({ areas: ['Tone'], note: 'fix this', resolution: 'Done already' }),
      });
      const result = await processRevisions();
      expect(result).toEqual({ postsRevised: 0, cyclesRevised: 0, failed: 0 });
      const cycle = await getCycle(cycleId);
      expect(cycle?.status).toBe('CHANGES_REQUESTED');
      expect(cycle?.summary).toBe('original summary');
    });

    it('E6: ACTIVE cycle with past endDate is archived', async () => {
      const cycleId = await seedCycle({
        status: 'ACTIVE',
        startDate: msFromAnchor(-14 * 24),
        endDate: msFromAnchor(-1),         // ended yesterday
      });
      const result = await processRollingWindow({ rollingWindowHours: 48 });
      expect(result.archived).toBe(1);
      expect(result.cyclesProcessed).toBe(0);
      expect(result.slotsCreated).toBe(0);
      expect((await getCycle(cycleId))?.status).toBe('HISTORY');
    });
  });
});
