/**
 * ICurrentAffairsProvider -- the seam that produces currentAffairsHints for
 * the AI pipeline. Phase 3 ships three implementations behind this interface:
 *
 *   NoopCurrentAffairsProvider        no-op (when both V1 and V2 are disabled)
 *   CalendarOnlyProvider              V1 (Google Calendar holidays)
 *   SonarAugmentedProvider            V2 (decorator: V1 + Perplexity Sonar Pro)
 *
 * Pipelines call fetchHints(...) when input.currentAffairsHints is empty.
 * The cron processor calls refresh() at 06:00 IST to populate the cache.
 */

import type { SpecializationContext } from '../specialization/types.js';

export type CurrentAffairsOperation = 'draftCycle' | 'reviseCycle' | 'generatePost' | 'revisePost';

export interface FetchHintsParams {
  operation: CurrentAffairsOperation;
  specializationContext: SpecializationContext;
  /** Concept of the post -- used by V2 per-post trigger detection. */
  concept?: string;
  /** Optional restaurantId for telemetry / cost attribution. */
  restaurantId?: string;
  /** Optional cycleId for telemetry / cost attribution. */
  cycleId?: string;
  /** Optional postId for telemetry / cost attribution. */
  postId?: string;
}

export interface ICurrentAffairsProvider {
  readonly name: string;

  /** Build hints to pass into the LLM prompt. Returns [] on failure (degraded mode). */
  fetchHints(params: FetchHintsParams): Promise<string[]>;

  /**
   * Populate any caches this provider owns. Called by the daily refresh cron.
   * Idempotent. Decorators MUST call upstream.refresh() before their own work
   * so the chain refreshes from the bottom up.
   */
  refresh(): Promise<void>;
}
