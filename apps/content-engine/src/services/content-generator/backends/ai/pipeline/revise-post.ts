/**
 * runRevisePost -- single-call post revision.
 *
 * Caption is always re-LLM'd. Media is regenerated only when feedback.tags
 * mention 'media' or 'image' (or 'video') -- otherwise the caller's existing
 * thumbnail / videoUrl carry over to the result.
 *
 * Same model + retry + cost-tracking pattern as runGeneratePost.
 */

import { createLogger } from '@restropulse/telemetry/server';
import {
  ContentGenerationError,
  type GeneratedPost,
  type GenerationContext,
  type RevisePostInput,
  type MediaMetadata,
} from '../../../types.js';
import type { Platform, PostType } from '@restropulse/shared';
import { withRetry, RETRY_PROFILES } from '../with-retry.js';
import { withCostTracking } from '../with-cost-tracking.js';
import { PostCaptionSchema } from '../llm/schemas.js';
import { computeCostUsd } from '../llm/pricing.js';
import { type PipelineDeps, toSpecializationContext, resolveCurrentAffairsHints } from './types.js';
import type { MediaGenJob } from '../media/types.js';

const log = createLogger('ai-revise-post');

const MEDIA_FEEDBACK_TAGS = new Set(['media', 'image', 'video', 'thumbnail']);
const HASHTAG_HARD_CAP = 8;

// Mirror the denylist in specialization/restaurant/hashtag-strategy.ts.
// Applied here so LLM-suggested hashtags are also scrubbed before appending.
const HASHTAG_DENYLIST = new Set([
  '#like4like', '#follow4follow', '#l4l', '#f4f', '#tagsforlikes', '#followforfollow',
]);

function feedbackRequestsMedia(tags: string[]): boolean {
  return tags.some((t) => MEDIA_FEEDBACK_TAGS.has(t.toLowerCase()));
}

function isVideoType(t: PostType): boolean {
  return t === 'REEL' || t === 'VIDEO';
}

