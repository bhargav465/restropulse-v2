/**
 * Dependencies the pipeline orchestration functions accept.
 *
 * Passing PipelineDeps (vs reading from a global) lets tests inject mocks
 * for every external dependency: the LLM client, the media generator, the
 * domain specialization, and (phase 3) the optional current-affairs provider.
 */

import type { ILLMProvider } from '../llm/types.js';
import type { IMediaGenerator } from '../media/types.js';
import type { IDomainSpecialization, SpecializationContext } from '../specialization/types.js';
import type { ICurrentAffairsProvider, CurrentAffairsOperation } from '../current-affairs/types.js';
import type { SonarClient } from '../current-affairs/clients/sonar-client.js';
import type { GenerationContext } from '../../../types.js';

export interface PipelineDeps {
  llm: ILLMProvider;
  media: IMediaGenerator;
  specialization: IDomainSpecialization;
  /** Optional. When set and caller supplies no hints, the pipeline auto-enriches. */
  currentAffairs?: ICurrentAffairsProvider;
  /**
   * Optional. When set, the pipeline fetches reference dish images on-demand from
   * Perplexity Sonar at media-generation time (img2img for single-image posts).
   */
  sonar?: SonarClient;
}

export function toSpecializationContext(ctx?: GenerationContext): SpecializationContext {
  const profile = ctx?.restaurantProfile;
  return {
    restaurantId: ctx?.restaurantId,
    restaurantName: ctx?.restaurantName,
    locale: ctx?.locale,
    cuisine: profile?.cuisine,
    bio: profile?.description,
    menu: profile?.menu,
    chefSpecials: profile?.chefSpecials,
  };
}

/**
 * If the caller supplied currentAffairsHints, use them. Otherwise, if a provider
 * is configured, ask it. On any error the provider returns []; we never block
 * the pipeline on hint-fetch failure.
 */
export async function resolveCurrentAffairsHints(
  callerHints: string[] | undefined,
  provider: ICurrentAffairsProvider | undefined,
  params: {
    operation: CurrentAffairsOperation;
    specializationContext: SpecializationContext;
    concept?: string;
    restaurantId?: string;
    cycleId?: string;
    postId?: string;
  },
): Promise<string[]> {
  if (callerHints && callerHints.length > 0) return callerHints;
  if (!provider) return [];
  try {
    return await provider.fetchHints(params);
  } catch {
    return [];
  }
}
