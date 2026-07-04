import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  trackAIUsage: vi.fn(),
}));

vi.mock('@restropulse/db', () => ({
  insertCostEvent: vi.fn().mockResolvedValue({ id: 'ce_test' }),
  // FalAIMediaGenerator goes through IMediaJobStore (injected), not these helpers
  // -- but these are mocked for any incidental import paths.
}));

const { FalAIMediaGenerator } = await import(
  '../../../../../../../src/services/content-generator/backends/ai/media/fal-ai/fal-ai-media-generator.js'
);
const { ContentGenerationError } = await import(
  '../../../../../../../src/services/content-generator/types.js'
);

function makeStore(captureInsert: (j: any) => void = () => {}) {
  return {
    insert: vi.fn(async (j: any) => { captureInsert(j); return { ...j, id: 'persisted' }; }),
    findById: vi.fn(async () => null),
    updateStatus: vi.fn(async () => null),
    incrementAttempts: vi.fn(async () => undefined),
  };
}

function makeClient(images = [{ url: 'https://fal.media/x.jpg', width: 1024, height: 1024 }]) {
  return {
    generateImage: vi.fn(async () => ({ images, seed: 1, modelId: 'fal-ai/flux/dev' })),
    editImage: vi.fn(async () => ({ images, seed: 2, modelId: 'fal-ai/flux/dev/image-to-image' })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('FalAIMediaGenerator IMAGE happy path', () => {
  it('produces a COMPLETED MediaGenJob with the fal-returned URL', async () => {
    const store = makeStore();
    const client = makeClient();
    const gen = new FalAIMediaGenerator({ client: client as any, store: store as any });

    const job = await gen.generateImage({
      postType: 'IMAGE',
      platforms: ['INSTAGRAM'],
      concept: 'paneer tikka',
      restaurantId: 'r1',
      postId: 'p1',
    });

    expect(job.status).toBe('COMPLETED');
    expect(job.mediaUrl).toBe('https://fal.media/x.jpg');
    expect(job.metadata?.widthPx).toBe(1024);
    expect(client.generateImage).toHaveBeenCalledTimes(1);
  });

  it('writes a MediaJobRecord with restaurantId/postId/modelId/status=COMPLETED', async () => {
    let captured: any = null;
    const store = makeStore((j) => { captured = j; });
    const client = makeClient();
    const gen = new FalAIMediaGenerator({ client: client as any, store: store as any });

    await gen.generateImage({
      postType: 'IMAGE',
      platforms: ['INSTAGRAM'],
      concept: 'paneer tikka',
      restaurantId: 'r1',
      postId: 'p1',
      cycleId: 'c1',
    });

    expect(captured).not.toBeNull();
    expect(captured.provider).toBe('fal-ai');
    expect(captured.modelId).toBe('fal-ai/flux/dev');
    expect(captured.status).toBe('COMPLETED');
    expect(captured.restaurantId).toBe('r1');
    expect(captured.postId).toBe('p1');
    expect(captured.cycleId).toBe('c1');
    expect(captured.attempts).toBe(1);
    expect(captured.mediaUrl).toBe('https://fal.media/x.jpg');
  });

  it('writes an LLM cost event tagged surface=image when generation succeeds', async () => {
    const { insertCostEvent } = await import('@restropulse/db');
    (insertCostEvent as any).mockClear();
    const store = makeStore();
    const client = makeClient();
    const gen = new FalAIMediaGenerator({ client: client as any, store: store as any });

    await gen.generateImage({
      postType: 'IMAGE',
      platforms: ['INSTAGRAM'],
      concept: 'paneer tikka',
      restaurantId: 'r1',
      postId: 'p1',
    });

    expect(insertCostEvent).toHaveBeenCalledTimes(1);
    const event = (insertCostEvent as any).mock.calls[0][0];
    expect(event.surface).toBe('image');
    expect(event.operation).toBe('generatePost');
    expect(event.model).toBe('fal-ai/flux/dev');
    expect(event.restaurantId).toBe('r1');
    expect(event.postId).toBe('p1');
    expect(event.costUsd).toBeGreaterThan(0);
  });

  it('routes baseImageUrl through editImage (img2img) instead of generateImage', async () => {
    const store = makeStore();
    const client = makeClient();
    const gen = new FalAIMediaGenerator({ client: client as any, store: store as any });

    const job = await gen.generateImage({
      postType: 'IMAGE',
      platforms: ['INSTAGRAM'],
      concept: 'warmer lighting on this dish',
      baseImageUrl: 'https://example.com/uploaded.jpg',
      restaurantId: 'r1',
      postId: 'p1',
    });

    expect(client.generateImage).not.toHaveBeenCalled();
    expect(client.editImage).toHaveBeenCalledTimes(1);
    expect(job.status).toBe('COMPLETED');
  });

  it('STORY post type uses portrait_16_9 image_size', async () => {
    const store = makeStore();
    const client = makeClient();
    const gen = new FalAIMediaGenerator({ client: client as any, store: store as any });
    await gen.generateImage({
      postType: 'STORY',
      platforms: ['INSTAGRAM'],
      concept: 'kitchen behind the scenes',
    });
    const arg = (client.generateImage as any).mock.calls[0][0];
    expect(arg.imageSize).toBe('portrait_16_9');
  });

  it('generateCarousel fans out to 3 parallel frames + 3 MediaJobRecords', async () => {
    const insertCalls: any[] = [];
    const store = makeStore((j) => { insertCalls.push(j); });
    const client = makeClient();
    const gen = new FalAIMediaGenerator({ client: client as any, store: store as any });

    const job = await gen.generateCarousel({
      platforms: ['INSTAGRAM'],
      concept: 'menu highlights',
      restaurantId: 'r1',
      postId: 'p1',
    });

    expect(client.generateImage).toHaveBeenCalledTimes(3);
    expect(insertCalls).toHaveLength(3);
    expect(job.mediaUrls).toHaveLength(3);
    expect(job.thumbnail).toBe(job.mediaUrls![0]);
    expect(job.status).toBe('COMPLETED');
  });

  it('returns FAILED MediaGenJob when fal.ai returns no images', async () => {
    const store = makeStore();
    const client = { generateImage: vi.fn(async () => ({ images: [], modelId: 'fal-ai/flux/dev' })), editImage: vi.fn() };
    const gen = new FalAIMediaGenerator({ client: client as any, store: store as any });

    const job = await gen.generateImage({
      postType: 'IMAGE',
      platforms: ['INSTAGRAM'],
      concept: 'x',
    });
    expect(job.status).toBe('FAILED');
    expect(job.error).toMatch(/no images/i);
  });
});

describe('FalAIMediaGenerator generateVideo (queue submit)', () => {
  it('submits a video job via the queue API and inserts a RUNNING MediaJobRecord', async () => {
    let captured: any = null;
    const store = makeStore((j) => { captured = j; });
    const client = {
      generateImage: vi.fn(),
      editImage: vi.fn(),
      submitToQueue: vi.fn(async () => ({ requestId: 'req_v1' })),
      getQueueStatus: vi.fn(),
      getQueueResult: vi.fn(),
    };
    const gen = new FalAIMediaGenerator({ client: client as any, store: store as any });

    const job = await gen.generateVideo({
      postType: 'REEL',
      platforms: ['INSTAGRAM'],
      concept: 'kitchen reel',
      restaurantId: 'r1',
      postId: 'p1',
    });

    expect(job.status).toBe('RUNNING');
    expect(job.jobId).toBeTruthy();
    expect(client.submitToQueue).toHaveBeenCalledTimes(1);
    expect(captured.status).toBe('RUNNING');
    expect(captured.providerJobId).toBe('req_v1');
    expect(captured.modelId).toBe('fal-ai/kling-video/v1.6/standard/text-to-video');
    expect(captured.postType).toBe('REEL');
    expect(captured.restaurantId).toBe('r1');
    expect(captured.postId).toBe('p1');
  });

  it('writes a cost event tagged surface=video at submission time', async () => {
    const { insertCostEvent } = await import('@restropulse/db');
    (insertCostEvent as any).mockClear();
    const store = makeStore();
    const client = {
      generateImage: vi.fn(), editImage: vi.fn(),
      submitToQueue: vi.fn(async () => ({ requestId: 'req_v2' })),
      getQueueStatus: vi.fn(), getQueueResult: vi.fn(),
    };
    const gen = new FalAIMediaGenerator({ client: client as any, store: store as any });
    await gen.generateVideo({
      postType: 'REEL', platforms: ['INSTAGRAM'], concept: 'x',
      restaurantId: 'r1', postId: 'p1',
    });
    expect(insertCostEvent).toHaveBeenCalledTimes(1);
    const event = (insertCostEvent as any).mock.calls[0][0];
    expect(event.surface).toBe('video');
    expect(event.step).toBe('video-submit');
    expect(event.model).toBe('fal-ai/kling-video/v1.6/standard/text-to-video');
    expect(event.costUsd).toBeGreaterThan(0);
  });

  it('returns FAILED MediaGenJob when queue submission fails permanently', async () => {
    const store = makeStore();
    const client = {
      generateImage: vi.fn(), editImage: vi.fn(),
      submitToQueue: vi.fn().mockRejectedValue({ status: 422, message: 'bad prompt' }),
      getQueueStatus: vi.fn(), getQueueResult: vi.fn(),
    };
    const gen = new FalAIMediaGenerator({ client: client as any, store: store as any });
    const job = await gen.generateVideo({ postType: 'REEL', platforms: ['INSTAGRAM'], concept: 'x' });
    expect(job.status).toBe('FAILED');
  });
});

describe('FalAIMediaGenerator pollJob (queue-aware)', () => {
  it('returns store-record unchanged when status is COMPLETED', async () => {
    const completedRecord = {
      id: 'p', jobId: 'j_done', provider: 'fal-ai', modelId: 'fal-ai/kling-video/v1.6/standard/text-to-video',
      postType: 'REEL', status: 'COMPLETED', mediaUrl: 'https://fal.media/v.mp4',
      attempts: 1, startedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
      providerJobId: 'req',
    };
    const store = {
      insert: vi.fn(),
      findById: vi.fn(async () => completedRecord),
      updateStatus: vi.fn(),
      incrementAttempts: vi.fn(),
    };
    const client = {
      generateImage: vi.fn(), editImage: vi.fn(),
      submitToQueue: vi.fn(),
      getQueueStatus: vi.fn(),
      getQueueResult: vi.fn(),
    };
    const gen = new FalAIMediaGenerator({ client: client as any, store: store as any });
    const out = await gen.pollJob('j_done');
    expect(out.status).toBe('COMPLETED');
    expect(out.mediaUrl).toBe('https://fal.media/v.mp4');
    expect(client.getQueueStatus).not.toHaveBeenCalled();
  });

  it('live-polls the queue when stored status is RUNNING; transitions to COMPLETED when fal says so', async () => {
    const runningRecord = {
      id: 'p', jobId: 'j_run', provider: 'fal-ai', modelId: 'fal-ai/kling-video/v1.6/standard/text-to-video',
      postType: 'REEL', status: 'RUNNING', providerJobId: 'req_xyz',
      attempts: 1, startedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
    };
    const store = {
      insert: vi.fn(),
      findById: vi.fn(async () => runningRecord),
      updateStatus: vi.fn(async (jobId: string, update: any) => ({
        ...runningRecord, ...update, jobId,
      })),
      incrementAttempts: vi.fn(),
    };
    const client = {
      generateImage: vi.fn(), editImage: vi.fn(),
      submitToQueue: vi.fn(),
      getQueueStatus: vi.fn(async () => ({ status: 'COMPLETED' })),
      getQueueResult: vi.fn(async () => ({ video: { url: 'https://fal.media/done.mp4' } })),
    };
    const gen = new FalAIMediaGenerator({ client: client as any, store: store as any });
    const out = await gen.pollJob('j_run');

    expect(client.getQueueStatus).toHaveBeenCalledWith('fal-ai/kling-video/v1.6/standard/text-to-video', 'req_xyz');
    expect(client.getQueueResult).toHaveBeenCalledTimes(1);
    expect(store.updateStatus).toHaveBeenCalled();
    const update = (store.updateStatus as any).mock.calls[0][1];
    expect(update.status).toBe('COMPLETED');
    expect(update.mediaUrl).toBe('https://fal.media/done.mp4');
    expect(out.status).toBe('COMPLETED');
    expect(out.mediaUrl).toBe('https://fal.media/done.mp4');
  });

  it('returns RUNNING from pollJob when fal still in progress', async () => {
    const runningRecord = {
      id: 'p', jobId: 'j_inprog', provider: 'fal-ai', modelId: 'fal-ai/kling-video/v1.6/standard/text-to-video',
      postType: 'REEL', status: 'RUNNING', providerJobId: 'req_in',
      attempts: 1, startedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
    };
    const store = {
      insert: vi.fn(),
      findById: vi.fn(async () => runningRecord),
      updateStatus: vi.fn(async (_jobId: string, update: any) => ({ ...runningRecord, ...update })),
      incrementAttempts: vi.fn(),
    };
    const client = {
      generateImage: vi.fn(), editImage: vi.fn(),
      submitToQueue: vi.fn(),
      getQueueStatus: vi.fn(async () => ({ status: 'IN_PROGRESS', queue_position: 0 })),
      getQueueResult: vi.fn(),
    };
    const gen = new FalAIMediaGenerator({ client: client as any, store: store as any });
    const out = await gen.pollJob('j_inprog');
    expect(out.status).toBe('RUNNING');
    expect(client.getQueueResult).not.toHaveBeenCalled();
  });
});
