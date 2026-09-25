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

/** Media constraints for a single platform + post type. */
export function getConstraints(type: PostType, platform: Platform): MediaConstraints {
  return CONSTRAINTS[platform]?.[type] ?? {};
}
