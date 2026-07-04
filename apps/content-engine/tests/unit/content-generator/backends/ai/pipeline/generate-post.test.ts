import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  trackAIUsage: vi.fn(),
}));

vi.mock('@restropulse/db', () => ({
  insertCostEvent: vi.fn().mockResolvedValue({ id: 'ce_test' }),
}));

const { runGeneratePost } = await import(
  '../../../../../../src/services/content-generator/backends/ai/pipeline/generate-post.js'
);
const { RestaurantSpecialization } = await import(
  '../../../../../../src/services/content-generator/backends/ai/specialization/index.js'
);

beforeEach(() => {
  vi.clearAllMocks();
});

const MOCK_DISH_VISUAL = 'Golden-bronze cauliflower florets with char marks, drizzled with herb-flecked achaar emulsion on a copper plate.';

function makeDeps(captionOverrides: Partial<{ caption: string; suggestedHashtags: string[] }> = {}) {
  // Single mock satisfies both PostCaptionSchema calls (uses caption/suggestedHashtags) and
  // DishVisualDescriptionSchema calls (uses visualDescription). Zod is not invoked on mocks.
  const generateObject = vi.fn().mockResolvedValue({
    object: {
      caption: captionOverrides.caption ?? 'Soft, flaky, ghee-laced parotta straight off the tawa.',
      suggestedHashtags: captionOverrides.suggestedHashtags ?? ['#parotta', '#ghee'],
      archetype: 'CHEFS_PICK',
      visualDescription: MOCK_DISH_VISUAL,
    },
    usage: { inputTokens: 80, outputTokens: 40 },
    modelId: 'claude-haiku-4-5-20251001',
  });
  const generateImage = vi.fn().mockResolvedValue({
    jobId: 'job_img_1',
    status: 'COMPLETED',
    mediaUrl: 'http://localhost:3002/images/x.jpg',
    thumbnail: 'http://localhost:3002/images/x.jpg',
    metadata: { widthPx: 1080, heightPx: 1080 },
  });
  const generateVideo = vi.fn().mockResolvedValue({
    jobId: 'job_vid_1',
    status: 'COMPLETED',
    mediaUrl: 'http://localhost:3002/videos/x.mp4',
    thumbnail: 'http://localhost:3002/videos/x.jpg',
    metadata: { widthPx: 1080, heightPx: 1920, durationSeconds: 18 },
  });
  const generateCarousel = vi.fn().mockResolvedValue({
    jobId: 'job_car_1',
    status: 'COMPLETED',
    mediaUrls: ['http://localhost:3002/images/a.jpg', 'http://localhost:3002/images/b.jpg', 'http://localhost:3002/images/c.jpg'],
    thumbnail: 'http://localhost:3002/images/a.jpg',
    metadata: { widthPx: 1080, heightPx: 1080 },
  });
  return {
    llm: { name: 'mock-llm', generateObject },
    media: { name: 'mock-media', generateImage, generateCarousel, generateVideo, pollJob: vi.fn() },
    specialization: new RestaurantSpecialization(),
  };
}

