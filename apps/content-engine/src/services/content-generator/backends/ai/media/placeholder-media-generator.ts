/**
 * PlaceholderMediaGenerator -- IMediaGenerator that wraps the existing
 * asset-manager catalog. Used by AIContentGenerator in phase 2 so the AI
 * pipeline runs end-to-end with real-looking media URLs without calling
 * an external media provider. Replaced by ReplicateMediaGenerator in phase 4.
 *
 * Synchronous: every job resolves to COMPLETED immediately. pollJob() is a
 * no-op (returns COMPLETED) so callers that always poll still work.
 */

import { randomUUID } from 'node:crypto';
import { createLogger } from '@restropulse/telemetry/server';
import {
  getRandomCarousel,
  getRandomImage,
  getRandomVideo,
  getConstraintCompatibleImage,
  getConstraintCompatibleVideo,
} from '../../../../asset-manager.js';
import { getConstraints } from '../../../../content-validator/media-constraints.js';
import type {
  IMediaGenerator,
  ImageGenInput,
  CarouselGenInput,
  MediaGenJob,
  VideoGenInput,
} from './types.js';

const log = createLogger('placeholder-media-generator');

function pickThemeKey(input: { themes?: string[]; concept: string }): string {
  return input.themes?.[0]?.trim() || input.concept || 'default';
}

export class PlaceholderMediaGenerator implements IMediaGenerator {
  readonly name = 'placeholder-media';

  async generateImage(input: ImageGenInput): Promise<MediaGenJob> {
    const theme = pickThemeKey(input);
    const constraints = getConstraints(input.postType, input.platform);
    const selected = getConstraintCompatibleImage(constraints, theme) ?? getRandomImage(theme);
    return {
      jobId: randomUUID(),
      status: 'COMPLETED',
      mediaUrl: selected.url,
      thumbnail: selected.url,
      metadata: { widthPx: selected.asset.widthPx, heightPx: selected.asset.heightPx },
    };
  }

  async generateCarousel(input: CarouselGenInput): Promise<MediaGenJob> {
    const theme = input.themes?.[0]?.trim() || input.concept || 'default';
    const { urls, set } = getRandomCarousel(theme);
    return {
      jobId: randomUUID(),
      status: 'COMPLETED',
      mediaUrls: urls,
      thumbnail: urls[0],
      metadata: { widthPx: set.widthPx, heightPx: set.heightPx },
    };
  }

  async generateVideo(input: VideoGenInput): Promise<MediaGenJob> {
    const theme = pickThemeKey(input);
    const constraints = getConstraints(input.postType, input.platform);

    const selected = getConstraintCompatibleVideo(constraints, theme);
    if (selected) {
      return {
        jobId: randomUUID(),
        status: 'COMPLETED',
        mediaUrl: selected.videoUrl,
        thumbnail: selected.thumbnail,
        metadata: {
          widthPx: selected.asset.widthPx,
          heightPx: selected.asset.heightPx,
          durationSeconds: selected.asset.durationSeconds,
        },
      };
    }

    log.warn({ postType: input.postType, platform: input.platform, theme },
      'No constraint-compatible video; falling back to random video');
    const fallback = getRandomVideo(theme);
    return {
      jobId: randomUUID(),
      status: 'COMPLETED',
      mediaUrl: fallback.videoUrl,
      thumbnail: fallback.thumbnail,
      metadata: {
        widthPx: fallback.asset.widthPx,
        heightPx: fallback.asset.heightPx,
        durationSeconds: fallback.asset.durationSeconds,
      },
    };
  }

  async pollJob(jobId: string): Promise<MediaGenJob> {
    return { jobId, status: 'COMPLETED' };
  }
}
