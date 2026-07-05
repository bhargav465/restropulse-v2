/**
 * ILLMProvider -- the seam between AIContentGenerator orchestration and the
 * concrete LLM client. Phase 2 ships AnthropicLLMProvider as the only impl.
 *
 * Every method must:
 *  - emit OTel spans via Vercel AI SDK's experimental_telemetry
 *  - return a structured object validated against the supplied Zod schema
 *  - return token usage (raw counts; cost is computed by callers using pricing.ts)
 *  - throw classifiable errors (TransientError / RateLimitError / pass-through)
 *    so withRetry can decide whether to retry
 */

import type { z } from 'zod';

/** Family-level model selector. The provider maps this to a concrete model id. */
export type LLMModelFamily = 'haiku' | 'sonnet';

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  /**
   * Vercel AI SDK exposes cache read/write tokens for Anthropic when prompt
   * caching is enabled. They are reported here for cost reconciliation; phase 2
   * does NOT factor cache pricing differently from base input pricing.
   */
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface GenerateObjectRequest<T> {
  /** Model family; provider picks the concrete model id. */
  model: LLMModelFamily;
  /** System prompt; cached when the provider supports caching. */
  system: string;
  /** User prompt for this specific call. */
  prompt: string;
  /** Zod schema the response must satisfy. The provider parses + validates. */
  schema: z.ZodType<T>;
  /** Optional context for telemetry tagging (restaurantId/postId/cycleId/operation). */
  telemetryAttributes?: Record<string, string>;
}

export interface GenerateObjectResponse<T> {
  object: T;
  usage: LLMUsage;
  /** Concrete model id the provider used (for cost lookup + audit). */
  modelId: string;
}

export interface ILLMProvider {
  readonly name: string;
  generateObject<T>(req: GenerateObjectRequest<T>): Promise<GenerateObjectResponse<T>>;
}