describe('runGeneratePost', () => {
  it('produces caption + thumbnail for an IMAGE post', async () => {
    const deps = makeDeps();
    const out = await runGeneratePost(
      { concept: 'parotta', type: 'IMAGE', platforms: ['INSTAGRAM'] },
      deps,
      { restaurantId: 'r1', restaurantName: 'Spice Route', locale: 'en-IN' },
    );
    expect(out.caption).toContain('parotta');
    expect(out.thumbnail).toMatch(/^http:\/\//);
    expect(out.videoUrl).toBeUndefined();
  });

  it('routes REEL post type through generateVideo and returns pendingMedia=true', async () => {
    const deps = makeDeps();
    (deps.media.generateVideo as any).mockResolvedValueOnce({
      jobId: 'jobV1', status: 'RUNNING',
    });
    const out = await runGeneratePost(
      { concept: 'kitchen reel', type: 'REEL', platforms: ['INSTAGRAM'] },
      deps,
      {},
    );
    expect(deps.media.generateVideo).toHaveBeenCalledTimes(1);
    expect(out.pendingMedia).toBe(true);
    expect(out.mediaJobId).toBe('jobV1');
    expect(out.generationStep).toBe('MEDIA_REQUESTED');
  });

  it('routes CAROUSEL through generateCarousel and returns mediaUrls', async () => {
    const deps = makeDeps();
    const out = await runGeneratePost(
      { concept: 'menu', type: 'CAROUSEL', platforms: ['INSTAGRAM'] },
      deps,
      {},
    );
    expect(deps.media.generateCarousel).toHaveBeenCalledTimes(1);
    expect(deps.media.generateImage).not.toHaveBeenCalled();
    expect(out.mediaUrls).toHaveLength(3);
    expect(out.thumbnail).toBe(out.mediaUrls![0]);
    expect(out.videoUrl).toBeUndefined();
  });

  it('routes STORY through generateImage and returns a single mediaUrl', async () => {
    const deps = makeDeps();
    const out = await runGeneratePost(
      { concept: 'story post', type: 'STORY', platforms: ['INSTAGRAM'] },
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

  it('routes VIDEO through generateVideo', async () => {
    const deps = makeDeps();
    (deps.media.generateVideo as any).mockResolvedValueOnce({
      jobId: 'jobV2', status: 'RUNNING',
    });
    const out = await runGeneratePost(
      { concept: 'video post', type: 'VIDEO', platforms: ['FACEBOOK'] },
      deps,
      {},
    );
    expect(deps.media.generateVideo).toHaveBeenCalledTimes(1);
    expect(deps.media.generateImage).not.toHaveBeenCalled();
    expect(deps.media.generateCarousel).not.toHaveBeenCalled();
    expect(out.pendingMedia).toBe(true);
    expect(out.mediaJobId).toBe('jobV2');
  });

  it('caption ends with hashtags merged from LLM + specialization, deduped, denylist applied', async () => {
    const deps = makeDeps({
      suggestedHashtags: ['#parotta', '#like4like', '#ghee'],  // like4like is on the denylist
    });
    const out = await runGeneratePost(
      { concept: 'parotta', type: 'IMAGE', platforms: ['INSTAGRAM'] },
      deps,
      { restaurantId: 'r1', locale: 'en-IN' },
    );
    expect(out.caption).not.toMatch(/like4like/i);
    // At least one hashtag from the model input survives:
    expect(out.caption).toMatch(/#parotta|#ghee/);
  });

  it('writes two cost events: one llm, one image', async () => {
    const { insertCostEvent } = await import('@restropulse/db');
    (insertCostEvent as any).mockClear();
    const deps = makeDeps();
    await runGeneratePost({ concept: 'x', type: 'IMAGE', platforms: ['INSTAGRAM'] }, deps, { restaurantId: 'r1' });
    expect(insertCostEvent).toHaveBeenCalledTimes(2);
    const surfaces = (insertCostEvent as any).mock.calls.map((c: any) => c[0].surface);
    expect(surfaces).toContain('llm');
    expect(surfaces).toContain('image');
  });

  it('throws ContentGenerationError on missing concept and type', async () => {
    const deps = makeDeps();
    await expect(
      runGeneratePost({ concept: '', type: 'IMAGE', platforms: ['INSTAGRAM'] }, deps, {}),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('accepts themes-only input when concept is empty', async () => {
    const deps = makeDeps();
    // Should not throw -- themes[0] is the archetype, concept is empty
    const out = await runGeneratePost(
      { concept: '', type: 'IMAGE', platforms: ['INSTAGRAM'], themes: ['CRAVING_CUE'] },
      deps,
    );
    expect(out.caption).toBeTruthy();
  });

  it('throws INVALID_INPUT when concept, themes, and archetype are all absent', async () => {
    const deps = makeDeps();
    await expect(
      runGeneratePost({ concept: '', type: 'IMAGE', platforms: ['INSTAGRAM'] }, deps),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('accepts archetype field as standalone input without concept', async () => {
    const deps = makeDeps();
    const out = await runGeneratePost(
      { concept: '', type: 'REEL', platforms: ['INSTAGRAM'], archetype: 'CRAVING_CUE' },
      deps,
    );
    expect(out.caption).toBeTruthy();
  });

  it('calls generateObject twice when selectedDish is set and uses visual description as image concept', async () => {
    const deps = makeDeps();
    await runGeneratePost(
      { concept: 'Charred Cauliflower with Achaar Emulsion', type: 'IMAGE', platforms: ['INSTAGRAM'], selectedDish: 'Charred Cauliflower with Achaar Emulsion' },
      deps,
      { restaurantId: 'r1', restaurantName: 'Saffron & Smoke' },
    );
    // Caption call + dish visual description call
    expect(deps.llm.generateObject).toHaveBeenCalledTimes(2);
    // Image received the visual description, not the raw dish name
    expect(deps.media.generateImage).toHaveBeenCalledWith(
      expect.objectContaining({ concept: MOCK_DISH_VISUAL }),
    );
  });

  it('does not call generateObject for dish description when selectedDish is absent', async () => {
    const deps = makeDeps();
    await runGeneratePost(
      { concept: 'weekend brunch', type: 'IMAGE', platforms: ['INSTAGRAM'] },
      deps,
      { restaurantId: 'r1' },
    );
    // Only the caption call; no dish description call
    expect(deps.llm.generateObject).toHaveBeenCalledTimes(1);
    // Image received the original concept unchanged
    expect(deps.media.generateImage).toHaveBeenCalledWith(
      expect.objectContaining({ concept: 'weekend brunch' }),
    );
  });

  it('does not call dish visual description for video posts even with selectedDish', async () => {
    const deps = makeDeps();
    (deps.media.generateVideo as any).mockResolvedValueOnce({ jobId: 'jv', status: 'RUNNING' });
    await runGeneratePost(
      { concept: 'Biryani Reel', type: 'REEL', platforms: ['INSTAGRAM'], selectedDish: 'Biryani' },
      deps,
      { restaurantId: 'r1' },
    );
    // Only the caption call; dish description is skipped for video (no image model)
    expect(deps.llm.generateObject).toHaveBeenCalledTimes(1);
  });
});
