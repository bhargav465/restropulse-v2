/**
 * FalAIMediaGenerator -- IMediaGenerator backed by fal.ai sync inference (images)
 * and queue API (video via Kling 1.6).
 *
 * Phase 4 supports IMAGE, CAROUSEL, STORY (text-to-image OR image-to-image
 * when input.baseImageUrl is present).
 * Phase 5 adds REEL/VIDEO via the async queue + poll pattern.
 *
 * Every generation path:
 *   1. Pick model + image_size from postType + baseImageUrl.
 *   2. Call FalClient (with retry + cost tracking).
 *   3. Insert MediaJobRecord with status=COMPLETED on success (image), RUNNING on
 *      queue submit (video), FAILED on error.
 *
 * CAROUSEL fans out to 3 parallel calls; each gets its own MediaJobRecord.
 */

import { randomUUID } from 'node:crypto';
import { createLogger } from '@restropulse/telemetry/server';
import type { Platform, PostType, MediaJobRecord } from '@restropulse/shared';
import {
  ContentGenerationError,
} from '../../../../types.js';
import { withRetry, RETRY_PROFILES } from '../../with-retry.js';
import { withCostTracking } from '../../with-cost-tracking.js';
import { FAL_MODELS } from './models.js';
import { computeFalCostUsd } from './pricing.js';
import type { FalClient, FalImageResponse } from './fal-client.js';
import type { FalQueueStatusValue } from './queue-types.js';
import type { IMediaJobStore } from '../jobs/types.js';
import type {
  IMediaGenerator,
  ImageGenInput,
  CarouselGenInput,
  MediaGenJob,
  VideoGenInput,
} from '../types.js';

const DEFAULT_VIDEO_MODEL = FAL_MODELS.klingVideo;

const log = createLogger('fal-ai-media-generator');

const CAROUSEL_FRAME_COUNT = 3;

export interface FalAIMediaGeneratorOptions {
  client: Pick<FalClient, 'generateImage' | 'editImage' | 'submitToQueue' | 'getQueueStatus' | 'getQueueResult'>;
  store: IMediaJobStore;
}

function pickImageSize(postType: PostType, _platforms: Platform[]): string {
  switch (postType) {
    case 'STORY':
      return 'portrait_16_9';
    case 'IMAGE':
    case 'CAROUSEL':
    default:
      return 'square_hd';
  }
}

function buildPrompt(input: Pick<ImageGenInput, 'concept' | 'themes' | 'caption' | 'promptSuffix'>): string {
  const themePart = input.themes?.length ? `, themes: ${input.themes.join(', ')}` : '';
  const captionPart = input.caption ? `, alongside the caption "${input.caption.slice(0, 200)}"` : '';
  const base = `${input.concept}${themePart}${captionPart}`;
  return (input.promptSuffix ? `${base}\n\n${input.promptSuffix}` : base).slice(0, 1200);
}

export class FalAIMediaGenerator implements IMediaGenerator {
  readonly name = 'fal-ai';
  private readonly client: Pick<FalClient, 'generateImage' | 'editImage' | 'submitToQueue' | 'getQueueStatus' | 'getQueueResult'>;
  private readonly store: IMediaJobStore;

  constructor(options: FalAIMediaGeneratorOptions) {
    if (!options || !options.client || !options.store) {
      throw new Error('FalAIMediaGenerator requires { client, store }');
    }
    this.client = options.client;
    this.store = options.store;
  }

  async generateImage(input: ImageGenInput): Promise<MediaGenJob> {
    return this.generateSingleImage(input);
  }

