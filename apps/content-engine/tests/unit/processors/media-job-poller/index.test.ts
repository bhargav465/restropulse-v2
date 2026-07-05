import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const dbMocks = vi.hoisted(() => ({
  findAllPendingMediaPosts: vi.fn().mockResolvedValue([
    { id: 'p1', mediaJobId: 'j1' },
    { id: 'p2', mediaJobId: 'j2' },
    { id: 'p3' /* no mediaJobId */ },
  ]),
}));
vi.mock('@restropulse/db', () => dbMocks);

const pollMediaJobMock = vi.fn();
vi.mock('../../../../src/services/processors/media-job-poller/poll-runner.js', () => ({
  pollMediaJob: pollMediaJobMock,
}));

const {
  processMediaJobs,
  createMediaJobPollerProcessor,
} = await import('../../../../src/services/processors/media-job-poller/index.js');

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.findAllPendingMediaPosts.mockResolvedValue([
    { id: 'p1', mediaJobId: 'j1' },
    { id: 'p2', mediaJobId: 'j2' },
    { id: 'p3' /* no mediaJobId -- pollMediaJob skips */ },
  ]);
});

describe('media-job-poller processor', () => {
  it('createMediaJobPollerProcessor returns IProcessor with name + cron + run', () => {
    const p = createMediaJobPollerProcessor('*/30 * * * * *', { store: {} as any, media: {} as any });
    expect(p.name).toBe('media-job-poller');
    expect(p.cron).toBe('*/30 * * * * *');
    expect(typeof p.run).toBe('function');
  });

  it('processMediaJobs invokes pollMediaJob for every PENDING_MEDIA post', async () => {
    const deps = { store: {} as any, media: {} as any };
    await processMediaJobs(deps);
    expect(pollMediaJobMock).toHaveBeenCalledTimes(3);
  });

  it('a single post failure does not stop the loop', async () => {
    pollMediaJobMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);
    const deps = { store: {} as any, media: {} as any };
    await processMediaJobs(deps);
    expect(pollMediaJobMock).toHaveBeenCalledTimes(3);
  });
});
