import { describe, it, expect, vi, beforeEach } from 'vitest';

const telemetry = vi.hoisted(() => ({ trackEvent: vi.fn() }));
vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  trackEvent: telemetry.trackEvent,
}));

const dbMocks = vi.hoisted(() => ({
  applyMediaJobResultToPost: vi.fn(),
  markPostFailedWithMedia: vi.fn(),
}));
vi.mock('@restropulse/db', () => dbMocks);

const { pollMediaJob, VIDEO_ATTEMPT_FAILED_EVENT, VIDEO_GAVE_UP_EVENT } = await import(
  '../../../../src/services/processors/media-job-poller/poll-runner.js'
);
const { DEFAULT_VIDEO_RETRY_POLICY } = await import(
  '../../../../src/services/processors/media-job-poller/video-retry-policy.js'
);

const MIN = 60 * 1000;
const NOW = new Date('2026-11-24T12:00:00Z');
const post = { id: 'p1', mediaJobId: 'job_v1', restaurantId: 'r1' };

function videoJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mj1', jobId: 'job_v1', provider: 'replicate' as const,
    modelId: 'kwaivgi/kling-v1.6-standard', postType: 'REEL' as const,
    status: 'RUNNING' as const, providerJobId: 'pred_1', attempts: 1,
    request: { prompt: 'Chef plating biryani' },
    attemptHistory: [] as unknown[],
    startedAt: new Date(NOW.getTime() - 5 * MIN),
    firstStartedAt: new Date(NOW.getTime() - 5 * MIN),
    restaurantId: 'r1',
    createdAt: NOW, updatedAt: NOW,
    ...overrides,
  };
}

function makeStore(...states: unknown[]) {
  const findById = vi.fn();
  for (const s of states) findById.mockResolvedValueOnce(s);
  findById.mockResolvedValue(states[states.length - 1]);
  return { findById, updateStatus: vi.fn(async () => null), insert: vi.fn(), incrementAttempts: vi.fn() };
}

function makeMedia(overrides: Record<string, unknown> = {}) {
  return {
    name: 'm', generateImage: vi.fn(), generateCarousel: vi.fn(), generateVideo: vi.fn(),
    pollJob: vi.fn(async () => ({ jobId: 'job_v1', status: 'RUNNING' })),
    retryVideoJob: vi.fn(async () => ({ jobId: 'job_v1', status: 'RUNNING' })),
    ...overrides,
  };
}

const deps = (store: unknown, media: unknown) => ({
  store: store as any, media: media as any, policy: DEFAULT_VIDEO_RETRY_POLICY, now: () => NOW,
});

beforeEach(() => vi.clearAllMocks());