function mergeHashtags(caption: string, suggested: string[] | undefined, fromSpec: string[]): string {
  const present = new Set((caption.match(/#[\w-]+/g) ?? []).map((t) => t.toLowerCase()));
  const candidates: string[] = [];
  for (const tag of [...(suggested ?? []), ...fromSpec]) {
    const norm = tag.startsWith('#') ? tag : `#${tag}`;
    const lower = norm.toLowerCase();
    if (HASHTAG_DENYLIST.has(lower)) continue;
    if (present.has(lower)) continue;
    if (candidates.some((c) => c.toLowerCase() === lower)) continue;
    candidates.push(lower);
    if (candidates.length >= HASHTAG_HARD_CAP) break;
  }
  if (candidates.length === 0) return caption;
  const sep = caption.endsWith('\n\n') ? '' : caption.endsWith('\n') ? '\n' : '\n\n';
  return `${caption}${sep}${candidates.join(' ')}`;
}

function metadataFromMedia(job: MediaGenJob): MediaMetadata | undefined {
  if (!job.metadata) return undefined;
  const m: MediaMetadata = {};
  if (job.metadata.widthPx !== undefined) m.widthPx = job.metadata.widthPx;
  if (job.metadata.heightPx !== undefined) m.heightPx = job.metadata.heightPx;
  if (job.metadata.durationSeconds !== undefined) m.durationSeconds = job.metadata.durationSeconds;
  return Object.keys(m).length ? m : undefined;
}

export async function runRevisePost(
  input: RevisePostInput,
  deps: PipelineDeps,
  ctx?: GenerationContext,
): Promise<GeneratedPost> {
  if (!input.existingPost) {
    throw new ContentGenerationError('INVALID_INPUT', 'revisePost requires existingPost');
  }
  if (!input.feedback) {
    throw new ContentGenerationError('INVALID_INPUT', 'revisePost requires feedback');
  }

  const specCtx = toSpecializationContext(ctx);
  const system = deps.specialization.getSystemPromptFragment(specCtx);
  const taskPrompt = deps.specialization.getTaskPrompt('revisePost', input, specCtx);

  const hints = await resolveCurrentAffairsHints(
    input.currentAffairsHints,
    deps.currentAffairs,
    {
      operation: 'revisePost',
      specializationContext: specCtx,
      concept: input.existingPost.caption,
      ...(ctx?.restaurantId ? { restaurantId: ctx.restaurantId } : {}),
    },
  );

  const detailLines = Object.entries(input.feedback.details).map(([k, v]) => `  ${k}: ${v}`);
  const userPrompt = [
    taskPrompt,
    '',
    'Existing post:',
    `Type: ${input.existingPost.type}`,
    `Platforms: ${input.existingPost.platforms.join(', ')}`,
    `Caption: ${input.existingPost.caption}`,
    input.existingPost.themes?.length ? `Themes: ${input.existingPost.themes.join(', ')}` : '',
    '',
    'Feedback to address:',
    `Tags: ${input.feedback.tags.join(', ')}`,
    detailLines.length ? `Details:\n${detailLines.join('\n')}` : '',
    `Note: ${input.feedback.note}`,
    input.feedback.resolution ? `Resolution: ${input.feedback.resolution}` : '',
    hints.length
      ? `\nCurrent-affairs hints (use sparingly):\n- ${hints.join('\n- ')}`
      : '',
    `\nReturn just the revised caption (no hashtags inline) plus 2-5 suggestedHashtags.`,
  ].filter(Boolean).join('\n');

  const telemetryAttributes: Record<string, string> = { operation: 'revisePost', step: 'caption' };
  if (ctx?.restaurantId) telemetryAttributes.restaurantId = ctx.restaurantId;
  if (ctx?.correlationId) telemetryAttributes.correlationId = ctx.correlationId;

  // 1. Always regenerate caption.
  const captionObj = await withRetry(
    () => withCostTracking(
      async () => {
        const { object, usage, modelId } = await deps.llm.generateObject({
          model: 'haiku',
          system,
          prompt: userPrompt,
          schema: PostCaptionSchema,
          telemetryAttributes,
        });
        const costUsd = computeCostUsd(modelId, usage);
        return {
          result: object,
          usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            costUsd,
          },
        };
      },
      {
        ...(ctx?.restaurantId ? { restaurantId: ctx.restaurantId } : {}),
        operation: 'revisePost',
        surface: 'llm',
        step: 'caption',
        model: 'claude-haiku-4-5-20251001',
      },
    ),
    RETRY_PROFILES.LLM,
  );

  // 2. Media: regenerate iff feedback tags request it; otherwise carry existing.
  let mediaSource: { thumbnail?: string; mediaUrls?: string[]; videoUrl?: string; metadata?: MediaMetadata };
  if (feedbackRequestsMedia(input.feedback.tags)) {
    const isCarousel = input.existingPost.type === 'CAROUSEL';
    const isVideo = isVideoType(input.existingPost.type);
    const job = await withRetry(
      () => withCostTracking(
        async () => {
          const result = isVideo
            ? await deps.media.generateVideo({
                postType: input.existingPost.type as 'REEL' | 'VIDEO' | 'STORY',
                platforms: input.existingPost.platforms,
                concept: captionObj.caption,
                themes: input.existingPost.themes,
                ...(ctx?.restaurantId ? { restaurantId: ctx.restaurantId } : {}),
              })
            : isCarousel
            ? await deps.media.generateCarousel({
                platforms: input.existingPost.platforms,
                concept: captionObj.caption,
                themes: input.existingPost.themes,
                ...(ctx?.restaurantId ? { restaurantId: ctx.restaurantId } : {}),
              })
            : await deps.media.generateImage({
                postType: input.existingPost.type,
                platforms: input.existingPost.platforms,
                concept: captionObj.caption,
                themes: input.existingPost.themes,
                ...(ctx?.restaurantId ? { restaurantId: ctx.restaurantId } : {}),
              });
          if (result.status === 'FAILED') {
            throw new ContentGenerationError('UNKNOWN', `Media regeneration failed: ${result.error ?? 'unknown'}`);
          }
          return { result, usage: { costUsd: 0 } };
        },
        {
          ...(ctx?.restaurantId ? { restaurantId: ctx.restaurantId } : {}),
          operation: 'revisePost',
          surface: isVideo ? 'video' : 'image',
          step: isVideo ? 'video' : isCarousel ? 'carousel' : 'image',
          model: 'placeholder-media',
        },
      ),
      isVideo ? RETRY_PROFILES.VIDEO_SUBMIT : RETRY_PROFILES.IMAGE_SUBMIT,
    );

    const mediaJobMeta = metadataFromMedia(job);
    mediaSource = {
      ...(job.thumbnail ? { thumbnail: job.thumbnail } : {}),
      ...(job.mediaUrls ? { mediaUrls: job.mediaUrls } : {}),
      ...(isVideoType(input.existingPost.type) && job.mediaUrl ? { videoUrl: job.mediaUrl } : {}),
      ...(mediaJobMeta ? { metadata: mediaJobMeta } : {}),
    };
  } else {
    mediaSource = {
      ...(input.existingPost.thumbnail ? { thumbnail: input.existingPost.thumbnail } : {}),
      ...(input.existingPost.mediaUrls ? { mediaUrls: input.existingPost.mediaUrls } : {}),
      ...(input.existingPost.videoUrl ? { videoUrl: input.existingPost.videoUrl } : {}),
    };
  }

  // 3. Hashtag merge + assemble
  const specHashtags = deps.specialization.selectHashtags(captionObj.caption, specCtx);
  const fullCaption = mergeHashtags(captionObj.caption, captionObj.suggestedHashtags, specHashtags);

  const post: GeneratedPost = {
    caption: fullCaption,
    thumbnail: mediaSource.thumbnail ?? '',
  };
  if (mediaSource.mediaUrls) post.mediaUrls = mediaSource.mediaUrls;
  if (mediaSource.videoUrl) post.videoUrl = mediaSource.videoUrl;
  if (mediaSource.metadata) post.mediaMetadata = mediaSource.metadata;

  const validation = deps.specialization.validateOutput(post, specCtx);
  if (!validation.ok) {
    const errorIssue = validation.issues.find((i) => i.severity === 'error');
    throw new ContentGenerationError(
      'INVALID_INPUT',
      `Revised post failed specialization validation: ${errorIssue?.message ?? 'unknown'}`,
    );
  }
  if (validation.issues.length > 0) {
    log.warn({ issues: validation.issues, postType: input.existingPost.type }, 'Revised post has warnings');
  }

  return post;
}
