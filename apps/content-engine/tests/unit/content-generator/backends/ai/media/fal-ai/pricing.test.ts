import { describe, it, expect } from 'vitest';
import {
  FAL_PRICING,
  computeFalCostUsd,
} from '../../../../../../../src/services/content-generator/backends/ai/media/fal-ai/pricing.js';

describe('FAL_PRICING', () => {
  it('declares prices for the two phase-4 models (text-to-image + image-to-image)', () => {
    expect(FAL_PRICING['fal-ai/flux/dev']).toBeDefined();
    expect(FAL_PRICING['fal-ai/flux/dev/image-to-image']).toBeDefined();
  });

  it('all prices are positive USD per call', () => {
    for (const [, p] of Object.entries(FAL_PRICING)) {
      expect(p.usdPerCall).toBeGreaterThan(0);
    }
  });

  it('declares prices for the phase-5 video models (Kling + MiniMax)', () => {
    expect(FAL_PRICING['fal-ai/kling-video/v1.6/standard/text-to-video']).toBeDefined();
    expect(FAL_PRICING['fal-ai/minimax-video/text-to-video']).toBeDefined();
    expect(FAL_PRICING['fal-ai/kling-video/v1.6/standard/text-to-video'].usdPerCall).toBeGreaterThan(0);
  });
});

describe('computeFalCostUsd', () => {
  it('returns the per-call USD for a known model', () => {
    const cost = computeFalCostUsd('fal-ai/flux/dev');
    expect(cost).toBeCloseTo(FAL_PRICING['fal-ai/flux/dev'].usdPerCall, 6);
  });

  it('returns 0 for an unknown model rather than throwing', () => {
    expect(computeFalCostUsd('fal-ai/unknown-model')).toBe(0);
  });
});
