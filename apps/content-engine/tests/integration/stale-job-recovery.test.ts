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
    trackEvent: vi.fn(),
  };
});

const { processMediaJobs } = await import(
  '../../src/services/processors/media-job-poller/index.js'
);
const { ReplicateMediaGenerator, MongoMediaJobStore } = await import(
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

    // Insert a stale RUNNING job (started 21 min ago, past the 20 min attempt budget).
    // No stored request, so it is not resumable and fails the post as before.
    await insertMediaJob({
      jobId: 'job_stale',
      providerJobId: 'req_stale',
      provider: 'replicate',
      modelId: 'kwaivgi/kling-v1.6-standard',
      postType: 'REEL',
      status: 'RUNNING',
      attempts: 1,
      restaurantId: 'r-stale',
      postId: post.id,
      startedAt: new Date(Date.now() - 21 * 60 * 1000),
    });

    // Run the poller -- the runner should reap stale jobs WITHOUT calling Replicate
    const noFetchClient = { createPrediction: vi.fn(), getPrediction: vi.fn() };
    const store = new MongoMediaJobStore();
    const media = new ReplicateMediaGenerator({ client: noFetchClient as any, store });

    await processMediaJobs({ store, media });

    const updatedJob = await findMediaJobById('job_stale');
    expect(updatedJob!.status).toBe('FAILED');
    expect(updatedJob!.error).toMatch(/stale/i);

    const updatedPost = await findPostById(post.id);
    expect(updatedPost!.status).toBe('MISSED_DEADLINE');
    expect(updatedPost!.publishError).toContain('media-generation');

    expect(noFetchClient.getPrediction).not.toHaveBeenCalled();
  });
  it('parks a stale resumable video job for another attempt and keeps the post PENDING_MEDIA', async () => {
    const startedAt = new Date(Date.now() - 21 * 60 * 1000);
    const post = await createPost({
      type: 'REEL', status: 'PENDING_MEDIA',
      thumbnail: '', caption: 'retry me', platforms: ['INSTAGRAM'],
      restaurantId: 'r-stale',
      mediaJobId: 'job_resumable',
      lastStepAt: startedAt.toISOString(),
    });
    await insertMediaJob({
      jobId: 'job_resumable',
      providerJobId: 'req_resumable',
      provider: 'replicate',
      modelId: 'kwaivgi/kling-v1.6-standard',
      postType: 'REEL',
      status: 'RUNNING',
      attempts: 1,
      request: { prompt: 'Chef plating biryani' },
      restaurantId: 'r-stale',
      postId: post.id,
      startedAt,
      firstStartedAt: startedAt,
    });

    const noFetchClient = { createPrediction: vi.fn(), getPrediction: vi.fn() };
    const store = new MongoMediaJobStore();
    const media = new ReplicateMediaGenerator({ client: noFetchClient as any, store });

    await processMediaJobs({ store, media });

    const job = await findMediaJobById('job_resumable');
    expect(job!.status).toBe('PENDING');
    expect(job!.attemptHistory).toHaveLength(1);
    expect(job!.attemptHistory![0]!.errorClass).toBe('retryable');
    expect(new Date(job!.nextAttemptAt!).getTime()).toBeGreaterThan(Date.now());

    const stillPending = await findPostById(post.id);
    expect(stillPending!.status).toBe('PENDING_MEDIA');
    expect(noFetchClient.getPrediction).not.toHaveBeenCalled();
  });
});
