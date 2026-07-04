import { describe, it, expect, beforeAll, vi } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

beforeAll(() => {
  process.env['ASSET_SERVER_BASE_URL'] = 'http://localhost:3002';
  process.env['ASSET_SERVER_PORT'] = '3002';
});

const { PlaceholderMediaGenerator } = await import(
  '../../../../../../src/services/content-generator/backends/ai/media/placeholder-media-generator.js'
);

const gen = new PlaceholderMediaGenerator();

describe('PlaceholderMediaGenerator', () => {
  it('exposes name "placeholder-media"', () => {
    expect(gen.name).toBe('placeholder-media');
  });

  it('generateImage returns a COMPLETED job with a URL for IMAGE post type', async () => {
    const job = await gen.generateImage({
      postType: 'IMAGE',
      platforms: ['INSTAGRAM'],
      concept: 'paneer tikka',
    });
    expect(job.status).toBe('COMPLETED');
    expect(job.mediaUrl).toMatch(/^http:\/\//);
    expect(job.thumbnail).toBeDefined();
    expect(job.metadata?.widthPx).toBeGreaterThan(0);
    expect(job.metadata?.heightPx).toBeGreaterThan(0);
  });

  it('generateCarousel returns mediaUrls + thumbnail for CAROUSEL', async () => {
    const job = await gen.generateCarousel({
      platforms: ['INSTAGRAM'],
      concept: 'menu highlights',
    });
    expect(job.status).toBe('COMPLETED');
    expect(Array.isArray(job.mediaUrls)).toBe(true);
    expect(job.mediaUrls!.length).toBeGreaterThan(0);
    expect(job.thumbnail).toBe(job.mediaUrls![0]);
  });

  it('generateVideo returns a COMPLETED job with thumbnail + videoUrl for REEL', async () => {
    const job = await gen.generateVideo({
      postType: 'REEL',
      platforms: ['INSTAGRAM'],
      concept: 'kitchen close-up',
    });
    expect(job.status).toBe('COMPLETED');
    expect(job.mediaUrl).toMatch(/^http:\/\//);
    expect(job.thumbnail).toBeDefined();
  });

  it('pollJob returns COMPLETED for any jobId (synchronous backend)', async () => {
    const status = await gen.pollJob('whatever');
    expect(status.status).toBe('COMPLETED');
  });

  it('jobId is unique per call (uuid-like)', async () => {
    const j1 = await gen.generateImage({ postType: 'IMAGE', platforms: ['INSTAGRAM'], concept: 'x' });
    const j2 = await gen.generateImage({ postType: 'IMAGE', platforms: ['INSTAGRAM'], concept: 'y' });
    expect(j1.jobId).not.toBe(j2.jobId);
  });
});
