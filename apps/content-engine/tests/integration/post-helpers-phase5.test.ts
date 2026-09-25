import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import {
  setDB,
  createPost,
  findStalePendingMediaPosts,
  findAllPendingMediaPosts,
  setPostMediaJobReference,
  advanceGenerationStep,
  applyMediaJobResultToPost,
  markPostFailedWithMedia,
} from '@restropulse/db';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

let mongod: MongoMemoryServer;
let client: MongoClient;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongod.getUri());
  setDB(client.db('post-helpers-phase5'));
}, 60000);

afterAll(async () => {
  await client.close();
  await mongod.stop();
}, 20000);

beforeEach(async () => {
  await client.db('post-helpers-phase5').collection('posts').deleteMany({});
});

const basePost = {
  type: 'REEL' as const,
  status: 'PENDING_CONTENT' as const,
  thumbnail: 'http://x',
  caption: 'c',
  platforms: ['INSTAGRAM' as const],
  restaurantId: 'r1',
};

describe('Phase-5 posts.ts helpers', () => {
  it('setPostMediaJobReference flips status PENDING_CONTENT -> PENDING_MEDIA + writes mediaJobId/step/lastStepAt', async () => {
    const created = await createPost(basePost);
    const updated = await setPostMediaJobReference(created.id, 'job_xyz', 'MEDIA_REQUESTED');
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('PENDING_MEDIA');
    expect(updated!.mediaJobId).toBe('job_xyz');
    expect(updated!.generationStep).toBe('MEDIA_REQUESTED');
    expect(updated!.lastStepAt).toBeTruthy();
  });

  it('setPostMediaJobReference rejects posts already moved past PENDING (returns null)', async () => {
    const created = await createPost({ ...basePost, status: 'POSTED' });
    const updated = await setPostMediaJobReference(created.id, 'jobX', 'MEDIA_REQUESTED');
    expect(updated).toBeNull();
  });

  it('advanceGenerationStep updates step + lastStepAt without changing status', async () => {
    const created = await createPost({ ...basePost, status: 'PENDING_MEDIA' });
    const updated = await advanceGenerationStep(created.id, 'CAPTION_DONE');
    expect(updated!.generationStep).toBe('CAPTION_DONE');
    expect(updated!.status).toBe('PENDING_MEDIA');
  });

  it('applyMediaJobResultToPost flips PENDING_MEDIA -> PENDING_APPROVAL with media URL + duration', async () => {
    const created = await createPost({ ...basePost, status: 'PENDING_MEDIA' });
    const job = {
      jobId: 'j1',
      provider: 'replicate' as const,
      modelId: 'kwaivgi/kling-v1.6-standard',
      postType: 'REEL' as const,
      status: 'COMPLETED' as const,
      mediaUrl: 'https://replicate.delivery/video.mp4',
      thumbnail: 'https://replicate.delivery/thumb.jpg',
      metadata: { widthPx: 1080, heightPx: 1920, durationSeconds: 5 },
      attempts: 1,
      startedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const updated = await applyMediaJobResultToPost(created.id, job);
    expect(updated!.status).toBe('PENDING_APPROVAL');
    expect(updated!.videoUrl).toBe('https://replicate.delivery/video.mp4');
    expect(updated!.thumbnail).toBe('https://replicate.delivery/thumb.jpg');
    expect(updated!.duration).toBe('5s');
    expect(updated!.generationStep).toBe('MEDIA_DONE');
  });

  it('markPostFailedWithMedia surfaces the error on publishError', async () => {
    const created = await createPost({ ...basePost, status: 'PENDING_MEDIA' });
    const updated = await markPostFailedWithMedia(created.id, 'replicate queue timeout');
    expect(updated!.status).toBe('MISSED_DEADLINE');
    expect(updated!.publishError).toContain('media-generation');
    expect(updated!.publishError).toContain('replicate queue timeout');
  });

  it('findStalePendingMediaPosts surfaces posts with old lastStepAt', async () => {
    const recent = await createPost({ ...basePost, status: 'PENDING_MEDIA', lastStepAt: new Date().toISOString() });
    const stale = await createPost({ ...basePost, status: 'PENDING_MEDIA', lastStepAt: new Date(Date.now() - 10 * 60 * 1000).toISOString() });
    const noStep = await createPost({ ...basePost, status: 'PENDING_MEDIA' });

    const stalePosts = await findStalePendingMediaPosts(new Date(Date.now() - 5 * 60 * 1000));
    const ids = stalePosts.map((p) => p.id);
    expect(ids).toContain(stale.id);
    expect(ids).toContain(noStep.id);
    expect(ids).not.toContain(recent.id);
  });

  it('findAllPendingMediaPosts returns every PENDING_MEDIA post', async () => {
    await createPost({ ...basePost, status: 'PENDING_MEDIA' });
    await createPost({ ...basePost, status: 'PENDING_MEDIA' });
    await createPost({ ...basePost, status: 'PENDING_APPROVAL' });
    const all = await findAllPendingMediaPosts();
    expect(all).toHaveLength(2);
  });
});
