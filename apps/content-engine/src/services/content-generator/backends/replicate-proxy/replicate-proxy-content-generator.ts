/**
 * ReplicateProxyContentGenerator
 *
 * Same shape as AIContentGenerator (specialization + llm + media + optional
 * currentAffairs), and draftCycle/reviseCycle delegate to the exact same
 * Anthropic-based pipeline functions the ai backend uses -- cycle planning
 * is not proxied. generatePost/revisePost are pure proxies to Replicate:
 * see content-proxy-pipeline.ts for what "proxy" means concretely (verbatim
 * caption, no prompt engineering, no LLM call).
 */

import { createLogger } from '@restropulse/telemetry/server';
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
import type { IDomainSpecialization } from '../ai/specialization/index.js';
import type { ILLMProvider } from '../ai/llm/types.js';
import type { IMediaGenerator } from '../ai/media/types.js';
import type { ICurrentAffairsProvider } from '../ai/current-affairs/types.js';
import { runDraftCycle } from '../ai/pipeline/draft-cycle.js';
import { runReviseCycle } from '../ai/pipeline/revise-cycle.js';
import type { PipelineDeps } from '../ai/pipeline/types.js';
import { runGeneratePostProxy, runRevisePostProxy } from './content-proxy-pipeline.js';

const log = createLogger('replicate-proxy-content-generator');

export interface ReplicateProxyContentGeneratorOptions {
  specialization: IDomainSpecialization;
  llm: ILLMProvider;
  media: IMediaGenerator;
  /** Optional. Used only by draftCycle/reviseCycle (cycle planning is not proxied). */
  currentAffairs?: ICurrentAffairsProvider;
}

export class ReplicateProxyContentGenerator extends BaseContentGenerator {
  readonly name = 'replicate-proxy';
  readonly specialization: IDomainSpecialization;
  private readonly deps: PipelineDeps;

  constructor(options: ReplicateProxyContentGeneratorOptions) {
    super();
    if (!options || !options.specialization || !options.llm || !options.media) {
      throw new ContentGenerationError(
        'INVALID_INPUT',
        'ReplicateProxyContentGenerator requires { specialization, llm, media } in its constructor options.',
      );
    }
    this.specialization = options.specialization;
    this.deps = {
      specialization: options.specialization,
      llm: options.llm,
      media: options.media,
      ...(options.currentAffairs ? { currentAffairs: options.currentAffairs } : {}),
    };
    log.info(
      {
        domain: this.specialization.domain,
        version: this.specialization.version,
        llm: options.llm.name,
        media: options.media.name,
        currentAffairs: options.currentAffairs?.name ?? 'none',
      },
      'ReplicateProxyContentGenerator instantiated',
    );
  }

  async draftCycle(input: DraftCycleInput, ctx?: GenerationContext): Promise<GeneratedCycle> {
    return runDraftCycle(input, this.deps, ctx);
  }

  async reviseCycle(input: ReviseCycleInput, ctx?: GenerationContext): Promise<GeneratedCycle> {
    return runReviseCycle(input, this.deps, ctx);
  }

  async generatePostContent(input: GeneratePostInput, ctx?: GenerationContext): Promise<GeneratedPost> {
    return runGeneratePostProxy(input, this.deps, ctx);
  }

  async revisePostContent(input: RevisePostInput, ctx?: GenerationContext): Promise<GeneratedPost> {
    return runRevisePostProxy(input, this.deps, ctx);
  }

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: true, detail: `llm=${this.deps.llm.name} media=${this.deps.media.name}` };
  }
}
