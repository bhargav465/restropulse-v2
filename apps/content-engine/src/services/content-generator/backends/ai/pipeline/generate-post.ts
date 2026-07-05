/**
 * runGeneratePost -- per-post caption + media orchestration.
 *
 * 1. Pick the model family (Haiku for captions per ADR 4.6).
 * 2. Build system + task prompts via the specialization.
 * 3. Call LLM(generateObject, schema=PostCaptionSchema) wrapped in withRetry +
 *    withCostTracking.
 * 4. In parallel-ish, request media via IMediaGenerator (image vs video chosen
 *    from postType). Image jobs in phase 2 resolve immediately (placeholder
 *    media generator); phase 5 introduces async video.
 * 5. Merge LLM-suggested hashtags with specialization.selectHashtags, apply
 *    denylist + count cap, append to caption.
 * 6. Validate the assembled post via specialization.validateOutput. Errors
 *    bubble; warnings are logged.
 */

import { createLogger } from '@restropulse/telemetry/server';
import {
  ContentGenerationError,
  type GeneratedPost,
  type GenerationContext,
  type GeneratePostInput,
  type MediaMetadata,
} from '../../../types.js';
import type { Platform, PostType } from '@restropulse/shared';
import { z } from 'zod';
import { withRetry, RETRY_PROFILES } from '../with-retry.js';
import { withCostTracking } from '../with-cost-tracking.js';
import { PostCaptionSchema, type PostCaptionSchemaType } from '../llm/schemas.js';
import { computeCostUsd } from '../llm/pricing.js';
import { type PipelineDeps, toSpecializationContext, resolveCurrentAffairsHints } from './types.js';
import type { MediaGenJob, CarouselGenInput } from '../media/types.js';
import { buildImagePromptFragment } from '../specialization/restaurant/visual-direction.js';
import type { SpecializationContext } from '../specialization/types.js';

const log = createLogger('ai-generate-post');

const HASHTAG_HARD_CAP = 8;

// Mirror the denylist in specialization/restaurant/hashtag-strategy.ts.
// Applied here so LLM-suggested hashtags are also scrubbed before appending.
const HASHTAG_DENYLIST = new Set([
  '#like4like', '#follow4follow', '#l4l', '#f4f', '#tagsforlikes', '#followforfollow',
]);

function isVideoType(t: PostType): boolean {
  return t === 'REEL' || t === 'VIDEO';
}

function isStoryVideoCandidate(_t: PostType, _platforms: Platform[]): boolean {
  // Phase 2 keeps STORY on the image path (matches placeholder behavior).
  // FalAIMediaGenerator in phase 4 may revisit.
  return false;
}

