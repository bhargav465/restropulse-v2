import { describe, it, expect, beforeAll } from 'vitest';

// Set ASSET_SERVER_BASE_URL before dynamic import so asset-manager picks it up.
beforeAll(() => {
  process.env['ASSET_SERVER_BASE_URL'] = 'http://localhost:3002';
});

const { PlaceholderContentGenerator } = await import(
  '../../../../src/services/content-generator/backends/placeholder/index.js'
);
const { ContentGenerationError } = await import(
  '../../../../src/services/content-generator/types.js'
);

const generator = new PlaceholderContentGenerator();

describe('PlaceholderContentGenerator', () => {
  it('exposes a stable name', () => {
    expect(generator.name).toBe('placeholder');
  });

  describe('generatePost', () => {
    it('produces caption + thumbnail for IMAGE', async () => {
      const result = await generator.generatePost({
        concept: 'Weekend special',
        type: 'IMAGE',
        platforms: ['INSTAGRAM'],
      });
      expect(typeof result.caption).toBe('string');
      expect(result.thumbnail).toMatch(/^http:\/\/localhost:3002\/images\/.+\.jpg$/);
      expect(result.videoUrl).toBeUndefined();
      expect(result.mediaUrls).toBeUndefined();
    });

    it('produces mediaUrls for CAROUSEL', async () => {
      const result = await generator.generatePost({
        concept: 'Menu highlights',
        type: 'CAROUSEL',
        platforms: ['INSTAGRAM'],
      });
      expect(Array.isArray(result.mediaUrls)).toBe(true);
      expect(result.mediaUrls!.length).toBeGreaterThan(0);
      expect(result.thumbnail).toBe(result.mediaUrls![0]);
    });

    it('produces videoUrl + thumbnail for REEL', async () => {
      const result = await generator.generatePost({
        concept: 'Chef demo',
        type: 'REEL',
        platforms: ['INSTAGRAM'],
      });
      expect(result.videoUrl).toMatch(/\.mp4$/);
      expect(typeof result.thumbnail).toBe('string');
    });

    it('produces video for VIDEO', async () => {
      const result = await generator.generatePost({
        concept: 'Demo',
        type: 'VIDEO',
        platforms: ['FACEBOOK'],
      });
      expect(result.videoUrl).toMatch(/\.mp4$/);
    });

    it('produces a video story for STORY when a compatible video exists', async () => {
      const result = await generator.generatePost({
        concept: 'Daily story',
        type: 'STORY',
        platforms: ['INSTAGRAM'],
      });
      // Sintel (854×480, 52s) passes INSTAGRAM STORY constraints (max 1920px, 3–60s).
      // Generator prefers video; only falls back to image when no compatible video found.
      expect(result.thumbnail).toMatch(/^http:\/\/localhost:3002\/videos\/.+\.(jpg|jpeg|png)$/);
      expect(result.videoUrl).toMatch(/^http:\/\/localhost:3002\/videos\/.+\.mp4$/);
    });

    it('includes restaurant name in caption when provided via context', async () => {
      const result = await generator.generatePost(
        {
          concept: 'Pasta night',
          type: 'IMAGE',
          platforms: ['INSTAGRAM'],
          themes: ['Food & Menu'],
        },
        { restaurantName: 'Bella Roma' },
      );
      expect(result.caption).toContain('Bella Roma');
    });

    it('falls back to theme when concept is empty', async () => {
      const result = await generator.generatePost({
        concept: '',
        type: 'IMAGE',
        platforms: ['INSTAGRAM'],
        themes: ['Offers'],
      });
      expect(typeof result.caption).toBe('string');
      expect(result.caption).not.toContain('{concept}');
      expect(result.caption).not.toContain('{restaurant}');
    });

    it('throws ContentGenerationError when type is missing', async () => {
      await expect(
        generator.generatePost({
          concept: 'x',
          type: undefined as unknown as 'IMAGE',
          platforms: ['INSTAGRAM'],
        }),
      ).rejects.toBeInstanceOf(ContentGenerationError);
    });
  });

  describe('revisePost', () => {
    it('produces a fresh caption + media for the existing PostType', async () => {
      const result = await generator.revisePost(
        {
          existingPost: {
            type: 'CAROUSEL',
            platforms: ['INSTAGRAM'],
            caption: 'old caption',
            themes: ['Food & Menu'],
          },
          feedback: {
            tags: ['caption'],
            details: { Caption: 'make it punchier' },
            note: 'More energy please',
          },
        },
        { restaurantName: 'Casa Bella' },
      );

      expect(Array.isArray(result.mediaUrls)).toBe(true);
      expect(result.caption).toContain('Casa Bella');
    });

    it('handles empty feedback note gracefully', async () => {
      const result = await generator.revisePost({
        existingPost: {
          type: 'IMAGE',
          platforms: ['INSTAGRAM'],
          caption: 'old',
          themes: ['default'],
        },
        feedback: { tags: [], details: {}, note: '' },
      });
      expect(typeof result.caption).toBe('string');
      expect(result.thumbnail).toMatch(/^http:/);
    });

    it('throws ContentGenerationError when existingPost.type is missing', async () => {
      await expect(
        generator.revisePost({
          existingPost: {
            type: undefined as unknown as 'IMAGE',
            platforms: ['INSTAGRAM'],
            caption: '',
          },
          feedback: { tags: [], details: {}, note: '' },
        }),
      ).rejects.toBeInstanceOf(ContentGenerationError);
    });
  });

  describe('draftCycle', () => {
    it('returns summary + plannedPosts + focus derived from strategyFocus', async () => {
      const result = await generator.draftCycle({
        period: 'March 2026',
        strategyFocus: ['Food & Menu', 'Chef Specials', 'Offers', 'Behind the Scenes'],
      });
      expect(result.summary).toContain('March 2026');
      expect(result.focus).toHaveLength(3);
      expect(result.plannedPosts).toHaveLength(3);
      expect(result.plannedPosts[0]).toEqual({ category: 'Food & Menu', count: 2 });
    });

    it('uses default themes when strategyFocus is empty', async () => {
      const result = await generator.draftCycle({ period: 'April 2026' });
      expect(result.focus.length).toBeGreaterThan(0);
      expect(result.plannedPosts.length).toBeGreaterThan(0);
    });

    it('throws ContentGenerationError when period is empty', async () => {
      await expect(generator.draftCycle({ period: '' })).rejects.toBeInstanceOf(
        ContentGenerationError,
      );
    });
  });

  describe('reviseCycle', () => {
    it('preserves plannedPosts + focus, refreshes summary, stamps rationale', async () => {
      const existing = {
        period: 'May 2026',
        summary: 'Old summary',
        plannedPosts: [{ category: 'Food & Menu', count: 2 }],
        focus: ['Food & Menu'],
      };
      const result = await generator.reviseCycle({
        existingCycle: existing,
        feedback: { areas: ['timing', 'themes'], note: 'shift weekends' },
      });
      expect(result.summary).toContain('May 2026');
      expect(result.summary).toContain('timing');
      expect(result.plannedPosts).toEqual(existing.plannedPosts);
      expect(result.focus).toEqual(existing.focus);
      expect(typeof result.rationale).toBe('string');
    });

    it('throws ContentGenerationError when existing cycle period is missing', async () => {
      await expect(
        generator.reviseCycle({
          existingCycle: {
            period: '',
            summary: '',
            plannedPosts: [],
            focus: [],
          },
          feedback: { areas: [], note: '' },
        }),
      ).rejects.toBeInstanceOf(ContentGenerationError);
    });
  });

  describe('healthCheck', () => {
    it('returns ok: true', async () => {
      const result = await generator.healthCheck();
      expect(result.ok).toBe(true);
    });
  });
});
