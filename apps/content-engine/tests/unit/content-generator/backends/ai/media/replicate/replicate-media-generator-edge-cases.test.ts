import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  trackAIUsage: vi.fn(),
}));

vi.mock('@restropulse/db', () => ({
  insertCostEvent: vi.fn().mockResolvedValue({ id: 'ce_1' }),
}));

const { ReplicateMediaGenerator } = await import(
  '../../../../../../../../src/services/content-generator/backends/ai/media/replicate/replicate-media-generator.js'
);

const IDS = { restaurantId: 'r1', postId: 'p1', cycleId: 'c1' };
const image = { postType: 'IMAGE' as const, platforms: ['INSTAGRAM' as const], concept: 'Biryani' };
const video = { postType: 'REEL' as const, platforms: ['INSTAGRAM' as const], concept: 'Chef at work' };
const URL_A = 'https://replicate.delivery/a.webp';

function makeStore(record: Record<string, unknown> | null = {}) {
  const base = {
    jobId: 'job_1',
    providerJobId: 'pred_1',
    provider: 'replicate' as const,
    modelId: 'kwaivgi/kling-v1.6-standard',
    postType: 'REEL' as const,
    status: 'RUNNING' as const,
    attempts: 1,
    startedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...record,
  };
  return {
    insert: vi.fn().mockImplementation((doc) => Promise.resolve({ ...base, ...doc })),
    findById: vi.fn().mockResolvedValue(record === null ? null : base),
    updateStatus: vi.fn().mockImplementation((_id, update) => Promise.resolve({ ...base, ...update })),
    incrementAttempts: vi.fn().mockResolvedValue(undefined),
  };
}