  async generateVideo(input: VideoGenInput): Promise<MediaGenJob> {
    const jobId = randomUUID();
    const modelId = DEFAULT_VIDEO_MODEL;
    const prompt = buildPrompt(input);

    let submission: { requestId: string };
    try {
      submission = await withRetry(
        () => withCostTracking(
          async () => {
            const result = await this.client.submitToQueue(modelId, { prompt });
            return {
              result,
              usage: { costUsd: computeFalCostUsd(modelId) },
            };
          },
          {
            ...(input.restaurantId ? { restaurantId: input.restaurantId } : {}),
            ...(input.postId ? { postId: input.postId } : {}),
            ...(input.cycleId ? { cycleId: input.cycleId } : {}),
            operation: 'generatePost',
            surface: 'video',
            step: 'video-submit',
            model: modelId,
          },
        ),
        RETRY_PROFILES.VIDEO_SUBMIT,
      );
    } catch (err) {
      log.error({ err, jobId, modelId }, 'fal.ai queue submission failed after retries');
      const failed = await this.store.insert({
        jobId,
        provider: 'fal-ai',
        modelId,
        postType: input.postType,
        status: 'FAILED',
        error: (err as Error).message ?? 'unknown',
        attempts: 1,
        ...(input.restaurantId ? { restaurantId: input.restaurantId } : {}),
        ...(input.postId ? { postId: input.postId } : {}),
        ...(input.cycleId ? { cycleId: input.cycleId } : {}),
        startedAt: new Date(),
      });
      return this.recordToMediaGenJob(failed);
    }

    const record = await this.store.insert({
      jobId,
      providerJobId: submission.requestId,
      provider: 'fal-ai',
      modelId,
      postType: input.postType,
      status: 'RUNNING',
      attempts: 1,
      ...(input.restaurantId ? { restaurantId: input.restaurantId } : {}),
      ...(input.postId ? { postId: input.postId } : {}),
      ...(input.cycleId ? { cycleId: input.cycleId } : {}),
      startedAt: new Date(),
    });

    return this.recordToMediaGenJob(record);
  }

  async pollJob(jobId: string): Promise<MediaGenJob> {
    const record = await this.store.findById(jobId);
    if (!record) {
      return { jobId, status: 'FAILED', error: 'job not found' };
    }
    if (record.status !== 'RUNNING' || !record.providerJobId) {
      return this.recordToMediaGenJob(record);
    }

    let queueStatus: FalQueueStatusValue;
    try {
      const out = await this.client.getQueueStatus(record.modelId, record.providerJobId);
      queueStatus = out.status;
    } catch (err) {
      log.warn({ err, jobId, providerJobId: record.providerJobId }, 'fal.ai queue status poll failed; leaving record RUNNING');
      return this.recordToMediaGenJob(record);
    }

    if (queueStatus === 'COMPLETED') {
      let result: { video?: { url?: string }; images?: Array<{ url?: string; width?: number; height?: number }>; seed?: number } | null = null;
      try {
        result = await this.client.getQueueResult(record.modelId, record.providerJobId) as any;
      } catch (err) {
        log.error({ err, jobId }, 'fal.ai queue result fetch failed despite COMPLETED status');
        const updated = await this.store.updateStatus(jobId, {
          status: 'FAILED',
          error: 'queue COMPLETED but result fetch failed',
          completedAt: new Date(),
          lastPolledAt: new Date(),
        });
        return this.recordToMediaGenJob(updated ?? record);
      }
      const mediaUrl = result?.video?.url ?? result?.images?.[0]?.url;
      if (!mediaUrl) {
        const updated = await this.store.updateStatus(jobId, {
          status: 'FAILED',
          error: 'queue COMPLETED but response had no media URL',
          completedAt: new Date(),
          lastPolledAt: new Date(),
        });
        return this.recordToMediaGenJob(updated ?? record);
      }
      const updated = await this.store.updateStatus(jobId, {
        status: 'COMPLETED',
        mediaUrl,
        thumbnail: mediaUrl,
        completedAt: new Date(),
        lastPolledAt: new Date(),
      });
      return this.recordToMediaGenJob(updated ?? record);
    }

    if (queueStatus === 'FAILED') {
      const updated = await this.store.updateStatus(jobId, {
        status: 'FAILED',
        error: 'fal.ai queue status FAILED',
        completedAt: new Date(),
        lastPolledAt: new Date(),
      });
      return this.recordToMediaGenJob(updated ?? record);
    }

    // IN_QUEUE / IN_PROGRESS -- still running. Just bump lastPolledAt.
    await this.store.updateStatus(jobId, { lastPolledAt: new Date() });
    return this.recordToMediaGenJob(record);
  }

