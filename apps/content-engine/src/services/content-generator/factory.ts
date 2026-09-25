/**
 * createContentGenerator -- selects the registered IContentGenerator backend
 * based on a flag string. Wired into worker.ts via the CONTENT_GENERATOR_BACKEND
 * env var. Default is 'placeholder' so existing deployments keep their current
 * behavior unless the flag is explicitly flipped.
 *
 * The 'ai' branch is an "uber" master flag: when set, every AI sub-feature
 * defaults to enabled (Replicate media + V1 calendar + V2 Sonar) and every
 * required key must be present. Operators set ONE flag and four keys; that
 * is the supported normal mode.
 *
 * Required when CONTENT_GENERATOR_BACKEND=ai (defaults shown):
 *   ANTHROPIC_API_KEY                  -- Anthropic Claude
 *   REPLICATE_API_TOKEN                -- Replicate (image + video)
 *   GOOGLE_CALENDAR_API_KEY            -- India holidays (V1)
 *   PERPLEXITY_API_KEY                 -- Sonar Pro current affairs (V2)
 *
 * Advanced sub-flag overrides (for debug / cost-control / staged rollouts):
 *   MEDIA_BACKEND=placeholder          -- skip Replicate; use asset catalog
 *   CURRENT_AFFAIRS_V1_ENABLED=false   -- skip Google Calendar
 *   CURRENT_AFFAIRS_V2_ENABLED=false   -- skip Perplexity Sonar
 *
 * When a sub-flag is overridden to false, its corresponding API key becomes
 * optional. The factory pre-validates every required key in one pass and
 * throws a single combined error so operators see the full setup gap at once.
 */

import type { IContentGenerator } from './types.js';
import { PlaceholderContentGenerator } from './backends/placeholder/index.js';
// AI backend imports are dynamic (inside createContentGenerator 'ai' branch) so
// packages like 'ai' and '@ai-sdk/anthropic' are never loaded when using placeholder.
import type { IMediaGenerator } from './backends/ai/media/types.js';
import type { ICurrentAffairsProvider } from './backends/ai/current-affairs/index.js';

export type ContentGeneratorBackend = 'placeholder' | 'ai' | 'replicate-proxy';
type MediaBackend = 'placeholder' | 'replicate';

function readBoolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1';
}

function readMediaBackend(fallback: MediaBackend): MediaBackend {
  const raw = process.env.MEDIA_BACKEND?.trim();
  if (!raw) return fallback;
  if (raw === 'placeholder' || raw === 'replicate') return raw;
  throw new Error(`Unknown MEDIA_BACKEND value: ${raw}. Expected 'placeholder' or 'replicate'.`);
}

interface AiModeResolution {
  v1Enabled: boolean;
  v2Enabled: boolean;
  mediaBackend: MediaBackend;
}

/**
 * Resolve the effective sub-feature flags when AI mode is engaged.
 * Master flag activates everything by default; sub-flags override.
 */
function resolveAiModeFlags(): AiModeResolution {
  return {
    // V1 has been default-on since phase 3 (Calendar is free); kept default-on under AI.
    v1Enabled: readBoolEnv('CURRENT_AFFAIRS_V1_ENABLED', true),
    // V2 default flips from false to true under AI mode.
    v2Enabled: readBoolEnv('CURRENT_AFFAIRS_V2_ENABLED', true),
    // Media backend default flips from placeholder to replicate under AI mode.
    mediaBackend: readMediaBackend('replicate'),
  };
}

/**
 * Validate every required key for the resolved AI-mode shape and throw a
 * single combined error if any are missing. Operators see the full gap at
 * once instead of fixing one key at a time across multiple boots.
 */
