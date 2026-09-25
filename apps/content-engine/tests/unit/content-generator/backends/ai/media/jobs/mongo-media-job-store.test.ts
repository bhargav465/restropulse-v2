import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { setDB } from '@restropulse/db';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { MongoMediaJobStore } = await import(
  '../../../../../../../src/services/content-generator/backends/ai/media/jobs/mongo-media-job-store.js'
);

let mongod: MongoMemoryServer;
let client: MongoClient;
const store = new MongoMediaJobStore();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongod.getUri());
  setDB(client.db('media-job-store-test'));
}, 60000);

afterAll(async () => {
  await client.close();
  await mongod.stop();
}, 20000);

beforeEach(async () => {
  await client.db('media-job-store-test').collection('mediaJobs').deleteMany({});
});

const baseJob = {
  jobId: 'job_abc',
  provider: 'replicate' as const,
  modelId: 'black-forest-labs/flux-dev',
  postType: 'IMAGE' as const,
  status: 'COMPLETED' as const,
  mediaUrl: 'https://replicate.delivery/files/x.jpg',
  thumbnail: 'https://replicate.delivery/files/x.jpg',
  metadata: { widthPx: 1024, heightPx: 1024 },
  attempts: 1,
  restaurantId: 'r1',
  postId: 'p1',
  startedAt: new Date('2026-05-13T10:00:00Z'),
  completedAt: new Date('2026-05-13T10:00:02Z'),
};

describe('MongoMediaJobStore', () => {
  it('insert + findById round-trip', async () => {
    const inserted = await store.insert(baseJob);
    expect(inserted.id).toBeTruthy();
    expect(inserted.jobId).toBe('job_abc');

    const found = await store.findById('job_abc');
    expect(found).not.toBeNull();
    expect(found!.mediaUrl).toBe('https://replicate.delivery/files/x.jpg');
    expect(found!.attempts).toBe(1);
  });

  it('findById returns null for unknown jobId', async () => {
    expect(await store.findById('nope')).toBeNull();
  });

  it('updateStatus persists provided fields and bumps updatedAt', async () => {
    await store.insert({ ...baseJob, jobId: 'job_upd', status: 'RUNNING' });
    const before = await store.findById('job_upd');
    const updated = await store.updateStatus('job_upd', {
      status: 'COMPLETED',
      mediaUrl: 'https://replicate.delivery/done.jpg',
      completedAt: new Date('2026-05-13T10:00:05Z'),
    });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('COMPLETED');
    expect(updated!.mediaUrl).toBe('https://replicate.delivery/done.jpg');
    expect(updated!.updatedAt.getTime()).toBeGreaterThan(before!.updatedAt.getTime());
  });

  it('updateStatus returns null when jobId is unknown', async () => {
    expect(await store.updateStatus('nope', { status: 'FAILED' })).toBeNull();
  });

  it('incrementAttempts increments by 1', async () => {
    await store.insert({ ...baseJob, jobId: 'job_inc', attempts: 0 });
    await store.incrementAttempts('job_inc');
    await store.incrementAttempts('job_inc');
    const after = await store.findById('job_inc');
    expect(after!.attempts).toBe(2);
  });
});
