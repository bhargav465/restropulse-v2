import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  trackAIUsage: vi.fn(),
}));

vi.mock('@restropulse/db', () => ({
  insertCostEvent: vi.fn().mockResolvedValue({ id: 'ce_test' }),
}));

const { runRevisePost } = await import(
  '../../../../../../src/services/content-generator/backends/ai/pipeline/revise-post.js'
);
const { RestaurantSpecialization } = await import(
  '../../../../../../src/services/content-generator/backends/ai/specialization/index.js'
);

beforeEach(() => {
  vi.clearAllMocks();
});

const baseInput = {
  existingPost: {
    type: 'IMAGE' as const,
    platforms: ['INSTAGRAM' as const],
    caption: 'Old caption with #fewhashtags',
    thumbnail: 'http://localhost/old.jpg',
  },
  feedback: {
    tags: ['caption', 'voice'],
    details: { voice: 'too formal' },
    note: 'Make it warmer and more inviting.',
  },
};

function makeDeps() {
  const generateObject = vi.fn().mockResolvedValue({
    object: {
      caption: 'A warmer, friendlier hello from our kitchen.',
      suggestedHashtags: ['#warm', '#kitchen'],
    },
    usage: { inputTokens: 100, outputTokens: 60 },
    modelId: 'claude-haiku-4-5-20251001',
  });
  const generateImage = vi.fn().mockResolvedValue({
    jobId: 'jr_img_1',
    status: 'COMPLETED',
    mediaUrl: 'http://localhost:3002/images/new.jpg',
    thumbnail: 'http://localhost:3002/images/new.jpg',
    metadata: { widthPx: 1080, heightPx: 1080 },
  });
  const generateCarousel = vi.fn().mockResolvedValue({
    jobId: 'jr_car_1',
    status: 'COMPLETED',
    mediaUrls: ['http://localhost:3002/images/s1.jpg', 'http://localhost:3002/images/s2.jpg', 'http://localhost:3002/images/s3.jpg'],
    thumbnail: 'http://localhost:3002/images/s1.jpg',
    metadata: { widthPx: 1080, heightPx: 1080 },
  });
  const generateVideo = vi.fn().mockResolvedValue({
    jobId: 'jr_vid_1',
    status: 'COMPLETED',
    mediaUrl: 'http://localhost:3002/videos/new.mp4',
    thumbnail: 'http://localhost:3002/videos/new.jpg',
    metadata: { widthPx: 1080, heightPx: 1920, durationSeconds: 15 },
  });
  return {
    llm: { name: 'mock-llm', generateObject },
    media: { name: 'mock-media', generateImage, generateCarousel, generateVideo, pollJob: vi.fn() },
    specialization: new RestaurantSpecialization(),
  };
}

