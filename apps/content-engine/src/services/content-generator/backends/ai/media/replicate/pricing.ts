/**
 * Per-model Replicate pricing in USD per call.
 * Replicate bills by compute time; these are empirical averages per generation.
 * Source: replicate.com/pricing (updated 2026-06).
 */

export interface ReplicateModelPricing {
  usdPerCall: number;
}

export const REPLICATE_PRICING: Record<string, ReplicateModelPricing> = {
  'black-forest-labs/flux-dev': { usdPerCall: 0.025 },
  'kwaivgi/kling-v1.6-standard': { usdPerCall: 0.28 },
};

export function computeReplicateCostUsd(modelSlug: string): number {
  return REPLICATE_PRICING[modelSlug]?.usdPerCall ?? 0;
}
