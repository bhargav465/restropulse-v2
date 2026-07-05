/**
 * SonarAugmentedProvider -- V2 of the current-affairs RAG.
 *
 * Decorator over an upstream provider (typically CalendarOnlyProvider).
 *
 * fetchHints behavior:
 *   1. Call upstream.fetchHints(params) -- always.
 *   2. Read today's cached daily Sonar response (key: sonar-daily:YYYY-MM-DD).
 *      Append its text to the upstream hints if present.
 *   3. If params.operation is 'generatePost' or 'revisePost' AND params.concept
 *      matches a trigger keyword, fire ONE per-post Sonar call (not cached)
 *      using the first per-post query template from the specialization.
 *      Append the response. Failures degrade silently.
 *
 * refresh behavior:
 *   1. Call upstream.refresh().
 *   2. Fire the daily platform query (first daily-platform template from the
 *      specialization). Write to cache.
 *
 * All Sonar calls are wrapped in withRetry(LLM_PROFILE) + withCostTracking with
 * surface='sonar'. Per-post calls track step='trigger'; daily refresh tracks
 * step='daily'.
 */

import { createLogger } from '@restropulse/telemetry/server';
import { withRetry, RETRY_PROFILES } from '../../with-retry.js';
import { withCostTracking } from '../../with-cost-tracking.js';
import type { SonarClient } from '../clients/sonar-client.js';
import type { ICurrentAffairsCache } from '../cache/types.js';
import type { IDomainSpecialization } from '../../specialization/types.js';
import type { FetchHintsParams, ICurrentAffairsProvider } from '../types.js';

const log = createLogger('sonar-augmented-provider');

const DAILY_TTL_MS = 24 * 60 * 60 * 1000;

const TRIGGER_KEYWORDS: ReadonlyArray<string> = [
  // Sports
  'cricket', 'ipl', 'football', 'fifa', 'final', 'tournament', 'match',
  // Festivals (high-traffic India events)
  'festival', 'diwali', 'holi', 'eid', 'christmas', 'new year', 'pongal', 'onam', 'baisakhi', 'rakshabandhan', 'ganesh',
  // Weather / seasons
  'monsoon', 'summer', 'winter', 'rain', 'weather', 'season',
  // Major occasions
  'wedding', 'celebration', 'anniversary', 'birthday',
];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function dailyCacheKey(now: Date): string {
  return `sonar-daily:${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}`;
}

function conceptMatchesTrigger(concept: string | undefined): boolean {
  if (!concept) return false;
  const lc = concept.toLowerCase();
  return TRIGGER_KEYWORDS.some((kw) => lc.includes(kw));
}

interface DailyPayload {
  text: string;
  cachedAt: string;
}

export interface SonarAugmentedProviderOptions {
  cache: ICurrentAffairsCache;
  client: Pick<SonarClient, 'query'>;
  specialization: IDomainSpecialization;
}

export class SonarAugmentedProvider implements ICurrentAffairsProvider {
  readonly name = 'sonar-augmented';

  private readonly upstream: ICurrentAffairsProvider;
  private readonly cache: ICurrentAffairsCache;
  private readonly client: Pick<SonarClient, 'query'>;
  private readonly specialization: IDomainSpecialization;

  constructor(upstream: ICurrentAffairsProvider, options: SonarAugmentedProviderOptions) {
    if (!upstream) throw new Error('SonarAugmentedProvider requires an upstream provider');
    if (!options || !options.cache || !options.client || !options.specialization) {
      throw new Error('SonarAugmentedProvider requires { cache, client, specialization }');
    }
    this.upstream = upstream;
    this.cache = options.cache;
    this.client = options.client;
    this.specialization = options.specialization;
  }

  async fetchHints(params: FetchHintsParams): Promise<string[]> {
    const upstreamHints = await this.upstream.fetchHints(params);
    const hints = [...upstreamHints];

    // (a) Cached daily platform answer
    try {
      const today = new Date();
      const daily = await this.cache.get<DailyPayload>(dailyCacheKey(today));
      if (daily?.text) hints.push(daily.text);
    } catch (err) {
      log.warn({ err }, 'Failed to read daily Sonar cache; proceeding without it');
    }

    // (b) Per-post hyperlocal trigger
    if ((params.operation === 'generatePost' || params.operation === 'revisePost')
        && conceptMatchesTrigger(params.concept)) {
      const queries = this.specialization.getSonarQueries('per-post-trigger', params.specializationContext);
      const query = queries[0];
      if (query) {
        try {
          const text = await this.runSonarQuery(query, {
            operation: params.operation,
            step: 'trigger',
            restaurantId: params.restaurantId,
            postId: params.postId,
            cycleId: params.cycleId,
          });
          if (text) hints.push(text);
        } catch (err) {
          log.warn({ err, concept: params.concept }, 'Per-post Sonar trigger failed; degrading');
        }
      }
    }

    return hints;
  }

  async refresh(): Promise<void> {
    await this.upstream.refresh();

    // Generic specialization context for the daily platform query.
    const queries = this.specialization.getSonarQueries('daily-platform', {});
    const query = queries[0];
    if (!query) {
      log.warn('Specialization returned no daily-platform query; skipping daily Sonar refresh');
      return;
    }

    try {
      const text = await this.runSonarQuery(query, {
        operation: 'currentAffairsRefresh',
        step: 'daily',
      });
      const today = new Date();
      const payload: DailyPayload = { text, cachedAt: today.toISOString() };
      await this.cache.set(dailyCacheKey(today), payload, DAILY_TTL_MS);
      log.info({ key: dailyCacheKey(today), len: text.length }, 'Daily Sonar refresh stored');
    } catch (err) {
      log.error({ err }, 'Daily Sonar refresh failed; cache stays stale');
    }
  }

  private async runSonarQuery(
    question: string,
    labels: { operation: 'generatePost' | 'revisePost' | 'currentAffairsRefresh'; step: string; restaurantId?: string; postId?: string; cycleId?: string },
  ): Promise<string> {
    return withRetry(
      () => withCostTracking(
        async () => {
          const { text, usage, modelId } = await this.client.query(question);
          const SONAR_PRO_INPUT_PER_M = 3.0;   // USD per million input tokens
          const SONAR_PRO_OUTPUT_PER_M = 15.0; // USD per million output tokens
          const costUsd = (usage.inputTokens / 1_000_000) * SONAR_PRO_INPUT_PER_M
                        + (usage.outputTokens / 1_000_000) * SONAR_PRO_OUTPUT_PER_M;
          return {
            result: text,
            usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd },
          };
        },
        {
          operation: labels.operation,
          surface: 'sonar',
          step: labels.step,
          model: 'sonar-pro',
          ...(labels.restaurantId ? { restaurantId: labels.restaurantId } : {}),
          ...(labels.postId ? { postId: labels.postId } : {}),
          ...(labels.cycleId ? { cycleId: labels.cycleId } : {}),
        },
      ),
      RETRY_PROFILES.LLM,
    );
  }
}
