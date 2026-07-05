/**
 * AIContentGenerator -- phase 2 implementation for cycle ops.
 *
 * Holds three injected collaborators (specialization, llm, media) so tests
 * substitute mocks for any of them without monkey-patching modules.
 *
 * draftCycle + reviseCycle delegate to pipeline/draft-cycle.ts +
 * pipeline/revise-cycle.ts. generatePost + revisePost still throw
 * BACKEND_UNAVAILABLE -- they land in Checkpoint C.
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
import type { IDomainSpecialization } from './specialization/index.js';
import type { ILLMProvider } from './llm/types.js';
import type { IMediaGenerator } from './media/types.js';
import type { ICurrentAffairsProvider } from './current-affairs/types.js';
import type { SonarClient } from './current-affairs/clients/sonar-client.js';
import { runDraftCycle } from './pipeline/draft-cycle.js';
import { runReviseCycle } from './pipeline/revise-cycle.js';
import { runGeneratePost } from './pipeline/generate-post.js';
import { runRevisePost } from './pipeline/revise-post.js';
import type { PipelineDeps } from './pipeline/types.js';

const log = createLogger('ai-content-generator');

export interface AIContentGeneratorOptions {
  specialization: IDomainSpecialization;
  llm: ILLMProvider;
  media: IMediaGenerator;
  /** Optional. When set, pipeline auto-enriches currentAffairsHints. */
  currentAffairs?: ICurrentAffairsProvider;
  /** Optional. When set, pipeline fetches dish reference images on-demand for img2img. */
  sonar?: SonarClient;
}

export class AIContentGenerator extends BaseContentGenerator {
  readonly name = 'ai';
  readonly specialization: IDomainSpecialization;
  private readonly deps: PipelineDeps;

  constructor(options: AIContentGeneratorOptions) {
    super();
    if (!options || !options.specialization || !options.llm || !options.media) {
      throw new ContentGenerationError(
        'INVALID_INPUT',
        'AIContentGenerator requires { specialization, llm, media } in its constructor options.',
      );
    }
    this.specialization = options.specialization;
    this.deps = {
      specialization: options.specialization,
      llm: options.llm,
      media: options.media,
      ...(options.currentAffairs ? { currentAffairs: options.currentAffairs } : {}),
      ...(options.sonar ? { sonar: options.sonar } : {}),
    };
    log.info(
      {
        domain: this.specialization.domain,
        version: this.specialization.version,
        llm: options.llm.name,
        media: options.media.name,
        currentAffairs: options.currentAffairs?.name ?? 'none',
        dishImages: options.sonar ? 'sonar-on-demand' : 'none',
      },
      'AIContentGenerator instantiated',
    );
  }

  async draftCycle(input: DraftCycleInput, ctx?: GenerationContext): Promise<GeneratedCycle> {
    return runDraftCycle(input, this.deps, ctx);
  }

  async reviseCycle(input: ReviseCycleInput, ctx?: GenerationContext): Promise<GeneratedCycle> {
    return runReviseCycle(input, this.deps, ctx);
  }

  async generatePostContent(input: GeneratePostInput, ctx?: GenerationContext): Promise<GeneratedPost> {
    return runGeneratePost(input, this.deps, ctx);
  }

  async revisePostContent(input: RevisePostInput, ctx?: GenerationContext): Promise<GeneratedPost> {
    return runRevisePost(input, this.deps, ctx);
  }

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: true, detail: `llm=${this.deps.llm.name} media=${this.deps.media.name}` };
  }
}