function mergeHashtags(
  caption: string,
  suggested: string[] | undefined,
  fromSpec: string[],
): string {
  const present = new Set(
    (caption.match(/#[\w-]+/g) ?? []).map((t) => t.toLowerCase()),
  );
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

/**
 * Archetype IDs are UPPER_SNAKE_CASE workflow labels for the LLM — they have no
 * visual meaning for image models. Filter them out before building image prompts.
 */
function stripArchetypeIds(themes: string[] | undefined): string[] | undefined {
  if (!themes?.length) return themes;
  const visual = themes.filter(t => !/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(t));
  return visual.length ? visual : undefined;
}

const DishVisualDescriptionSchema = z.object({
  visualDescription: z.string().min(1),
});

/**
 * Ask Haiku to produce a photographic visual description of a named dish.
 * The result is used as the image-generation concept so the model gets concrete
 * visual anchors (color, texture, plating, vessel) rather than just a dish name.
 * Falls back to the dish name on any error — the call is non-fatal.
 */
async function describeDishVisually(
  dish: string,
  deps: PipelineDeps,
  specCtx: SpecializationContext,
  ctx: GenerationContext | undefined,
): Promise<string> {
  const cuisineHint = specCtx.cuisine ? ` at a ${specCtx.cuisine} restaurant` : '';
  const bioHint = specCtx.bio ? ` Context: ${specCtx.bio.slice(0, 200)}.` : '';

  try {
    return await withRetry(
      () => withCostTracking(
        async () => {
          const { object, usage, modelId } = await deps.llm.generateObject({
            model: 'haiku',
            system: 'You are briefing an AI image generation model. Describe dishes with concrete visual language: color, texture, form, plating, garnish, serving vessel. No marketing adjectives like "delicious" or "mouthwatering". 2-3 sentences maximum.',
            prompt: `Describe what "${dish}" looks like as a plated dish${cuisineHint}.${bioHint} Focus only on what is visible: the main ingredient\'s appearance, sauces or garnishes, and the serving vessel or surface. Be photographic and specific.`,
            schema: DishVisualDescriptionSchema,
            telemetryAttributes: {
              operation: 'generatePost',
              step: 'dish-description',
              ...(ctx?.restaurantId ? { restaurantId: ctx.restaurantId } : {}),
            },
          });
          const costUsd = computeCostUsd(modelId, usage);
          return {
            result: object.visualDescription,
            usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd },
          };
        },
        {
          ...(ctx?.restaurantId ? { restaurantId: ctx.restaurantId } : {}),
          operation: 'generatePost',
          surface: 'llm',
          step: 'dish-description',
          model: 'claude-haiku-4-5-20251001',
        },
      ),
      RETRY_PROFILES.LLM,
    );
  } catch {
    log.warn({ dish }, 'Dish visual description failed; falling back to dish name');
    return dish;
  }
}

async function runMediaForPost(
  input: GeneratePostInput,
  deps: PipelineDeps,
  ctx?: GenerationContext,
  slideDirections?: string[],
): Promise<MediaGenJob> {
  const isCarousel = input.type === 'CAROUSEL';
  const isVideo = isVideoType(input.type) || isStoryVideoCandidate(input.type, input.platforms);
  const surface = isVideo ? 'video' : 'image';

  const labels = {
    ...(ctx?.restaurantId ? { restaurantId: ctx.restaurantId } : {}),
    operation: 'generatePost' as const,
    surface: surface as 'video' | 'image',
    step: isVideo ? 'video' : isCarousel ? 'carousel' : 'image',
    model: 'placeholder-media',
  };

  const specCtx = toSpecializationContext(ctx);
  const visualDirection = buildImagePromptFragment(
    { postType: input.type, platforms: input.platforms, concept: input.concept, themes: input.themes },
    specCtx,
  );

  // Archetype IDs (CRAVING_CUE, etc.) are LLM concepts — strip them from image prompts
  const visualThemes = stripArchetypeIds(input.themes);

  // When a specific dish is known, ask Haiku for a concrete visual description so the
  // image model receives photographic anchors (color, texture, plating) instead of just a name.
  const imageConcept = input.selectedDish && !isVideo
    ? await describeDishVisually(input.selectedDish, deps, specCtx, ctx)
    : input.concept;

  // For single-image posts, look up or fetch a reference image for img2img.
  // Check the context cache first (populated from DB or a previous call), then fetch
  // on-demand from Sonar so we only call the API for the exact dish being generated.
  let referenceImageUrl: string | undefined;
  if (input.selectedDish && !isVideo && !isCarousel) {
    referenceImageUrl = ctx?.restaurantProfile?.dishImages?.[input.selectedDish]?.[0];
    if (!referenceImageUrl && deps.sonar) {
      try {
        const restaurantHint = specCtx.restaurantName ? `"${specCtx.restaurantName}" ` : '';
        const result = await deps.sonar.query(
          `${restaurantHint}"${input.selectedDish}" food photo India`,
          { returnImages: true },
        );
        referenceImageUrl = result.images?.[0]?.url;
        if (referenceImageUrl) {
          log.debug({ restaurantId: ctx?.restaurantId, dish: input.selectedDish }, 'Fetched dish reference image on-demand');
        }
      } catch {
        // Non-fatal — proceed without reference image
      }
    }
  }

  return withRetry(
    () => withCostTracking(
      async () => {
        const job = isVideo
          ? await deps.media.generateVideo({
              postType: input.type as 'REEL' | 'VIDEO' | 'STORY',
              platforms: input.platforms,
              concept: input.concept,
              themes: visualThemes,
              ...(ctx?.restaurantId ? { restaurantId: ctx.restaurantId } : {}),
              ...(input.cycleId ? { cycleId: input.cycleId } : {}),
            })
          : isCarousel
          ? await deps.media.generateCarousel({
              platforms: input.platforms,
              concept: imageConcept,
              themes: visualThemes,
              promptSuffix: visualDirection,
              ...(slideDirections ? { slideDirections } : {}),
              ...(ctx?.restaurantId ? { restaurantId: ctx.restaurantId } : {}),
              ...(input.cycleId ? { cycleId: input.cycleId } : {}),
            })
          : await deps.media.generateImage({
              postType: input.type,
              platforms: input.platforms,
              concept: imageConcept,
              themes: visualThemes,
              promptSuffix: visualDirection,
              ...(referenceImageUrl ? { baseImageUrl: referenceImageUrl } : {}),
              ...(ctx?.restaurantId ? { restaurantId: ctx.restaurantId } : {}),
              ...(input.cycleId ? { cycleId: input.cycleId } : {}),
            });

        if (job.status === 'FAILED') {
          throw new ContentGenerationError('UNKNOWN', `Media generation failed: ${job.error ?? 'unknown'}`);
        }

        return {
          result: job,
          usage: { costUsd: 0 },
        };
      },
      labels,
    ),
    isVideo ? RETRY_PROFILES.VIDEO_SUBMIT : RETRY_PROFILES.IMAGE_SUBMIT,
  );
}

async function runCaptionForPost(
  input: GeneratePostInput,
  deps: PipelineDeps,
  ctx?: GenerationContext,
): Promise<PostCaptionSchemaType> {
  const specCtx = toSpecializationContext(ctx);
  const system = deps.specialization.getSystemPromptFragment(specCtx);

  const hints = await resolveCurrentAffairsHints(
    input.currentAffairsHints,
    deps.currentAffairs,
    {
      operation: 'generatePost',
      specializationContext: specCtx,
      concept: input.concept,
      ...(ctx?.restaurantId ? { restaurantId: ctx.restaurantId } : {}),
      ...(input.cycleId ? { cycleId: input.cycleId } : {}),
    },
  );

  const userPrompt = [
    deps.specialization.getTaskPrompt('generatePost', input, specCtx),
    input.themes?.length ? `Themes: ${input.themes.join(', ')}` : '',
    input.cycleId ? `Cycle id: ${input.cycleId}` : '',
    hints.length
      ? `\nCurrent-affairs hints (use sparingly):\n- ${hints.join('\n- ')}`
      : '',
    `\nReturn the following fields:`,
    `- caption: the post caption (without hashtags inline)`,
    `- suggestedHashtags: 2-5 relevant hashtags`,
    `- motivation: 1-2 sentences explaining the creative or strategic rationale for this specific post — what angle, seasonal context, or occasion drove this content choice`,
    input.selectedDish ? `- selectedDish: "${input.selectedDish}" (the dish featured in this post)` : `- selectedDish: the main dish featured in this post, if any (must be from the menu list)`,
    input.type === 'CAROUSEL' ? `- carouselSlides: 2-4 visual briefs for each slide (see CAROUSEL SLIDES instructions above). Each brief is 1 sentence describing what that specific frame shows — subject + action/state, not just a camera angle.` : '',
  ].filter(Boolean).join('\n');

  const telemetryAttributes: Record<string, string> = { operation: 'generatePost', step: 'caption' };
  if (ctx?.restaurantId) telemetryAttributes.restaurantId = ctx.restaurantId;
  if (input.cycleId) telemetryAttributes.cycleId = input.cycleId;
  if (ctx?.correlationId) telemetryAttributes.correlationId = ctx.correlationId;

  return withRetry(
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
        ...(input.cycleId ? { cycleId: input.cycleId } : {}),
        operation: 'generatePost',
        surface: 'llm',
        step: 'caption',
        model: 'claude-haiku-4-5-20251001',
      },
    ),
    RETRY_PROFILES.LLM,
  );
}

