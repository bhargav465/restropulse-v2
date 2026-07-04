import { describe, it, expect } from 'vitest';
import { getMergedConstraints } from '../../../src/services/content-validator/media-constraints.js';

describe('getMergedConstraints', () => {
  describe('single platform', () => {
    it('INSTAGRAM IMAGE: has minWidthPx 320 and maxAspectRatio 1.91', () => {
      const c = getMergedConstraints('IMAGE', ['INSTAGRAM']);
      expect(c.minWidthPx).toBe(320);
      expect(c.maxAspectRatio).toBe(1.91);
      expect(c.minAspectRatio).toBe(0.8);
      expect(c.maxFileSizeBytes).toBe(8_388_608);
    });

    it('FACEBOOK IMAGE: no minWidthPx constraint', () => {
      const c = getMergedConstraints('IMAGE', ['FACEBOOK']);
      expect(c.minWidthPx).toBeUndefined();
      expect(c.maxFileSizeBytes).toBe(10_485_760);
    });

    it('INSTAGRAM REEL: duration 3-900s', () => {
      const c = getMergedConstraints('REEL', ['INSTAGRAM']);
      expect(c.minDurationSeconds).toBe(3);
      expect(c.maxDurationSeconds).toBe(900);
    });

    it('FACEBOOK REEL: strict aspect ratio 0.5625', () => {
      const c = getMergedConstraints('REEL', ['FACEBOOK']);
      expect(c.minAspectRatio).toBe(0.5625);
      expect(c.maxAspectRatio).toBe(0.5625);
      expect(c.maxDurationSeconds).toBe(90);
    });

    it('INSTAGRAM CAROUSEL: minCarouselItems 2, maxCarouselItems 10', () => {
      const c = getMergedConstraints('CAROUSEL', ['INSTAGRAM']);
      expect(c.minCarouselItems).toBe(2);
      expect(c.maxCarouselItems).toBe(10);
    });

    it('empty platforms array returns empty constraints', () => {
      const c = getMergedConstraints('IMAGE', []);
      expect(Object.keys(c)).toHaveLength(0);
    });
  });

  describe('merged across platforms', () => {
    it('INSTAGRAM + FACEBOOK REEL: maxDurationSeconds collapses to 90 (FB cap)', () => {
      const c = getMergedConstraints('REEL', ['INSTAGRAM', 'FACEBOOK']);
      expect(c.maxDurationSeconds).toBe(90);
    });

    it('INSTAGRAM + FACEBOOK REEL: minWidthPx is 540, minHeightPx is 960 (from FB)', () => {
      const c = getMergedConstraints('REEL', ['INSTAGRAM', 'FACEBOOK']);
      expect(c.minWidthPx).toBe(540);
      expect(c.minHeightPx).toBe(960);
    });

    it('INSTAGRAM + FACEBOOK REEL: minAspectRatio collapses to 0.5625', () => {
      const c = getMergedConstraints('REEL', ['INSTAGRAM', 'FACEBOOK']);
      expect(c.minAspectRatio).toBe(0.5625);
    });

    it('INSTAGRAM + FACEBOOK IMAGE: allowedMimeTypes is intersection (jpeg only)', () => {
      const c = getMergedConstraints('IMAGE', ['INSTAGRAM', 'FACEBOOK']);
      // INSTAGRAM only allows image/jpeg; FACEBOOK allows multiple
      // Intersection = ['image/jpeg']
      expect(c.allowedMimeTypes).toEqual(['image/jpeg']);
    });

    it('INSTAGRAM + FACEBOOK IMAGE: maxFileSizeBytes is min of 8MB and 10MB', () => {
      const c = getMergedConstraints('IMAGE', ['INSTAGRAM', 'FACEBOOK']);
      expect(c.maxFileSizeBytes).toBe(8_388_608);
    });

    it('INSTAGRAM + FACEBOOK CAROUSEL: maxCarouselItems is min(10, 10) = 10', () => {
      const c = getMergedConstraints('CAROUSEL', ['INSTAGRAM', 'FACEBOOK']);
      expect(c.maxCarouselItems).toBe(10);
      // minCarouselItems only defined by INSTAGRAM
      expect(c.minCarouselItems).toBe(2);
    });

    it('FACEBOOK + INSTAGRAM VIDEO: maxDurationSeconds is min(14400, 900) = 900', () => {
      const c = getMergedConstraints('VIDEO', ['FACEBOOK', 'INSTAGRAM']);
      expect(c.maxDurationSeconds).toBe(900);
    });
  });
});
