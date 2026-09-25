import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const dbMocks = vi.hoisted(() => ({
  findStalePendingMediaPosts: vi.fn(),
}));
vi.mock('@restropulse/db', () => dbMocks);

const pollMediaJobMock = vi.fn();
vi.mock('../../src/services/processors/media-job-poller/poll-runner.js', () => ({
  pollMediaJob: pollMediaJobMock,
}));

const { runPostResumeOnBoot } = await import('../../src/services/post-resume.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runPostResumeOnBoot', () => {
  it('polls every stale PENDING_MEDIA post', async () => {
    dbMocks.findStalePendingMediaPosts.mockResolvedValueOnce([
      { id: 'p1', mediaJobId: 'j1' },
      { id: 'p2', mediaJobId: 'j2' },
    ]);
    await runPostResumeOnBoot({ store: {} as any, media: {} as any });
    expect(pollMediaJobMock).toHaveBeenCalledTimes(2);
  });

  it('no-ops when there are no stale posts', async () => {
    dbMocks.findStalePendingMediaPosts.mockResolvedValueOnce([]);
    await runPostResumeOnBoot({ store: {} as any, media: {} as any });
    expect(pollMediaJobMock).not.toHaveBeenCalled();
  });

  it('one failed poll does not stop the loop', async () => {
    dbMocks.findStalePendingMediaPosts.mockResolvedValueOnce([
      { id: 'a', mediaJobId: 'j1' },
      { id: 'b', mediaJobId: 'j2' },
    ]);
    pollMediaJobMock
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValueOnce(undefined);
    await runPostResumeOnBoot({ store: {} as any, media: {} as any });
    expect(pollMediaJobMock).toHaveBeenCalledTimes(2);
  });
});
