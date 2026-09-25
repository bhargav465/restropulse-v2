/**
 * runGeneratePostProxy / runRevisePostProxy -- pure-proxy post content creation.
 *
 * Unlike the ai backend's pipeline/generate-post.ts + pipeline/revise-post.ts,
 * there is no LLM caption call, no specialization visual-direction prompt, no
 * dish resolution/Sonar reference-image lookup, and no LLM-authored carousel
 * slide briefs. The caption is the caller-supplied concept verbatim, and the
 * media request is forwarded to deps.media (the real ReplicateMediaGenerator)
 * with that same concept as the prompt. draftCycle/reviseCycle are NOT proxied
 * -- see replicate-proxy-content-generator.ts, which delegates those to the
 * ai backend's runDraftCycle/runReviseCycle unchanged.
 */

import type { Platform, PostType } from '@restropulse/shared';
import {
  ContentGenerationError,
  type GeneratedPost,
  type GenerationContext,
  type GeneratePostInput,
  type MediaMetadata,
  type RevisePostInput,
} from '../../types.js';
import type { PipelineDeps } from '../ai/pipeline/types.js';
import type { MediaGenJob } from '../ai/media/types.js';

function isVideoType(t: PostType): boolean {
  return t === 'REEL' || t === 'VIDEO';
}

function metadataFromMedia(job: MediaGenJob): MediaMetadata | undefined {
  if (!job.metadata) return undefined;
  const m: MediaMetadata = {};
  if (job.metadata.widthPx !== undefined) m.widthPx = job.metadata.widthPx;
  if (job.metadata.heightPx !== undefined) m.heightPx = job.metadata.heightPx;
  if (job.metadata.durationSeconds !== undefined) m.durationSeconds = job.metadata.durationSeconds;
  return Object.keys(m).length ? m : undefined;
}

interface ProxyMediaInput {
  type: PostType;
  platform: Platform;
  themes?: string[];
  cycleId?: string;
}

/** Forward the concept straight to Replicate with no prompt engineering. */
async function runProxyMedia(
  input: ProxyMediaInput,
  concept: string,
  deps: PipelineDeps,
  ctx?: GenerationContext,
): Promise<MediaGenJob> {
  const isCarousel = input.type === 'CAROUSEL';
  const isVideo = isVideoType(input.type);

  if (isVideo) {
    return deps.media.generateVideo({
      postType: input.type as 'REEL' | 'VIDEO' | 'STORY',
      platform: input.platform,
      concept,
      themes: input.themes,
      ...(ctx?.restaurantId ? { restaurantId: ctx.restaurantId } : {}),
      ...(input.cycleId ? { cycleId: input.cycleId } : {}),
    });
  }
  if (isCarousel) {
    return deps.media.generateCarousel({
      platform: input.platform,
      concept,
      themes: input.themes,
      ...(ctx?.restaurantId ? { restaurantId: ctx.restaurantId } : {}),
      ...(input.cycleId ? { cycleId: input.cycleId } : {}),
    });
  }
  return deps.media.generateImage({
    postType: input.type,
    platform: input.platform,
    concept,
    themes: input.themes,
    ...(ctx?.restaurantId ? { restaurantId: ctx.restaurantId } : {}),
    ...(input.cycleId ? { cycleId: input.cycleId } : {}),
  });
}

function assemblePost(concept: string, mediaJob: MediaGenJob, postType: PostType): GeneratedPost {
  const post: GeneratedPost = {
    caption: concept,
    thumbnail: mediaJob.thumbnail ?? mediaJob.mediaUrl ?? '',
  };
  if (mediaJob.mediaUrls) post.mediaUrls = mediaJob.mediaUrls;
  if (isVideoType(postType) && mediaJob.mediaUrl) post.videoUrl = mediaJob.mediaUrl;
  const metadata = metadataFromMedia(mediaJob);
  if (metadata) post.mediaMetadata = metadata;
  return post;
}

function resolveConcept(input: { concept?: string; themes?: string[] }): string {
  return (input.concept?.trim() || input.themes?.[0]?.trim() || '').trim();
}

export async function runGeneratePostProxy(
  input: GeneratePostInput,
  deps: PipelineDeps,
  ctx?: GenerationContext,
): Promise<GeneratedPost> {
  if (!input.type) {
    throw new ContentGenerationError('INVALID_INPUT', 'generatePost requires a post type');
  }
  if (!input.platform) {
    throw new ContentGenerationError('INVALID_INPUT', 'generatePost requires a platform');
  }

  const concept = resolveConcept(input);
  if (!concept) {
    throw new ContentGenerationError(
      'INVALID_INPUT',
      'generatePost requires a non-empty concept or theme -- the proxy backend has no LLM to synthesize one',
    );
  }

  const mediaJob = await runProxyMedia(
    { type: input.type, platform: input.platform, themes: input.themes, cycleId: input.cycleId },
    concept,
    deps,
    ctx,
  );

  if (mediaJob.status === 'RUNNING') {
    return {
      caption: concept,
      thumbnail: '',
      pendingMedia: true,
      mediaJobId: mediaJob.jobId,
      generationStep: 'MEDIA_REQUESTED',
    };
  }

  if (mediaJob.status === 'FAILED') {
    throw new ContentGenerationError('UNKNOWN', `Media generation failed: ${mediaJob.error ?? 'unknown'}`);
  }

  return assemblePost(concept, mediaJob, input.type);
}

function resolveRevisedConcept(input: RevisePostInput): string {
  const details = Object.values(input.feedback?.details ?? {}).filter(Boolean).join(' ');
  const combined = [input.feedback?.note, details].filter((s) => s && s.trim().length > 0).join(' - ');
  return (combined || input.existingPost?.themes?.[0] || '').trim();
}

export async function runRevisePostProxy(
  input: RevisePostInput,
  deps: PipelineDeps,
  ctx?: GenerationContext,
): Promise<GeneratedPost> {
  if (!input.existingPost?.type) {
    throw new ContentGenerationError('INVALID_INPUT', 'revisePost requires an existingPost with a type');
  }
  if (!input.feedback) {
    throw new ContentGenerationError('INVALID_INPUT', 'revisePost requires feedback');
  }

  const concept = resolveRevisedConcept(input);
  if (!concept) {
    throw new ContentGenerationError(
      'INVALID_INPUT',
      'revisePost requires feedback note/details or existing themes to build a concept -- the proxy backend has no LLM to synthesize one',
    );
  }

  const { existingPost } = input;
  const mediaJob = await runProxyMedia(
    { type: existingPost.type, platform: existingPost.platform, themes: existingPost.themes },
    concept,
    deps,
    ctx,
  );

  if (mediaJob.status === 'RUNNING') {
    return {
      caption: concept,
      thumbnail: '',
      pendingMedia: true,
      mediaJobId: mediaJob.jobId,
      generationStep: 'MEDIA_REQUESTED',
    };
  }

  if (mediaJob.status === 'FAILED') {
    throw new ContentGenerationError('UNKNOWN', `Media regeneration failed: ${mediaJob.error ?? 'unknown'}`);
  }

  return assemblePost(concept, mediaJob, existingPost.type);
}
