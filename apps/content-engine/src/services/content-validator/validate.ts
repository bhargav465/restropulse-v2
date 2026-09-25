import type { Platform, PostType } from '@restropulse/shared';
import type { GeneratedPost } from '../content-generator/types.js';
import { getConstraints } from './media-constraints.js';

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationIssue {
  field: string;
  rule: string;
  message: string;
  severity: ValidationSeverity;
}

function mimeTypeFromUrl(url: string): string | null {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', bmp: 'image/bmp', tiff: 'image/tiff', tif: 'image/tiff',
    mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  };
  return ext ? (map[ext] ?? null) : null;
}

export function validateGeneratedPost(
  post: GeneratedPost,
  type: PostType,
  platform: Platform,
): ValidationIssue[] {
  const c = getConstraints(type, platform);
  const issues: ValidationIssue[] = [];

  // MIME type check via URL extension
  if (c.allowedMimeTypes) {
    const primaryUrl = post.videoUrl ?? post.thumbnail;
    const mime = mimeTypeFromUrl(primaryUrl);
    if (mime && !c.allowedMimeTypes.includes(mime)) {
      issues.push({
        field: post.videoUrl ? 'videoUrl' : 'thumbnail',
        rule: 'allowedMimeTypes',
        message: `${type} on ${platform} requires one of [${c.allowedMimeTypes.join(', ')}] but got ${mime}`,
        severity: 'error',
      });
    }
  }

  // Missing video for types that require it
  if ((type === 'REEL' || type === 'VIDEO') && !post.videoUrl) {
    issues.push({
      field: 'videoUrl',
      rule: 'required',
      message: `${type} post must have a videoUrl`,
      severity: 'error',
    });
  }

  // Carousel item count
  if (type === 'CAROUSEL') {
    const count = post.mediaUrls?.length ?? 0;
    if (c.minCarouselItems !== undefined && count < c.minCarouselItems) {
      issues.push({
        field: 'mediaUrls',
        rule: 'minCarouselItems',
        message: `Carousel requires at least ${c.minCarouselItems} items, got ${count}`,
        severity: 'error',
      });
    }
    if (c.maxCarouselItems !== undefined && count > c.maxCarouselItems) {
      issues.push({
        field: 'mediaUrls',
        rule: 'maxCarouselItems',
        message: `Carousel allows at most ${c.maxCarouselItems} items, got ${count}`,
        severity: 'error',
      });
    }
  }

  // Metadata-based checks (only when generator supplies metadata)
  const meta = post.mediaMetadata;
  if (meta) {
    if (meta.durationSeconds !== undefined) {
      if (c.minDurationSeconds !== undefined && meta.durationSeconds < c.minDurationSeconds) {
        issues.push({
          field: 'mediaMetadata.durationSeconds',
          rule: 'minDurationSeconds',
          message: `Duration ${meta.durationSeconds}s is below minimum ${c.minDurationSeconds}s`,
          severity: 'error',
        });
      }
      if (c.maxDurationSeconds !== undefined && meta.durationSeconds > c.maxDurationSeconds) {
        issues.push({
          field: 'mediaMetadata.durationSeconds',
          rule: 'maxDurationSeconds',
          message: `Duration ${meta.durationSeconds}s exceeds maximum ${c.maxDurationSeconds}s`,
          severity: 'error',
        });
      }
    }
    if (meta.widthPx !== undefined && meta.heightPx !== undefined) {
      if (c.minWidthPx !== undefined && meta.widthPx < c.minWidthPx) {
        issues.push({
          field: 'mediaMetadata.widthPx',
          rule: 'minWidthPx',
          message: `Width ${meta.widthPx}px is below minimum ${c.minWidthPx}px`,
          severity: 'error',
        });
      }
      if (c.maxWidthPx !== undefined && meta.widthPx > c.maxWidthPx) {
        issues.push({
          field: 'mediaMetadata.widthPx',
          rule: 'maxWidthPx',
          message: `Width ${meta.widthPx}px exceeds maximum ${c.maxWidthPx}px`,
          severity: 'error',
        });
      }
      if (c.minHeightPx !== undefined && meta.heightPx < c.minHeightPx) {
        issues.push({
          field: 'mediaMetadata.heightPx',
          rule: 'minHeightPx',
          message: `Height ${meta.heightPx}px is below minimum ${c.minHeightPx}px`,
          severity: 'error',
        });
      }
      if (c.maxHeightPx !== undefined && meta.heightPx > c.maxHeightPx) {
        issues.push({
          field: 'mediaMetadata.heightPx',
          rule: 'maxHeightPx',
          message: `Height ${meta.heightPx}px exceeds maximum ${c.maxHeightPx}px`,
          severity: 'error',
        });
      }
      const ar = meta.widthPx / meta.heightPx;
      if (c.minAspectRatio !== undefined && ar < c.minAspectRatio - 0.001) {
        issues.push({
          field: 'mediaMetadata',
          rule: 'minAspectRatio',
          message: `Aspect ratio ${ar.toFixed(3)} is below minimum ${c.minAspectRatio}`,
          severity: 'error',
        });
      }
      if (c.maxAspectRatio !== undefined && ar > c.maxAspectRatio + 0.001) {
        issues.push({
          field: 'mediaMetadata',
          rule: 'maxAspectRatio',
          message: `Aspect ratio ${ar.toFixed(3)} exceeds maximum ${c.maxAspectRatio}`,
          severity: 'error',
        });
      }
    }
    if (
      meta.fileSizeBytes !== undefined &&
      c.maxFileSizeBytes !== undefined &&
      meta.fileSizeBytes > c.maxFileSizeBytes
    ) {
      issues.push({
        field: 'mediaMetadata.fileSizeBytes',
        rule: 'maxFileSizeBytes',
        message: `File size ${Math.round(meta.fileSizeBytes / 1024 / 1024)}MB exceeds maximum ${Math.round(c.maxFileSizeBytes / 1024 / 1024)}MB`,
        severity: 'error',
      });
    }
  }

  return issues;
}
