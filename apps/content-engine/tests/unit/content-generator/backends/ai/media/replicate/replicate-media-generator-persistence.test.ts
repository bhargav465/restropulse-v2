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

/**
 * Replicate deletes API prediction output files after ~1 hour. The invariant
 * under test: with durable storage configured, no replicate.delivery URL is
 * ever written to a media job (and so never reaches a post).
 */

const PROVIDER_URL = 'https://replicate.delivery/xezq/abc/out-0.webp';
const DURABLE_URL = 'https://restropulsemediaprod.blob.core.windows.net/restropulse/r1/p1/uuid.webp';

const imageInput = {
  postType: 'IMAGE' as const,
  platforms: ['INSTAGRAM' as const],
  concept: 'A plate of biryani',
  restaurantId: 'r1',
  postId: 'p1',
};

function makeStorage(impl?: (url: string) => Promise<string>) {
  return {
    name: 'test',
    durable: true,
    persist: vi.fn(impl ?? (async () => DURABLE_URL)),
  };
}

function makeStore(record: Record<string, unknown> = {}) {
  const base = {
    jobId: 'job_1',
    providerJobId: 'pred_1',
    provider: 'replicate' as const,
    modelId: 'kwaivgi/kling-v1.6-standard',
    postType: 'REEL' as const,
    status: 'RUNNING' as const,
    attempts: 1,
    restaurantId: 'r1',
    postId: 'p1',
    startedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...record,
  };
  return {
    insert: vi.fn().mockImplementation((doc) => Promise.resolve({ ...base, ...doc })),
    findById: vi.fn().mockResolvedValue(base),
    updateStatus: vi.fn().mockImplementation((_id, update) => Promise.resolve({ ...base, ...update })),
    incrementAttempts: vi.fn().mockResolvedValue(undefined),
  };
}

function makeClient(output: unknown = [PROVIDER_URL]) {
  return {
    createPrediction: vi.fn().mockResolvedValue({ id: 'pred_1', status: 'starting', output: null }),
    getPrediction: vi.fn().mockResolvedValue({ id: 'pred_1', status: 'succeeded', output }),
  };
}

/** Everything ever handed to the job store, serialized, for the "no expiring URL" assertion. */
function everythingRecorded(store: ReturnType<typeof makeStore>): string {
  return JSON.stringify([store.insert.mock.calls, store.updateStatus.mock.calls]);
}

beforeEach(() => vi.clearAllMocks());

describe('ReplicateMediaGenerator durable persistence', () => {
  describe('image (sync path)', () => {
    it('persists the Replicate URL and records only the durable URL', async () => {
      const storage = makeStorage();
      const store = makeStore({ postType: 'IMAGE' });
      const gen = new ReplicateMediaGenerator({ client: makeClient(), store, storage });

      const job = await gen.generateImage(imageInput);

      expect(storage.persist).toHaveBeenCalledOnce();
      expect(storage.persist).toHaveBeenCalledWith(
        PROVIDER_URL,
        expect.objectContaining({ restaurantId: 'r1', postId: 'p1', jobId: expect.any(String) }),
      );
      expect(store.insert).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'COMPLETED', mediaUrl: DURABLE_URL, thumbnail: DURABLE_URL }),
      );
      expect(job.mediaUrl).toBe(DURABLE_URL);
      expect(everythingRecorded(store)).not.toContain('replicate.delivery');
    });

    it('fails the job (and records no URL) when persistence fails', async () => {
      const storage = makeStorage(async () => {
        throw new Error('media persistence failed: disk on fire');
      });
      const store = makeStore({ postType: 'IMAGE' });
      const gen = new ReplicateMediaGenerator({ client: makeClient(), store, storage });

      const job = await gen.generateImage(imageInput);

      expect(job.status).toBe('FAILED');
      expect(store.insert).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'FAILED', error: expect.stringContaining('persistence failed') }),
      );
      expect(everythingRecorded(store)).not.toContain('replicate.delivery');
    });

    it('does not re-run the paid generation when only persistence fails', async () => {
      const storage = makeStorage(async () => {
        throw new Error('nope');
      });
      const client = makeClient();
      const gen = new ReplicateMediaGenerator({ client, store: makeStore({ postType: 'IMAGE' }), storage });

      await gen.generateImage(imageInput);

      expect(client.createPrediction).toHaveBeenCalledOnce();
    });
  });

  describe('carousel', () => {
    it('persists every frame and returns only durable URLs', async () => {
      const storage = makeStorage();
      const store = makeStore({ postType: 'IMAGE' });
      const gen = new ReplicateMediaGenerator({ client: makeClient(), store, storage });

      const job = await gen.generateCarousel({ platforms: ['INSTAGRAM'], concept: 'Biryani', restaurantId: 'r1', postId: 'p1' });

      expect(storage.persist).toHaveBeenCalledTimes(3);
      expect(job.status).toBe('COMPLETED');
      expect(job.mediaUrls).toEqual([DURABLE_URL, DURABLE_URL, DURABLE_URL]);
      expect(everythingRecorded(store)).not.toContain('replicate.delivery');
    });
  });

  describe('video (async poll path)', () => {
    it('persists before recording COMPLETED and stores only the durable URL', async () => {
      const storage = makeStorage();
      const store = makeStore();
      const gen = new ReplicateMediaGenerator({ client: makeClient(PROVIDER_URL), store, storage });

      const job = await gen.pollJob('job_1');

      expect(storage.persist).toHaveBeenCalledWith(
        PROVIDER_URL,
        expect.objectContaining({ restaurantId: 'r1', postId: 'p1', jobId: 'job_1' }),
      );
      expect(store.updateStatus).toHaveBeenCalledWith(
        'job_1',
        expect.objectContaining({ status: 'COMPLETED', mediaUrl: DURABLE_URL, thumbnail: DURABLE_URL }),
      );
      expect(job.status).toBe('COMPLETED');
      expect(everythingRecorded(store)).not.toContain('replicate.delivery');
    });

    it('leaves the job RUNNING (retried next poll) when persistence fails, never storing the expiring URL', async () => {
      const storage = makeStorage(async () => {
        throw new Error('storage down');
      });
      const store = makeStore();
      const gen = new ReplicateMediaGenerator({ client: makeClient(PROVIDER_URL), store, storage });

      const job = await gen.pollJob('job_1');

      expect(job.status).toBe('RUNNING');
      expect(store.updateStatus).not.toHaveBeenCalledWith('job_1', expect.objectContaining({ status: 'COMPLETED' }));
      expect(store.updateStatus).not.toHaveBeenCalledWith('job_1', expect.objectContaining({ status: 'FAILED' }));
      expect(everythingRecorded(store)).not.toContain('replicate.delivery');
    });

    it('still fails a succeeded prediction that has no output URL', async () => {
      const storage = makeStorage();
      const store = makeStore();
      const gen = new ReplicateMediaGenerator({ client: makeClient(null), store, storage });

      const job = await gen.pollJob('job_1');

      expect(job.status).toBe('FAILED');
      expect(storage.persist).not.toHaveBeenCalled();
    });
  });

  describe('without storage (local dev / tests)', () => {
    it('passes the provider URL through unchanged', async () => {
      const store = makeStore();
      const gen = new ReplicateMediaGenerator({ client: makeClient(PROVIDER_URL), store });

      const job = await gen.pollJob('job_1');

      expect(job.mediaUrl).toBe(PROVIDER_URL);
    });
  });
});
