/**
 * Zod schemas for structured LLM outputs.
 *
 * Vercel AI SDK's generateObject() validates the parsed JSON against these
 * schemas before returning. Mismatches cause an exception that
 * AnthropicLLMProvider classifies (typically non-retriable -- a model that
 * doesn't follow the schema won't follow it on retry either).
 */

import { z } from 'zod';

export const PlannedPostSchema = z.object({
  category: z.string().min(1),
  count: z.number().int().positive(),
  themes: z.array(z.string().min(1)).max(3).optional(),
});

export const CycleSchema = z.object({
  summary: z.string().min(1),
  plannedPosts: z.array(PlannedPostSchema).min(1),
  focus: z.array(z.string().min(1)).min(1),
  rationale: z.string().optional(),
});

export type CycleSchemaType = z.infer<typeof CycleSchema>;

export const PostCaptionSchema = z.object({
  /** The post caption (without hashtags). */
  caption: z.string().min(1),
  /** Hashtags suggested by the model. Final selection is merged with specialization output. */
  suggestedHashtags: z.array(z.string()).optional(),
  /** Archetype the model chose; informational only (not enforced). */
  archetype: z.string().optional(),
  /** 1-2 sentences explaining why this specific content was chosen — the strategic or seasonal rationale. */
  motivation: z.string().min(1),
  /** The main dish featured in this content, when the post is dish-specific. Must match a menu item if one was provided. */
  selectedDish: z.string().optional(),
  /**
   * For CAROUSEL posts only: per-slide visual brief (2-6 items).
   * Each string describes what a single slide should show — a distinct moment, stage, or
   * facet of the same subject, not just a camera angle. Used by the media generator to produce
   * slides that share a narrative arc while remaining visually distinct.
   */
  carouselSlides: z.array(z.string().min(1)).min(2).max(6).optional(),
});

export type PostCaptionSchemaType = z.infer<typeof PostCaptionSchema>;
