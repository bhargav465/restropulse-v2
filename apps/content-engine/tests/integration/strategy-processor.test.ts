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

// Set ASSET_SERVER_BASE_URL before any asset-manager import downstream
process.env['ASSET_SERVER_BASE_URL'] = 'http://localhost:3002';

const { processPendingCycles } = await import(
  '../../src/services/processors/strategy/index.js'
);
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
  setDB(client.db('strategy-processor-test'));
}, 60000);

afterAll(async () => {
  await client.close();
  await mongod.stop();
}, 20000);

beforeEach(async () => {
  vi.clearAllMocks();
  setContentGenerator(new PlaceholderContentGenerator());
  const db = client.db('strategy-processor-test');
  await db.collection('posts').deleteMany({});
  await db.collection('strategyCycles').deleteMany({});
  await db.collection('contentStrategies').deleteMany({});
  await db.collection('restaurants').deleteMany({});
});

afterEach(() => {
  resetContentGenerator();
});

// ---------------------------------------------------------------------------
// processPendingCycles
// ---------------------------------------------------------------------------
describe('processPendingCycles()', () => {
  it('returns { processed: 0, failed: 0 } when no PENDING_GENERATION cycles exist', async () => {
    const result = await processPendingCycles();
    expect(result).toEqual({ processed: 0, failed: 0 });
  });

  it('does not process cycles that are not PENDING_GENERATION', async () => {
    const db = client.db('strategy-processor-test');
    await db.collection('strategyCycles').insertOne({
      _id: new ObjectId(),
      status: 'PENDING_APPROVAL',
      restaurantId: 'r1',
      period: 'April 2026',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await processPendingCycles();
    expect(result).toEqual({ processed: 0, failed: 0 });
  });

  it('drafts a PENDING_GENERATION cycle and sets status to PENDING_APPROVAL', async () => {
    const db = client.db('strategy-processor-test');
    const cycleId = new ObjectId();

    await db.collection('strategyCycles').insertOne({
      _id: cycleId,
      status: 'PENDING_GENERATION',
      restaurantId: 'r1',
      period: 'April 2026',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await processPendingCycles();
    expect(result).toEqual({ processed: 1, failed: 0 });

    const updatedCycle = await db.collection('strategyCycles').findOne({ _id: cycleId });
    expect(updatedCycle?.status).toBe('PENDING_APPROVAL');
    expect(typeof updatedCycle?.summary).toBe('string');
    expect(Array.isArray(updatedCycle?.focus)).toBe(true);
    expect(Array.isArray(updatedCycle?.plannedPosts)).toBe(true);
  });

  it('sets summary to include the cycle period', async () => {
    const db = client.db('strategy-processor-test');
    const cycleId = new ObjectId();

    await db.collection('strategyCycles').insertOne({
      _id: cycleId,
      status: 'PENDING_GENERATION',
      restaurantId: 'r1',
      period: 'May 2026',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await processPendingCycles();

    const updatedCycle = await db.collection('strategyCycles').findOne({ _id: cycleId });
    expect(updatedCycle?.summary).toContain('May 2026');
  });

  it('processes multiple PENDING_GENERATION cycles in a single call', async () => {
    const db = client.db('strategy-processor-test');
    await db.collection('strategyCycles').insertMany([
      {
        _id: new ObjectId(),
        status: 'PENDING_GENERATION',
        restaurantId: 'r1',
        period: 'April 2026',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        _id: new ObjectId(),
        status: 'PENDING_GENERATION',
        restaurantId: 'r2',
        period: 'May 2026',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const result = await processPendingCycles();
    expect(result).toEqual({ processed: 2, failed: 0 });
  });
});