function validateAiKeys(flags: AiModeResolution): void {
  const missing: string[] = [];
  if (!process.env.ANTHROPIC_API_KEY) missing.push('ANTHROPIC_API_KEY');
  if (flags.mediaBackend === 'replicate' && !process.env.REPLICATE_API_TOKEN) missing.push('REPLICATE_API_TOKEN');
  if (flags.v1Enabled && !process.env.GOOGLE_CALENDAR_API_KEY) missing.push('GOOGLE_CALENDAR_API_KEY');
  if (flags.v2Enabled && !process.env.PERPLEXITY_API_KEY) missing.push('PERPLEXITY_API_KEY');

  if (missing.length === 0) return;

  const overrideHints: string[] = [];
  if (flags.mediaBackend === 'replicate' && missing.includes('REPLICATE_API_TOKEN')) {
    overrideHints.push('MEDIA_BACKEND=placeholder to skip Replicate');
  }
  if (flags.v1Enabled && missing.includes('GOOGLE_CALENDAR_API_KEY')) {
    overrideHints.push('CURRENT_AFFAIRS_V1_ENABLED=false to skip Google Calendar');
  }
  if (flags.v2Enabled && missing.includes('PERPLEXITY_API_KEY')) {
    overrideHints.push('CURRENT_AFFAIRS_V2_ENABLED=false to skip Sonar Pro');
  }

  const overrideLine = overrideHints.length
    ? `\n\nTo run with a reduced AI chain, set one or more of: ${overrideHints.join('; ')}.`
    : '';

  throw new Error(
    `CONTENT_GENERATOR_BACKEND=ai requires the following missing env var(s): ${missing.join(', ')}.\n` +
    `Set them in apps/content-engine/.env (dev) or App Service settings (prod). ` +
    `See docs/SECRETS.md for how to obtain each key.${overrideLine}`,
  );
}

/**
 * The replicate-proxy backend only needs Anthropic (cycle planning) and
 * Replicate (media is always Replicate for this backend -- no MEDIA_BACKEND
 * override). Current-affairs stays off by default; the same
 * CURRENT_AFFAIRS_V1_ENABLED/V2_ENABLED envs can still opt it in.
 */
function validateReplicateProxyKeys(): void {
  const missing: string[] = [];
  if (!process.env.ANTHROPIC_API_KEY) missing.push('ANTHROPIC_API_KEY');
  if (!process.env.REPLICATE_API_TOKEN) missing.push('REPLICATE_API_TOKEN');
  if (missing.length === 0) return;

  throw new Error(
    `CONTENT_GENERATOR_BACKEND=replicate-proxy requires the following missing env var(s): ${missing.join(', ')}.\n` +
    `Set them in apps/content-engine/.env (dev) or App Service settings (prod). ` +
    `See docs/SECRETS.md for how to obtain each key.`,
  );
}

async function buildCurrentAffairsForFactory(
  specialization: any,
  flags: AiModeResolution,
): Promise<ICurrentAffairsProvider> {
  const { v1Enabled, v2Enabled } = flags;
  const { buildCurrentAffairsProvider, GoogleCalendarClient, MongoCurrentAffairsCache, SonarClient } =
    await import('./backends/ai/current-affairs/index.js');

  if (!v1Enabled && !v2Enabled) {
    return buildCurrentAffairsProvider({ v1Enabled: false, v2Enabled: false }, {
      cache: new MongoCurrentAffairsCache(),
      calendarClient: { listHolidays: async () => [] } as any,
      sonarClient: { query: async () => ({ text: '', usage: { inputTokens: 0, outputTokens: 0 }, modelId: 'sonar-pro' }) } as any,
      specialization,
    });
  }

  const calendarClient = v1Enabled
    ? new GoogleCalendarClient({ apiKey: process.env.GOOGLE_CALENDAR_API_KEY! })
    : { listHolidays: async () => [] as never[] };

  const sonarClient = v2Enabled
    ? new SonarClient({ apiKey: process.env.PERPLEXITY_API_KEY! })
    : { query: async () => ({ text: '', usage: { inputTokens: 0, outputTokens: 0 }, modelId: 'sonar-pro' }) };

  return buildCurrentAffairsProvider(
    { v1Enabled, v2Enabled },
    {
      cache: new MongoCurrentAffairsCache(),
      calendarClient: calendarClient as any,
      sonarClient: sonarClient as any,
      specialization,
    },
  );
}

async function buildMediaGeneratorForFactory(flags: AiModeResolution): Promise<IMediaGenerator> {
  const { PlaceholderMediaGenerator } = await import('./backends/ai/media/placeholder-media-generator.js');

  if (flags.mediaBackend === 'replicate') {
    const { ReplicateMediaGenerator, ReplicateClient, MongoMediaJobStore } = await import('./backends/ai/index.js');
    const { createMediaStorage } = await import('../media-storage/index.js');
    const store = new MongoMediaJobStore();
    const media = new ReplicateMediaGenerator({
      client: new ReplicateClient({ apiKey: process.env.REPLICATE_API_TOKEN! }),
      store,
      // Replicate output files are deleted after ~1h: copy them to durable,
      // DB-scoped blob storage before any URL is recorded.
      storage: createMediaStorage(),
    });
    lastAiMediaJobStore = store;
    lastAiMediaGenerator = media;
    return media;
  }
  lastAiMediaJobStore = null;
  lastAiMediaGenerator = null;
  return new PlaceholderMediaGenerator();
}

