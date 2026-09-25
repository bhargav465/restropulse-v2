/**
 * PlaceholderContentGenerator
 *
 * Default IContentGenerator implementation. Delegates to the local asset catalog
 * via asset-manager.ts and a small set of heuristic strategy templates. No AI calls.
 */

import type { Platform, PlannedPost, PostType } from '@restropulse/shared';
import { createLogger } from '@restropulse/telemetry/server';
import {
  buildCaption,
  getConstraintCompatibleImage,
  getConstraintCompatibleVideo,
  getRandomCarousel,
  getRandomImage,
  getRandomVideo,
} from '../../../asset-manager.js';
import { getConstraints } from '../../../content-validator/media-constraints.js';
import { BaseContentGenerator } from '../../base-generator.js';
import {
  ContentGenerationError,
  type DraftCycleInput,
  type GeneratedCycle,
  type GeneratedPost,
  type GenerationContext,
  type GeneratePostInput,
  type ReviseCycleInput,
  type RevisePostInput,
} from '../../types.js';

const log = createLogger('content-generator');

const DEFAULT_THEMES = [
  'Food & Menu',
  'Chef Specials',
  'Behind the Scenes',
  'Customer Stories',
  'Offers',
];

function buildPlannedPosts(focus: string[]): PlannedPost[] {
  return focus.map((category) => ({ category, count: 2 }));
}

function pickTheme(themes: string[] | undefined): string {
  return themes?.[0]?.trim() || 'default';
}

function pickConcept(input: Pick<GeneratePostInput, 'concept' | 'themes'>): string {
  if (input.concept && input.concept.trim().length > 0) return input.concept;
  return pickTheme(input.themes);
}

function assembleMedia(
  type: PostType,
  platform: Platform,
  theme: string,
): Omit<GeneratedPost, 'caption'> {
  const constraints = getConstraints(type, platform);

  switch (type) {
    case 'CAROUSEL': {
      const { urls, set } = getRandomCarousel(theme);
      return {
        thumbnail: urls[0],
        mediaUrls: urls,
        mediaMetadata: { widthPx: set.widthPx, heightPx: set.heightPx },
      };
    }
    case 'REEL':
    case 'VIDEO': {
      const selected = getConstraintCompatibleVideo(constraints, theme);
      if (selected) {
        return {
          thumbnail: selected.thumbnail,
          videoUrl: selected.videoUrl,
          mediaMetadata: {
            widthPx: selected.asset.widthPx,
            heightPx: selected.asset.heightPx,
            durationSeconds: selected.asset.durationSeconds,
          },
        };
      }
      // No compatible video found; fall back to image asset and log warning
      log.warn(
        { type, platform, theme },
        'No constraint-compatible video asset found; falling back to image thumbnail',
      );
      const imgFallback = getConstraintCompatibleImage(constraints, theme) ?? getRandomImage(theme);
      return {
        thumbnail: imgFallback.url,
        mediaMetadata: { widthPx: imgFallback.asset.widthPx, heightPx: imgFallback.asset.heightPx },
      };
    }
    case 'STORY': {
      // Try to find a compatible video first (e.g. Sintel 854×480 52s passes
      // Instagram STORY constraints: max 1920px wide, 3–60s, no min resolution).
      // Fall back to a photo story only when no compatible video exists.
      const storyVideo = getConstraintCompatibleVideo(constraints, theme);
      if (storyVideo) {
        return {
          thumbnail: storyVideo.thumbnail,
          videoUrl: storyVideo.videoUrl,
          mediaMetadata: {
            widthPx: storyVideo.asset.widthPx,
            heightPx: storyVideo.asset.heightPx,
            durationSeconds: storyVideo.asset.durationSeconds,
          },
        };
      }
      log.warn(
        { type, platform, theme },
        'No constraint-compatible video for STORY; falling back to photo story',
      );
      const imgSelected = getConstraintCompatibleImage(constraints, theme) ?? getRandomImage(theme);
      return {
        thumbnail: imgSelected.url,
        mediaMetadata: { widthPx: imgSelected.asset.widthPx, heightPx: imgSelected.asset.heightPx },
      };
    }
    case 'IMAGE':
    default: {
      const imgSelected = getConstraintCompatibleImage(constraints, theme) ?? getRandomImage(theme);
      return {
        thumbnail: imgSelected.url,
        mediaMetadata: { widthPx: imgSelected.asset.widthPx, heightPx: imgSelected.asset.heightPx },
      };
    }
  }
}

export class PlaceholderContentGenerator extends BaseContentGenerator {
  readonly name = 'placeholder';

  async draftCycle(input: DraftCycleInput, _ctx?: GenerationContext): Promise<GeneratedCycle> {
    const period = input.period?.trim();
    if (!period) {
      throw new ContentGenerationError('INVALID_INPUT', 'draftCycle requires a non-empty period');
    }

    const focus = (input.strategyFocus && input.strategyFocus.length > 0
      ? input.strategyFocus
      : DEFAULT_THEMES
    ).slice(0, 3);

    return {
      summary: `Content strategy for ${period}: ${focus.join(', ')} focus`,
      plannedPosts: buildPlannedPosts(focus),
      focus,
    };
  }

  async reviseCycle(
    input: ReviseCycleInput,
    _ctx?: GenerationContext,
  ): Promise<GeneratedCycle> {
    const { existingCycle, feedback } = input;
    if (!existingCycle?.period) {
      throw new ContentGenerationError(
        'INVALID_INPUT',
        'reviseCycle requires an existing cycle with a period',
      );
    }

    // Placeholder revision: keep existing focus/plannedPosts, just refresh the summary
    // and stamp a resolution explaining which areas we considered.
    const areas = feedback.areas.length > 0 ? feedback.areas.join(', ') : 'general feedback';
    return {
      summary: `Revised plan for ${existingCycle.period}: addressed ${areas}`,
      plannedPosts: existingCycle.plannedPosts,
      focus: existingCycle.focus,
      rationale: `Adjusted based on feedback: ${areas}`,
    };
  }

  async generatePostContent(
    input: GeneratePostInput,
    ctx?: GenerationContext,
  ): Promise<GeneratedPost> {
    if (!input.type) {
      throw new ContentGenerationError('INVALID_INPUT', 'generatePost requires a PostType');
    }

    const theme = pickTheme(input.themes);
    const concept = pickConcept(input);
    const caption = buildCaption(concept, theme, ctx?.restaurantName);
    const media = assembleMedia(input.type, input.platform, theme);

    return { caption, ...media };
  }

  async revisePostContent(
    input: RevisePostInput,
    ctx?: GenerationContext,
  ): Promise<GeneratedPost> {
    const { existingPost, feedback } = input;
    if (!existingPost?.type) {
      throw new ContentGenerationError(
        'INVALID_INPUT',
        'revisePost requires an existingPost with a type',
      );
    }

    const theme = pickTheme(existingPost.themes);
    const details = Object.values(feedback.details || {}).filter(Boolean).join(' ');
    const concept =
      [feedback.note, details].filter((s) => s && s.trim().length > 0).join(' - ') ||
      pickTheme(existingPost.themes);
    const caption = buildCaption(concept, theme, ctx?.restaurantName);
    const media = assembleMedia(existingPost.type, existingPost.platform, theme);

    return { caption, ...media };
  }

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: true, detail: 'placeholder generator always healthy' };
  }
}