describe('pollMediaJob video retries', () => {
  it('parks a failed attempt as PENDING with backoff and keeps the post', async () => {
    const running = videoJob();
    const failed = videoJob({ status: 'FAILED', error: 'Prediction timed out' });
    const store = makeStore(running, failed);
    await pollMediaJob(post as any, deps(store, makeMedia()));

    expect(store.updateStatus).toHaveBeenCalledWith('job_v1', expect.objectContaining({
      status: 'PENDING',
      nextAttemptAt: new Date(NOW.getTime() + 2 * MIN),
      attemptHistory: [expect.objectContaining({ attempt: 1, errorClass: 'retryable', error: 'Prediction timed out' })],
    }));
    expect(dbMocks.markPostFailedWithMedia).not.toHaveBeenCalled();
    expect(telemetry.trackEvent).toHaveBeenCalledWith(VIDEO_ATTEMPT_FAILED_EVENT, expect.objectContaining({ attempt: '1' }));
  });

  it('treats an attempt past 20 minutes as a failed attempt, not a failed post', async () => {
    const stale = videoJob({ startedAt: new Date(NOW.getTime() - 21 * MIN) });
    const store = makeStore(stale);
    const media = makeMedia();
    await pollMediaJob(post as any, deps(store, media));

    expect(media.pollJob).not.toHaveBeenCalled();
    expect(store.updateStatus).toHaveBeenCalledWith('job_v1', expect.objectContaining({ status: 'PENDING' }));
    expect(dbMocks.markPostFailedWithMedia).not.toHaveBeenCalled();
  });

  it('fails the post at once on a content-policy rejection', async () => {
    const store = makeStore(videoJob(), videoJob({ status: 'FAILED', error: 'NSFW content detected' }));
    await pollMediaJob(post as any, deps(store, makeMedia()));

    expect(store.updateStatus).toHaveBeenCalledWith('job_v1', expect.objectContaining({
      status: 'FAILED',
      attemptHistory: [expect.objectContaining({ errorClass: 'permanent' })],
    }));
    expect(dbMocks.markPostFailedWithMedia).toHaveBeenCalledWith('p1', expect.stringMatching(/rejected/i));
    expect(telemetry.trackEvent).toHaveBeenCalledWith(VIDEO_GAVE_UP_EVENT, expect.anything());
  });

  it('fails the post once the eighth attempt fails', async () => {
    const history = Array.from({ length: 7 }, (_, i) => ({ attempt: i + 1 }));
    const store = makeStore(
      videoJob({ attempts: 8, attemptHistory: history }),
      videoJob({ attempts: 8, attemptHistory: history, status: 'FAILED', error: 'timed out' }),
    );
    await pollMediaJob(post as any, deps(store, makeMedia()));

    expect(store.updateStatus).toHaveBeenCalledWith('job_v1', expect.objectContaining({ status: 'FAILED' }));
    expect(dbMocks.markPostFailedWithMedia).toHaveBeenCalledWith('p1', expect.stringMatching(/8 attempts/));
  });

  it('waits while a parked job is not yet due', async () => {
    const parked = videoJob({ status: 'PENDING', nextAttemptAt: new Date(NOW.getTime() + MIN) });
    const store = makeStore(parked);
    const media = makeMedia();
    await pollMediaJob(post as any, deps(store, media));

    expect(media.retryVideoJob).not.toHaveBeenCalled();
    expect(store.updateStatus).not.toHaveBeenCalled();
  });

  it('resubmits a due job on the primary model for attempt 2', async () => {
    const parked = videoJob({ status: 'PENDING', nextAttemptAt: new Date(NOW.getTime() - MIN), attemptHistory: [{ attempt: 1 }] });
    const store = makeStore(parked, videoJob({ attempts: 2, attemptHistory: [{ attempt: 1 }] }));
    const media = makeMedia();
    await pollMediaJob(post as any, deps(store, media));

    expect(media.retryVideoJob).toHaveBeenCalledWith('job_v1', { useAlternateModel: false });
    expect(media.pollJob).not.toHaveBeenCalled();
  });

  it('resubmits attempt 3 on the alternate model', async () => {
    const history = [{ attempt: 1 }, { attempt: 2 }];
    const parked = videoJob({ status: 'PENDING', attempts: 2, nextAttemptAt: NOW, attemptHistory: history });
    const store = makeStore(parked, videoJob({ attempts: 3, attemptHistory: history }));
    const media = makeMedia();
    await pollMediaJob(post as any, deps(store, media));

    expect(media.retryVideoJob).toHaveBeenCalledWith('job_v1', { useAlternateModel: true });
  });

  it('records a resubmission that failed to submit as a failed attempt', async () => {
    const history = [{ attempt: 1 }];
    const parked = videoJob({ status: 'PENDING', nextAttemptAt: NOW, attemptHistory: history });
    const failedSubmit = videoJob({ status: 'FAILED', attempts: 2, attemptHistory: history, error: '502 Bad Gateway' });
    const store = makeStore(parked, failedSubmit);
    await pollMediaJob(post as any, deps(store, makeMedia()));

    expect(store.updateStatus).toHaveBeenCalledWith('job_v1', expect.objectContaining({
      status: 'PENDING',
      nextAttemptAt: new Date(NOW.getTime() + 10 * MIN),
      attemptHistory: [{ attempt: 1 }, expect.objectContaining({ attempt: 2, error: '502 Bad Gateway' })],
    }));
    expect(dbMocks.markPostFailedWithMedia).not.toHaveBeenCalled();
  });

  it('gives up on a parked job when the generator cannot resubmit', async () => {
    const parked = videoJob({ status: 'PENDING', nextAttemptAt: NOW });
    const store = makeStore(parked);
    const media = makeMedia({ retryVideoJob: undefined });
    await pollMediaJob(post as any, deps(store, media));

    expect(store.updateStatus).toHaveBeenCalledWith('job_v1', expect.objectContaining({ status: 'FAILED' }));
    expect(dbMocks.markPostFailedWithMedia).toHaveBeenCalledWith('p1', expect.stringMatching(/cannot be resubmitted/));
  });

  it('re-applies a final failure without retrying again', async () => {
    const final = videoJob({ status: 'FAILED', attempts: 2, attemptHistory: [{ attempt: 1 }, { attempt: 2 }], error: 'gave up' });
    const store = makeStore(final);
    const media = makeMedia();
    await pollMediaJob(post as any, deps(store, media));

    expect(store.updateStatus).not.toHaveBeenCalled();
    expect(media.retryVideoJob).not.toHaveBeenCalled();
    expect(dbMocks.markPostFailedWithMedia).toHaveBeenCalledWith('p1', 'gave up');
  });

  it('applies the result when a retried attempt completes', async () => {
    const done = videoJob({ status: 'COMPLETED', attempts: 3, mediaUrl: 'https://blob/v.mp4' });
    const store = makeStore(videoJob({ attempts: 3 }), done);
    await pollMediaJob(post as any, deps(store, makeMedia()));

    expect(dbMocks.applyMediaJobResultToPost).toHaveBeenCalledWith('p1', done);
  });
});
