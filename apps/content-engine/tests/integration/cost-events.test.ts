import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { setDB } from '@restropulse/db';

vi.mock('@restropulse/telemetry/server', () => {
  const noopLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    createLogger: vi.fn(() => noopLogger),
    initServerTelemetry: vi.fn(),
    shutdownServerTelemetry: vi.fn(),
    trackAIUsage: vi.fn(),
  };
});

const {
  insertCostEvent,
  findCostEventsByPost,
  findCostEventsByRestaurant,
  sumCostByRestaurant,
} = await import('@restropulse/db');

let mongod: MongoMemoryServer;
let client: MongoClient;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongod.getUri());
  setDB(client.db('cost-events-test'));
}, 60000);

afterAll(async () => {
  await client.close();
  await mongod.stop();
}, 20000);

beforeEach(async () => {
  await client.db('cost-events-test').collection('costEvents').deleteMany({});
});

describe('costEvents collection helpers', () => {
  it('insertCostEvent persists and returns id', async () => {
    const saved = await insertCostEvent({
      restaurantId: 'r1',
      postId: 'p1',
      operation: 'generatePost',
      surface: 'llm',
      step: 'caption',
      model: 'claude-sonnet-4-6',
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.012,
      durationMs: 800,
      status: 'success',
      createdAt: new Date(),
    });
    expect(saved.id).toBeTruthy();
    expect(saved.costUsd).toBe(0.012);
  });

  it('findCostEventsByPost returns rows in createdAt order', async () => {
    const t0 = new Date('2026-05-03T10:00:00Z');
    const t1 = new Date('2026-05-03T10:00:01Z');
    await insertCostEvent({
      postId: 'p1', operation: 'generatePost', surface: 'llm', step: 'caption',
      model: 'm', costUsd: 0.01, durationMs: 1, status: 'success', createdAt: t1,
    });
    await insertCostEvent({
      postId: 'p1', operation: 'generatePost', surface: 'image', step: 'image',
      model: 'flux', costUsd: 0.025, durationMs: 1500, status: 'success', createdAt: t0,
    });
    const rows = await findCostEventsByPost('p1');
    expect(rows).toHaveLength(2);
    expect(rows[0].surface).toBe('image');
    expect(rows[1].surface).toBe('llm');
  });

  it('findCostEventsByRestaurant filters by date range', async () => {
    await insertCostEvent({
      restaurantId: 'r1', operation: 'generatePost', surface: 'llm', step: 'caption',
      model: 'm', costUsd: 0.01, durationMs: 1, status: 'success', createdAt: new Date('2026-05-01T00:00:00Z'),
    });
    await insertCostEvent({
      restaurantId: 'r1', operation: 'generatePost', surface: 'llm', step: 'caption',
      model: 'm', costUsd: 0.02, durationMs: 1, status: 'success', createdAt: new Date('2026-05-15T00:00:00Z'),
    });
    const inRange = await findCostEventsByRestaurant('r1', {
      from: new Date('2026-05-10T00:00:00Z'),
      to: new Date('2026-05-20T00:00:00Z'),
    });
    expect(inRange).toHaveLength(1);
    expect(inRange[0].costUsd).toBe(0.02);
  });

  it('sumCostByRestaurant adds up costUsd', async () => {
    for (const cost of [0.01, 0.02, 0.05]) {
      await insertCostEvent({
        restaurantId: 'r1', operation: 'generatePost', surface: 'llm', step: 'caption',
        model: 'm', costUsd: cost, durationMs: 1, status: 'success', createdAt: new Date(),
      });
    }
    const total = await sumCostByRestaurant('r1');
    expect(total).toBeCloseTo(0.08, 5);
  });
});
