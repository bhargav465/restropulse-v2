import type { Platform, PostType } from '@restropulse/shared';

export interface MediaConstraints {
  allowedMimeTypes?: string[];
  maxFileSizeBytes?: number;
  minWidthPx?: number;
  maxWidthPx?: number;
  minHeightPx?: number;
  maxHeightPx?: number;
  minAspectRatio?: number;
  maxAspectRatio?: number;
  minDurationSeconds?: number;
  maxDurationSeconds?: number;
  minCarouselItems?: number;
  maxCarouselItems?: number;
}

export const CONSTRAINTS: Record<Platform, Partial<Record<PostType, MediaConstraints>>> = {
  INSTAGRAM: {
    IMAGE:    { allowedMimeTypes: ['image/jpeg'], maxFileSizeBytes: 8_388_608, minWidthPx: 320, maxWidthPx: 1440, minAspectRatio: 0.8, maxAspectRatio: 1.91 },
    CAROUSEL: { allowedMimeTypes: ['image/jpeg'], maxFileSizeBytes: 8_388_608, minWidthPx: 320, maxWidthPx: 1440, minAspectRatio: 0.8, maxAspectRatio: 1.91, minCarouselItems: 2, maxCarouselItems: 10 },
    REEL:     { allowedMimeTypes: ['video/mp4', 'video/quicktime'], maxFileSizeBytes: 314_572_800, minWidthPx: 540, maxWidthPx: 1920, minDurationSeconds: 3, maxDurationSeconds: 900, minAspectRatio: 0.01, maxAspectRatio: 10 },
    STORY:    { allowedMimeTypes: ['image/jpeg', 'video/mp4', 'video/quicktime'], maxFileSizeBytes: 104_857_600, maxWidthPx: 1920, minDurationSeconds: 3, maxDurationSeconds: 60 },
    VIDEO:    { allowedMimeTypes: ['video/mp4', 'video/quicktime'], maxWidthPx: 1920, minDurationSeconds: 3, maxDurationSeconds: 900 },
  },
  FACEBOOK: {
    IMAGE:    { allowedMimeTypes: ['image/jpeg', 'image/png', 'image/bmp', 'image/gif', 'image/tiff'], maxFileSizeBytes: 10_485_760 },
    CAROUSEL: { maxCarouselItems: 10 },
    REEL:     { allowedMimeTypes: ['video/mp4'], minWidthPx: 540, minHeightPx: 960, maxWidthPx: 1080, maxHeightPx: 1920, minDurationSeconds: 3, maxDurationSeconds: 90, minAspectRatio: 0.5625, maxAspectRatio: 0.5625 },
    VIDEO:    { allowedMimeTypes: ['video/mp4'], maxDurationSeconds: 14400 },
    // STORY: aspect ratio constraint omitted — applies only to video stories
    // (photo stories accept various ratios, displayed with letterboxing/padding).
    STORY:    { allowedMimeTypes: ['video/mp4', 'image/jpeg'], maxDurationSeconds: 60 },
  },
};

/**
 * Merge constraints from all target platforms, taking the most restrictive
 * value for each field (smallest maxes, largest mins).
 */
export function getMergedConstraints(type: PostType, platforms: Platform[]): MediaConstraints {
  const merged: MediaConstraints = {};
  for (const platform of platforms) {
    const c = CONSTRAINTS[platform]?.[type];
    if (!c) continue;
    if (c.allowedMimeTypes) {
      // intersection of allowed types (must be accepted by ALL platforms)
      merged.allowedMimeTypes = merged.allowedMimeTypes
        ? merged.allowedMimeTypes.filter(m => c.allowedMimeTypes!.includes(m))
        : [...c.allowedMimeTypes];
    }
    if (c.maxFileSizeBytes !== undefined)    merged.maxFileSizeBytes    = merged.maxFileSizeBytes    !== undefined ? Math.min(merged.maxFileSizeBytes,    c.maxFileSizeBytes)    : c.maxFileSizeBytes;
    if (c.minWidthPx       !== undefined)    merged.minWidthPx          = merged.minWidthPx          !== undefined ? Math.max(merged.minWidthPx,          c.minWidthPx)          : c.minWidthPx;
    if (c.maxWidthPx       !== undefined)    merged.maxWidthPx          = merged.maxWidthPx          !== undefined ? Math.min(merged.maxWidthPx,          c.maxWidthPx)          : c.maxWidthPx;
    if (c.minHeightPx      !== undefined)    merged.minHeightPx         = merged.minHeightPx         !== undefined ? Math.max(merged.minHeightPx,         c.minHeightPx)         : c.minHeightPx;
    if (c.maxHeightPx      !== undefined)    merged.maxHeightPx         = merged.maxHeightPx         !== undefined ? Math.min(merged.maxHeightPx,         c.maxHeightPx)         : c.maxHeightPx;
    if (c.minAspectRatio   !== undefined)    merged.minAspectRatio      = merged.minAspectRatio      !== undefined ? Math.max(merged.minAspectRatio,      c.minAspectRatio)      : c.minAspectRatio;
    if (c.maxAspectRatio   !== undefined)    merged.maxAspectRatio      = merged.maxAspectRatio      !== undefined ? Math.min(merged.maxAspectRatio,      c.maxAspectRatio)      : c.maxAspectRatio;
    if (c.minDurationSeconds !== undefined)  merged.minDurationSeconds  = merged.minDurationSeconds  !== undefined ? Math.max(merged.minDurationSeconds,  c.minDurationSeconds)  : c.minDurationSeconds;
    if (c.maxDurationSeconds !== undefined)  merged.maxDurationSeconds  = merged.maxDurationSeconds  !== undefined ? Math.min(merged.maxDurationSeconds,  c.maxDurationSeconds)  : c.maxDurationSeconds;
    if (c.minCarouselItems !== undefined)    merged.minCarouselItems    = merged.minCarouselItems    !== undefined ? Math.max(merged.minCarouselItems,    c.minCarouselItems)    : c.minCarouselItems;
    if (c.maxCarouselItems !== undefined)    merged.maxCarouselItems    = merged.maxCarouselItems    !== undefined ? Math.min(merged.maxCarouselItems,    c.maxCarouselItems)    : c.maxCarouselItems;
  }
  return merged;
}
