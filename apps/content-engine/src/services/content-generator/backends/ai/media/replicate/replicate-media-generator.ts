/**
 * ReplicateMediaGenerator -- IMediaGenerator backed by the Replicate Predictions API.
 *
 * Images  (IMAGE / CAROUSEL / STORY): Flux dev (black-forest-labs/flux-dev).
 *   Submit prediction + poll in-process (max 30 × 2s = 60s). Returns COMPLETED.
 *
 * Video   (REEL / VIDEO): Kling v1.6 Standard (kwaivgi/kling-v1.6-standard).
 *   Submit prediction, store RUNNING, return immediately.
 *   The media-job-poller cron advances the job to COMPLETED/FAILED via pollJob().
 *
 * Mirrors FalAIMediaGenerator structure so the worker gate
 * (getLastAiMediaJobStore / getLastAiMediaGenerator) works identically.
 */

import { randomUUID } from 'node:crypto';
import { createLogger } from '@restropulse/telemetry/server';
import type { Platform, PostType, MediaJobRecord } from '@restropulse/shared';
import { withRetry, RETRY_PROFILES } from '../../with-retry.js';
import { withCostTracking } from '../../with-cost-tracking.js';
import { REPLICATE_MODELS } from './models.js';
import { computeReplicateCostUsd } from './pricing.js';
import type { ReplicateClient, ReplicatePrediction } from './replicate-client.js';
import type { IMediaJobStore } from '../jobs/types.js';
import type {
  IMediaGenerator,
  ImageGenInput,
  CarouselGenInput,
  MediaGenJob,
  VideoGenInput,
} from '../types.js';

const log = createLogger('replicate-media-generator');

const CAROUSEL_FRAME_COUNT = 3;
const IMAGE_POLL_INTERVAL_MS = 2000;
const IMAGE_POLL_MAX_ATTEMPTS = 30;

export interface ReplicateMediaGeneratorOptions {
  client: Pick<ReplicateClient, 'createPrediction' | 'getPrediction'>;
  store: IMediaJobStore;
}

function pickAspectRatio(postType: PostType, _platforms: Platform[]): string {
  return postType === 'STORY' ? '9:16' : '1:1';
}

