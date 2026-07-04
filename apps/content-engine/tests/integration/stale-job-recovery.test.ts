import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import {
  setDB,
  createPost,
  findPostById,
  insertMediaJob,
  findMediaJobById,
} from '@restropulse/db';

vi.mock('@restropulse/telemetry/server', () => {
  const noopLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    createLogger: vi.fn(() => noopLogger),
    initServerTelemetry: vi.fn(),
    shutdownServerTelemetry: vi.fn(),
    trackAIUsage: vi.fn(),
  };
});

const { processMediaJobs } = await import(
  '../../src/services/processors/media-job-poller/index.js'
);
const { FalAIMediaGenerator, MongoMediaJobStore } = await import(
  '../../src/services/content-generator/backends/ai/index.js'
);

let mongod: MongoMemoryServer;
let client: MongoClient;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongod.getUri());
  setDB(client.db('stale-recovery-test'));
}, 60000);

afterAll(async () => {
  await client.close();
  await mongod.stop();
}, 20000);

beforeEach(async () => {
  await client.db('stale-recovery-test').collection('posts').deleteMany({});
  await client.db('stale-recovery-test').collection('mediaJobs').deleteMany({});
});

describe('Stale-job recovery', () => {
  it('reaps a RUNNING job older than 10 min as FAILED and marks the post FAILED', async () => {
    const post = await createPost({
      type: 'REEL', status: 'PENDING_MEDIA',
      thumbnail: '', caption: 'old', platforms: ['INSTAGRAM'],
      restaurantId: 'r-stale',
      mediaJobId: 'job_stale',
      lastStepAt: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
    });

    // Insert a stale RUNNING job (started 11 min ago)
    await insertMediaJob({
      jobId: 'job_stale',
      providerJobId: 'req_stale',
      provider: 'fal-ai',
      modelId: 'fal-ai/kling-video/v1.6/standard/text-to-video',
      postType: 'REEL',
      status: 'RUNNING',
      attempts: 1,
      restaurantId: 'r-stale',
      postId: post.id,
      startedAt: new Date(Date.now() - 11 * 60 * 1000),
    });

    // Run the poller -- the runner should reap stale jobs WITHOUT calling fal
    const noFetchClient = { generateImage: vi.fn(), editImage: vi.fn(), submitToQueue: vi.fn(), getQueueStatus: vi.fn(), getQueueResult: vi.fn() };
    const store = new MongoMediaJobStore();
    const media = new FalAIMediaGenerator({ client: noFetchClient as any, store });

    await processMediaJobs({ store, media });

    const updatedJob = await findMediaJobById('job_stale');
    expect(updatedJob!.status).toBe('FAILED');
    expect(updatedJob!.error).toMatch(/stale|10/i);

    const updatedPost = await findPostById(post.id);
    expect(updatedPost!.status).toBe('MISSED_DEADLINE');
    expect(updatedPost!.publishError).toContain('media-generation');

    expect(noFetchClient.getQueueStatus).not.toHaveBeenCalled();
  });
});