describe('runRevisePost', () => {
  it('returns a revised caption (LLM output) preserving the existing thumbnail when feedback does NOT request media changes', async () => {
    const deps = makeDeps();
    const out = await runRevisePost(baseInput, deps, { restaurantId: 'r1' });
    expect(out.caption).toContain('warmer');
    expect(out.thumbnail).toBe('http://localhost/old.jpg');  // existing thumbnail preserved
    expect((deps.media.generateImage as any)).not.toHaveBeenCalled();
  });

  it('regenerates media when feedback.tags includes "media" or "image"', async () => {
    const deps = makeDeps();
    const inputWithMediaFeedback = {
      ...baseInput,
      feedback: { tags: ['image'], details: {}, note: 'Try a different shot' },
    };
    const out = await runRevisePost(inputWithMediaFeedback, deps, {});
    expect((deps.media.generateImage as any)).toHaveBeenCalledTimes(1);
    expect(out.thumbnail).toBe('http://localhost:3002/images/new.jpg');
  });

  it('passes the existing caption + feedback into the LLM prompt', async () => {
    const deps = makeDeps();
    await runRevisePost(baseInput, deps, {});
    const arg = (deps.llm.generateObject as any).mock.calls[0][0];
    expect(arg.prompt).toContain('Old caption with #fewhashtags');
    expect(arg.prompt).toContain('too formal');
    expect(arg.prompt).toContain('Make it warmer and more inviting');
  });

  it('writes a cost event with operation=revisePost', async () => {
    const { insertCostEvent } = await import('@restropulse/db');
    (insertCostEvent as any).mockClear();
    const deps = makeDeps();
    await runRevisePost(baseInput, deps, { restaurantId: 'r1' });
    const llmEvent = (insertCostEvent as any).mock.calls.find((c: any) => c[0].surface === 'llm');
    expect(llmEvent).toBeDefined();
    expect(llmEvent[0].operation).toBe('revisePost');
  });

  it('routes CAROUSEL media revision through generateCarousel and returns mediaUrls', async () => {
    const deps = makeDeps();
    const out = await runRevisePost(
      {
        existingPost: {
          type: 'CAROUSEL',
          platforms: ['INSTAGRAM'],
          caption: 'Original carousel caption.',
          archetype: 'ANATOMY_OF_A_DISH',
          mediaUrls: ['http://localhost/old1.jpg', 'http://localhost/old2.jpg'],
          thumbnail: 'http://localhost/old1.jpg',
        },
        feedback: { tags: ['media'], details: {}, note: 'Images not vibrant enough' },
      },
      deps,
      {},
    );
    expect(deps.media.generateCarousel).toHaveBeenCalledTimes(1);
    expect(deps.media.generateImage).not.toHaveBeenCalled();
    expect(out.mediaUrls).toHaveLength(3);
    expect(out.thumbnail).toBe(out.mediaUrls![0]);
    expect(out.videoUrl).toBeUndefined();
  });

  it('routes VIDEO media revision through generateVideo', async () => {
    const deps = makeDeps();
    const out = await runRevisePost(
      {
        existingPost: {
          type: 'VIDEO',
          platforms: ['INSTAGRAM'],
          caption: 'Original video caption.',
          videoUrl: 'http://localhost/old.mp4',
          thumbnail: 'http://localhost/old.jpg',
        },
        feedback: { tags: ['video'], details: {}, note: 'Wrong angle' },
      },
      deps,
      {},
    );
    expect(deps.media.generateVideo).toHaveBeenCalledTimes(1);
    expect(deps.media.generateImage).not.toHaveBeenCalled();
    expect(deps.media.generateCarousel).not.toHaveBeenCalled();
    expect(out.videoUrl).toBeDefined();
  });

  it('routes STORY media revision through generateImage', async () => {
    const deps = makeDeps();
    const out = await runRevisePost(
      {
        existingPost: {
          type: 'STORY',
          platforms: ['INSTAGRAM'],
          caption: 'Original story caption.',
          thumbnail: 'http://localhost/old.jpg',
        },
        feedback: { tags: ['image'], details: {}, note: 'Needs a brighter shot' },
      },
      deps,
      {},
    );
    expect(deps.media.generateImage).toHaveBeenCalledTimes(1);
    expect(deps.media.generateCarousel).not.toHaveBeenCalled();
    expect(deps.media.generateVideo).not.toHaveBeenCalled();
    expect(out.thumbnail).toMatch(/^http:\/\//);
    expect(out.mediaUrls).toBeUndefined();
    expect(out.videoUrl).toBeUndefined();
  });

  it('preserves existing CAROUSEL mediaUrls when feedback does NOT request media changes', async () => {
    const deps = makeDeps();
    const out = await runRevisePost(
      {
        existingPost: {
          type: 'CAROUSEL',
          platforms: ['INSTAGRAM'],
          caption: 'Old carousel caption.',
          archetype: 'FOOD_PAIRING',
          mediaUrls: ['http://localhost/s1.jpg', 'http://localhost/s2.jpg'],
          thumbnail: 'http://localhost/s1.jpg',
        },
        feedback: { tags: ['caption'], details: {}, note: 'Tone too formal' },
      },
      deps,
      {},
    );
    expect(deps.media.generateCarousel).not.toHaveBeenCalled();
    expect(out.mediaUrls).toEqual(['http://localhost/s1.jpg', 'http://localhost/s2.jpg']);
    expect(out.thumbnail).toBe('http://localhost/s1.jpg');
  });

  it('injects archetype guidance into the revision prompt when archetype is provided', async () => {
    const deps = makeDeps();
    await runRevisePost(
      {
        existingPost: {
          type: 'REEL',
          platforms: ['INSTAGRAM'],
          caption: 'Original caption about sensory food.',
          archetype: 'CRAVING_CUE',
        },
        feedback: { tags: ['caption'], details: {}, note: 'Not sensory enough' },
      },
      deps,
    );

    const llmCall = deps.llm.generateObject.mock.calls[0][0];
    // The prompt should contain the archetype label or description
    expect(llmCall.prompt).toContain('Craving Cue');
  });
});
