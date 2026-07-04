/**
 * Per-operation model family selection.
 *
 * Cycle planning needs reasoning across multiple posts and themes -> Sonnet.
 * Per-post caption work is high-volume and bounded -> Haiku.
 *
 * If a future operation needs a different mapping, extend this map -- the
 * orchestration layer should never hardcode a model id.
 */

import type { LLMModelFamily } from './types.js';

export type ModelSelectionOperation = 'draftCycle' | 'reviseCycle' | 'generatePost' | 'revisePost';

const OPERATION_TO_FAMILY: Record<ModelSelectionOperation, LLMModelFamily> = {
  draftCycle: 'sonnet',
  reviseCycle: 'sonnet',
  generatePost: 'haiku',
  revisePost: 'haiku',
};

export function pickModel(operation: ModelSelectionOperation): LLMModelFamily {
  return OPERATION_TO_FAMILY[operation];
}

export const ANTHROPIC_MODEL_IDS: Record<LLMModelFamily, string> = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
};
