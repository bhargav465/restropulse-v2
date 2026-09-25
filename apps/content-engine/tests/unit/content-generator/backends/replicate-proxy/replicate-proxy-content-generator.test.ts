import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  trackAIUsage: vi.fn(),
}));

vi.mock('@restropulse/db', () => ({
  insertCostEvent: vi.fn().mockResolvedValue({ id: 'ce_test' }),
}));

const { ReplicateProxyContentGenerator } = await import(
  '../../../../../src/services/content-generator/backends/replicate-proxy/replicate-proxy-content-generator.js'
);
const { RestaurantSpecialization } = await import(
  '../../../../../src/services/content-generator/backends/ai/specialization/index.js'
);
const { ContentGenerationError } = await import(
  '../../../../../src/services/content-generator/types.js'
);

const cycleObject = {
  summary: 'A week of food storytelling',
  plannedPosts: [{ category: 'chef_special', count: 2 }],
  focus: ['Chef Specials'],
};

function makeGen() {
  const generateObject = vi.fn().mockResolvedValue({
    object: cycleObject,
    usage: { inputTokens: 100, outputTokens: 50 },
    modelId: 'claude-sonnet-4-6',
  });
  const generateImage = vi.fn().mockResolvedValue({
    jobId: 'img-1', status: 'COMPLETED',
    mediaUrl: 'https://replicate.delivery/x.webp',
    thumbnail: 'https://replicate.delivery/x.webp',
    metadata: { widthPx: 1080, heightPx: 1080 },
  });
  const generateVideo = vi.fn().mockResolvedValue({
    jobId: 'vid-1', status: 'RUNNING',
  });
  const generateCarousel = vi.fn().mockResolvedValue({
    jobId: 'car-1', status: 'COMPLETED',
    mediaUrls: ['https://replicate.delivery/a.webp', 'https://replicate.delivery/b.webp'],
    thumbnail: 'https://replicate.delivery/a.webp',
  });
  return {
    gen: new ReplicateProxyContentGenerator({
      specialization: new RestaurantSpecialization(),
      llm: { name: 'mock-anthropic', generateObject },
      media: { name: 'mock-replicate', generateImage, generateVideo, generateCarousel, pollJob: vi.fn() },
    }),
    generateObject,
    generateImage,
    generateVideo,
    generateCarousel,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ReplicateProxyContentGenerator', () => {
  it('exposes name "replicate-proxy" and the configured specialization', () => {
    const { gen } = makeGen();
    expect(gen.name).toBe('replicate-proxy');
    expect(gen.specialization.domain).toBe('restaurant');
  });

  it('throws when constructed without specialization, llm, or media', () => {
    expect(() => new ReplicateProxyContentGenerator({} as any)).toThrow(ContentGenerationError);
  });

  it('draftCycle delegates to the Anthropic pipeline (not proxied)', async () => {
    const { gen, generateObject } = makeGen();
    const out = await gen.draftCycle({ period: 'w1' });
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(out.summary).toBe(cycleObject.summary);
  });

  it('reviseCycle delegates to the Anthropic pipeline (not proxied)', async () => {
    const { gen, generateObject } = makeGen();
    await gen.reviseCycle({
      existingCycle: {
        period: 'w1',
        summary: 'old summary',
        plannedPosts: [{ category: 'offers', count: 1 }],
        focus: ['Offers'],
      },
      feedback: { areas: ['tone'], note: 'make it punchier' },
    });
    expect(generateObject).toHaveBeenCalledTimes(1);
  });

  it('generatePost uses the caller concept verbatim as caption with no LLM call', async () => {
    const { gen, generateObject, generateImage } = makeGen();
    const out = await gen.generatePost({
      concept: 'Sizzling paneer tikka on a cast iron plate',
      type: 'IMAGE',
      platform: 'INSTAGRAM',
    });
    expect(generateObject).not.toHaveBeenCalled();
    expect(out.caption).toBe('Sizzling paneer tikka on a cast iron plate');
    expect(out.thumbnail).toBe('https://replicate.delivery/x.webp');
    expect(generateImage).toHaveBeenCalledWith(
      expect.objectContaining({ concept: 'Sizzling paneer tikka on a cast iron plate' }),
    );
    // No prompt engineering: promptSuffix/baseImageUrl must not be set.
    expect(generateImage.mock.calls[0][0]).not.toHaveProperty('promptSuffix');
    expect(generateImage.mock.calls[0][0]).not.toHaveProperty('baseImageUrl');
  });

  it('routes CAROUSEL posts to generateCarousel', async () => {
    const { gen, generateCarousel } = makeGen();
    const out = await gen.generatePost({
      concept: 'Weekend thali spread',
      type: 'CAROUSEL',
      platform: 'INSTAGRAM',
    });
    expect(generateCarousel).toHaveBeenCalledWith(
      expect.objectContaining({ concept: 'Weekend thali spread' }),
    );
    expect(out.mediaUrls).toEqual([
      'https://replicate.delivery/a.webp',
      'https://replicate.delivery/b.webp',
    ]);
  });

  it('returns pendingMedia=true when video media is still RUNNING', async () => {
    const { gen } = makeGen();
    const out = await gen.generatePost({
      concept: 'A short reel of the tandoor flame',
      type: 'REEL',
      platform: 'INSTAGRAM',
    });
    expect(out.pendingMedia).toBe(true);
    expect(out.mediaJobId).toBe('vid-1');
    expect(out.generationStep).toBe('MEDIA_REQUESTED');
    expect(out.caption).toBe('A short reel of the tandoor flame');
  });

  it('throws INVALID_INPUT when no concept or theme is supplied', async () => {
    const { gen } = makeGen();
    await expect(
      gen.generatePost({ concept: '', type: 'IMAGE', platform: 'INSTAGRAM' }),
    ).rejects.toThrow(ContentGenerationError);
  });

  it('throws UNKNOWN when the media provider reports FAILED', async () => {
    const { gen, generateImage } = makeGen();
    generateImage.mockResolvedValueOnce({ jobId: 'x', status: 'FAILED', error: 'model overloaded' });
    await expect(
      gen.generatePost({ concept: 'A dish', type: 'IMAGE', platform: 'INSTAGRAM' }),
    ).rejects.toThrow(ContentGenerationError);
  });

  it('revisePost builds the concept from feedback (no LLM) and regenerates media', async () => {
    const { gen, generateObject, generateImage } = makeGen();
    const out = await gen.revisePost({
      existingPost: {
        type: 'IMAGE',
        platform: 'INSTAGRAM',
        caption: 'old caption',
        thumbnail: 'https://old.example/x.jpg',
      },
      feedback: {
        tags: ['media'],
        details: { lighting: 'brighter, more natural light' },
        note: 'make the plating look more rustic',
      },
    });
    expect(generateObject).not.toHaveBeenCalled();
    expect(out.caption).toBe('make the plating look more rustic - brighter, more natural light');
    expect(generateImage).toHaveBeenCalledWith(
      expect.objectContaining({ concept: 'make the plating look more rustic - brighter, more natural light' }),
    );
  });

  it('healthCheck reports the llm and media collaborator names', async () => {
    const { gen } = makeGen();
    const health = await gen.healthCheck!();
    expect(health.ok).toBe(true);
    expect(health.detail).toBe('llm=mock-anthropic media=mock-replicate');
  });
});
