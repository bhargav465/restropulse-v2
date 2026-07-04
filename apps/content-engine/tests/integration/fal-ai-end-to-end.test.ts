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

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  (globalThis as any).fetch = fetchMock;
});

const { AIContentGenerator } = await import(
  '../../src/services/content-generator/backends/ai/ai-content-generator.js'
);
const { RestaurantSpecialization } = await import(
  '../../src/services/content-generator/backends/ai/specialization/index.js'
);
const { FalClient, FalAIMediaGenerator, MongoMediaJobStore } = await import(
  '../../src/services/content-generator/backends/ai/index.js'
);
const { findCostEventsByRestaurant, findMediaJobById } = await import('@restropulse/db');

let mongod: MongoMemoryServer;
let client: MongoClient;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongod.getUri());
  setDB(client.db('fal-ai-e2e-test'));
}, 60000);

afterAll(async () => {
  await client.close();
  await mongod.stop();
}, 20000);

beforeEach(async () => {
  await client.db('fal-ai-e2e-test').collection('mediaJobs').deleteMany({});
  await client.db('fal-ai-e2e-test').collection('costEvents').deleteMany({});
});

describe('AIContentGenerator + FalAIMediaGenerator end-to-end', () => {
  it('generatePost(IMAGE) writes both a mediaJobs row and a costEvents row tagged for the restaurant', async () => {
    // fal.ai returns one image
    fetchMock.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({
        images: [{ url: 'https://fal.media/files/end2end.jpg', width: 1024, height: 1024 }],
        seed: 7,
      }),
    });

    // LLM mock for caption
    const generateObject = vi.fn().mockResolvedValue({
      object: { caption: 'A delicious-looking image of paneer tikka', suggestedHashtags: ['#paneer', '#food'] },
      usage: { inputTokens: 80, outputTokens: 40 },
      modelId: 'claude-haiku-4-5-20251001',
    });

    const falClient = new FalClient({ apiKey: 'fal-fake' });
    const store = new MongoMediaJobStore();
    const media = new FalAIMediaGenerator({ client: falClient, store });

    const gen = new AIContentGenerator({
      specialization: new RestaurantSpecialization(),
      llm: { name: 'mock-llm', generateObject },
      media,
    });

    const post = await gen.generatePost(
      { concept: 'paneer tikka platter', type: 'IMAGE', platforms: ['INSTAGRAM'] },
      { restaurantId: 'r-fal-e2e', restaurantName: 'Spice Route', locale: 'en-IN' },
    );

    expect(post.thumbnail).toBe('https://fal.media/files/end2end.jpg');

    // mediaJobs row exists
    const allMediaJobs = await client.db('fal-ai-e2e-test').collection('mediaJobs').find({}).toArray();
    expect(allMediaJobs).toHaveLength(1);
    expect(allMediaJobs[0].provider).toBe('fal-ai');
    expect(allMediaJobs[0].status).toBe('COMPLETED');
    expect(allMediaJobs[0].restaurantId).toBe('r-fal-e2e');

    // costEvents row exists for the image surface
    const events = await findCostEventsByRestaurant('r-fal-e2e');
    const imageEvent = events.find((e) => e.surface === 'image');
    expect(imageEvent).toBeDefined();
    expect(imageEvent!.model).toBe('fal-ai/flux/dev');
    expect(imageEvent!.costUsd).toBeGreaterThan(0);
  });
});
