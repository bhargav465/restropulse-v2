/**
 * IDomainSpecialization -- the seam at which the content engine becomes
 * multi-domain. This phase ships exactly one concrete implementation
 * (RestaurantSpecialization). The interface stays small enough that adding
 * a second domain (salon, fitness, retail) does not force a redesign.
 *
 * See ADR 0001 for the rationale behind every method on this interface.
 */

import type {
  GeneratedCycle,
  GeneratedPost,
  GeneratePostInput,
  DraftCycleInput,
  ReviseCycleInput,
  RevisePostInput,
} from '../../../types.js';
import type { PostType, Platform, MenuItem } from '@restropulse/shared';

export type SpecializationOperation = 'draftCycle' | 'reviseCycle' | 'generatePost' | 'revisePost';

export type SpecializationOperationInput =
  | DraftCycleInput
  | ReviseCycleInput
  | GeneratePostInput
  | RevisePostInput;

export type SonarQueryScope = 'daily-platform' | 'per-post-trigger';

export interface SpecializationContext {
  restaurantId?: string;
  restaurantName?: string;
  cuisine?: string;
  region?: string;
  brandVoice?: string;
  dietaryFocus?: string[];
  locale?: string;
  /** Prose bio synthesised by the restaurant enricher (stable, prompt-cacheable). */
  bio?: string;
  /** Available menu items from the restaurant DB document. */
  menu?: MenuItem[];
  /** Chef's special dish names. */
  chefSpecials?: string[];
}

export interface ImageGenInput {
  postType: PostType;
  platforms: Platform[];
  concept: string;
  themes?: string[];
  caption?: string;
}

export interface ValidationIssue {
  severity: 'error' | 'warning';
  field: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

export interface IDomainSpecialization {
  readonly domain: string;
  readonly version: string;

  getSystemPromptFragment(ctx: SpecializationContext): string;

  getTaskPrompt(
    operation: SpecializationOperation,
    input: SpecializationOperationInput,
    ctx: SpecializationContext,
  ): string;

  getSonarQueries(scope: SonarQueryScope, ctx: SpecializationContext): string[];

  getImagePromptFragment(input: ImageGenInput, ctx: SpecializationContext): string;

  selectHashtags(caption: string, ctx: SpecializationContext): string[];

  validateOutput(
    output: GeneratedPost | GeneratedCycle,
    ctx: SpecializationContext,
  ): ValidationResult;
}
