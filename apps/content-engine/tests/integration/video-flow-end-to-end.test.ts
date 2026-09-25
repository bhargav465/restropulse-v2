import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { setDB, createPost, findPostById } from '@restropulse/db';

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
const { ReplicateClient, ReplicateMediaGenerator, MongoMediaJobStore } = await import(
  '../../src/services/content-generator/backends/ai/index.js'
);
const { processMediaJobs } = await import(
  '../../src/services/processors/media-job-poller/index.js'
);

let mongod: MongoMemoryServer;
let client: MongoClient;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongod.getUri());
  setDB(client.db('video-e2e-test'));
}, 60000);

afterAll(async () => {
  await client.close();
  await mongod.stop();
}, 20000);

beforeEach(async () => {
  await client.db('video-e2e-test').collection('posts').deleteMany({});
  await client.db('video-e2e-test').collection('mediaJobs').deleteMany({});
  await client.db('video-e2e-test').collection('costEvents').deleteMany({});
});

describe('Video flow end-to-end (submit -> poll -> COMPLETED)', () => {
  it('REEL post: submit lands in PENDING_MEDIA, two poll ticks transition to PENDING_APPROVAL', async () => {
    // Seed a PENDING_CONTENT REEL post
    const seeded = await createPost({
      type: 'REEL',
      status: 'PENDING_CONTENT',
      thumbnail: '',
      caption: 'kitchen close-up',
      platform: 'INSTAGRAM',
      restaurantId: 'r-vid',
    });

    // LLM mock for caption
    const generateObject = vi.fn().mockResolvedValue({
      object: { caption: 'A warm kitchen reel' },
      usage: { inputTokens: 80, outputTokens: 40 },
      modelId: 'claude-haiku-4-5-20251001',
    });

    // fetch mock: prediction submit then poll (processing -> succeeded)
    let stage: 'submit' | 'processing' | 'succeeded' = 'submit';
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (typeof url === 'string' && url.endsWith('/predictions') && init?.method === 'POST' && stage === 'submit') {
        stage = 'processing';
        return { ok: true, status: 200, json: async () => ({ id: 'pred_e2e', status: 'starting', output: null }) };
      }
      if (typeof url === 'string' && url.endsWith('/predictions/pred_e2e')) {
        if (stage === 'processing') {
          stage = 'succeeded';
          return { ok: true, status: 200, json: async () => ({ id: 'pred_e2e', status: 'processing', output: null }) };
        }
        if (stage === 'succeeded') {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: 'pred_e2e', status: 'succeeded', output: 'https://replicate.delivery/video.mp4' }),
          };
        }
      }
      throw new Error(`Unexpected fetch in stage ${stage} for ${url}`);
    });

    const replicateClient = new ReplicateClient({ apiKey: 'replicate-fake' });
    const store = new MongoMediaJobStore();
    const media = new ReplicateMediaGenerator({ client: replicateClient, store });
    const gen = new AIContentGenerator({
      specialization: new RestaurantSpecialization(),
      llm: { name: 'mock-llm', generateObject },
      media,
    });

    // 1. Submit (caption + queue)
    const result = await gen.generatePost(
      { concept: 'kitchen close-up', type: 'REEL', platform: 'INSTAGRAM', cycleId: undefined },
      { restaurantId: 'r-vid' },
    );
    expect(result.pendingMedia).toBe(true);
    expect(result.mediaJobId).toBeTruthy();

    // 2. Simulate adhoc-processor's PENDING_MEDIA write
    await client.db('video-e2e-test').collection('posts').updateOne(
      { _id: { $eq: (await client.db('video-e2e-test').collection('posts').findOne({}))!._id } },
      {
        $set: {
          status: 'PENDING_MEDIA',
          mediaJobId: result.mediaJobId,
          generationStep: 'MEDIA_REQUESTED',
          lastStepAt: new Date().toISOString(),
        },
      },
    );

    // 3. First poller tick -- still processing
    await processMediaJobs({ store, media });
    let updated = await findPostById(seeded.id);
    expect(updated!.status).toBe('PENDING_MEDIA');

    // 4. Second poller tick -- COMPLETED
    await processMediaJobs({ store, media });
    updated = await findPostById(seeded.id);
    expect(updated!.status).toBe('PENDING_APPROVAL');
    expect(updated!.videoUrl).toBe('https://replicate.delivery/video.mp4');
    expect(updated!.generationStep).toBe('MEDIA_DONE');
  });
});
