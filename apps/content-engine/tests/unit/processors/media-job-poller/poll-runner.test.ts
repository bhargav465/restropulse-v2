import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const dbMocks = vi.hoisted(() => ({
  applyMediaJobResultToPost: vi.fn(),
  markPostFailedWithMedia: vi.fn(),
}));
vi.mock('@restropulse/db', () => dbMocks);

const { pollMediaJob } = await import(
  '../../../../src/services/processors/media-job-poller/poll-runner.js'
);

beforeEach(() => {
  vi.clearAllMocks();
});

const baseRunningJob = {
  id: 'mj1', jobId: 'job_v1', provider: 'fal-ai' as const,
  modelId: 'fal-ai/kling-video/v1.6/standard/text-to-video',
  postType: 'REEL' as const, status: 'RUNNING' as const,
  providerJobId: 'req_xyz', attempts: 1,
  startedAt: new Date(),
  createdAt: new Date(), updatedAt: new Date(),
};

const post = { id: 'p1', mediaJobId: 'job_v1', restaurantId: 'r1' };

describe('pollMediaJob', () => {
  it('reaps stale RUNNING jobs (>10 min) as FAILED and marks post FAILED', async () => {
    const stale = { ...baseRunningJob, startedAt: new Date(Date.now() - 11 * 60 * 1000) };
    const store = {
      findById: vi.fn(async () => stale),
      updateStatus: vi.fn(async () => ({ ...stale, status: 'FAILED' })),
      insert: vi.fn(), incrementAttempts: vi.fn(),
    };
    const media = { name: 'm', generateImage: vi.fn(), generateVideo: vi.fn(), pollJob: vi.fn() };

    await pollMediaJob(post as any, { store: store as any, media: media as any });

    expect(store.updateStatus).toHaveBeenCalledWith('job_v1', expect.objectContaining({ status: 'FAILED' }));
    expect(media.pollJob).not.toHaveBeenCalled();
    expect(dbMocks.markPostFailedWithMedia).toHaveBeenCalledWith('p1', expect.stringMatching(/stale|10/i));
  });

  it('delegates to media.pollJob for fresh RUNNING jobs', async () => {
    const fresh = { ...baseRunningJob, startedAt: new Date() };
    const store = {
      findById: vi.fn()
        .mockResolvedValueOnce(fresh)               // first lookup
        .mockResolvedValueOnce({ ...fresh, status: 'COMPLETED', mediaUrl: 'https://fal.media/v.mp4' }), // after pollJob
      updateStatus: vi.fn(), insert: vi.fn(), incrementAttempts: vi.fn(),
    };
    const media = {
      name: 'm', generateImage: vi.fn(), generateVideo: vi.fn(),
      pollJob: vi.fn(async () => ({ jobId: 'job_v1', status: 'COMPLETED', mediaUrl: 'https://fal.media/v.mp4' })),
    };
    await pollMediaJob(post as any, { store: store as any, media: media as any });
    expect(media.pollJob).toHaveBeenCalledWith('job_v1');
    expect(dbMocks.applyMediaJobResultToPost).toHaveBeenCalledTimes(1);
  });

  it('no-ops when the job is still RUNNING after pollJob', async () => {
    const fresh = { ...baseRunningJob, startedAt: new Date() };
    const store = {
      findById: vi.fn().mockResolvedValue(fresh),
      updateStatus: vi.fn(), insert: vi.fn(), incrementAttempts: vi.fn(),
    };
    const media = {
      name: 'm', generateImage: vi.fn(), generateVideo: vi.fn(),
      pollJob: vi.fn(async () => ({ jobId: 'job_v1', status: 'RUNNING' })),
    };
    await pollMediaJob(post as any, { store: store as any, media: media as any });
    expect(dbMocks.applyMediaJobResultToPost).not.toHaveBeenCalled();
    expect(dbMocks.markPostFailedWithMedia).not.toHaveBeenCalled();
  });

  it('marks post FAILED when pollJob returns FAILED status', async () => {
    const fresh = { ...baseRunningJob, startedAt: new Date() };
    const store = {
      findById: vi.fn()
        .mockResolvedValueOnce(fresh)
        .mockResolvedValueOnce({ ...fresh, status: 'FAILED', error: 'fal queue FAILED' }),
      updateStatus: vi.fn(), insert: vi.fn(), incrementAttempts: vi.fn(),
    };
    const media = {
      name: 'm', generateImage: vi.fn(), generateVideo: vi.fn(),
      pollJob: vi.fn(async () => ({ jobId: 'job_v1', status: 'FAILED', error: 'fal queue FAILED' })),
    };
    await pollMediaJob(post as any, { store: store as any, media: media as any });
    expect(dbMocks.markPostFailedWithMedia).toHaveBeenCalledWith('p1', expect.stringContaining('fal queue FAILED'));
  });

  it('skips silently when post.mediaJobId is unset', async () => {
    const store = { findById: vi.fn(), updateStatus: vi.fn(), insert: vi.fn(), incrementAttempts: vi.fn() };
    const media = { name: 'm', generateImage: vi.fn(), generateVideo: vi.fn(), pollJob: vi.fn() };
    await pollMediaJob({ id: 'p2' } as any, { store: store as any, media: media as any });
    expect(store.findById).not.toHaveBeenCalled();
  });
});
