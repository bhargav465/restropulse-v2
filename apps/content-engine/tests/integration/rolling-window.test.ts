import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, ObjectId } from 'mongodb';
import { setDB } from '@restropulse/db';
import { ROLLING_WINDOW_HOURS } from '@restropulse/shared';

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

const { processRollingWindow } = await import('../../src/services/processors/rolling-window/index.js');

let mongod: MongoMemoryServer;
let client: MongoClient;
const DB_NAME = 'rolling-window-test';

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongod.getUri());
  setDB(client.db(DB_NAME));
  // Mirror the compound index the migration will create so upsert races resolve deterministically.
  await client.db(DB_NAME).collection('posts').createIndex({ cycleId: 1, scheduledFor: 1 });
}, 60000);

afterAll(async () => {
  await client.close();
  await mongod.stop();
}, 20000);

beforeEach(async () => {
  vi.clearAllMocks();
  const db = client.db(DB_NAME);
  await db.collection('posts').deleteMany({});
  await db.collection('strategyCycles').deleteMany({});
  await db.collection('contentStrategies').deleteMany({});
});

function isoFromNow(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

describe('processRollingWindow()', () => {
  it('returns zero stats when there are no ACTIVE or APPROVED cycles', async () => {
    const result = await processRollingWindow();
    expect(result).toEqual({ cyclesProcessed: 0, slotsCreated: 0, slotsSkipped: 0, failed: 0, activated: 0, archived: 0 });
  });

  it('materialises stub posts for slots falling inside the 48h window', async () => {
    const db = client.db(DB_NAME);
    const cycleId = new ObjectId();
    // Start the cycle ~1 day before now so slots land inside the 48h horizon.
    const startDate = isoFromNow(-24 * 60 * 60 * 1000);

    await db.collection('strategyCycles').insertOne({
      _id: cycleId,
      status: 'ACTIVE',
      restaurantId: 'r1',
      startDate,
      endDate: isoFromNow(14 * 24 * 60 * 60 * 1000),
      plannedPosts: [{ category: 'Food & Menu', count: 2 }],
      focus: ['Food & Menu'],
      period: 'March 2026',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.collection('contentStrategies').insertOne({
      _id: new ObjectId(),
      restaurantId: 'r1',
      postsPerWeek: 7,
      bestTime: '10:00',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await processRollingWindow();

    expect(result.cyclesProcessed).toBe(1);
    expect(result.slotsCreated).toBeGreaterThan(0);

    const posts = await db.collection('posts').find({ cycleId: cycleId.toString() }).toArray();
    for (const p of posts) {
      expect(p.status).toBe('PENDING_CONTENT');
      expect(typeof p.scheduledFor).toBe('string');
      expect(p.cycleId).toBe(cycleId.toString());
    }
  });

  it('skips slots outside the rolling window horizon', async () => {
    const db = client.db(DB_NAME);
    const cycleId = new ObjectId();
    // Far-future start means every slot is outside horizon.
    const startDate = isoFromNow((ROLLING_WINDOW_HOURS + 72) * 60 * 60 * 1000);

    await db.collection('strategyCycles').insertOne({
      _id: cycleId,
      status: 'ACTIVE',
      restaurantId: 'r-far',
      startDate,
      endDate: isoFromNow((ROLLING_WINDOW_HOURS + 200) * 60 * 60 * 1000),
      plannedPosts: [{ category: 'Food & Menu', count: 3 }],
      period: 'Far',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await processRollingWindow();

    expect(result.cyclesProcessed).toBe(1);
    expect(result.slotsCreated).toBe(0);
    const posts = await db.collection('posts').find({ cycleId: cycleId.toString() }).toArray();
    expect(posts).toHaveLength(0);
  });

  it('is idempotent under back-to-back ticks (no duplicates)', async () => {
    const db = client.db(DB_NAME);
    const cycleId = new ObjectId();
    const startDate = isoFromNow(-12 * 60 * 60 * 1000);

    await db.collection('strategyCycles').insertOne({
      _id: cycleId,
      status: 'ACTIVE',
      restaurantId: 'r2',
      startDate,
      endDate: isoFromNow(14 * 24 * 60 * 60 * 1000),
      plannedPosts: [{ category: 'Food & Menu', count: 1 }],
      period: 'Idempotence',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.collection('contentStrategies').insertOne({
      _id: new ObjectId(),
      restaurantId: 'r2',
      postsPerWeek: 7,
      bestTime: '10:00',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const first = await processRollingWindow();
    const second = await processRollingWindow();

    expect(first.slotsCreated).toBeGreaterThan(0);
    expect(second.slotsCreated).toBe(0);
    expect(second.slotsSkipped).toBeGreaterThan(0);
  });

  it('is race-safe: concurrent ticks do not duplicate posts', async () => {
    const db = client.db(DB_NAME);
    const cycleId = new ObjectId();
    const startDate = isoFromNow(-6 * 60 * 60 * 1000);

    await db.collection('strategyCycles').insertOne({
      _id: cycleId,
      status: 'ACTIVE',
      restaurantId: 'r3',
      startDate,
      endDate: isoFromNow(14 * 24 * 60 * 60 * 1000),
      plannedPosts: [{ category: 'Food & Menu', count: 1 }],
      period: 'Race',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.collection('contentStrategies').insertOne({
      _id: new ObjectId(),
      restaurantId: 'r3',
      postsPerWeek: 7,
      bestTime: '10:00',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const results = await Promise.all([
      processRollingWindow(),
      processRollingWindow(),
      processRollingWindow(),
    ]);

    const totalCreated = results.reduce((sum, r) => sum + r.slotsCreated, 0);
    expect(totalCreated).toBe(1);

    const posts = await db.collection('posts').find({ cycleId: cycleId.toString() }).toArray();
    expect(posts).toHaveLength(1);
  });

  it('activates an APPROVED cycle whose startDate has arrived and creates post stubs', async () => {
    const db = client.db(DB_NAME);
    const cycleId = new ObjectId();
    // Started 1 hour ago — startDate <= now, so activation should trigger.
    const startDate = isoFromNow(-1 * 60 * 60 * 1000);

    await db.collection('strategyCycles').insertOne({
      _id: cycleId,
      status: 'APPROVED',
      restaurantId: 'r-activate',
      startDate,
      endDate: isoFromNow(14 * 24 * 60 * 60 * 1000),
      plannedPosts: [{ category: 'Food & Menu', count: 2 }],
      focus: ['Food & Menu'],
      period: 'Activation Test',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.collection('contentStrategies').insertOne({
      _id: new ObjectId(),
      restaurantId: 'r-activate',
      postsPerWeek: 7,
      bestTime: '10:00',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await processRollingWindow();

    expect(result.activated).toBe(1);
    expect(result.cyclesProcessed).toBe(1);

    const updatedCycle = await db.collection('strategyCycles').findOne({ _id: cycleId });
    expect(updatedCycle?.status).toBe('ACTIVE');
  });

  it('pre-generates post stubs for an APPROVED cycle starting within 48h without activating it', async () => {
    const db = client.db(DB_NAME);
    const cycleId = new ObjectId();
    // Starts in 24h — inside the 48h pre-generation window but startDate > now.
    const startDate = isoFromNow(24 * 60 * 60 * 1000);

    await db.collection('strategyCycles').insertOne({
      _id: cycleId,
      status: 'APPROVED',
      restaurantId: 'r-pregenerate',
      startDate,
      endDate: isoFromNow(14 * 24 * 60 * 60 * 1000),
      plannedPosts: [{ category: 'Food & Menu', count: 2 }],
      focus: ['Food & Menu'],
      period: 'Pre-generate Test',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.collection('contentStrategies').insertOne({
      _id: new ObjectId(),
      restaurantId: 'r-pregenerate',
      postsPerWeek: 7,
      bestTime: '10:00',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await processRollingWindow();

    // Cycle should stay APPROVED — it hasn't started yet.
    const cycle = await db.collection('strategyCycles').findOne({ _id: cycleId });
    expect(cycle?.status).toBe('APPROVED');
    expect(result.activated).toBe(0);

    // But post stubs for slots in the 48h window should have been created.
    expect(result.cyclesProcessed).toBe(1);
    expect(result.slotsCreated).toBeGreaterThan(0);
  });

  it('leaves an APPROVED cycle starting more than 48h away completely untouched', async () => {
    const db = client.db(DB_NAME);
    const cycleId = new ObjectId();
    // Starts in 72h — beyond the pre-generation window.
    const startDate = isoFromNow(72 * 60 * 60 * 1000);

    await db.collection('strategyCycles').insertOne({
      _id: cycleId,
      status: 'APPROVED',
      restaurantId: 'r-too-far',
      startDate,
      endDate: isoFromNow(30 * 24 * 60 * 60 * 1000),
      plannedPosts: [{ category: 'Food & Menu', count: 1 }],
      focus: ['Food & Menu'],
      period: 'Too Far',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await processRollingWindow();

    expect(result.activated).toBe(0);
    expect(result.cyclesProcessed).toBe(0);

    const cycle = await db.collection('strategyCycles').findOne({ _id: cycleId });
    expect(cycle?.status).toBe('APPROVED');
  });

  it('archives ACTIVE cycles whose endDate has passed to HISTORY', async () => {
    const db = client.db(DB_NAME);
    const cycleId = new ObjectId();

    await db.collection('strategyCycles').insertOne({
      _id: cycleId,
      status: 'ACTIVE',
      restaurantId: 'r-expired',
      startDate: isoFromNow(-14 * 24 * 60 * 60 * 1000),
      endDate: isoFromNow(-24 * 60 * 60 * 1000), // ended yesterday
      plannedPosts: [{ category: 'Food & Menu', count: 1 }],
      focus: ['Food & Menu'],
      period: 'Expired',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await processRollingWindow();

    expect(result.archived).toBe(1);
    expect(result.cyclesProcessed).toBe(0);
    expect(result.slotsCreated).toBe(0);

    const updatedCycle = await db.collection('strategyCycles').findOne({ _id: cycleId });
    expect(updatedCycle?.status).toBe('HISTORY');
  });

  it('does not touch pre-existing posts with a PENDING_APPROVAL status for the same slot', async () => {
    const db = client.db(DB_NAME);
    const cycleId = new ObjectId();
    const startDate = isoFromNow(-12 * 60 * 60 * 1000);

    await db.collection('strategyCycles').insertOne({
      _id: cycleId,
      status: 'ACTIVE',
      restaurantId: 'r-existing',
      startDate,
      endDate: isoFromNow(14 * 24 * 60 * 60 * 1000),
      plannedPosts: [{ category: 'Food & Menu', count: 1 }],
      period: 'Preserve',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.collection('contentStrategies').insertOne({
      _id: new ObjectId(),
      restaurantId: 'r-existing',
      postsPerWeek: 7,
      bestTime: '10:00',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Precompute exactly the same scheduledFor the processor would derive.
    const { deriveCycleSlots } = await import('../../src/services/processors/rolling-window/slots.js');
    const slots = deriveCycleSlots({
      cycle: {
        startDate,
        endDate: isoFromNow(14 * 24 * 60 * 60 * 1000),
        plannedPosts: [{ category: 'Food & Menu', count: 1 }],
      },
      strategy: { postsPerWeek: 7, bestTime: '10:00' },
    });
    const scheduledForIso = slots[0].scheduledFor.toISOString();

    await db.collection('posts').insertOne({
      _id: new ObjectId(),
      cycleId: cycleId.toString(),
      scheduledFor: scheduledForIso,
      type: 'IMAGE',
      platforms: ['INSTAGRAM'],
      status: 'PENDING_APPROVAL',
      caption: 'Pre-existing approved post',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await processRollingWindow();

    expect(result.slotsSkipped).toBeGreaterThan(0);
    expect(result.slotsCreated).toBe(0);

    const posts = await db.collection('posts').find({ cycleId: cycleId.toString() }).toArray();
    expect(posts).toHaveLength(1);
    expect(posts[0].status).toBe('PENDING_APPROVAL');
    expect(posts[0].caption).toBe('Pre-existing approved post');
  });
});
