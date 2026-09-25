import { describe, it, expect } from 'vitest';
import { IMAGE_ASSETS, VIDEO_ASSETS } from '../../src/assets/media-catalog.js';

const { getConstraintCompatibleImage, getConstraintCompatibleVideo } = await import('../../src/services/asset-manager.js');

/**
 * The catalog is static, so every constraint here is derived from it: each test
 * builds a constraint that excludes (or admits) a known slice of assets rather
 * than hard-coding dimensions that could drift from the catalog.
 */

const imgW = IMAGE_ASSETS.map((a) => a.widthPx);
const imgH = IMAGE_ASSETS.map((a) => a.heightPx);
const imgAr = IMAGE_ASSETS.map((a) => a.widthPx / a.heightPx);
const vidW = VIDEO_ASSETS.map((a) => a.widthPx);
const vidH = VIDEO_ASSETS.map((a) => a.heightPx);
const vidAr = VIDEO_ASSETS.map((a) => a.widthPx / a.heightPx);
const vidDur = VIDEO_ASSETS.map((a) => a.durationSeconds);

describe('getConstraintCompatibleImage', () => {
  it('returns an image when there are no constraints', () => {
    expect(getConstraintCompatibleImage({})).not.toBeNull();
  });

  it('builds the URL from the chosen asset', () => {
    const picked = getConstraintCompatibleImage({});
    expect(picked!.url).toBe(`http://localhost:3002/images/${picked!.asset.filename}`);
  });

  it('returns null when every image is narrower than minWidthPx', () => {
    expect(getConstraintCompatibleImage({ minWidthPx: Math.max(...imgW) + 1 })).toBeNull();
  });

  it('returns null when every image is wider than maxWidthPx', () => {
    expect(getConstraintCompatibleImage({ maxWidthPx: Math.min(...imgW) - 1 })).toBeNull();
  });

  it('returns null when every image is shorter than minHeightPx', () => {
    expect(getConstraintCompatibleImage({ minHeightPx: Math.max(...imgH) + 1 })).toBeNull();
  });

  it('returns null when every image is taller than maxHeightPx', () => {
    expect(getConstraintCompatibleImage({ maxHeightPx: Math.min(...imgH) - 1 })).toBeNull();
  });

  it('returns null when every aspect ratio is below minAspectRatio', () => {
    expect(getConstraintCompatibleImage({ minAspectRatio: Math.max(...imgAr) + 0.5 })).toBeNull();
  });

  it('returns null when every aspect ratio is above maxAspectRatio', () => {
    expect(getConstraintCompatibleImage({ maxAspectRatio: Math.min(...imgAr) - 0.5 })).toBeNull();
  });

  it('accepts an image whose aspect ratio matches exactly (tolerance on both bounds)', () => {
    const target = imgAr[0];
    const picked = getConstraintCompatibleImage({ minAspectRatio: target, maxAspectRatio: target });
    expect(picked).not.toBeNull();
    expect(picked!.asset.widthPx / picked!.asset.heightPx).toBeCloseTo(target, 2);
  });

  it('applies only a min or only a max aspect ratio when the other is absent', () => {
    expect(getConstraintCompatibleImage({ minAspectRatio: Math.min(...imgAr) })).not.toBeNull();
    expect(getConstraintCompatibleImage({ maxAspectRatio: Math.max(...imgAr) })).not.toBeNull();
  });

  it('honours the size window when it admits the catalog', () => {
    const picked = getConstraintCompatibleImage({
      minWidthPx: Math.min(...imgW),
      maxWidthPx: Math.max(...imgW),
      minHeightPx: Math.min(...imgH),
      maxHeightPx: Math.max(...imgH),
    });
    expect(picked).not.toBeNull();
  });

  it('prefers the requested theme among compatible images', () => {
    const theme = IMAGE_ASSETS[0].theme;
    expect(getConstraintCompatibleImage({}, theme)!.asset.theme).toBe(theme);
  });
});

describe('getConstraintCompatibleVideo', () => {
  it('returns a video with video and thumbnail URLs when there are no constraints', () => {
    const picked = getConstraintCompatibleVideo({});
    expect(picked).not.toBeNull();
    expect(picked!.videoUrl).toBe(`http://localhost:3002/videos/${picked!.asset.videoFilename}`);
    expect(picked!.thumbnail).toBe(`http://localhost:3002/videos/${picked!.asset.thumbnailFilename}`);
  });

  it('returns null when every video is narrower than minWidthPx', () => {
    expect(getConstraintCompatibleVideo({ minWidthPx: Math.max(...vidW) + 1 })).toBeNull();
  });

  it('returns null when every video is wider than maxWidthPx', () => {
    expect(getConstraintCompatibleVideo({ maxWidthPx: Math.min(...vidW) - 1 })).toBeNull();
  });

  it('returns null when every video is shorter than minHeightPx', () => {
    expect(getConstraintCompatibleVideo({ minHeightPx: Math.max(...vidH) + 1 })).toBeNull();
  });

  it('returns null when every video is taller than maxHeightPx', () => {
    expect(getConstraintCompatibleVideo({ maxHeightPx: Math.min(...vidH) - 1 })).toBeNull();
  });

  it('returns null when every aspect ratio is below minAspectRatio', () => {
    expect(getConstraintCompatibleVideo({ minAspectRatio: Math.max(...vidAr) + 0.5 })).toBeNull();
  });

  it('returns null when every aspect ratio is above maxAspectRatio', () => {
    expect(getConstraintCompatibleVideo({ maxAspectRatio: Math.min(...vidAr) - 0.5 })).toBeNull();
  });

  it('accepts a video whose aspect ratio matches exactly', () => {
    const target = vidAr[0];
    const picked = getConstraintCompatibleVideo({ minAspectRatio: target, maxAspectRatio: target });
    expect(picked).not.toBeNull();
    expect(picked!.asset.widthPx / picked!.asset.heightPx).toBeCloseTo(target, 2);
  });

  it('applies only a min or only a max aspect ratio when the other is absent', () => {
    expect(getConstraintCompatibleVideo({ minAspectRatio: Math.min(...vidAr) })).not.toBeNull();
    expect(getConstraintCompatibleVideo({ maxAspectRatio: Math.max(...vidAr) })).not.toBeNull();
  });

  it('returns null when every video is shorter than minDurationSeconds', () => {
    expect(getConstraintCompatibleVideo({ minDurationSeconds: Math.max(...vidDur) + 1 })).toBeNull();
  });

  it('returns null when every video is longer than maxDurationSeconds', () => {
    expect(getConstraintCompatibleVideo({ maxDurationSeconds: Math.min(...vidDur) - 1 })).toBeNull();
  });

  it('returns a video inside the duration window', () => {
    const picked = getConstraintCompatibleVideo({ minDurationSeconds: Math.min(...vidDur), maxDurationSeconds: Math.max(...vidDur) });
    expect(picked).not.toBeNull();
  });
});
