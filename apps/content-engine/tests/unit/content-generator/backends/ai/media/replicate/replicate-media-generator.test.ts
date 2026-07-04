import { describe, it, expect, vi, beforeEach } from 'vitest';

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

const baseImageInput = {
  postType: 'IMAGE' as const,
  platforms: ['INSTAGRAM' as const],
  concept: 'A plate of biryani',
  restaurantId: 'r1',
  postId: 'p1',
  cycleId: 'c1',
};

const baseVideoInput = {
  postType: 'REEL' as const,
  platforms: ['INSTAGRAM' as const],
  concept: 'Chef cooking biryani',
  restaurantId: 'r1',
  postId: 'p1',
  cycleId: 'c1',
};

function makeStore(record?: Partial<import('@restropulse/shared').MediaJobRecord>) {
  const base = {
    jobId: 'job_1',
    providerJobId: 'pred_1',
    provider: 'replicate' as const,
    modelId: 'black-forest-labs/flux-dev',
    postType: 'IMAGE' as const,
    status: 'RUNNING' as const,
    attempts: 1,
    startedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...record,
  };
  return {
    insert: vi.fn().mockResolvedValue(base),
    findById: vi.fn().mockResolvedValue(base),
    updateStatus: vi.fn().mockImplementation((_, update) =>
      Promise.resolve({ ...base, ...update })
    ),
    incrementAttempts: vi.fn().mockResolvedValue(undefined),
  };
}

function makeClient(overrides?: {
  createResponse?: unknown;
  pollResponses?: unknown[];
}) {
  let pollCallCount = 0;
  const pollResponses = overrides?.pollResponses ?? [
    { id: 'pred_1', status: 'processing', output: null },
    { id: 'pred_1', status: 'succeeded', output: ['https://replicate.delivery/img.webp'] },
  ];
  return {
    createPrediction: vi.fn().mockResolvedValue(
      overrides?.createResponse ?? { id: 'pred_1', status: 'starting', output: null }
    ),
    getPrediction: vi.fn().mockImplementation(() => {
      const resp = pollResponses[Math.min(pollCallCount, pollResponses.length - 1)];
      pollCallCount++;
      return Promise.resolve(resp);
    }),
  };
}

// Speed up in-process polling for tests
vi.mock('../../../../../../../../src/services/content-generator/backends/ai/media/replicate/replicate-media-generator.js', async (importOriginal) => {
  const mod = await importOriginal() as any;
  // Patch the sleep by making IMAGE_POLL_INTERVAL_MS effectively 0
  // We achieve this by reimporting with vi.importActual approach — instead just
  // use a very short sleep via vi.useFakeTimers approach is complex; use real timers but patch sleep.
  return mod;
});

beforeEach(() => vi.clearAllMocks());

