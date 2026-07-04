import { describe, it, expect } from 'vitest';
import {
  pickModel,
  ANTHROPIC_MODEL_IDS,
} from '../../../../../../src/services/content-generator/backends/ai/llm/model-selection.js';

describe('pickModel', () => {
  it('returns sonnet family for cycle-level reasoning operations', () => {
    expect(pickModel('draftCycle')).toBe('sonnet');
    expect(pickModel('reviseCycle')).toBe('sonnet');
  });

  it('returns haiku family for per-post caption work', () => {
    expect(pickModel('generatePost')).toBe('haiku');
    expect(pickModel('revisePost')).toBe('haiku');
  });
});

describe('ANTHROPIC_MODEL_IDS', () => {
  it('declares concrete model ids for both families', () => {
    expect(ANTHROPIC_MODEL_IDS.haiku).toBe('claude-haiku-4-5-20251001');
    expect(ANTHROPIC_MODEL_IDS.sonnet).toBe('claude-sonnet-4-6');
  });
});
