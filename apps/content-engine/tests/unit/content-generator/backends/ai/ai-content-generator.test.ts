import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  trackAIUsage: vi.fn(),
}));

vi.mock('@restropulse/db', () => ({
  insertCostEvent: vi.fn().mockResolvedValue({ id: 'ce_test' }),
}));

const { AIContentGenerator } = await import(
  '../../../../../src/services/content-generator/backends/ai/ai-content-generator.js'
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

const captionObject = {
  caption: 'Soft, flaky, ghee-laced parotta straight off the tawa.',
  suggestedHashtags: ['#parotta', '#ghee'],
};

function makeGen() {
  const generateObject = vi.fn().mockImplementation(async (req: any) => {
    if (req.schema._def && req.schema._def.shape && 'plannedPosts' in req.schema._def.shape()) {
      return { object: cycleObject, usage: { inputTokens: 100, outputTokens: 50 }, modelId: 'claude-sonnet-4-6' };
    }
    return { object: captionObject, usage: { inputTokens: 80, outputTokens: 40 }, modelId: 'claude-haiku-4-5-20251001' };
  });
  const generateImage = vi.fn().mockResolvedValue({
    jobId: 'j1', status: 'COMPLETED',
    mediaUrl: 'http://localhost:3002/images/x.jpg',
    thumbnail: 'http://localhost:3002/images/x.jpg',
    metadata: { widthPx: 1080, heightPx: 1080 },
  });
  const generateVideo = vi.fn().mockResolvedValue({
    jobId: 'j2', status: 'COMPLETED',
    mediaUrl: 'http://localhost:3002/videos/x.mp4',
    thumbnail: 'http://localhost:3002/videos/x.jpg',
    metadata: { widthPx: 1080, heightPx: 1920, durationSeconds: 18 },
  });
  return {
    gen: new AIContentGenerator({
      specialization: new RestaurantSpecialization(),
      llm: { name: 'mock', generateObject },
      media: { name: 'mock-media', generateImage, generateVideo, pollJob: vi.fn() },
    }),
    generateObject,
    generateImage,
    generateVideo,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AIContentGenerator (phase 2 complete)', () => {
  it('exposes name "ai" and the configured specialization', () => {
    const { gen } = makeGen();
    expect(gen.name).toBe('ai');
    expect(gen.specialization.domain).toBe('restaurant');
  });

  it('throws when constructed without specialization, llm, or media', () => {
    expect(() => new AIContentGenerator({} as any)).toThrow(ContentGenerationError);
  });

  it('draftCycle returns the cycle from the LLM', async () => {
    const { gen } = makeGen();
    const out = await gen.draftCycle({ period: 'w1' });
    expect(out.summary).toBe(cycleObject.summary);
  });

  it('reviseCycle returns the cycle from the LLM', async () => {
    const { gen } = makeGen();
    const out = await gen.reviseCycle({
      existingCycle: { period: 'w1', summary: 's', plannedPosts: [{ category: 'a', count: 1 }], focus: ['x'] },
      feedback: { areas: ['cta'], note: 'add CTA' },
    });
    expect(out.summary).toBe(cycleObject.summary);
  });

  it('generatePost produces caption + thumbnail for IMAGE', async () => {
    const { gen } = makeGen();
    const out = await gen.generatePost({ concept: 'parotta', type: 'IMAGE', platforms: ['INSTAGRAM'] });
    expect(out.caption).toContain('parotta');
    expect(out.thumbnail).toMatch(/^http:\/\//);
  });

  it('revisePost regenerates caption only when feedback does not request media', async () => {
    const { gen, generateImage } = makeGen();
    await gen.revisePost({
      existingPost: { type: 'IMAGE', platforms: ['INSTAGRAM'], caption: 'old', thumbnail: 'http://existing/t.jpg' },
      feedback: { tags: ['voice'], details: {}, note: 'warmer please' },
    });
    expect(generateImage).not.toHaveBeenCalled();
  });

  it('healthCheck reports ok=true', async () => {
    const { gen } = makeGen();
    const r = await gen.healthCheck!();
    expect(r.ok).toBe(true);
  });
});

describe('AIContentGenerator currentAffairs auto-enrichment', () => {
  it('passes currentAffairs into PipelineDeps and pipeline forwards hints to the prompt', async () => {
    const generateObject = vi.fn().mockResolvedValue({
      object: { caption: 'A warm post', suggestedHashtags: ['#warm'] },
      usage: { inputTokens: 50, outputTokens: 30 },
      modelId: 'claude-haiku-4-5-20251001',
    });
    const generateImage = vi.fn().mockResolvedValue({
      jobId: 'jx', status: 'COMPLETED',
      mediaUrl: 'http://localhost/x.jpg', thumbnail: 'http://localhost/x.jpg',
      metadata: { widthPx: 1080, heightPx: 1080 },
    });
    const fetchHints = vi.fn(async () => ['Eid al-Fitr is in 2 days', 'IPL Final tonight']);
    const currentAffairs = { name: 'mock-current-affairs', fetchHints, refresh: vi.fn() };

    const gen = new AIContentGenerator({
      specialization: new RestaurantSpecialization(),
      llm: { name: 'mock', generateObject },
      media: { name: 'mock-media', generateImage, generateVideo: vi.fn(), pollJob: vi.fn() },
      currentAffairs: currentAffairs as any,
    });

    await gen.generatePost({ concept: 'cricket match-day biryani', type: 'IMAGE', platforms: ['INSTAGRAM'] });

    expect(fetchHints).toHaveBeenCalledTimes(1);
    const prompt = (generateObject.mock.calls[0][0] as any).prompt;
    expect(prompt).toContain('Eid al-Fitr is in 2 days');
    expect(prompt).toContain('IPL Final tonight');
  });

  it('does NOT call currentAffairs.fetchHints when caller already supplied currentAffairsHints', async () => {
    const generateObject = vi.fn().mockResolvedValue({
      object: { caption: 'x', suggestedHashtags: [] },
      usage: { inputTokens: 1, outputTokens: 1 }, modelId: 'claude-haiku-4-5-20251001',
    });
    const generateImage = vi.fn().mockResolvedValue({ jobId: 'j', status: 'COMPLETED', mediaUrl: 'http://x', thumbnail: 'http://x', metadata: { widthPx: 1, heightPx: 1 } });
    const fetchHints = vi.fn();
    const currentAffairs = { name: 'mock', fetchHints, refresh: vi.fn() };

    const gen = new AIContentGenerator({
      specialization: new RestaurantSpecialization(),
      llm: { name: 'mock', generateObject },
      media: { name: 'mock-media', generateImage, generateVideo: vi.fn(), pollJob: vi.fn() },
      currentAffairs: currentAffairs as any,
    });

    await gen.generatePost({
      concept: 'plain biryani',
      type: 'IMAGE',
      platforms: ['INSTAGRAM'],
      currentAffairsHints: ['caller-supplied hint'],
    });

    expect(fetchHints).not.toHaveBeenCalled();
  });
});
