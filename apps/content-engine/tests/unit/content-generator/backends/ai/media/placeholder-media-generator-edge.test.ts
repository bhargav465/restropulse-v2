import { describe, it, expect, vi } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { PlaceholderMediaGenerator } = await import(
  '../../../../../../../src/services/content-generator/backends/ai/media/placeholder-media-generator.js'
);

const gen = new PlaceholderMediaGenerator();

/**
 * Constraint-driven selection is exercised with real inputs, no mocking:
 *  - INSTAGRAM IMAGE / VIDEO constraints admit the catalog assets.
 *  - FACEBOOK REEL requires 540x960+ and an exact 9:16 ratio, which no catalog
 *    asset satisfies, so it forces the "no compatible asset" fallback.
 */
const compatibleImage = { postType: 'IMAGE' as const, platform: 'INSTAGRAM' as const, platforms: ['INSTAGRAM' as const] };
const compatibleVideo = { postType: 'VIDEO' as const, platform: 'INSTAGRAM' as const, platforms: ['INSTAGRAM' as const] };
const impossible = { postType: 'REEL' as const, platform: 'FACEBOOK' as const, platforms: ['FACEBOOK' as const] };

describe('PlaceholderMediaGenerator media selection', () => {
  it('serves a constraint-compatible image with its dimensions', async () => {
    const job = await gen.generateImage({ ...compatibleImage, concept: 'Biryani' });

    expect(job.status).toBe('COMPLETED');
    expect(job.mediaUrl).toMatch(/^http:\/\/localhost:\d+\/images\/.+\.jpg$/);
    expect(job.thumbnail).toBe(job.mediaUrl);
    expect(job.metadata).toEqual({ widthPx: expect.any(Number), heightPx: expect.any(Number) });
  });

  it('falls back to any image when no image satisfies the constraints', async () => {
    const job = await gen.generateImage({ ...impossible, concept: 'Biryani' });

    expect(job.status).toBe('COMPLETED');
    expect(job.mediaUrl).toMatch(/\/images\/.+/);
  });

  it('serves a constraint-compatible video with duration metadata', async () => {
    const job = await gen.generateVideo({ ...compatibleVideo, concept: 'Chef' });

    expect(job.status).toBe('COMPLETED');
    expect(job.mediaUrl).toMatch(/\/videos\/.+/);
    expect(job.thumbnail).toMatch(/\/videos\/.+/);
    expect(job.metadata).toEqual({ widthPx: expect.any(Number), heightPx: expect.any(Number), durationSeconds: expect.any(Number) });
  });

  it('falls back to a random video when no video satisfies the constraints', async () => {
    const job = await gen.generateVideo({ ...impossible, concept: 'Chef' });

    expect(job.status).toBe('COMPLETED');
    expect(job.mediaUrl).toMatch(/\/videos\/.+/);
    expect(job.metadata).toHaveProperty('durationSeconds');
  });
});

describe('theme selection', () => {
  it.each([
    ['a padded theme', { concept: 'Biryani', themes: ['  Food & Menu  '] }],
    ['a blank theme, falling back to the concept', { concept: 'Biryani', themes: ['   '] }],
    ['no themes and an empty concept, falling back to "default"', { concept: '' }],
  ])('completes an image with %s', async (_label, input) => {
    const job = await gen.generateImage({ ...compatibleImage, ...input });
    expect(job.status).toBe('COMPLETED');
    expect(job.mediaUrl).toMatch(/\/images\/.+/);
  });

  it.each([
    ['a padded theme', { concept: 'x', themes: ['Food & Menu'] }],
    ['a blank theme, falling back to the concept', { concept: 'x', themes: ['  '] }],
    ['no themes and an empty concept, falling back to "default"', { concept: '' }],
  ])('builds a carousel with %s', async (_label, input) => {
    const job = await gen.generateCarousel({ platforms: ['INSTAGRAM'], ...input });

    expect(job.status).toBe('COMPLETED');
    expect(job.mediaUrls!.length).toBeGreaterThan(0);
    expect(job.thumbnail).toBe(job.mediaUrls![0]);
  });
});
