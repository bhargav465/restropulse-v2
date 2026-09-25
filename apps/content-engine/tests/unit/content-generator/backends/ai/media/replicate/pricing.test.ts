import { describe, it, expect } from 'vitest';
import { computeReplicateCostUsd, REPLICATE_PRICING } from '../../../../../../../src/services/content-generator/backends/ai/media/replicate/pricing.js';

describe('computeReplicateCostUsd', () => {
  it('returns correct price for flux-dev', () => {
    expect(computeReplicateCostUsd('black-forest-labs/flux-dev')).toBe(0.025);
  });

  it('returns correct price for kling-v1.6-standard', () => {
    expect(computeReplicateCostUsd('kwaivgi/kling-v1.6-standard')).toBe(0.28);
  });

  it('returns 0 for unknown model', () => {
    expect(computeReplicateCostUsd('unknown/model')).toBe(0);
  });

  it('all pricing entries have positive usdPerCall', () => {
    for (const [slug, pricing] of Object.entries(REPLICATE_PRICING)) {
      expect(pricing.usdPerCall, `${slug} should have positive price`).toBeGreaterThan(0);
    }
  });
});