/**
 * Stash the current-affairs provider per call so worker.ts can pull the same
 * instance for cron registration without re-running the env logic. This is a
 * factory-internal cache keyed by the most recent backend selected.
 */
let lastAiCurrentAffairs: ICurrentAffairsProvider | null = null;

let lastAiMediaJobStore: import('./backends/ai/media/jobs/types.js').IMediaJobStore | null = null;
let lastAiMediaGenerator: import('./backends/ai/media/types.js').IMediaGenerator | null = null;

export function getLastAiMediaJobStore() {
  return lastAiMediaJobStore;
}

export function getLastAiMediaGenerator() {
  return lastAiMediaGenerator;
}

/**
 * Read the current-affairs provider built by the most recent createContentGenerator('ai') call.
 * Worker.ts uses this to wire the cron processor. Returns null if 'ai' was never selected
 * (in which case there's nothing to refresh).
 */
export function getLastAiCurrentAffairsProvider(): ICurrentAffairsProvider | null {
  return lastAiCurrentAffairs;
}

export async function createContentGenerator(backend: ContentGeneratorBackend): Promise<IContentGenerator> {
  switch (backend) {
    case 'placeholder':
      lastAiCurrentAffairs = null;
      lastAiMediaJobStore = null;
      lastAiMediaGenerator = null;
      return new PlaceholderContentGenerator();

    case 'ai': {
      const flags = resolveAiModeFlags();
      validateAiKeys(flags);

      const { AIContentGenerator } = await import('./backends/ai/ai-content-generator.js');
      const { RestaurantSpecialization } = await import('./backends/ai/specialization/index.js');
      const { AnthropicLLMProvider } = await import('./backends/ai/llm/anthropic-provider.js');

      const specialization = new RestaurantSpecialization();
      const [currentAffairs, media] = await Promise.all([
        buildCurrentAffairsForFactory(specialization, flags),
        buildMediaGeneratorForFactory(flags),
      ]);
      lastAiCurrentAffairs = currentAffairs;

      // Build a SonarClient for on-demand dish image fetching when PERPLEXITY_API_KEY is present.
      // This is independent of the V2 current-affairs flag — dish images don't require V2.
      let sonar: import('./backends/ai/current-affairs/clients/sonar-client.js').SonarClient | undefined;
      if (process.env.PERPLEXITY_API_KEY) {
        const { SonarClient } = await import('./backends/ai/current-affairs/clients/sonar-client.js');
        sonar = new SonarClient({ apiKey: process.env.PERPLEXITY_API_KEY, model: 'sonar' });
      }

      return new AIContentGenerator({
        specialization,
        llm: new AnthropicLLMProvider({ apiKey: process.env.ANTHROPIC_API_KEY! }),
        media,
        currentAffairs,
        ...(sonar ? { sonar } : {}),
      });
    }

    case 'replicate-proxy': {
      validateReplicateProxyKeys();

      const { ReplicateProxyContentGenerator } = await import('./backends/replicate-proxy/index.js');
      const { RestaurantSpecialization } = await import('./backends/ai/specialization/index.js');
      const { AnthropicLLMProvider } = await import('./backends/ai/llm/anthropic-provider.js');

      const specialization = new RestaurantSpecialization();
      const flags: AiModeResolution = {
        v1Enabled: readBoolEnv('CURRENT_AFFAIRS_V1_ENABLED', false),
        v2Enabled: readBoolEnv('CURRENT_AFFAIRS_V2_ENABLED', false),
        mediaBackend: 'replicate',
      };
      const [currentAffairs, media] = await Promise.all([
        buildCurrentAffairsForFactory(specialization, flags),
        buildMediaGeneratorForFactory(flags),
      ]);
      lastAiCurrentAffairs = currentAffairs;

      return new ReplicateProxyContentGenerator({
        specialization,
        llm: new AnthropicLLMProvider({ apiKey: process.env.ANTHROPIC_API_KEY! }),
        media,
        currentAffairs,
      });
    }

    default: {
      const exhaustive: never = backend;
      throw new Error(`Unknown content generator backend: ${String(exhaustive)}`);
    }
  }
}