describe('ReplicateMediaGenerator', () => {
  describe('constructor', () => {
    it('throws if options missing', () => {
      expect(() => new ReplicateMediaGenerator({} as any)).toThrow();
    });
  });

  describe('generateImage (IMAGE)', () => {
    it('submits prediction and polls until succeeded, returns COMPLETED job', async () => {
      const client = makeClient();
      const store = makeStore({ status: 'COMPLETED', mediaUrl: 'https://replicate.delivery/img.webp' });
      const gen = new ReplicateMediaGenerator({ client, store });

      const job = await gen.generateImage(baseImageInput);

      expect(client.createPrediction).toHaveBeenCalledOnce();
      const [modelSlug, input] = client.createPrediction.mock.calls[0];
      expect(modelSlug).toBe('black-forest-labs/flux-dev');
      expect(input.prompt).toContain('biryani');
      expect(input.aspect_ratio).toBe('1:1');
      expect(input.num_outputs).toBe(1);
      expect(job.status).toBe('COMPLETED');
    });

    it('uses portrait aspect ratio for STORY', async () => {
      const client = makeClient();
      const store = makeStore({ status: 'COMPLETED', mediaUrl: 'https://replicate.delivery/img.webp' });
      const gen = new ReplicateMediaGenerator({ client, store });

      await gen.generateImage({ ...baseImageInput, postType: 'STORY' });

      const [, input] = client.createPrediction.mock.calls[0];
      expect(input.aspect_ratio).toBe('9:16');
    });

    it('returns FAILED job if prediction fails', async () => {
      const client = makeClient({
        pollResponses: [
          { id: 'pred_1', status: 'failed', output: null, error: 'out of memory' },
        ],
      });
      const store = makeStore({ status: 'FAILED' });
      const gen = new ReplicateMediaGenerator({ client, store });

      const job = await gen.generateImage(baseImageInput);

      expect(store.insert).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED' }));
      expect(job.status).toBe('FAILED');
    });
  });

  describe('generateCarousel', () => {
    it('fans out to 3 parallel frames', async () => {
      const client = makeClient();
      const store = makeStore({ status: 'COMPLETED', mediaUrl: 'https://replicate.delivery/img.webp' });
      const gen = new ReplicateMediaGenerator({ client, store });

      const job = await gen.generateCarousel({
        platforms: baseImageInput.platforms,
        concept: baseImageInput.concept,
      });

      expect(client.createPrediction).toHaveBeenCalledTimes(3);
      expect(job.status).toBe('COMPLETED');
      expect(job.mediaUrls?.length).toBeGreaterThan(0);
    });
  });

  describe('generateVideo', () => {
    it('submits to Kling and returns RUNNING job without polling', async () => {
      const client = makeClient();
      const store = makeStore({ status: 'RUNNING', modelId: 'kwaivgi/kling-v1.6-standard' });
      const gen = new ReplicateMediaGenerator({ client, store });

      const job = await gen.generateVideo(baseVideoInput);

      expect(client.createPrediction).toHaveBeenCalledOnce();
      const [modelSlug, input] = client.createPrediction.mock.calls[0];
      expect(modelSlug).toBe('kwaivgi/kling-v1.6-standard');
      expect(input.prompt).toContain('biryani');
      expect(input.duration).toBe(5);
      expect(input.aspect_ratio).toBe('16:9');
      expect(client.getPrediction).not.toHaveBeenCalled();
      expect(job.status).toBe('RUNNING');
    });

    it('stores providerJobId from prediction id', async () => {
      const client = makeClient({ createResponse: { id: 'pred_99', status: 'starting', output: null } });
      const store = makeStore({ status: 'RUNNING', providerJobId: 'pred_99' });
      const gen = new ReplicateMediaGenerator({ client, store });

      await gen.generateVideo(baseVideoInput);

      expect(store.insert).toHaveBeenCalledWith(expect.objectContaining({ providerJobId: 'pred_99' }));
    });

    it('returns FAILED job when submission throws', async () => {
      const client = { createPrediction: vi.fn().mockRejectedValue(new Error('auth failed')), getPrediction: vi.fn() };
      const store = makeStore({ status: 'FAILED' });
      const gen = new ReplicateMediaGenerator({ client, store });

      const job = await gen.generateVideo(baseVideoInput);

      expect(store.insert).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED' }));
      expect(job.status).toBe('FAILED');
    });
  });

  describe('pollJob', () => {
    it('returns FAILED job not found when store has no record', async () => {
      const client = makeClient();
      const store = { ...makeStore(), findById: vi.fn().mockResolvedValue(null) };
      const gen = new ReplicateMediaGenerator({ client, store });

      const job = await gen.pollJob('missing');
      expect(job.status).toBe('FAILED');
      expect(job.error).toContain('not found');
    });

    it('advances RUNNING -> COMPLETED when prediction succeeds', async () => {
      const client = {
        createPrediction: vi.fn(),
        getPrediction: vi.fn().mockResolvedValue({
          id: 'pred_1', status: 'succeeded',
          output: 'https://replicate.delivery/video.mp4',
        }),
      };
      const store = makeStore({ status: 'RUNNING', providerJobId: 'pred_1', modelId: 'kwaivgi/kling-v1.6-standard' });
      const gen = new ReplicateMediaGenerator({ client, store });

      const job = await gen.pollJob('job_1');

      expect(store.updateStatus).toHaveBeenCalledWith('job_1', expect.objectContaining({ status: 'COMPLETED', mediaUrl: 'https://replicate.delivery/video.mp4' }));
      expect(job.status).toBe('COMPLETED');
    });

    it('handles array output for video', async () => {
      const client = {
        createPrediction: vi.fn(),
        getPrediction: vi.fn().mockResolvedValue({
          id: 'pred_1', status: 'succeeded',
          output: ['https://replicate.delivery/video.mp4'],
        }),
      };
      const store = makeStore({ status: 'RUNNING', providerJobId: 'pred_1' });
      const gen = new ReplicateMediaGenerator({ client, store });

      await gen.pollJob('job_1');

      expect(store.updateStatus).toHaveBeenCalledWith('job_1', expect.objectContaining({ mediaUrl: 'https://replicate.delivery/video.mp4' }));
    });

    it('advances RUNNING -> FAILED when prediction fails', async () => {
      const client = {
        createPrediction: vi.fn(),
        getPrediction: vi.fn().mockResolvedValue({ id: 'pred_1', status: 'failed', output: null, error: 'OOM' }),
      };
      const store = makeStore({ status: 'RUNNING', providerJobId: 'pred_1' });
      const gen = new ReplicateMediaGenerator({ client, store });

      await gen.pollJob('job_1');

      expect(store.updateStatus).toHaveBeenCalledWith('job_1', expect.objectContaining({ status: 'FAILED' }));
    });

    it('leaves RUNNING when poll network call fails', async () => {
      const client = {
        createPrediction: vi.fn(),
        getPrediction: vi.fn().mockRejectedValue(new Error('timeout')),
      };
      const store = makeStore({ status: 'RUNNING', providerJobId: 'pred_1' });
      const gen = new ReplicateMediaGenerator({ client, store });

      const job = await gen.pollJob('job_1');

      expect(store.updateStatus).not.toHaveBeenCalledWith('job_1', expect.objectContaining({ status: 'FAILED' }));
      expect(job.status).toBe('RUNNING');
    });
  });
});
