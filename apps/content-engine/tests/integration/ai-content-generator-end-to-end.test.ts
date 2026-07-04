import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
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

const { AIContentGenerator } = await import(
  '../../src/services/content-generator/backends/ai/ai-content-generator.js'
);
const { RestaurantSpecialization } = await import(
  '../../src/services/content-generator/backends/ai/specialization/index.js'
);
const { findCostEventsByRestaurant } = await import('@restropulse/db');

let mongod: MongoMemoryServer;
let client: MongoClient;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongod.getUri());
  setDB(client.db('ai-end-to-end-test'));
}, 60000);

afterAll(async () => {
  await client.close();
  await mongod.stop();
}, 20000);

beforeEach(async () => {
  await client.db('ai-end-to-end-test').collection('costEvents').deleteMany({});
});

function makeGen() {
  const generateObject = vi.fn().mockImplementation(async (req: any) => {
    // Heuristic: cycle schema has plannedPosts; caption schema has just caption/suggestedHashtags
    const isCycle = req.system && req.prompt && req.prompt.toLowerCase().includes('cycle');
    if (isCycle) {
      return {
        object: { summary: 'cycle', plannedPosts: [{ category: 'a', count: 1 }], focus: ['x'] },
        usage: { inputTokens: 200, outputTokens: 80 },
        modelId: 'claude-sonnet-4-6',
      };
    }
    return {
      object: { caption: 'A warm, sensory caption from the kitchen.', suggestedHashtags: ['#warm', '#kitchen'] },
      usage: { inputTokens: 100, outputTokens: 50 },
      modelId: 'claude-haiku-4-5-20251001',
    };
  });

  const generateImage = vi.fn().mockResolvedValue({
    jobId: 'j_e2e', status: 'COMPLETED',
    mediaUrl: 'http://localhost:3002/images/x.jpg',
    thumbnail: 'http://localhost:3002/images/x.jpg',
    metadata: { widthPx: 1080, heightPx: 1080 },
  });

  return new AIContentGenerator({
    specialization: new RestaurantSpecialization(),
    llm: { name: 'mock', generateObject },
    media: { name: 'mock-media', generateImage, generateVideo: vi.fn(), pollJob: vi.fn() },
  });
}

describe('AIContentGenerator end-to-end (mocked external, real Mongo cost events)', () => {
  it('draftCycle then generatePost yields three cost events tagged for the same restaurant', async () => {
    const gen = makeGen();
    await gen.draftCycle({ period: 'w1' }, { restaurantId: 'r-end-to-end' });
    await gen.generatePost(
      { concept: 'parotta', type: 'IMAGE', platforms: ['INSTAGRAM'] },
      { restaurantId: 'r-end-to-end' },
    );

    const events = await findCostEventsByRestaurant('r-end-to-end');
    expect(events.length).toBe(3); // 1 LLM (cycle) + 1 LLM (caption) + 1 image
    const ops = events.map((e) => e.operation);
    expect(ops.filter((o) => o === 'draftCycle')).toHaveLength(1);
    expect(ops.filter((o) => o === 'generatePost')).toHaveLength(2);
    const surfaces = events.map((e) => e.surface);
    expect(surfaces).toContain('llm');
    expect(surfaces).toContain('image');
  });
});
