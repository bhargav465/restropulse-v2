/**
 * Per-call cost tracking row written by the AI content generator.
 *
 * Surfaces are the family of external API: 'llm' covers Anthropic/OpenAI/Google text calls,
 * 'image' / 'video' cover media generation providers, 'sonar' covers Perplexity Sonar
 * current-affairs lookups, and 'calendar' covers Google Calendar holiday lookups.
 */

export type CostSurface = 'llm' | 'image' | 'video' | 'sonar' | 'calendar';

export type CostOperation =
  | 'draftCycle'
  | 'reviseCycle'
  | 'generatePost'
  | 'revisePost'
  | 'currentAffairsRefresh'
  | 'mediaJobPoll';

export interface CostEvent {
  id?: string;
  restaurantId?: string;
  postId?: string;
  cycleId?: string;
  operation: CostOperation;
  surface: CostSurface;
  step: string;            // e.g. 'caption', 'hashtags', 'image', 'video', 'trends-daily'
  model: string;           // e.g. 'claude-sonnet-4-6', 'flux-dev', 'kling-1.6'
  inputTokens?: number;
  outputTokens?: number;
  costUsd: number;
  durationMs: number;
  status: 'success' | 'failure';
  errorCode?: string;
  createdAt: Date;
}
