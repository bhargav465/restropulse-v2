/**
 * Per-model USD pricing table.
 *
 * Source of truth: Anthropic / OpenAI / Google public pricing pages. Values here
 * are documented placeholders -- update when official pricing changes. A wrong
 * price degrades cost-tracking accuracy but does not break the pipeline.
 *
 * Phase 2 simplification: cache-read tokens are billed at the same per-token
 * rate as fresh input tokens. Anthropic actually charges 0.1x for cache reads
 * and 1.25x for cache writes; we ignore that nuance until the observability
 * dashboards in phase 6 surface it.
 */

export interface ModelPricing {
  /** USD per million input tokens. */
  inputPerMillion: number;
  /** USD per million output tokens. */
  outputPerMillion: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic
  'claude-haiku-4-5-20251001': { inputPerMillion: 0.80, outputPerMillion: 4.00 },
  'claude-sonnet-4-6': { inputPerMillion: 3.00, outputPerMillion: 15.00 },
  // Provider portability placeholders -- phase 2 doesn't switch off Anthropic by
  // default but any swap should populate the map for the new model id.
};

export interface UsageForCost {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export function computeCostUsd(model: string, usage: UsageForCost): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;

  const input = (usage.inputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
  const output = usage.outputTokens ?? 0;

  return (input / 1_000_000) * pricing.inputPerMillion
       + (output / 1_000_000) * pricing.outputPerMillion;
}
