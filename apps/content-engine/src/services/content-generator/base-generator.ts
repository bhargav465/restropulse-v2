/**
 * BaseContentGenerator
 *
 * Abstract base class for all content generator implementations. Provides the
 * public IContentGenerator contract by delegating post generation to the
 * abstract generatePostContent / revisePostContent methods and running
 * platform constraint validation after each call.
 */

import { createLogger } from '@restropulse/telemetry/server';
import { validateGeneratedPost } from '../content-validator/index.js';
import type {
  DraftCycleInput,
  GeneratedCycle,
  GeneratedPost,
  GenerationContext,
  GeneratePostInput,
  IContentGenerator,
  RevisePostInput,
  ReviseCycleInput,
} from './types.js';

const log = createLogger('content-generator');

export abstract class BaseContentGenerator implements IContentGenerator {
  abstract readonly name: string;

  abstract draftCycle(input: DraftCycleInput, ctx?: GenerationContext): Promise<GeneratedCycle>;
  abstract reviseCycle(input: ReviseCycleInput, ctx?: GenerationContext): Promise<GeneratedCycle>;

  /** Subclasses implement content generation here. */
  abstract generatePostContent(input: GeneratePostInput, ctx?: GenerationContext): Promise<GeneratedPost>;

  /** Subclasses implement post revision here. */
  abstract revisePostContent(input: RevisePostInput, ctx?: GenerationContext): Promise<GeneratedPost>;

  async generatePost(input: GeneratePostInput, ctx?: GenerationContext): Promise<GeneratedPost> {
    const post = await this.generatePostContent(input, ctx);
    const issues = validateGeneratedPost(post, input.type, input.platform);
    if (issues.length > 0) {
      log.warn(
        { issues, type: input.type, platform: input.platform, correlationId: ctx?.correlationId },
        'Generated post has constraint violations',
      );
    }
    return post;
  }

  async revisePost(input: RevisePostInput, ctx?: GenerationContext): Promise<GeneratedPost> {
    const post = await this.revisePostContent(input, ctx);
    const issues = validateGeneratedPost(post, input.existingPost.type, input.existingPost.platform);
    if (issues.length > 0) {
      log.warn(
        { issues, type: input.existingPost.type, platform: input.existingPost.platform, correlationId: ctx?.correlationId },
        'Revised post has constraint violations',
      );
    }
    return post;
  }
}
