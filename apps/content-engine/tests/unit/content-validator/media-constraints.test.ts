import { describe, it, expect } from 'vitest';
import { getConstraints } from '../../../src/services/content-validator/media-constraints.js';

describe('getConstraints', () => {
  it('INSTAGRAM IMAGE: has minWidthPx 320 and maxAspectRatio 1.91', () => {
    const c = getConstraints('IMAGE', 'INSTAGRAM');
    expect(c.minWidthPx).toBe(320);
    expect(c.maxAspectRatio).toBe(1.91);
    expect(c.minAspectRatio).toBe(0.8);
    expect(c.maxFileSizeBytes).toBe(8_388_608);
  });

  it('FACEBOOK IMAGE: no minWidthPx constraint', () => {
    const c = getConstraints('IMAGE', 'FACEBOOK');
    expect(c.minWidthPx).toBeUndefined();
    expect(c.maxFileSizeBytes).toBe(10_485_760);
  });

  it('INSTAGRAM REEL: duration 3-900s', () => {
    const c = getConstraints('REEL', 'INSTAGRAM');
    expect(c.minDurationSeconds).toBe(3);
    expect(c.maxDurationSeconds).toBe(900);
  });

  it('FACEBOOK REEL: strict aspect ratio 0.5625', () => {
    const c = getConstraints('REEL', 'FACEBOOK');
    expect(c.minAspectRatio).toBe(0.5625);
    expect(c.maxAspectRatio).toBe(0.5625);
    expect(c.maxDurationSeconds).toBe(90);
  });

  it('INSTAGRAM CAROUSEL: minCarouselItems 2, maxCarouselItems 10', () => {
    const c = getConstraints('CAROUSEL', 'INSTAGRAM');
    expect(c.minCarouselItems).toBe(2);
    expect(c.maxCarouselItems).toBe(10);
  });

  it('FACEBOOK CAROUSEL: maxCarouselItems 10, no minCarouselItems', () => {
    const c = getConstraints('CAROUSEL', 'FACEBOOK');
    expect(c.maxCarouselItems).toBe(10);
    expect(c.minCarouselItems).toBeUndefined();
  });

  it('FACEBOOK VIDEO: maxDurationSeconds 14400', () => {
    const c = getConstraints('VIDEO', 'FACEBOOK');
    expect(c.maxDurationSeconds).toBe(14400);
  });

  it('unknown type/platform combination returns empty constraints', () => {
    // STORY has no aspect-ratio constraint defined for FACEBOOK photo stories.
    const c = getConstraints('STORY', 'FACEBOOK');
    expect(c.minAspectRatio).toBeUndefined();
    expect(c.maxAspectRatio).toBeUndefined();
  });
});
