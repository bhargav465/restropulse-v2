import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  trackAIUsage: vi.fn(),
}));

const db = vi.hoisted(() => ({ insertCostEvent: vi.fn().mockResolvedValue({ id: 'ce_1' }) }));
vi.mock('@restropulse/db', () => db);

const { ReplicateMediaGenerator } = await import(
  '../../../../../../../../src/services/content-generator/backends/ai/media/replicate/replicate-media-generator.js'
);

const parked = {
  jobId: 'job_v1',
  providerJobId: 'pred_old',
  provider: 'replicate' as const,
  modelId: 'kwaivgi/kling-v1.6-standard',
  postType: 'REEL' as const,
  status: 'PENDING' as const,
  attempts: 2,
  request: { prompt: 'Chef plating biryani' },
  restaurantId: 'r1',
  postId: 'p1',
  startedAt: new Date('2026-11-24T10:00:00Z'),
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeStore(record: Record<string, unknown> | null) {
  return {
    insert: vi.fn(async (r: Record<string, unknown>) => ({ ...r, createdAt: new Date(), updatedAt: new Date() })),
    findById: vi.fn(async () => record),
    updateStatus: vi.fn(async (_id: string, u: Record<string, unknown>) => (record ? { ...record, ...u } : null)),
    incrementAttempts: vi.fn(),
  };
}

beforeEach(() => vi.clearAllMocks());

describe('ReplicateMediaGenerator video retries', () => {
  it('stores the prompt and first start time on the first submission', async () => {
    const client = { createPrediction: vi.fn(async () => ({ id: 'pred_1', status: 'starting' })), getPrediction: vi.fn() };
    const store = makeStore(null);
    const gen = new ReplicateMediaGenerator({ client: client as any, store: store as any });

    await gen.generateVideo({ postType: 'REEL', platform: 'INSTAGRAM', concept: 'Chef cooking biryani' });

    const inserted = store.insert.mock.calls[0]![0] as Record<string, any>;
    expect(inserted.request.prompt).toContain('biryani');
    expect(inserted.firstStartedAt).toEqual(inserted.startedAt);
    expect(inserted.status).toBe('RUNNING');
  });

  it('resubmits on the primary model and moves the job to RUNNING as the next attempt', async () => {
    const client = { createPrediction: vi.fn(async () => ({ id: 'pred_new', status: 'starting' })), getPrediction: vi.fn() };
    const store = makeStore(parked);
    const gen = new ReplicateMediaGenerator({ client: client as any, store: store as any });

    const job = await gen.retryVideoJob('job_v1', { useAlternateModel: false });

    const [slug, input] = client.createPrediction.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(slug).toBe('kwaivgi/kling-v1.6-standard');
    expect(input).toEqual({ prompt: 'Chef plating biryani', duration: 5, aspect_ratio: '16:9' });
    expect(store.updateStatus).toHaveBeenCalledWith('job_v1', expect.objectContaining({
      status: 'RUNNING', providerJobId: 'pred_new', attempts: 3, nextAttemptAt: null,
    }));
    expect(job.status).toBe('RUNNING');
  });

  it('uses the alternate model with its own input shape and price', async () => {
    const client = { createPrediction: vi.fn(async () => ({ id: 'pred_alt', status: 'starting' })), getPrediction: vi.fn() };
    const store = makeStore(parked);
    const gen = new ReplicateMediaGenerator({ client: client as any, store: store as any });

    await gen.retryVideoJob('job_v1', { useAlternateModel: true });

    const [slug, input] = client.createPrediction.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(slug).toBe('minimax/video-01');
    expect(input).toEqual({ prompt: 'Chef plating biryani', prompt_optimizer: true });
    expect(store.updateStatus).toHaveBeenCalledWith('job_v1', expect.objectContaining({ modelId: 'minimax/video-01' }));
    expect(db.insertCostEvent).toHaveBeenCalledWith(expect.objectContaining({ model: 'minimax/video-01', costUsd: 0.5 }));
  });

  it('marks the attempt FAILED (not final) when the submission throws', async () => {
    const client = { createPrediction: vi.fn(async () => { throw new Error('502 Bad Gateway'); }), getPrediction: vi.fn() };
    const store = makeStore(parked);
    const gen = new ReplicateMediaGenerator({ client: client as any, store: store as any });

    const job = await gen.retryVideoJob('job_v1', { useAlternateModel: false });

    expect(client.createPrediction).toHaveBeenCalledOnce();
    expect(store.updateStatus).toHaveBeenCalledWith('job_v1', expect.objectContaining({
      status: 'FAILED', attempts: 3, error: '502 Bad Gateway',
    }));
    expect(job.status).toBe('FAILED');
  });

  it('does nothing for a job that is not parked', async () => {
    const client = { createPrediction: vi.fn(), getPrediction: vi.fn() };
    const store = makeStore({ ...parked, status: 'RUNNING' });
    const gen = new ReplicateMediaGenerator({ client: client as any, store: store as any });

    const job = await gen.retryVideoJob('job_v1', { useAlternateModel: false });

    expect(client.createPrediction).not.toHaveBeenCalled();
    expect(job.status).toBe('RUNNING');
  });

  it('does nothing for a job without a stored request', async () => {
    const { request: _omit, ...legacy } = parked;
    const client = { createPrediction: vi.fn(), getPrediction: vi.fn() };
    const store = makeStore(legacy);
    const gen = new ReplicateMediaGenerator({ client: client as any, store: store as any });

    await gen.retryVideoJob('job_v1', { useAlternateModel: false });

    expect(client.createPrediction).not.toHaveBeenCalled();
  });

  it('reports a missing job as FAILED', async () => {
    const gen = new ReplicateMediaGenerator({ client: { createPrediction: vi.fn(), getPrediction: vi.fn() } as any, store: makeStore(null) as any });
    expect((await gen.retryVideoJob('nope', { useAlternateModel: false })).status).toBe('FAILED');
  });
});