function makeClient(overrides: { create?: unknown; poll?: unknown } = {}) {
  return {
    createPrediction: overrides.create ?? vi.fn().mockResolvedValue({ id: 'pred_1', status: 'starting', output: null }),
    getPrediction:
      overrides.poll ?? vi.fn().mockResolvedValue({ id: 'pred_1', status: 'succeeded', output: [URL_A] }),
  } as never;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

describe('constructor validation', () => {
  it('requires a client', () => {
    expect(() => new ReplicateMediaGenerator({ store: makeStore() } as never)).toThrow('requires { client, store }');
  });
  it('requires a store', () => {
    expect(() => new ReplicateMediaGenerator({ client: makeClient() } as never)).toThrow('requires { client, store }');
  });
});

describe('generateVideo', () => {
  it('records optional ids only when provided', async () => {
    const withIds = makeStore();
    await new ReplicateMediaGenerator({ client: makeClient(), store: withIds }).generateVideo({ ...video, ...IDS });
    expect(withIds.insert).toHaveBeenCalledWith(expect.objectContaining({ ...IDS, status: 'RUNNING' }));

    const withoutIds = makeStore();
    await new ReplicateMediaGenerator({ client: makeClient(), store: withoutIds }).generateVideo(video);
    const doc = withoutIds.insert.mock.calls[0][0];
    expect(doc).not.toHaveProperty('restaurantId');
    expect(doc).not.toHaveProperty('postId');
    expect(doc).not.toHaveProperty('cycleId');
  });

  it('inserts a FAILED job when submission is rejected (with ids)', async () => {
    const store = makeStore();
    const client = makeClient({ create: vi.fn().mockRejectedValue(new Error('invalid input')) });
    const job = await new ReplicateMediaGenerator({ client, store }).generateVideo({ ...video, ...IDS });

    expect(job.status).toBe('FAILED');
    expect(store.insert).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED', error: 'invalid input', ...IDS }));
  });

  it('inserts a FAILED job without ids and falls back to "unknown" when the error has no message', async () => {
    const store = makeStore();
    const client = makeClient({ create: vi.fn().mockRejectedValue({}) });
    await new ReplicateMediaGenerator({ client, store }).generateVideo(video);

    const doc = store.insert.mock.calls[0][0];
    expect(doc).toMatchObject({ status: 'FAILED', error: 'unknown' });
    expect(doc).not.toHaveProperty('postId');
  });
});

describe('pollJob', () => {
  it('reports FAILED when the job row is missing', async () => {
    const job = await new ReplicateMediaGenerator({ client: makeClient(), store: makeStore(null) }).pollJob('nope');
    expect(job).toEqual({ jobId: 'nope', status: 'FAILED', error: 'job not found' });
  });

  it('returns already-terminal jobs untouched, without polling Replicate', async () => {
    const client = makeClient();
    const store = makeStore({ status: 'COMPLETED', mediaUrl: 'https://blob/x.webp', mediaUrls: ['https://blob/x.webp'], thumbnail: 'https://blob/t.webp', metadata: { width: 1 }, error: undefined });
    const job = await new ReplicateMediaGenerator({ client, store }).pollJob('job_1');

    expect(job).toMatchObject({ status: 'COMPLETED', mediaUrl: 'https://blob/x.webp', mediaUrls: ['https://blob/x.webp'], thumbnail: 'https://blob/t.webp', metadata: { width: 1 } });
    expect((client as any).getPrediction).not.toHaveBeenCalled();
  });

  it('does not poll a RUNNING job that has no provider job id', async () => {
    const client = makeClient();
    const store = makeStore({ providerJobId: undefined });
    const job = await new ReplicateMediaGenerator({ client, store }).pollJob('job_1');

    expect(job.status).toBe('RUNNING');
    expect((client as any).getPrediction).not.toHaveBeenCalled();
  });

  it('leaves the job RUNNING when the Replicate poll itself fails', async () => {
    const client = makeClient({ poll: vi.fn().mockRejectedValue(new Error('network')) });
    const store = makeStore();
    const job = await new ReplicateMediaGenerator({ client, store }).pollJob('job_1');

    expect(job.status).toBe('RUNNING');
    expect(store.updateStatus).not.toHaveBeenCalled();
  });

  it('keeps a still-processing job RUNNING and stamps the poll time', async () => {
    const client = makeClient({ poll: vi.fn().mockResolvedValue({ id: 'pred_1', status: 'processing', output: null }) });
    const store = makeStore();
    const job = await new ReplicateMediaGenerator({ client, store }).pollJob('job_1');

    expect(job.status).toBe('RUNNING');
    expect(store.updateStatus).toHaveBeenCalledWith('job_1', { lastPolledAt: expect.any(Date) });
  });

  it('fails the job with Replicate\'s error message', async () => {
    const client = makeClient({ poll: vi.fn().mockResolvedValue({ id: 'pred_1', status: 'failed', output: null, error: 'NSFW content' }) });
    const store = makeStore();
    const job = await new ReplicateMediaGenerator({ client, store }).pollJob('job_1');

    expect(job).toMatchObject({ status: 'FAILED', error: 'NSFW content' });
  });

  it('fails a canceled prediction with a generic message when Replicate gives none', async () => {
    const client = makeClient({ poll: vi.fn().mockResolvedValue({ id: 'pred_1', status: 'canceled', output: null }) });
    const job = await new ReplicateMediaGenerator({ client, store: makeStore() }).pollJob('job_1');

    expect(job).toMatchObject({ status: 'FAILED', error: 'Replicate prediction canceled' });
  });

  it('falls back to the pre-update record when the store returns nothing', async () => {
    const store = makeStore();
    store.updateStatus.mockResolvedValue(undefined);

    const succeeded = await new ReplicateMediaGenerator({ client: makeClient(), store }).pollJob('job_1');
    expect(succeeded.status).toBe('RUNNING');

    const noUrl = await new ReplicateMediaGenerator({ client: makeClient({ poll: vi.fn().mockResolvedValue({ id: 'p', status: 'succeeded', output: null }) }), store }).pollJob('job_1');
    expect(noUrl.status).toBe('RUNNING');

    const failed = await new ReplicateMediaGenerator({ client: makeClient({ poll: vi.fn().mockResolvedValue({ id: 'p', status: 'failed', output: null }) }), store }).pollJob('job_1');
    expect(failed.status).toBe('RUNNING');
  });

  it('accepts output given as a bare string or an array', async () => {
    for (const output of [URL_A, [URL_A]]) {
      const store = makeStore();
      const client = makeClient({ poll: vi.fn().mockResolvedValue({ id: 'pred_1', status: 'succeeded', output }) });
      const job = await new ReplicateMediaGenerator({ client, store }).pollJob('job_1');
      expect(job).toMatchObject({ status: 'COMPLETED', mediaUrl: URL_A });
    }
  });

  it('passes record ids to storage only when they exist', async () => {
    const persist = vi.fn().mockResolvedValue('https://blob/x.webp');
    const storage = { name: 't', durable: true, persist };

    await new ReplicateMediaGenerator({ client: makeClient(), store: makeStore({ restaurantId: 'r1', postId: 'p1' }), storage }).pollJob('job_1');
    expect(persist).toHaveBeenLastCalledWith(URL_A, { restaurantId: 'r1', postId: 'p1', jobId: 'job_1' });

    await new ReplicateMediaGenerator({ client: makeClient(), store: makeStore({ restaurantId: undefined, postId: undefined }), storage }).pollJob('job_1');
    expect(persist).toHaveBeenLastCalledWith(URL_A, { jobId: 'job_1' });
  });
});

describe('generateImage', () => {
  it('omits optional ids from the stored job when none are given', async () => {
    vi.useFakeTimers();
    const store = makeStore({ postType: 'IMAGE' });
    const pending = new ReplicateMediaGenerator({ client: makeClient(), store }).generateImage(image);
    await vi.runAllTimersAsync();
    await pending;

    const doc = store.insert.mock.calls[0][0];
    expect(doc).toMatchObject({ status: 'COMPLETED' });
    expect(doc).not.toHaveProperty('restaurantId');
    expect(doc).not.toHaveProperty('cycleId');
  });

  it('fails the job when submission is rejected, with and without ids', async () => {
    const rejecting = makeClient({ create: vi.fn().mockRejectedValue(new Error('bad prompt')) });

    const withIds = makeStore({ postType: 'IMAGE' });
    const a = await new ReplicateMediaGenerator({ client: rejecting, store: withIds }).generateImage({ ...image, ...IDS });
    expect(a.status).toBe('FAILED');
    expect(withIds.insert).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED', error: 'bad prompt', ...IDS }));

    const noIds = makeStore({ postType: 'IMAGE' });
    await new ReplicateMediaGenerator({ client: makeClient({ create: vi.fn().mockRejectedValue({}) }), store: noIds }).generateImage(image);
    expect(noIds.insert.mock.calls[0][0]).toMatchObject({ error: 'unknown' });
  });

  it('fails the job when the prediction succeeds without an output URL', async () => {
    vi.useFakeTimers();
    const store = makeStore({ postType: 'IMAGE' });
    const client = makeClient({ poll: vi.fn().mockResolvedValue({ id: 'pred_1', status: 'succeeded', output: null }) });
    const pending = new ReplicateMediaGenerator({ client, store }).generateImage(image);
    await vi.runAllTimersAsync();

    expect((await pending).status).toBe('FAILED');
    expect(store.insert.mock.calls[0][0].error).toContain('no URL');
  });

  it('gives up with a timeout error when the prediction never finishes', async () => {
    vi.useFakeTimers();
    const store = makeStore({ postType: 'IMAGE' });
    const client = makeClient({ poll: vi.fn().mockResolvedValue({ id: 'pred_1', status: 'processing', output: null }) });
    const pending = new ReplicateMediaGenerator({ client, store }).generateImage(image);
    await vi.runAllTimersAsync();

    expect((await pending).status).toBe('FAILED');
    expect(store.insert.mock.calls[0][0].error).toContain('timed out');
  });
});

describe('generateCarousel', () => {
  it('fails when every frame fails', async () => {
    const store = makeStore({ postType: 'IMAGE' });
    const client = makeClient({ create: vi.fn().mockRejectedValue(new Error('down')) });
    const job = await new ReplicateMediaGenerator({ client, store }).generateCarousel({ platforms: ['INSTAGRAM'], concept: 'x' });

    expect(job).toMatchObject({ status: 'FAILED', error: 'all carousel frames failed' });
  });

  it('uses per-slide briefs for both the count and the prompts', async () => {
    vi.useFakeTimers();
    const create = vi.fn().mockResolvedValue({ id: 'pred_1', status: 'starting', output: null });
    const store = makeStore({ postType: 'IMAGE' });
    const pending = new ReplicateMediaGenerator({ client: makeClient({ create }), store }).generateCarousel({
      platforms: ['INSTAGRAM'],
      concept: 'Thali',
      slideDirections: ['hero plate', 'spice detail'],
    });
    await vi.runAllTimersAsync();
    await pending;

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][1].prompt).toContain('hero plate');
    expect(create.mock.calls[1][1].prompt).toContain('spice detail');
  });

  it('honours slideCount and caps it at 10', async () => {
    vi.useFakeTimers();
    const create = vi.fn().mockResolvedValue({ id: 'pred_1', status: 'starting', output: null });
    const gen = new ReplicateMediaGenerator({ client: makeClient({ create }), store: makeStore({ postType: 'IMAGE' }) });

    const five = gen.generateCarousel({ platforms: ['INSTAGRAM'], concept: 'x', slideCount: 5 });
    await vi.runAllTimersAsync();
    await five;
    expect(create).toHaveBeenCalledTimes(5);

    create.mockClear();
    const many = gen.generateCarousel({ platforms: ['INSTAGRAM'], concept: 'x', slideCount: 25 });
    await vi.runAllTimersAsync();
    await many;
    expect(create).toHaveBeenCalledTimes(10);
  });
});
