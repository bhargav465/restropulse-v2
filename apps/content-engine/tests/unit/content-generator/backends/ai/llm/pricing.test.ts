import { describe, it, expect } from 'vitest';
import {
  MODEL_PRICING,
  computeCostUsd,
} from '../../../../../../src/services/content-generator/backends/ai/llm/pricing.js';

describe('MODEL_PRICING table', () => {
  it('declares prices for the two phase-2 models', () => {
    expect(MODEL_PRICING['claude-haiku-4-5-20251001']).toBeDefined();
    expect(MODEL_PRICING['claude-sonnet-4-6']).toBeDefined();
  });

  it('prices are positive numbers in USD per million tokens', () => {
    for (const [, p] of Object.entries(MODEL_PRICING)) {
      expect(p.inputPerMillion).toBeGreaterThan(0);
      expect(p.outputPerMillion).toBeGreaterThan(0);
    }
  });
});

describe('computeCostUsd', () => {
  it('computes input + output cost from token counts', () => {
    // Haiku: $0.80/M input, $4.00/M output
    // 1M input tokens + 0M output = $0.80
    const haikuOnly = computeCostUsd('claude-haiku-4-5-20251001', {
      inputTokens: 1_000_000,
      outputTokens: 0,
    });
    expect(haikuOnly).toBeCloseTo(0.80, 4);

    const haikuMixed = computeCostUsd('claude-haiku-4-5-20251001', {
      inputTokens: 100_000,
      outputTokens: 50_000,
    });
    // 0.1 * 0.80 + 0.05 * 4.00 = 0.08 + 0.20 = 0.28
    expect(haikuMixed).toBeCloseTo(0.28, 4);
  });

  it('returns 0 for an unknown model rather than throwing', () => {
    expect(
      computeCostUsd('unknown-model-99', { inputTokens: 1000, outputTokens: 1000 }),
    ).toBe(0);
  });

  it('treats cacheReadTokens at the same rate as inputTokens by default', () => {
    const withCache = computeCostUsd('claude-haiku-4-5-20251001', {
      inputTokens: 100_000,
      outputTokens: 0,
      cacheReadTokens: 50_000,
    });
    // 0.1 * 0.80 + 0.05 * 0.80 = 0.08 + 0.04 = 0.12
    expect(withCache).toBeCloseTo(0.12, 4);
  });

  it('handles missing usage fields without NaN', () => {
    const out = computeCostUsd('claude-sonnet-4-6', { inputTokens: 1000 });
    expect(Number.isFinite(out)).toBe(true);
    expect(out).toBeGreaterThanOrEqual(0);
  });
});