/** Build deduplicated dish pool from restaurant profile (menu + chefSpecials). */
function buildDishPool(ctx?: GenerationContext): string[] {
  const profile = ctx?.restaurantProfile;
  const fromMenu = profile?.menu?.filter(m => m.isAvailable !== false).map(m => m.name) ?? [];
  const fromSpecials = profile?.chefSpecials ?? [];
  return [...new Set([...fromMenu, ...fromSpecials])];
}

/**
 * When restaurant menu data is available, pre-select a dish and bake it into
 * input so both caption and image prompts reference the same real dish.
 * The concept is updated to carry the dish name when no explicit concept was given.
 */
function resolveDishForInput(input: GeneratePostInput, ctx?: GenerationContext): GeneratePostInput {
  const dishPool = buildDishPool(ctx);
  if (dishPool.length === 0 || input.selectedDish) return input;  // nothing to resolve

  const selectedDish = dishPool[Math.floor(Math.random() * dishPool.length)];
  return {
    ...input,
    selectedDish,
    // If no concept was supplied, the dish name becomes the visual concept for image generation
    concept: input.concept || selectedDish,
  };
}

export async function runGeneratePost(
  input: GeneratePostInput,
  deps: PipelineDeps,
  ctx?: GenerationContext,
): Promise<GeneratedPost> {
  const hasInput = (input.concept && input.concept.trim()) ||
    (input.themes && input.themes.length > 0) ||
    (input as any).archetype;
  if (!hasInput) {
    throw new ContentGenerationError('INVALID_INPUT', 'generatePost requires either a concept or an archetype (via themes or archetype field)');
  }
  if (!input.type) {
    throw new ContentGenerationError('INVALID_INPUT', 'generatePost requires a post type');
  }
  if (!input.platforms || input.platforms.length === 0) {
    throw new ContentGenerationError('INVALID_INPUT', 'generatePost requires at least one platform');
  }

  // Pre-select a real dish from the restaurant menu (when available) so both
  // caption and image prompts are grounded in the actual menu — prevents imaginary dishes.
  const resolvedInput = resolveDishForInput(input, ctx);

  // For CAROUSEL, run caption first so the LLM's carouselSlides briefs can drive
  // per-slide image generation. For all other types, run concurrently.
  let captionObj: PostCaptionSchemaType;
  let mediaJob: MediaGenJob;
  if (resolvedInput.type === 'CAROUSEL') {
    captionObj = await runCaptionForPost(resolvedInput, deps, ctx);
    mediaJob = await runMediaForPost(resolvedInput, deps, ctx, captionObj.carouselSlides);
  } else {
    [captionObj, mediaJob] = await Promise.all([
      runCaptionForPost(resolvedInput, deps, ctx),
      runMediaForPost(resolvedInput, deps, ctx),
    ]);
  }

  const specCtx = toSpecializationContext(ctx);
  const specHashtags = deps.specialization.selectHashtags(captionObj.caption, specCtx);
  const fullCaption = mergeHashtags(captionObj.caption, captionObj.suggestedHashtags, specHashtags);

  // Hard dish check: if the LLM reports a selectedDish, it must be from the known menu.
  // This catches cases where the model drifted to an unlisted dish despite the constraint.
  if (captionObj.selectedDish) {
    const dishPool = buildDishPool(ctx);
    if (dishPool.length > 0) {
      const lowerPool = dishPool.map(d => d.toLowerCase().trim());
      const reportedDish = captionObj.selectedDish.toLowerCase().trim();
      if (!lowerPool.includes(reportedDish)) {
        throw new ContentGenerationError(
          'INVALID_INPUT',
          `Generated content references dish "${captionObj.selectedDish}" not found in restaurant menu. Available: ${dishPool.join(', ')}`,
        );
      }
    }
  }

  // Phase 5: video media may still be RUNNING. Caller writes post.status=PENDING_MEDIA
  // and waits for the media-job-poller cron to advance it.
  if (mediaJob.status === 'RUNNING') {
    return {
      caption: fullCaption,
      thumbnail: '',           // populated when poller transitions COMPLETED
      pendingMedia: true,
      mediaJobId: mediaJob.jobId,
      generationStep: 'MEDIA_REQUESTED',
      motivation: captionObj.motivation,
    };
  }

  if (mediaJob.status === 'FAILED') {
    throw new ContentGenerationError(
      'UNKNOWN',
      `Media generation failed: ${mediaJob.error ?? 'unknown'}`,
    );
  }

  const post: GeneratedPost = {
    caption: fullCaption,
    thumbnail: mediaJob.thumbnail ?? mediaJob.mediaUrl ?? '',
  };
  if (mediaJob.mediaUrls) post.mediaUrls = mediaJob.mediaUrls;
  if (isVideoType(input.type) && mediaJob.mediaUrl) post.videoUrl = mediaJob.mediaUrl;
  const metadata = metadataFromMedia(mediaJob);
  if (metadata) post.mediaMetadata = metadata;
  if (captionObj.motivation) post.motivation = captionObj.motivation;

  const validation = deps.specialization.validateOutput(post, specCtx);
  if (!validation.ok) {
    const errorIssue = validation.issues.find((i) => i.severity === 'error');
    throw new ContentGenerationError(
      'INVALID_INPUT',
      `Generated post failed specialization validation: ${errorIssue?.message ?? 'unknown'}`,
    );
  }
  if (validation.issues.length > 0) {
    log.warn({ issues: validation.issues, postType: input.type }, 'Generated post has warnings');
  }

  return post;
}