function buildPrompt(input: Pick<ImageGenInput | VideoGenInput, 'concept' | 'themes' | 'caption'> & { promptSuffix?: string }): string {
  const themePart = input.themes?.length ? `, themes: ${input.themes.join(', ')}` : '';
  const captionPart = input.caption ? `, alongside the caption "${input.caption.slice(0, 200)}"` : '';
  const base = `${input.concept}${themePart}${captionPart}`;
  return (input.promptSuffix ? `${base}\n\n${input.promptSuffix}` : base).slice(0, 1200);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class ReplicateMediaGenerator implements IMediaGenerator {
  readonly name = 'replicate';
  private readonly client: Pick<ReplicateClient, 'createPrediction' | 'getPrediction'>;
  private readonly store: IMediaJobStore;

  constructor(options: ReplicateMediaGeneratorOptions) {
    if (!options?.client || !options?.store) {
      throw new Error('ReplicateMediaGenerator requires { client, store }');
    }
    this.client = options.client;
    this.store = options.store;
  }

  async generateImage(input: ImageGenInput): Promise<MediaGenJob> {
    return this.generateSingleImage(input);
  }

  async generateVideo(input: VideoGenInput): Promise<MediaGenJob> {
    const jobId = randomUUID();
    const modelSlug = REPLICATE_MODELS.klingStandard;
    const prompt = buildPrompt(input);

    let prediction: ReplicatePrediction;
    try {
      prediction = await withRetry(
        () => withCostTracking(
          async () => {
            const result = await this.client.createPrediction(modelSlug, {
              prompt,
              duration: 5,
              aspect_ratio: '16:9',
            });
            return { result, usage: { costUsd: computeReplicateCostUsd(modelSlug) } };
          },
          {
            ...(input.restaurantId ? { restaurantId: input.restaurantId } : {}),
            ...(input.postId ? { postId: input.postId } : {}),
            ...(input.cycleId ? { cycleId: input.cycleId } : {}),
            operation: 'generatePost',
            surface: 'video',
            step: 'video-submit',
            model: modelSlug,
          },
        ),
        RETRY_PROFILES.VIDEO_SUBMIT,
      );
    } catch (err) {
      log.error({ err, jobId, modelSlug }, 'Replicate video submission failed after retries');
      const failed = await this.store.insert({
        jobId,
        provider: 'replicate',
        modelId: modelSlug,
        postType: input.postType,
        status: 'FAILED',
        error: (err as Error).message ?? 'unknown',
        attempts: 1,
        ...(input.restaurantId ? { restaurantId: input.restaurantId } : {}),
        ...(input.postId ? { postId: input.postId } : {}),
        ...(input.cycleId ? { cycleId: input.cycleId } : {}),
        startedAt: new Date(),
      });
      return this.recordToJob(failed);
    }

    const record = await this.store.insert({
      jobId,
      providerJobId: prediction.id,
      provider: 'replicate',
      modelId: modelSlug,
      postType: input.postType,
      status: 'RUNNING',
      attempts: 1,
      ...(input.restaurantId ? { restaurantId: input.restaurantId } : {}),
      ...(input.postId ? { postId: input.postId } : {}),
      ...(input.cycleId ? { cycleId: input.cycleId } : {}),
      startedAt: new Date(),
    });
    return this.recordToJob(record);
  }

  async pollJob(jobId: string): Promise<MediaGenJob> {
    const record = await this.store.findById(jobId);
    if (!record) return { jobId, status: 'FAILED', error: 'job not found' };
    if (record.status !== 'RUNNING' || !record.providerJobId) return this.recordToJob(record);

    let prediction: ReplicatePrediction;
    try {
      prediction = await this.client.getPrediction(record.providerJobId);
    } catch (err) {
      log.warn({ err, jobId, providerJobId: record.providerJobId }, 'Replicate poll failed; leaving RUNNING');
      return this.recordToJob(record);
    }

    if (prediction.status === 'succeeded') {
      const mediaUrl = extractUrl(prediction.output);
      if (!mediaUrl) {
        const updated = await this.store.updateStatus(jobId, {
          status: 'FAILED',
          error: 'prediction succeeded but output had no URL',
          completedAt: new Date(),
          lastPolledAt: new Date(),
        });
        return this.recordToJob(updated ?? record);
      }
      const updated = await this.store.updateStatus(jobId, {
        status: 'COMPLETED',
        mediaUrl,
        thumbnail: mediaUrl,
        completedAt: new Date(),
        lastPolledAt: new Date(),
      });
      return this.recordToJob(updated ?? record);
    }

    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      const updated = await this.store.updateStatus(jobId, {
        status: 'FAILED',
        error: prediction.error ?? `Replicate prediction ${prediction.status}`,
        completedAt: new Date(),
        lastPolledAt: new Date(),
      });
      return this.recordToJob(updated ?? record);
    }

    // still starting / processing
    await this.store.updateStatus(jobId, { lastPolledAt: new Date() });
    return this.recordToJob(record);
  }

  private async generateSingleImage(input: ImageGenInput): Promise<MediaGenJob> {
    const jobId = randomUUID();
    const modelSlug = REPLICATE_MODELS.fluxDev;
    const prompt = buildPrompt(input);
    const aspectRatio = pickAspectRatio(input.postType, input.platforms);

    let mediaUrl: string;
    try {
      mediaUrl = await withRetry(
        () => withCostTracking(
          async () => {
            const pred = await this.client.createPrediction(modelSlug, {
              prompt,
              aspect_ratio: aspectRatio,
              num_outputs: 1,
              output_format: 'webp',
              output_quality: 80,
            });
            const completed = await this.pollUntilDone(pred.id);
            const url = extractUrl(completed.output);
            if (!url) throw new Error('Replicate image prediction succeeded but output had no URL');
            return { result: url, usage: { costUsd: computeReplicateCostUsd(modelSlug) } };
          },
          {
            ...(input.restaurantId ? { restaurantId: input.restaurantId } : {}),
            ...(input.postId ? { postId: input.postId } : {}),
            ...(input.cycleId ? { cycleId: input.cycleId } : {}),
            operation: 'generatePost',
            surface: 'image',
            step: 'image',
            model: modelSlug,
          },
        ),
        RETRY_PROFILES.IMAGE_SUBMIT,
      );
    } catch (err) {
      log.error({ err, jobId, modelSlug }, 'Replicate image generation failed');
      const failed = await this.store.insert({
        jobId,
        provider: 'replicate',
        modelId: modelSlug,
        postType: input.postType,
        status: 'FAILED',
        error: (err as Error).message ?? 'unknown',
        attempts: 1,
        ...(input.restaurantId ? { restaurantId: input.restaurantId } : {}),
        ...(input.postId ? { postId: input.postId } : {}),
        ...(input.cycleId ? { cycleId: input.cycleId } : {}),
        startedAt: new Date(),
      });
      return this.recordToJob(failed);
    }

    const record = await this.store.insert({
      jobId,
      provider: 'replicate',
      modelId: modelSlug,
      postType: input.postType,
      status: 'COMPLETED',
      mediaUrl,
      thumbnail: mediaUrl,
      attempts: 1,
      ...(input.restaurantId ? { restaurantId: input.restaurantId } : {}),
      ...(input.postId ? { postId: input.postId } : {}),
      ...(input.cycleId ? { cycleId: input.cycleId } : {}),
      startedAt: new Date(),
      completedAt: new Date(),
    });
    return this.recordToJob(record);
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

    const results = await Promise.all(frameInputs.map((f) => this.generateSingleImage(f)));
    const succeeded = results.filter((r) => r.status === 'COMPLETED' && r.mediaUrl);
    if (succeeded.length === 0) {
      return { jobId: carouselId, status: 'FAILED', error: 'all carousel frames failed' };
    }
    const urls = succeeded.map((r) => r.mediaUrl!);
    return {
      jobId: carouselId,
      status: 'COMPLETED',
      mediaUrls: urls,
      thumbnail: urls[0],
    };
  }

  /** Poll a prediction id in-process until succeeded/failed/canceled or timeout. */
  private async pollUntilDone(predictionId: string): Promise<ReplicatePrediction> {
    for (let attempt = 0; attempt < IMAGE_POLL_MAX_ATTEMPTS; attempt++) {
      await sleep(IMAGE_POLL_INTERVAL_MS);
      const pred = await this.client.getPrediction(predictionId);
      if (pred.status === 'succeeded') return pred;
      if (pred.status === 'failed' || pred.status === 'canceled') {
        throw new Error(`Replicate prediction ${pred.status}: ${pred.error ?? 'no detail'}`);
      }
    }
    throw new Error(`Replicate image timed out after ${IMAGE_POLL_MAX_ATTEMPTS * IMAGE_POLL_INTERVAL_MS / 1000}s`);
  }

  private recordToJob(record: MediaJobRecord): MediaGenJob {
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

/** Extracts the first URL from Replicate output regardless of whether it is a string or string[]. */
function extractUrl(output: string[] | string | null | undefined): string | undefined {
  if (!output) return undefined;
  if (Array.isArray(output)) return output[0];
  return output;
}
