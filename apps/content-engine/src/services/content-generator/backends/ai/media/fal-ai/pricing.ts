/**
 * Per-model fal.ai pricing in USD per call.
 *
 * Source: fal.ai public pricing page (placeholder values; update when official
 * pricing changes). A wrong price degrades cost-tracking accuracy but does not
 * break the pipeline.
 */

export interface FalModelPricing {
  /** USD billed per generation call, regardless of size. */
  usdPerCall: number;
}

export const FAL_PRICING: Record<string, FalModelPricing> = {
  'fal-ai/flux/dev': { usdPerCall: 0.025 },
  'fal-ai/flux/dev/image-to-image': { usdPerCall: 0.025 },
  'fal-ai/kling-video/v1.6/standard/text-to-video': { usdPerCall: 0.30 },
  'fal-ai/minimax-video/text-to-video': { usdPerCall: 0.40 },
};

export function computeFalCostUsd(modelId: string): number {
  return FAL_PRICING[modelId]?.usdPerCall ?? 0;
}