  private async generateSingleImage(input: ImageGenInput): Promise<MediaGenJob> {
    const jobId = randomUUID();
    const useEdit = !!input.baseImageUrl;
    const modelId = useEdit ? FAL_MODELS.fluxImg2Img : FAL_MODELS.fluxDev;
    const prompt = buildPrompt(input);
    const imageSize = pickImageSize(input.postType, input.platforms);

    let response: FalImageResponse;
    try {
      response = await withRetry(
        () => withCostTracking(
          async () => {
            const result = useEdit
              ? await this.client.editImage({
                  model: modelId,
                  prompt,
                  imageUrl: input.baseImageUrl!,
                })
              : await this.client.generateImage({
                  model: modelId,
                  prompt,
                  imageSize,
                });
            return {
              result,
              usage: { costUsd: computeFalCostUsd(modelId) },
            };
          },
          {
            ...(input.restaurantId ? { restaurantId: input.restaurantId } : {}),
            ...(input.postId ? { postId: input.postId } : {}),
            ...(input.cycleId ? { cycleId: input.cycleId } : {}),
            operation: 'generatePost',
            surface: 'image',
            step: useEdit ? 'image-edit' : 'image',
            model: modelId,
          },
        ),
        RETRY_PROFILES.IMAGE_SUBMIT,
      );
    } catch (err) {
      log.error({ err, jobId, modelId }, 'fal.ai image submission failed after retries');
      const failedRecord = await this.persistFailedJob(jobId, modelId, input, (err as Error).message ?? 'unknown');
      return this.recordToMediaGenJob(failedRecord);
    }

    if (!response.images || response.images.length === 0) {
      log.warn({ jobId, modelId }, 'fal.ai returned no images');
      const failedRecord = await this.persistFailedJob(jobId, modelId, input, 'no images returned');
      return this.recordToMediaGenJob(failedRecord);
    }

    const image = response.images[0];
    const record = await this.store.insert({
      jobId,
      provider: 'fal-ai',
      modelId,
      postType: input.postType,
      status: 'COMPLETED',
      mediaUrl: image.url,
      thumbnail: image.url,
      metadata: { widthPx: image.width, heightPx: image.height },
      attempts: 1,
      ...(input.restaurantId ? { restaurantId: input.restaurantId } : {}),
      ...(input.postId ? { postId: input.postId } : {}),
      ...(input.cycleId ? { cycleId: input.cycleId } : {}),
      startedAt: new Date(),
      completedAt: new Date(),
    });

    return this.recordToMediaGenJob(record);
  }

  async generateCarousel(input: CarouselGenInput): Promise<MediaGenJob> {
    const carouselId = randomUUID();
    // When the LLM provided per-slide briefs, they drive both count and content.
    // Fall back to hardcoded directions only when no per-slide briefs were supplied.
    const directions = input.slideDirections?.length
      ? input.slideDirections
      : [
          'hero full-frame shot — complete dish presentation, plating as served',
          'close-up macro detail — texture and ingredient focus',
          'lifestyle context shot — dining atmosphere, table setting',
        ];
    const slideCount = Math.min(input.slideDirections?.length ?? input.slideCount ?? CAROUSEL_FRAME_COUNT, 10);

    const frameInputs: ImageGenInput[] = Array.from({ length: slideCount }, (_, i) => ({
      postType: 'IMAGE' as const,
      platforms: input.platforms,
      concept: input.concept,
      themes: input.themes,
      caption: input.caption,
      promptSuffix: [
        input.promptSuffix,
        directions[i % directions.length],
      ].filter(Boolean).join(' — '),
      restaurantId: input.restaurantId,
      postId: input.postId,
      cycleId: input.cycleId,
    }));

    const results = await Promise.all(
      frameInputs.map((frame) => this.generateSingleImage(frame)),
    );
    const succeeded = results.filter((r) => r.status === 'COMPLETED' && r.mediaUrl);
    if (succeeded.length === 0) {
      return { jobId: carouselId, status: 'FAILED', error: 'all carousel frames failed' };
    }
    const urls = succeeded.map((r) => r.mediaUrl!);
    const meta = succeeded[0].metadata;
    return {
      jobId: carouselId,
      status: 'COMPLETED',
      mediaUrls: urls,
      thumbnail: urls[0],
      ...(meta ? { metadata: meta } : {}),
    };
  }

  private async persistFailedJob(
    jobId: string,
    modelId: string,
    input: ImageGenInput,
    error: string,
  ): Promise<MediaJobRecord> {
    return this.store.insert({
      jobId,
      provider: 'fal-ai',
      modelId,
      postType: input.postType,
      status: 'FAILED',
      error,
      attempts: 1,
      ...(input.restaurantId ? { restaurantId: input.restaurantId } : {}),
      ...(input.postId ? { postId: input.postId } : {}),
      ...(input.cycleId ? { cycleId: input.cycleId } : {}),
      startedAt: new Date(),
    });
  }

  private recordToMediaGenJob(record: MediaJobRecord): MediaGenJob {
    return {
      jobId: record.jobId,
      status: record.status,
      ...(record.mediaUrl ? { mediaUrl: record.mediaUrl } : {}),
      ...(record.mediaUrls ? { mediaUrls: record.mediaUrls } : {}),
      ...(record.thumbnail ? { thumbnail: record.thumbnail } : {}),
      ...(record.metadata ? { metadata: record.metadata } : {}),
      ...(record.error ? { error: record.error } : {}),
    };
  }
}
