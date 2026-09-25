import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
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

const { processCycleSync } = await import('../../src/services/processors/cycle-sync/index.js');

let mongod: MongoMemoryServer;
let client: MongoClient;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongod.getUri());
  setDB(client.db('cycle-sync-processor-test'));
}, 60000);

afterAll(async () => {
  await client.close();
  await mongod.stop();
}, 20000);

beforeEach(async () => {
  const db = client.db('cycle-sync-processor-test');
  await db.collection('subscriptions').deleteMany({});
  await db.collection('strategyCycles').deleteMany({});
  await db.collection('contentStrategies').deleteMany({});
});

describe('processCycleSync() -- trial support', () => {
  it('creates a ContentStrategy and a PENDING_GENERATION cycle for a restaurant still inside its free trial', async () => {
    const db = client.db('cycle-sync-processor-test');
    const now = new Date();
    const createdAt = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000); // trial started 2 days ago
    const trialEndsAt = new Date(now.getTime() + 12 * 24 * 60 * 60 * 1000); // 12 days left

    await db.collection('subscriptions').insertOne({
      restaurantId: 'r-trial-1',
      status: 'NONE',
      credits: 0,
      endedAt: null,
      trialEndsAt: trialEndsAt.toISOString(),
      createdAt,
      updatedAt: createdAt,
    } as any);

    const result = await processCycleSync();

    expect(result.created).toBe(1);
    expect(result.failed).toBe(0);

    const strategy = await db.collection('contentStrategies').findOne({ restaurantId: 'r-trial-1' });
    expect(strategy).not.toBeNull();
    expect(strategy!.postsPerWeek).toBe(5); // default (no plan tier for trial)

    const cycle = await db.collection('strategyCycles').findOne({ restaurantId: 'r-trial-1' });
    expect(cycle).not.toBeNull();
    expect(cycle!.status).toBe('PENDING_GENERATION');
    expect(new Date(cycle!.startDate as string).getTime()).toBe(createdAt.getTime());
    expect(new Date(cycle!.endDate as string).getTime()).toBe(trialEndsAt.getTime());
  });

  it('does not sync a restaurant whose trial has already ended and has no paid plan', async () => {
    const db = client.db('cycle-sync-processor-test');
    const now = new Date();

    await db.collection('subscriptions').insertOne({
      restaurantId: 'r-expired-trial',
      status: 'NONE',
      credits: 0,
      endedAt: null,
      trialEndsAt: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(), // ended yesterday
      createdAt: new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000),
    } as any);

    const result = await processCycleSync();

    expect(result.created).toBe(0);
    const strategy = await db.collection('contentStrategies').findOne({ restaurantId: 'r-expired-trial' });
    expect(strategy).toBeNull();
  });

  it('is idempotent -- a second run for the same trial restaurant does not create a duplicate cycle', async () => {
    const db = client.db('cycle-sync-processor-test');
    const now = new Date();

    await db.collection('subscriptions').insertOne({
      restaurantId: 'r-trial-2',
      status: 'NONE',
      credits: 0,
      endedAt: null,
      trialEndsAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: now,
    } as any);

    await processCycleSync();
    const secondRun = await processCycleSync();

    expect(secondRun.created).toBe(0);
    const cycles = await db.collection('strategyCycles').find({ restaurantId: 'r-trial-2' }).toArray();
    expect(cycles.length).toBe(1);
  });

  it('still syncs a paid ACTIVE subscription with a stored billing period (regression check)', async () => {
    const db = client.db('cycle-sync-processor-test');
    const now = new Date();
    const periodStart = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
    const periodEnd = new Date(now.getTime() + 29 * 24 * 60 * 60 * 1000);

    await db.collection('subscriptions').insertOne({
      restaurantId: 'r-paid-1',
      status: 'ACTIVE',
      credits: 0,
      endedAt: null,
      currentPeriodStart: periodStart.toISOString(),
      currentPeriodEnd: periodEnd.toISOString(),
      planSnapshot: { slug: 'growth' },
    } as any);

    const result = await processCycleSync();

    expect(result.created).toBe(1);
    const strategy = await db.collection('contentStrategies').findOne({ restaurantId: 'r-paid-1' });
    expect(strategy!.postsPerWeek).toBe(7); // growth tier
    const cycle = await db.collection('strategyCycles').findOne({ restaurantId: 'r-paid-1' });
    expect(cycle!.status).toBe('PENDING_GENERATION');
  });
});
