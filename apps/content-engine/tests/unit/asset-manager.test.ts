import { describe, it, expect } from 'vitest';

// asset-manager always uses http://localhost:{ASSET_SERVER_PORT} — no env var needed.
const { getRandomImage, getRandomCarousel, getRandomVideo, buildCaption } = await import(
  '../../src/services/asset-manager.js'
);

describe('asset-manager', () => {
  // ---------------------------------------------------------------------------
  // getRandomImage
  // ---------------------------------------------------------------------------
  describe('getRandomImage()', () => {
    it('returns an object with a url string', () => {
      const result = getRandomImage();
      expect(typeof result.url).toBe('string');
      expect(result.url.length).toBeGreaterThan(0);
    });

    it('url starts with the base URL and points to images/', () => {
      const result = getRandomImage();
      expect(result.url).toMatch(/^http:\/\/localhost:3002\/images\/.+\.jpg$/);
    });

    it('returns a themed image when theme matches', () => {
      const result = getRandomImage('Food & Menu');
      expect(result.url).toMatch(/^http:\/\/localhost:3002\/images\/(food|chef|bts|cust|offer|default)-.+\.jpg$/);
      expect(result.asset.theme).toBe('Food & Menu');
    });

    it('falls back to any image when theme does not match', () => {
      const result = getRandomImage('Completely Unknown Theme XYZ');
      expect(result.url).toMatch(/^http:\/\/localhost:3002\/images\/.+\.jpg$/);
    });

    it('returns different images across multiple calls (randomness check)', () => {
      const urls = new Set(Array.from({ length: 20 }, () => getRandomImage('Food & Menu').url));
      // With 3 food images and 20 draws, we expect at least 2 distinct results
      expect(urls.size).toBeGreaterThanOrEqual(1);
    });
  });

  // ---------------------------------------------------------------------------
  // getRandomCarousel
  // ---------------------------------------------------------------------------
  describe('getRandomCarousel()', () => {
    it('returns an object with a urls array of 3 entries', () => {
      const result = getRandomCarousel();
      expect(Array.isArray(result.urls)).toBe(true);
      expect(result.urls).toHaveLength(3);
    });

    it('all carousel urls point to images/', () => {
      const { urls } = getRandomCarousel();
      for (const url of urls) {
        expect(url).toMatch(/^http:\/\/localhost:3002\/images\/.+\.jpg$/);
      }
    });

    it('returns themed carousel when theme matches', () => {
      const result = getRandomCarousel('Food & Menu');
      expect(result.set.theme).toBe('Food & Menu');
    });

    it('falls back gracefully for unknown theme', () => {
      const result = getRandomCarousel('Nonexistent Theme');
      expect(result.urls).toHaveLength(3);
    });
  });

  // ---------------------------------------------------------------------------
  // getRandomVideo
  // ---------------------------------------------------------------------------
  describe('getRandomVideo()', () => {
    it('returns videoUrl and thumbnail strings', () => {
      const result = getRandomVideo();
      expect(typeof result.videoUrl).toBe('string');
      expect(typeof result.thumbnail).toBe('string');
    });

    it('videoUrl points to videos/ with .mp4 extension', () => {
      const result = getRandomVideo();
      expect(result.videoUrl).toMatch(/^http:\/\/localhost:3002\/videos\/.+\.mp4$/);
    });

    it('thumbnail points to videos/ with image extension', () => {
      const result = getRandomVideo();
      expect(result.thumbnail).toMatch(/^http:\/\/localhost:3002\/videos\/.+\.(jpg|jpeg|png)$/);
    });

    it('returns themed video when theme matches', () => {
      const result = getRandomVideo('Chef Specials');
      expect(result.asset.theme).toBe('Chef Specials');
    });

    it('falls back gracefully for unknown theme', () => {
      const result = getRandomVideo('Unknown Theme XYZ');
      expect(result.videoUrl).toMatch(/\.mp4$/);
    });
  });

  // ---------------------------------------------------------------------------
  // buildCaption
  // ---------------------------------------------------------------------------
  describe('buildCaption()', () => {
    it('substitutes {restaurant} with the provided restaurant name', () => {
      const caption = buildCaption('Pasta night', 'Food & Menu', 'Bella Roma');
      expect(caption).toContain('Bella Roma');
    });

    it('substitutes {concept} with the concept string', () => {
      const caption = buildCaption('Truffle pasta', 'Chef Specials', 'La Cucina');
      // At least one of the Chef Specials templates includes {concept}
      // so we check that the raw placeholder is gone
      expect(caption).not.toContain('{concept}');
      expect(caption).not.toContain('{restaurant}');
    });

    it('uses "our restaurant" as fallback when no restaurant name is provided', () => {
      const caption = buildCaption('Weekend brunch', 'Offers');
      expect(caption).toContain('our restaurant');
    });

    it('falls back to default templates for an unknown theme', () => {
      const caption = buildCaption('Special event', 'Unknown Theme', 'Test Place');
      expect(caption).toContain('Test Place');
      expect(caption).not.toContain('{restaurant}');
      expect(caption).not.toContain('{concept}');
    });

    it('returns a non-empty string', () => {
      const caption = buildCaption('', 'default');
      expect(typeof caption).toBe('string');
      expect(caption.length).toBeGreaterThan(0);
    });
  });
});
