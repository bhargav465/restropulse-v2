# Content-Engine AI - Phase 2: LLM Caption + Cycle Generation via Vercel AI SDK

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every `BACKEND_UNAVAILABLE` throw on `AIContentGenerator` with a real implementation. `draftCycle` and `reviseCycle` produce LLM-generated cycles. `generatePost` and `revisePost` produce LLM-generated captions plus media routed through a new `IMediaGenerator` seam, with a `PlaceholderMediaGenerator` (wrapping the existing asset catalog) as the only impl in this phase. Real fal.ai media lands in phase 4.

**Architecture:** Vercel AI SDK (`ai` + `@ai-sdk/anthropic` + `@ai-sdk/openai` + `@ai-sdk/google`) wrapped behind a thin `ILLMProvider` interface so model swaps stay one import. Per-call model selection (Haiku for caption work, Sonnet for cycle reasoning). All LLM calls go through `withRetry(RETRY_PROFILES.LLM)` and `withCostTracking(...)` from phase 1, so retry semantics and per-restaurant cost attribution are automatic. Anthropic prompt caching is enabled on the system fragment. `AIContentGenerator` constructor takes `{ specialization, llm, media }` so tests inject mocks; the factory wires `AnthropicLLMProvider` + `PlaceholderMediaGenerator` defaults.

**Tech Stack:** TypeScript (strict, ESM), Vercel AI SDK 4+, Zod, Vitest + mongodb-memory-server, `@restropulse/telemetry/server` (pino + OTel + `trackAIUsage`).

---

## Phase 2 Checkpoints

Three review checkpoints, one final commit at the end.

- **Checkpoint A (Tasks 1-9):** Foundations - deps, ILLMProvider + AnthropicLLMProvider, model selection + pricing, schemas, IMediaGenerator + PlaceholderMediaGenerator. STOP for user approval.
- **Checkpoint B (Tasks 10-15):** Cycle operations - draft-cycle pipeline, revise-cycle pipeline, AIContentGenerator wiring for both. STOP for user approval.
- **Checkpoint C (Tasks 16-23):** Post operations + factory wiring + final verify. Final stage + STOP for commit approval.

---

## File Structure

### New files

```
apps/content-engine/src/services/content-generator/backends/ai/
  llm/
    types.ts                       ILLMProvider interface + GenerationRequest types
    anthropic-provider.ts          AnthropicLLMProvider (default impl)
    model-selection.ts             pickModel(operation) -> { id, family }
    pricing.ts                     MODEL_PRICING + computeCostUsd(model, usage)
    schemas.ts                     Zod schemas (CycleSchema, PostCaptionSchema)
  media/
    types.ts                       IMediaGenerator interface + MediaGenJob types
    placeholder-media-generator.ts PlaceholderMediaGenerator wrapping asset-manager
  pipeline/
    draft-cycle.ts                 runDraftCycle(input, deps) orchestration
    revise-cycle.ts                runReviseCycle(input, deps) orchestration
    generate-post.ts               runGeneratePost(input, deps) orchestration
    revise-post.ts                 runRevisePost(input, deps) orchestration
    types.ts                       PipelineDeps shape passed to all four

apps/content-engine/tests/unit/content-generator/backends/ai/
  llm/
    anthropic-provider.test.ts
    model-selection.test.ts
    pricing.test.ts
    schemas.test.ts
  media/
    placeholder-media-generator.test.ts
  pipeline/
    draft-cycle.test.ts
    revise-cycle.test.ts
    generate-post.test.ts
    revise-post.test.ts

apps/content-engine/tests/integration/
  ai-content-generator-end-to-end.test.ts   (mocked LLM, mocked media, real cost-events Mongo)
```

### Modified files

```
apps/content-engine/package.json                                              add ai + 3 provider deps
apps/content-engine/src/services/content-generator/backends/ai/index.ts       export new modules
apps/content-engine/src/services/content-generator/backends/ai/ai-content-generator.ts  populate operations + new constructor shape
apps/content-engine/src/services/content-generator/backends/ai/specialization/types.ts  no change expected; verify ImageGenInput is reusable
apps/content-engine/src/services/content-generator/factory.ts                 wire ANTHROPIC_API_KEY + LLM provider + media provider
apps/content-engine/tests/unit/content-generator/backends/ai/ai-content-generator.test.ts  update for new constructor signature
```

---

# CHECKPOINT A - Foundations (LLM + Media seams)

## Task 1: Add Vercel AI SDK + provider deps to apps/content-engine/package.json

**Files:**
- Modify: `apps/content-engine/package.json`
- (No tests for this task - exercised by all subsequent tasks)

- [ ] **Step 1: Add the deps**

In `apps/content-engine/package.json`, add to `"dependencies"` (alphabetically next to `"@restropulse/telemetry"`):

```json
"ai": "^4.0.0",
"@ai-sdk/anthropic": "^1.0.0",
"@ai-sdk/openai": "^1.0.0",
"@ai-sdk/google": "^1.0.0",
"zod": "^3.23.0",
```

If `zod` is already a transitive dep via `@restropulse/shared`, add it explicitly anyway so the content-engine has a direct constraint.

- [ ] **Step 2: Install**

From repo root: `rtk npm install`
Expected: clean install, no peer-dep warnings critical to ai/@ai-sdk/* packages.

- [ ] **Step 3: Verify imports resolve**

From `apps/content-engine/`:
```
npx tsx --eval "import('ai').then(m => console.log('ai keys:', Object.keys(m).slice(0,5))).catch(e => { console.error(e); process.exit(1); })"
```
Expected: prints something like `ai keys: [ 'generateObject', 'generateText', 'streamObject', 'streamText', ... ]`.

If Vercel AI SDK has shifted its export shape, adapt. The two functions this plan needs are `generateObject` and the `anthropic`/`openai`/`google` provider factories.

---

## Task 2: ILLMProvider interface + supporting types

**Files:**
- Create: `apps/content-engine/src/services/content-generator/backends/ai/llm/types.ts`

- [ ] **Step 1: Create types.ts**

```typescript
/**
 * ILLMProvider -- the seam between AIContentGenerator orchestration and the
 * concrete LLM client. Phase 2 ships AnthropicLLMProvider as the only impl.
 *
 * Every method must:
 *  - emit OTel spans via Vercel AI SDK's experimental_telemetry
 *  - return a structured object validated against the supplied Zod schema
 *  - return token usage (raw counts; cost is computed by callers using pricing.ts)
 *  - throw classifiable errors (TransientError / RateLimitError / pass-through)
 *    so withRetry can decide whether to retry
 */

import type { z } from 'zod';

/** Family-level model selector. The provider maps this to a concrete model id. */
export type LLMModelFamily = 'haiku' | 'sonnet';

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  /**
   * Vercel AI SDK exposes cache read/write tokens for Anthropic when prompt
   * caching is enabled. They are reported here for cost reconciliation; phase 2
   * does NOT factor cache pricing differently from base input pricing.
   */
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface GenerateObjectRequest<T> {
  /** Model family; provider picks the concrete model id. */
  model: LLMModelFamily;
  /** System prompt; cached when the provider supports caching. */
  system: string;
  /** User prompt for this specific call. */
  prompt: string;
  /** Zod schema the response must satisfy. The provider parses + validates. */
  schema: z.ZodType<T>;
  /** Optional context for telemetry tagging (restaurantId/postId/cycleId/operation). */
  telemetryAttributes?: Record<string, string>;
}

export interface GenerateObjectResponse<T> {
  object: T;
  usage: LLMUsage;
  /** Concrete model id the provider used (for cost lookup + audit). */
  modelId: string;
}

export interface ILLMProvider {
  readonly name: string;
  generateObject<T>(req: GenerateObjectRequest<T>): Promise<GenerateObjectResponse<T>>;
}
```

- [ ] **Step 2: Verify type-check**

From repo root: `rtk npm run type-check --workspace=@restropulse/content-engine`
Expected: exit 0 (the new file has no impl yet but compiles).

---

## Task 3: pricing.ts + tests

**Files:**
- Create: `apps/content-engine/src/services/content-generator/backends/ai/llm/pricing.ts`
- Create: `apps/content-engine/tests/unit/content-generator/backends/ai/llm/pricing.test.ts`

- [ ] **Step 1: Create the failing test**

Create `apps/content-engine/tests/unit/content-generator/backends/ai/llm/pricing.test.ts`:

```typescript
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
```

Verify it fails: `cd apps/content-engine && npx vitest run tests/unit/content-generator/backends/ai/llm/pricing.test.ts`
Expected: FAIL ("Cannot find module").

- [ ] **Step 2: Implement pricing.ts**

Create `apps/content-engine/src/services/content-generator/backends/ai/llm/pricing.ts`:

```typescript
/**
 * Per-model USD pricing table.
 *
 * Source of truth: Anthropic / OpenAI / Google public pricing pages. Values here
 * are documented placeholders -- update when official pricing changes. A wrong
 * price degrades cost-tracking accuracy but does not break the pipeline.
 *
 * Phase 2 simplification: cache-read tokens are billed at the same per-token
 * rate as fresh input tokens. Anthropic actually charges 0.1x for cache reads
 * and 1.25x for cache writes; we ignore that nuance until the observability
 * dashboards in phase 6 surface it.
 */

export interface ModelPricing {
  /** USD per million input tokens. */
  inputPerMillion: number;
  /** USD per million output tokens. */
  outputPerMillion: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic
  'claude-haiku-4-5-20251001': { inputPerMillion: 0.80, outputPerMillion: 4.00 },
  'claude-sonnet-4-6': { inputPerMillion: 3.00, outputPerMillion: 15.00 },
  // Provider portability placeholders -- phase 2 doesn't switch off Anthropic by
  // default but any swap should populate the map for the new model id.
};

export interface UsageForCost {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export function computeCostUsd(model: string, usage: UsageForCost): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;

  const input = (usage.inputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
  const output = usage.outputTokens ?? 0;

  return (input / 1_000_000) * pricing.inputPerMillion
       + (output / 1_000_000) * pricing.outputPerMillion;
}
```

- [ ] **Step 3: Verify the test passes**

`cd apps/content-engine && npx vitest run tests/unit/content-generator/backends/ai/llm/pricing.test.ts`
Expected: PASS, all 5 assertions green.

---

## Task 4: model-selection.ts + tests

**Files:**
- Create: `apps/content-engine/src/services/content-generator/backends/ai/llm/model-selection.ts`
- Create: `apps/content-engine/tests/unit/content-generator/backends/ai/llm/model-selection.test.ts`

- [ ] **Step 1: Create the failing test**

```typescript
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
```

Verify it fails: `cd apps/content-engine && npx vitest run tests/unit/content-generator/backends/ai/llm/model-selection.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement model-selection.ts**

```typescript
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
```

- [ ] **Step 3: Verify**

`cd apps/content-engine && npx vitest run tests/unit/content-generator/backends/ai/llm/model-selection.test.ts`
Expected: PASS, 3 assertions green.

---

## Task 5: schemas.ts + tests

**Files:**
- Create: `apps/content-engine/src/services/content-generator/backends/ai/llm/schemas.ts`
- Create: `apps/content-engine/tests/unit/content-generator/backends/ai/llm/schemas.test.ts`

- [ ] **Step 1: Create the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import {
  CycleSchema,
  PostCaptionSchema,
} from '../../../../../../src/services/content-generator/backends/ai/llm/schemas.js';

describe('CycleSchema', () => {
  it('accepts a minimal valid cycle', () => {
    const valid = {
      summary: 'Week 1 focus on chef specials and behind-the-scenes content',
      plannedPosts: [{ category: 'chef_special', count: 2 }],
      focus: ['Chef Specials'],
    };
    expect(() => CycleSchema.parse(valid)).not.toThrow();
  });

  it('accepts an optional rationale', () => {
    const valid = {
      summary: 's',
      plannedPosts: [{ category: 'a', count: 1 }],
      focus: ['x'],
      rationale: 'because reasons',
    };
    expect(() => CycleSchema.parse(valid)).not.toThrow();
  });

  it('rejects a cycle missing required fields', () => {
    expect(() => CycleSchema.parse({ summary: 's' })).toThrow();
    expect(() => CycleSchema.parse({ plannedPosts: [], focus: [] })).toThrow();
  });

  it('rejects a plannedPost with non-numeric count', () => {
    expect(() =>
      CycleSchema.parse({
        summary: 's',
        plannedPosts: [{ category: 'c', count: 'two' }],
        focus: ['x'],
      }),
    ).toThrow();
  });
});

describe('PostCaptionSchema', () => {
  it('accepts a caption + optional suggestedHashtags + optional archetype', () => {
    const valid = {
      caption: 'Soft, flaky, ghee-laced parotta straight off the tawa.',
      suggestedHashtags: ['#parotta', '#southindian'],
      archetype: 'CHEFS_PICK',
    };
    expect(() => PostCaptionSchema.parse(valid)).not.toThrow();
  });

  it('accepts caption only (hashtags + archetype optional)', () => {
    const valid = { caption: 'Hello world' };
    expect(() => PostCaptionSchema.parse(valid)).not.toThrow();
  });

  it('rejects empty caption', () => {
    expect(() => PostCaptionSchema.parse({ caption: '' })).toThrow();
  });
});
```

Verify it fails.

- [ ] **Step 2: Implement schemas.ts**

```typescript
/**
 * Zod schemas for structured LLM outputs.
 *
 * Vercel AI SDK's generateObject() validates the parsed JSON against these
 * schemas before returning. Mismatches cause an exception that
 * AnthropicLLMProvider classifies (typically non-retriable -- a model that
 * doesn't follow the schema won't follow it on retry either).
 */

import { z } from 'zod';

export const PlannedPostSchema = z.object({
  category: z.string().min(1),
  count: z.number().int().positive(),
});

export const CycleSchema = z.object({
  summary: z.string().min(1),
  plannedPosts: z.array(PlannedPostSchema).min(1),
  focus: z.array(z.string().min(1)).min(1),
  rationale: z.string().optional(),
});

export type CycleSchemaType = z.infer<typeof CycleSchema>;

export const PostCaptionSchema = z.object({
  /** The post caption (without hashtags). */
  caption: z.string().min(1),
  /** Hashtags suggested by the model. Final selection is merged with specialization output. */
  suggestedHashtags: z.array(z.string()).optional(),
  /** Archetype the model chose; informational only (not enforced). */
  archetype: z.string().optional(),
});

export type PostCaptionSchemaType = z.infer<typeof PostCaptionSchema>;
```

- [ ] **Step 3: Verify**

PASS, 7 assertions green.

---

## Task 6: AnthropicLLMProvider + tests

**Files:**
- Create: `apps/content-engine/src/services/content-generator/backends/ai/llm/anthropic-provider.ts`
- Create: `apps/content-engine/tests/unit/content-generator/backends/ai/llm/anthropic-provider.test.ts`

- [ ] **Step 1: Create the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

const generateObjectMock = vi.fn();
const anthropicProviderFactoryMock = vi.fn((modelId: string) => ({ modelId }));

vi.mock('ai', () => ({
  generateObject: generateObjectMock,
}));

vi.mock('@ai-sdk/anthropic', () => ({
  anthropic: anthropicProviderFactoryMock,
}));

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { AnthropicLLMProvider } = await import(
  '../../../../../../src/services/content-generator/backends/ai/llm/anthropic-provider.js'
);
const { TransientError, RateLimitError } = await import(
  '../../../../../../src/services/content-generator/backends/ai/errors.js'
);

const Schema = z.object({ greeting: z.string() });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AnthropicLLMProvider', () => {
  it('exposes name "anthropic"', () => {
    const p = new AnthropicLLMProvider({ apiKey: 'sk-test' });
    expect(p.name).toBe('anthropic');
  });

  it('throws when constructed without an apiKey', () => {
    expect(() => new AnthropicLLMProvider({ apiKey: '' })).toThrow(/api ?key/i);
  });

  it('maps haiku/sonnet families to concrete Anthropic model ids', async () => {
    generateObjectMock.mockResolvedValue({
      object: { greeting: 'hi' },
      usage: { promptTokens: 100, completionTokens: 50 },
    });
    const p = new AnthropicLLMProvider({ apiKey: 'sk-test' });
    await p.generateObject({ model: 'haiku', system: 's', prompt: 'p', schema: Schema });
    expect(anthropicProviderFactoryMock).toHaveBeenCalledWith('claude-haiku-4-5-20251001');

    anthropicProviderFactoryMock.mockClear();
    await p.generateObject({ model: 'sonnet', system: 's', prompt: 'p', schema: Schema });
    expect(anthropicProviderFactoryMock).toHaveBeenCalledWith('claude-sonnet-4-6');
  });

  it('passes system + prompt + schema + cache control to generateObject', async () => {
    generateObjectMock.mockResolvedValue({
      object: { greeting: 'hi' },
      usage: { promptTokens: 100, completionTokens: 50 },
    });
    const p = new AnthropicLLMProvider({ apiKey: 'sk-test' });
    await p.generateObject({
      model: 'haiku',
      system: 'system fragment',
      prompt: 'user prompt',
      schema: Schema,
      telemetryAttributes: { operation: 'generatePost', restaurantId: 'r1' },
    });

    expect(generateObjectMock).toHaveBeenCalledTimes(1);
    const arg = generateObjectMock.mock.calls[0][0];
    expect(arg.system).toBe('system fragment');
    expect(arg.prompt).toBe('user prompt');
    expect(arg.schema).toBe(Schema);
    expect(arg.experimental_telemetry?.isEnabled).toBe(true);
    expect(arg.experimental_telemetry?.metadata).toMatchObject({ operation: 'generatePost', restaurantId: 'r1' });
    expect(arg.providerOptions?.anthropic?.cacheControl).toEqual({ type: 'ephemeral' });
  });

  it('returns object + usage with model id', async () => {
    generateObjectMock.mockResolvedValue({
      object: { greeting: 'hi' },
      usage: { promptTokens: 100, completionTokens: 50, cachedPromptTokens: 25 },
    });
    const p = new AnthropicLLMProvider({ apiKey: 'sk-test' });
    const out = await p.generateObject({
      model: 'sonnet',
      system: 's',
      prompt: 'p',
      schema: Schema,
    });
    expect(out.object).toEqual({ greeting: 'hi' });
    expect(out.usage.inputTokens).toBe(100);
    expect(out.usage.outputTokens).toBe(50);
    expect(out.usage.cacheReadTokens).toBe(25);
    expect(out.modelId).toBe('claude-sonnet-4-6');
  });

  it('classifies HTTP-shaped 429 errors as RateLimitError', async () => {
    generateObjectMock.mockRejectedValue({ status: 429, message: 'rate limited', headers: { 'retry-after': '3' } });
    const p = new AnthropicLLMProvider({ apiKey: 'sk-test' });
    await expect(
      p.generateObject({ model: 'haiku', system: 's', prompt: 'p', schema: Schema }),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it('classifies HTTP 502/503/504 as TransientError', async () => {
    generateObjectMock.mockRejectedValue({ status: 503, message: 'unavail' });
    const p = new AnthropicLLMProvider({ apiKey: 'sk-test' });
    await expect(
      p.generateObject({ model: 'haiku', system: 's', prompt: 'p', schema: Schema }),
    ).rejects.toBeInstanceOf(TransientError);
  });

  it('passes 4xx (non-429) errors through unchanged', async () => {
    const httpErr = { status: 400, message: 'bad request' };
    generateObjectMock.mockRejectedValue(httpErr);
    const p = new AnthropicLLMProvider({ apiKey: 'sk-test' });
    await expect(
      p.generateObject({ model: 'haiku', system: 's', prompt: 'p', schema: Schema }),
    ).rejects.toBe(httpErr);
  });
});
```

Verify it fails.

- [ ] **Step 2: Implement anthropic-provider.ts**

```typescript
/**
 * AnthropicLLMProvider -- Vercel AI SDK + @ai-sdk/anthropic.
 *
 * Default LLM provider. Family ('haiku' | 'sonnet') maps to concrete model ids
 * via ANTHROPIC_MODEL_IDS so the orchestration layer never hardcodes a model
 * version. Anthropic prompt caching is enabled on the system prompt by default
 * (5-minute ephemeral cache).
 *
 * The generateObject() call is wrapped in classifyError so transient/rate-limit
 * errors surface as the right exception type for withRetry to handle.
 */

import { generateObject as aiGenerateObject } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { createLogger } from '@restropulse/telemetry/server';
import { classifyError, TransientError } from '../errors.js';
import { ANTHROPIC_MODEL_IDS } from './model-selection.js';
import type {
  GenerateObjectRequest,
  GenerateObjectResponse,
  ILLMProvider,
  LLMUsage,
} from './types.js';

const log = createLogger('anthropic-llm');

export interface AnthropicLLMProviderOptions {
  apiKey: string;
  /**
   * Override the default Anthropic model ids per family. Useful for tests or
   * forcing a specific snapshot in production.
   */
  modelOverrides?: Partial<Record<'haiku' | 'sonnet', string>>;
}

export class AnthropicLLMProvider implements ILLMProvider {
  readonly name = 'anthropic';
  private readonly modelIds: Record<'haiku' | 'sonnet', string>;

  constructor(options: AnthropicLLMProviderOptions) {
    if (!options || !options.apiKey) {
      throw new Error('AnthropicLLMProvider requires a non-empty apiKey');
    }
    // The @ai-sdk/anthropic package reads ANTHROPIC_API_KEY from env when not
    // configured otherwise. Set it here so callers can pass the key explicitly
    // without having to mutate process.env elsewhere.
    if (!process.env.ANTHROPIC_API_KEY) {
      process.env.ANTHROPIC_API_KEY = options.apiKey;
    }
    this.modelIds = {
      haiku: options.modelOverrides?.haiku ?? ANTHROPIC_MODEL_IDS.haiku,
      sonnet: options.modelOverrides?.sonnet ?? ANTHROPIC_MODEL_IDS.sonnet,
    };
  }

  async generateObject<T>(req: GenerateObjectRequest<T>): Promise<GenerateObjectResponse<T>> {
    const modelId = this.modelIds[req.model];
    log.debug({ modelId, family: req.model }, 'AnthropicLLMProvider.generateObject');

    try {
      const result = await aiGenerateObject({
        model: anthropic(modelId),
        system: req.system,
        prompt: req.prompt,
        schema: req.schema,
        experimental_telemetry: {
          isEnabled: true,
          metadata: req.telemetryAttributes ?? {},
        },
        providerOptions: {
          anthropic: {
            cacheControl: { type: 'ephemeral' },
          },
        },
      });

      const usage: LLMUsage = {
        inputTokens: (result.usage as any)?.promptTokens ?? 0,
        outputTokens: (result.usage as any)?.completionTokens ?? 0,
      };
      const cacheRead = (result.usage as any)?.cachedPromptTokens
        ?? (result.usage as any)?.promptCacheReadTokens;
      if (cacheRead !== undefined) usage.cacheReadTokens = cacheRead;
      const cacheWrite = (result.usage as any)?.promptCacheWriteTokens;
      if (cacheWrite !== undefined) usage.cacheWriteTokens = cacheWrite;

      return {
        object: result.object as T,
        usage,
        modelId,
      };
    } catch (rawError) {
      const classified = classifyError(rawError);
      // Throw the classified version so withRetry can decide. Note that classifyError
      // returns the input unchanged when it's not retry-eligible (e.g. 4xx) -- we
      // preserve that exact reference here.
      if (classified instanceof TransientError) throw classified;
      throw rawError;
    }
  }
}
```

- [ ] **Step 3: Verify**

`cd apps/content-engine && npx vitest run tests/unit/content-generator/backends/ai/llm/anthropic-provider.test.ts`
Expected: PASS, 8 assertions green.

---

## Task 7: IMediaGenerator interface

**Files:**
- Create: `apps/content-engine/src/services/content-generator/backends/ai/media/types.ts`

- [ ] **Step 1: Create types.ts**

```typescript
/**
 * IMediaGenerator -- the seam between AIContentGenerator orchestration and
 * media providers (image/video). Phase 2 ships PlaceholderMediaGenerator as
 * the only impl. Phase 4 introduces FalAIMediaGenerator and the MongoDB-backed
 * mediaJobs durable polling pattern. Phase 5 extends to long-running video.
 *
 * Phase 2's contract is intentionally synchronous (Promise<MediaGenJob with
 * status 'COMPLETED' immediately); phase 5 will introduce the PENDING/RUNNING
 * states without changing this interface shape -- callers must already handle
 * the wider state space.
 */

import type { Platform, PostType } from '@restropulse/shared';

export type MediaJobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface MediaGenJob {
  jobId: string;
  status: MediaJobStatus;
  /** Public URL of the resulting media. Required when status is COMPLETED. */
  mediaUrl?: string;
  /** Carousel sets resolve with multiple URLs. */
  mediaUrls?: string[];
  /** Thumbnail URL (for video and carousel). */
  thumbnail?: string;
  /** Width/height/duration metadata when available. */
  metadata?: {
    widthPx?: number;
    heightPx?: number;
    durationSeconds?: number;
  };
  /** Failure detail when status is FAILED. */
  error?: string;
}

export interface ImageGenInput {
  postType: PostType;          // IMAGE | CAROUSEL | STORY (this method's domain)
  platforms: Platform[];
  concept: string;
  themes?: string[];
  caption?: string;
  /** Optional: edit a user-provided image (img2img) instead of generating from scratch. */
  baseImageUrl?: string;
}

export interface VideoGenInput {
  postType: 'REEL' | 'VIDEO' | 'STORY';
  platforms: Platform[];
  concept: string;
  themes?: string[];
  caption?: string;
}

export interface IMediaGenerator {
  readonly name: string;
  generateImage(input: ImageGenInput): Promise<MediaGenJob>;
  generateVideo(input: VideoGenInput): Promise<MediaGenJob>;
  /** Phase 5: poll a previously-submitted job. Phase 2 impls return COMPLETED jobs immediately so this is a no-op for them. */
  pollJob(jobId: string): Promise<MediaGenJob>;
}
```

- [ ] **Step 2: Verify type-check**

`rtk npm run type-check --workspace=@restropulse/content-engine`
Expected: exit 0.

---

## Task 8: PlaceholderMediaGenerator + tests

**Files:**
- Create: `apps/content-engine/src/services/content-generator/backends/ai/media/placeholder-media-generator.ts`
- Create: `apps/content-engine/tests/unit/content-generator/backends/ai/media/placeholder-media-generator.test.ts`

- [ ] **Step 1: Create the failing test**

```typescript
import { describe, it, expect, beforeAll, vi } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

beforeAll(() => {
  process.env['ASSET_SERVER_BASE_URL'] = 'http://localhost:3002';
  process.env['ASSET_SERVER_PORT'] = '3002';
});

const { PlaceholderMediaGenerator } = await import(
  '../../../../../../src/services/content-generator/backends/ai/media/placeholder-media-generator.js'
);

const gen = new PlaceholderMediaGenerator();

describe('PlaceholderMediaGenerator', () => {
  it('exposes name "placeholder-media"', () => {
    expect(gen.name).toBe('placeholder-media');
  });

  it('generateImage returns a COMPLETED job with a URL for IMAGE post type', async () => {
    const job = await gen.generateImage({
      postType: 'IMAGE',
      platforms: ['INSTAGRAM'],
      concept: 'paneer tikka',
    });
    expect(job.status).toBe('COMPLETED');
    expect(job.mediaUrl).toMatch(/^http:\/\//);
    expect(job.thumbnail).toBeDefined();
    expect(job.metadata?.widthPx).toBeGreaterThan(0);
    expect(job.metadata?.heightPx).toBeGreaterThan(0);
  });

  it('generateImage returns mediaUrls + thumbnail for CAROUSEL', async () => {
    const job = await gen.generateImage({
      postType: 'CAROUSEL',
      platforms: ['INSTAGRAM'],
      concept: 'menu highlights',
    });
    expect(job.status).toBe('COMPLETED');
    expect(Array.isArray(job.mediaUrls)).toBe(true);
    expect(job.mediaUrls!.length).toBeGreaterThan(0);
    expect(job.thumbnail).toBe(job.mediaUrls![0]);
  });

  it('generateVideo returns a COMPLETED job with thumbnail + videoUrl for REEL', async () => {
    const job = await gen.generateVideo({
      postType: 'REEL',
      platforms: ['INSTAGRAM'],
      concept: 'kitchen close-up',
    });
    expect(job.status).toBe('COMPLETED');
    expect(job.mediaUrl).toMatch(/^http:\/\//);
    expect(job.thumbnail).toBeDefined();
  });

  it('pollJob returns COMPLETED for any jobId (synchronous backend)', async () => {
    const status = await gen.pollJob('whatever');
    expect(status.status).toBe('COMPLETED');
  });

  it('jobId is unique per call (uuid-like)', async () => {
    const j1 = await gen.generateImage({ postType: 'IMAGE', platforms: ['INSTAGRAM'], concept: 'x' });
    const j2 = await gen.generateImage({ postType: 'IMAGE', platforms: ['INSTAGRAM'], concept: 'y' });
    expect(j1.jobId).not.toBe(j2.jobId);
  });
});
```

Verify it fails.

- [ ] **Step 2: Implement PlaceholderMediaGenerator**

```typescript
/**
 * PlaceholderMediaGenerator -- IMediaGenerator that wraps the existing
 * asset-manager catalog. Used by AIContentGenerator in phase 2 so the AI
 * pipeline runs end-to-end with real-looking media URLs without calling
 * fal.ai. Replaced by FalAIMediaGenerator in phase 4.
 *
 * Synchronous: every job resolves to COMPLETED immediately. pollJob() is a
 * no-op (returns COMPLETED) so callers that always poll still work.
 */

import { randomUUID } from 'node:crypto';
import { createLogger } from '@restropulse/telemetry/server';
import {
  getRandomCarousel,
  getRandomImage,
  getRandomVideo,
  getConstraintCompatibleImage,
  getConstraintCompatibleVideo,
} from '../../../../asset-manager.js';
import { getMergedConstraints } from '../../../content-validator/media-constraints.js';
import type {
  IMediaGenerator,
  ImageGenInput,
  MediaGenJob,
  VideoGenInput,
} from './types.js';

const log = createLogger('placeholder-media-generator');

function pickThemeKey(input: { themes?: string[]; concept: string }): string {
  return input.themes?.[0]?.trim() || input.concept || 'default';
}

export class PlaceholderMediaGenerator implements IMediaGenerator {
  readonly name = 'placeholder-media';

  async generateImage(input: ImageGenInput): Promise<MediaGenJob> {
    const theme = pickThemeKey(input);
    const constraints = getMergedConstraints(input.postType, input.platforms);

    if (input.postType === 'CAROUSEL') {
      const { urls, set } = getRandomCarousel(theme);
      return {
        jobId: randomUUID(),
        status: 'COMPLETED',
        mediaUrls: urls,
        thumbnail: urls[0],
        metadata: { widthPx: set.widthPx, heightPx: set.heightPx },
      };
    }

    const selected = getConstraintCompatibleImage(constraints, theme) ?? getRandomImage(theme);
    return {
      jobId: randomUUID(),
      status: 'COMPLETED',
      mediaUrl: selected.url,
      thumbnail: selected.url,
      metadata: { widthPx: selected.asset.widthPx, heightPx: selected.asset.heightPx },
    };
  }

  async generateVideo(input: VideoGenInput): Promise<MediaGenJob> {
    const theme = pickThemeKey(input);
    const constraints = getMergedConstraints(input.postType, input.platforms);

    const selected = getConstraintCompatibleVideo(constraints, theme);
    if (selected) {
      return {
        jobId: randomUUID(),
        status: 'COMPLETED',
        mediaUrl: selected.videoUrl,
        thumbnail: selected.thumbnail,
        metadata: {
          widthPx: selected.asset.widthPx,
          heightPx: selected.asset.heightPx,
          durationSeconds: selected.asset.durationSeconds,
        },
      };
    }

    log.warn({ postType: input.postType, platforms: input.platforms, theme },
      'No constraint-compatible video; falling back to random video');
    const fallback = getRandomVideo(theme);
    return {
      jobId: randomUUID(),
      status: 'COMPLETED',
      mediaUrl: fallback.videoUrl,
      thumbnail: fallback.thumbnail,
      metadata: {
        widthPx: fallback.asset.widthPx,
        heightPx: fallback.asset.heightPx,
        durationSeconds: fallback.asset.durationSeconds,
      },
    };
  }

  async pollJob(jobId: string): Promise<MediaGenJob> {
    return { jobId, status: 'COMPLETED' };
  }
}
```

- [ ] **Step 3: Verify**

PASS, 6 assertions green.

---

## Task 9: Checkpoint A wrap - run all phase-2 + regressions, STOP for user review

- [ ] **Step 1: Run all newly-added phase-2 tests**

`cd apps/content-engine && npx vitest run tests/unit/content-generator/backends/ai/llm tests/unit/content-generator/backends/ai/media`
Expected: 5 test files, all green.

- [ ] **Step 2: Run the full content-engine suite to confirm no regressions**

`cd apps/content-engine && npx vitest run`
Expected: prior 25 files + 5 new = 30 files, ~26+ new assertions over 237 baseline.

- [ ] **Step 3: Type-check the workspace + dependent workspaces**

`rtk npm run type-check --workspace=@restropulse/content-engine && rtk npm run type-check --workspace=@restropulse/shared && rtk npm run type-check --workspace=@restropulse/db`
Expected: all exit 0.

- [ ] **Step 4: Show user, request approval to proceed to Checkpoint B**

`rtk git status` (do NOT stage; let the user see what's been added).

**STOP. Tell the user: "Checkpoint A complete - LLM provider + media seam + 5 test files green. Approve continuing to Checkpoint B (cycle operations)?" Wait for explicit approval.**

---

# CHECKPOINT B - Cycle operations (draftCycle + reviseCycle)

## Task 10: Pipeline shared deps shape

**Files:**
- Create: `apps/content-engine/src/services/content-generator/backends/ai/pipeline/types.ts`

- [ ] **Step 1: Create types.ts**

```typescript
/**
 * Dependencies the pipeline orchestration functions accept.
 *
 * Passing PipelineDeps (vs reading from a global) lets tests inject mocks
 * for every external dependency: the LLM client, the media generator, and
 * the domain specialization. AIContentGenerator builds this object once in
 * its constructor and forwards it to each pipeline function.
 */

import type { ILLMProvider } from '../llm/types.js';
import type { IMediaGenerator } from '../media/types.js';
import type { IDomainSpecialization, SpecializationContext } from '../specialization/types.js';
import type { GenerationContext } from '../../../types.js';

export interface PipelineDeps {
  llm: ILLMProvider;
  media: IMediaGenerator;
  specialization: IDomainSpecialization;
}

/**
 * Project a GenerationContext (caller-supplied at call time) into the
 * SpecializationContext shape that prompts/queries expect.
 *
 * Today they are nearly identical; isolated as a function so future fields
 * (cuisine, brandVoice etc. enriched from a restaurant lookup) land in one place.
 */
export function toSpecializationContext(ctx?: GenerationContext): SpecializationContext {
  return {
    restaurantId: ctx?.restaurantId,
    restaurantName: ctx?.restaurantName,
    locale: ctx?.locale,
  };
}
```

- [ ] **Step 2: Type-check**

`rtk npm run type-check --workspace=@restropulse/content-engine` -> exit 0.

---

## Task 11: draft-cycle pipeline + tests

**Files:**
- Create: `apps/content-engine/src/services/content-generator/backends/ai/pipeline/draft-cycle.ts`
- Create: `apps/content-engine/tests/unit/content-generator/backends/ai/pipeline/draft-cycle.test.ts`

- [ ] **Step 1: Create the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  trackAIUsage: vi.fn(),
}));

vi.mock('@restropulse/db', () => ({
  insertCostEvent: vi.fn().mockResolvedValue({ id: 'ce_test' }),
}));

const { runDraftCycle } = await import(
  '../../../../../../src/services/content-generator/backends/ai/pipeline/draft-cycle.js'
);
const { RestaurantSpecialization } = await import(
  '../../../../../../src/services/content-generator/backends/ai/specialization/index.js'
);

beforeEach(() => {
  vi.clearAllMocks();
});

function makeDeps(overrides: Partial<{ generateObject: any }> = {}) {
  const generateObject = overrides.generateObject ?? vi.fn().mockResolvedValue({
    object: {
      summary: 'A focused week on chef specials',
      plannedPosts: [{ category: 'chef_special', count: 2 }],
      focus: ['Chef Specials'],
    },
    usage: { inputTokens: 200, outputTokens: 80 },
    modelId: 'claude-sonnet-4-6',
  });
  return {
    llm: { name: 'mock-llm', generateObject },
    media: {} as any,
    specialization: new RestaurantSpecialization(),
  };
}

describe('runDraftCycle', () => {
  it('returns the LLM-produced cycle', async () => {
    const deps = makeDeps();
    const out = await runDraftCycle(
      { period: 'week-of-2026-05-04', strategyFocus: ['Chef Specials'] },
      deps,
      { restaurantId: 'r1', restaurantName: 'Spice Route' },
    );
    expect(out.summary).toBe('A focused week on chef specials');
    expect(out.plannedPosts).toEqual([{ category: 'chef_special', count: 2 }]);
    expect(out.focus).toEqual(['Chef Specials']);
  });

  it('passes the specialization system fragment + sonnet model + telemetry tags to the LLM', async () => {
    const generateObject = vi.fn().mockResolvedValue({
      object: { summary: 's', plannedPosts: [{ category: 'a', count: 1 }], focus: ['x'] },
      usage: { inputTokens: 10, outputTokens: 10 },
      modelId: 'claude-sonnet-4-6',
    });
    const deps = makeDeps({ generateObject });
    await runDraftCycle(
      { period: 'w1' },
      deps,
      { restaurantId: 'r1', restaurantName: 'Spice Route' },
    );

    const arg = generateObject.mock.calls[0][0];
    expect(arg.model).toBe('sonnet');
    expect(arg.system.toLowerCase()).toContain('restaurant');
    expect(arg.prompt).toContain('Spice Route');
    expect(arg.telemetryAttributes).toMatchObject({
      operation: 'draftCycle',
      restaurantId: 'r1',
    });
  });

  it('writes a cost event via withCostTracking', async () => {
    const { insertCostEvent } = await import('@restropulse/db');
    (insertCostEvent as any).mockClear();
    const deps = makeDeps();
    await runDraftCycle({ period: 'w1' }, deps, { restaurantId: 'r1' });
    expect(insertCostEvent).toHaveBeenCalledTimes(1);
    const event = (insertCostEvent as any).mock.calls[0][0];
    expect(event.operation).toBe('draftCycle');
    expect(event.surface).toBe('llm');
    expect(event.step).toBe('cycle');
    expect(event.model).toBe('claude-sonnet-4-6');
    expect(event.restaurantId).toBe('r1');
  });

  it('throws ContentGenerationError on empty period', async () => {
    const deps = makeDeps();
    await expect(runDraftCycle({ period: '' }, deps, {})).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });
});
```

Verify it fails.

- [ ] **Step 2: Implement draft-cycle.ts**

```typescript
/**
 * runDraftCycle -- single-call cycle drafting.
 *
 * Composes:
 *   specialization.getSystemPromptFragment + getTaskPrompt('draftCycle', ...)
 *   -> LLM generateObject(model='sonnet', schema=CycleSchema)
 * Wrapped in withRetry(LLM) + withCostTracking so transient failures retry and
 * every call lands in the costEvents collection tagged with restaurantId/cycleId.
 */

import {
  ContentGenerationError,
  type DraftCycleInput,
  type GeneratedCycle,
  type GenerationContext,
} from '../../../types.js';
import { withRetry, RETRY_PROFILES } from '../with-retry.js';
import { withCostTracking } from '../with-cost-tracking.js';
import { CycleSchema } from '../llm/schemas.js';
import { computeCostUsd } from '../llm/pricing.js';
import { type PipelineDeps, toSpecializationContext } from './types.js';

export async function runDraftCycle(
  input: DraftCycleInput,
  deps: PipelineDeps,
  ctx?: GenerationContext,
): Promise<GeneratedCycle> {
  const period = input.period?.trim();
  if (!period) {
    throw new ContentGenerationError('INVALID_INPUT', 'draftCycle requires a non-empty period');
  }

  const specCtx = toSpecializationContext(ctx);
  const system = deps.specialization.getSystemPromptFragment(specCtx);
  const userPrompt = [
    deps.specialization.getTaskPrompt('draftCycle', input, specCtx),
    input.currentAffairsHints?.length
      ? `\nCurrent-affairs hints (use sparingly):\n- ${input.currentAffairsHints.join('\n- ')}`
      : '',
  ].filter(Boolean).join('\n');

  const telemetryAttributes: Record<string, string> = { operation: 'draftCycle' };
  if (ctx?.restaurantId) telemetryAttributes.restaurantId = ctx.restaurantId;
  if (ctx?.correlationId) telemetryAttributes.correlationId = ctx.correlationId;

  return withRetry(
    () => withCostTracking(
      async () => {
        const { object, usage, modelId } = await deps.llm.generateObject({
          model: 'sonnet',
          system,
          prompt: userPrompt,
          schema: CycleSchema,
          telemetryAttributes,
        });
        const costUsd = computeCostUsd(modelId, usage);
        return {
          result: {
            summary: object.summary,
            plannedPosts: object.plannedPosts,
            focus: object.focus,
            ...(object.rationale ? { rationale: object.rationale } : {}),
          },
          usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            costUsd,
          },
        };
      },
      {
        ...(ctx?.restaurantId ? { restaurantId: ctx.restaurantId } : {}),
        operation: 'draftCycle',
        surface: 'llm',
        step: 'cycle',
        model: 'claude-sonnet-4-6',  // best-known; refined inside withCostTracking
      },
    ),
    RETRY_PROFILES.LLM,
  );
}
```

Note the model label passed to withCostTracking is `'claude-sonnet-4-6'` (best-known constant). The actual modelId from the response is what gets used to compute the USD amount via computeCostUsd. The label on the cost event is informational; the real cost comes from the modelId-keyed pricing table. If we want exact label fidelity, the future refinement is to pipe the modelId from the response into the labels - left to phase 6's observability work to keep this PR focused.

- [ ] **Step 3: Verify**

`cd apps/content-engine && npx vitest run tests/unit/content-generator/backends/ai/pipeline/draft-cycle.test.ts`
Expected: PASS, 4 assertions green.

---

## Task 12: revise-cycle pipeline + tests

**Files:**
- Create: `apps/content-engine/src/services/content-generator/backends/ai/pipeline/revise-cycle.ts`
- Create: `apps/content-engine/tests/unit/content-generator/backends/ai/pipeline/revise-cycle.test.ts`

- [ ] **Step 1: Create the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  trackAIUsage: vi.fn(),
}));

vi.mock('@restropulse/db', () => ({
  insertCostEvent: vi.fn().mockResolvedValue({ id: 'ce_test' }),
}));

const { runReviseCycle } = await import(
  '../../../../../../src/services/content-generator/backends/ai/pipeline/revise-cycle.js'
);
const { RestaurantSpecialization } = await import(
  '../../../../../../src/services/content-generator/backends/ai/specialization/index.js'
);

beforeEach(() => {
  vi.clearAllMocks();
});

const baseInput = {
  existingCycle: {
    period: 'w1',
    summary: 'Existing summary',
    plannedPosts: [{ category: 'chef_special', count: 2 }],
    focus: ['Chef Specials'],
  },
  feedback: {
    areas: ['hashtags', 'cta'],
    note: 'More festive tone, add CTA in offer posts.',
  },
};

function makeDeps(overrides: Partial<{ generateObject: any }> = {}) {
  const generateObject = overrides.generateObject ?? vi.fn().mockResolvedValue({
    object: {
      summary: 'Revised summary with festive tone',
      plannedPosts: [{ category: 'chef_special', count: 2 }, { category: 'offer_promo', count: 1 }],
      focus: ['Chef Specials', 'Offers'],
    },
    usage: { inputTokens: 250, outputTokens: 100 },
    modelId: 'claude-sonnet-4-6',
  });
  return {
    llm: { name: 'mock-llm', generateObject },
    media: {} as any,
    specialization: new RestaurantSpecialization(),
  };
}

describe('runReviseCycle', () => {
  it('returns the revised cycle from the LLM', async () => {
    const out = await runReviseCycle(baseInput as any, makeDeps(), { restaurantId: 'r1' });
    expect(out.summary).toBe('Revised summary with festive tone');
    expect(out.plannedPosts).toHaveLength(2);
  });

  it('includes feedback note + areas in the user prompt', async () => {
    const generateObject = vi.fn().mockResolvedValue({
      object: { summary: 's', plannedPosts: [{ category: 'a', count: 1 }], focus: ['x'] },
      usage: { inputTokens: 10, outputTokens: 10 },
      modelId: 'claude-sonnet-4-6',
    });
    await runReviseCycle(baseInput as any, makeDeps({ generateObject }), {});
    const arg = generateObject.mock.calls[0][0];
    expect(arg.prompt).toContain('More festive tone');
    expect(arg.prompt).toMatch(/hashtags|cta/);
    expect(arg.prompt).toContain('Existing summary');
  });

  it('writes cost event with operation=reviseCycle', async () => {
    const { insertCostEvent } = await import('@restropulse/db');
    (insertCostEvent as any).mockClear();
    await runReviseCycle(baseInput as any, makeDeps(), { restaurantId: 'r1' });
    const event = (insertCostEvent as any).mock.calls[0][0];
    expect(event.operation).toBe('reviseCycle');
  });
});
```

Verify it fails.

- [ ] **Step 2: Implement revise-cycle.ts**

```typescript
/**
 * runReviseCycle -- single-call cycle revision.
 *
 * Same shape as runDraftCycle but with the existing cycle + feedback laid
 * into the user prompt. Sonnet for reasoning. The specialization decides how
 * to phrase "address the feedback while preserving what worked."
 */

import {
  ContentGenerationError,
  type GeneratedCycle,
  type GenerationContext,
  type ReviseCycleInput,
} from '../../../types.js';
import { withRetry, RETRY_PROFILES } from '../with-retry.js';
import { withCostTracking } from '../with-cost-tracking.js';
import { CycleSchema } from '../llm/schemas.js';
import { computeCostUsd } from '../llm/pricing.js';
import { type PipelineDeps, toSpecializationContext } from './types.js';

export async function runReviseCycle(
  input: ReviseCycleInput,
  deps: PipelineDeps,
  ctx?: GenerationContext,
): Promise<GeneratedCycle> {
  if (!input.existingCycle) {
    throw new ContentGenerationError('INVALID_INPUT', 'reviseCycle requires existingCycle');
  }
  if (!input.feedback) {
    throw new ContentGenerationError('INVALID_INPUT', 'reviseCycle requires feedback');
  }

  const specCtx = toSpecializationContext(ctx);
  const system = deps.specialization.getSystemPromptFragment(specCtx);
  const taskPrompt = deps.specialization.getTaskPrompt('reviseCycle', input, specCtx);

  const userPrompt = [
    taskPrompt,
    '',
    'Existing cycle:',
    `Period: ${input.existingCycle.period}`,
    `Summary: ${input.existingCycle.summary}`,
    `Focus areas: ${input.existingCycle.focus.join(', ')}`,
    `Planned posts: ${JSON.stringify(input.existingCycle.plannedPosts)}`,
    '',
    'Feedback to address:',
    `Areas: ${input.feedback.areas.join(', ')}`,
    `Note: ${input.feedback.note}`,
    input.feedback.resolution ? `Resolution: ${input.feedback.resolution}` : '',
    input.currentAffairsHints?.length
      ? `\nCurrent-affairs hints:\n- ${input.currentAffairsHints.join('\n- ')}`
      : '',
  ].filter(Boolean).join('\n');

  const telemetryAttributes: Record<string, string> = { operation: 'reviseCycle' };
  if (ctx?.restaurantId) telemetryAttributes.restaurantId = ctx.restaurantId;
  if (ctx?.correlationId) telemetryAttributes.correlationId = ctx.correlationId;

  return withRetry(
    () => withCostTracking(
      async () => {
        const { object, usage, modelId } = await deps.llm.generateObject({
          model: 'sonnet',
          system,
          prompt: userPrompt,
          schema: CycleSchema,
          telemetryAttributes,
        });
        const costUsd = computeCostUsd(modelId, usage);
        return {
          result: {
            summary: object.summary,
            plannedPosts: object.plannedPosts,
            focus: object.focus,
            ...(object.rationale ? { rationale: object.rationale } : {}),
          },
          usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            costUsd,
          },
        };
      },
      {
        ...(ctx?.restaurantId ? { restaurantId: ctx.restaurantId } : {}),
        operation: 'reviseCycle',
        surface: 'llm',
        step: 'cycle',
        model: 'claude-sonnet-4-6',
      },
    ),
    RETRY_PROFILES.LLM,
  );
}
```

- [ ] **Step 3: Verify**

PASS, 3 assertions green.

---

## Task 13: Wire AIContentGenerator constructor + draftCycle + reviseCycle

**Files:**
- Modify: `apps/content-engine/src/services/content-generator/backends/ai/ai-content-generator.ts`
- Modify: `apps/content-engine/tests/unit/content-generator/backends/ai/ai-content-generator.test.ts`

- [ ] **Step 1: Update the test for the new constructor shape**

The phase 1 test asserts the constructor takes `{ specialization }`. Update it to assert `{ specialization, llm, media }` and that `draftCycle` + `reviseCycle` succeed (no longer BACKEND_UNAVAILABLE). Keep `generatePost` + `revisePost` asserting BACKEND_UNAVAILABLE for now (they land in Checkpoint C).

Replace the test file content with:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  trackAIUsage: vi.fn(),
}));

vi.mock('@restropulse/db', () => ({
  insertCostEvent: vi.fn().mockResolvedValue({ id: 'ce_test' }),
}));

const { AIContentGenerator } = await import(
  '../../../../src/services/content-generator/backends/ai/ai-content-generator.js'
);
const { RestaurantSpecialization } = await import(
  '../../../../src/services/content-generator/backends/ai/specialization/index.js'
);
const { ContentGenerationError } = await import(
  '../../../../src/services/content-generator/types.js'
);

const cycleObject = {
  summary: 'A week of food storytelling',
  plannedPosts: [{ category: 'chef_special', count: 2 }],
  focus: ['Chef Specials'],
};

function makeGen() {
  const generateObject = vi.fn().mockResolvedValue({
    object: cycleObject,
    usage: { inputTokens: 100, outputTokens: 50 },
    modelId: 'claude-sonnet-4-6',
  });
  return {
    gen: new AIContentGenerator({
      specialization: new RestaurantSpecialization(),
      llm: { name: 'mock', generateObject },
      media: {
        name: 'mock-media',
        generateImage: vi.fn(),
        generateVideo: vi.fn(),
        pollJob: vi.fn(),
      },
    }),
    generateObject,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AIContentGenerator (phase 2)', () => {
  it('exposes name "ai" and the configured specialization', () => {
    const { gen } = makeGen();
    expect(gen.name).toBe('ai');
    expect(gen.specialization.domain).toBe('restaurant');
  });

  it('throws when constructed without specialization, llm, or media', () => {
    expect(() => new AIContentGenerator({} as any)).toThrow(ContentGenerationError);
    expect(() => new AIContentGenerator({ specialization: new RestaurantSpecialization() } as any)).toThrow(ContentGenerationError);
  });

  it('draftCycle returns the cycle from the LLM', async () => {
    const { gen } = makeGen();
    const out = await gen.draftCycle({ period: 'w1' });
    expect(out.summary).toBe(cycleObject.summary);
  });

  it('reviseCycle returns the cycle from the LLM', async () => {
    const { gen } = makeGen();
    const out = await gen.reviseCycle({
      existingCycle: { period: 'w1', summary: 's', plannedPosts: [{ category: 'a', count: 1 }], focus: ['x'] },
      feedback: { areas: ['cta'], note: 'add CTA' },
    });
    expect(out.summary).toBe(cycleObject.summary);
  });

  it('generatePost still throws BACKEND_UNAVAILABLE (phase 2 not yet wired)', async () => {
    const { gen } = makeGen();
    await expect(
      gen.generatePost({ concept: 'x', type: 'IMAGE', platforms: ['INSTAGRAM'] }),
    ).rejects.toMatchObject({ code: 'BACKEND_UNAVAILABLE' });
  });

  it('revisePost still throws BACKEND_UNAVAILABLE (phase 2 not yet wired)', async () => {
    const { gen } = makeGen();
    await expect(
      gen.revisePost({
        existingPost: { type: 'IMAGE', platforms: ['INSTAGRAM'], caption: 'c' },
        feedback: { tags: [], details: {}, note: '' },
      }),
    ).rejects.toMatchObject({ code: 'BACKEND_UNAVAILABLE' });
  });

  it('healthCheck reports ok=true when llm is wired', async () => {
    const { gen } = makeGen();
    const r = await gen.healthCheck!();
    expect(r.ok).toBe(true);
  });
});
```

Verify it fails (constructor signature mismatch is expected).

- [ ] **Step 2: Update AIContentGenerator**

Replace `apps/content-engine/src/services/content-generator/backends/ai/ai-content-generator.ts` with:

```typescript
/**
 * AIContentGenerator -- phase 2 implementation for cycle ops.
 *
 * Holds three injected collaborators (specialization, llm, media) so tests
 * substitute mocks for any of them without monkey-patching modules.
 *
 * draftCycle + reviseCycle delegate to pipeline/draft-cycle.ts +
 * pipeline/revise-cycle.ts. generatePost + revisePost still throw
 * BACKEND_UNAVAILABLE -- they land in Checkpoint C.
 */

import { createLogger } from '@restropulse/telemetry/server';
import { BaseContentGenerator } from '../../base-generator.js';
import {
  ContentGenerationError,
  type DraftCycleInput,
  type GeneratedCycle,
  type GeneratedPost,
  type GenerationContext,
  type GeneratePostInput,
  type ReviseCycleInput,
  type RevisePostInput,
} from '../../types.js';
import type { IDomainSpecialization } from './specialization/index.js';
import type { ILLMProvider } from './llm/types.js';
import type { IMediaGenerator } from './media/types.js';
import { runDraftCycle } from './pipeline/draft-cycle.js';
import { runReviseCycle } from './pipeline/revise-cycle.js';
import type { PipelineDeps } from './pipeline/types.js';

const log = createLogger('ai-content-generator');

const POST_OPS_NOT_WIRED_DETAIL = 'AI generator post operations land in phase 2 Checkpoint C.';

export interface AIContentGeneratorOptions {
  specialization: IDomainSpecialization;
  llm: ILLMProvider;
  media: IMediaGenerator;
}

export class AIContentGenerator extends BaseContentGenerator {
  readonly name = 'ai';
  readonly specialization: IDomainSpecialization;
  private readonly deps: PipelineDeps;

  constructor(options: AIContentGeneratorOptions) {
    super();
    if (!options || !options.specialization || !options.llm || !options.media) {
      throw new ContentGenerationError(
        'INVALID_INPUT',
        'AIContentGenerator requires { specialization, llm, media } in its constructor options.',
      );
    }
    this.specialization = options.specialization;
    this.deps = {
      specialization: options.specialization,
      llm: options.llm,
      media: options.media,
    };
    log.info(
      { domain: this.specialization.domain, version: this.specialization.version, llm: options.llm.name, media: options.media.name },
      'AIContentGenerator instantiated',
    );
  }

  async draftCycle(input: DraftCycleInput, ctx?: GenerationContext): Promise<GeneratedCycle> {
    return runDraftCycle(input, this.deps, ctx);
  }

  async reviseCycle(input: ReviseCycleInput, ctx?: GenerationContext): Promise<GeneratedCycle> {
    return runReviseCycle(input, this.deps, ctx);
  }

  async generatePostContent(_input: GeneratePostInput, _ctx?: GenerationContext): Promise<GeneratedPost> {
    throw new ContentGenerationError('BACKEND_UNAVAILABLE', POST_OPS_NOT_WIRED_DETAIL);
  }

  async revisePostContent(_input: RevisePostInput, _ctx?: GenerationContext): Promise<GeneratedPost> {
    throw new ContentGenerationError('BACKEND_UNAVAILABLE', POST_OPS_NOT_WIRED_DETAIL);
  }

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: true, detail: `llm=${this.deps.llm.name} media=${this.deps.media.name}` };
  }
}
```

- [ ] **Step 3: Verify**

`cd apps/content-engine && npx vitest run tests/unit/content-generator/backends/ai/ai-content-generator.test.ts`
Expected: PASS, 7 assertions green.

---

## Task 14: Update factory.ts to construct llm + media defaults

**Files:**
- Modify: `apps/content-engine/src/services/content-generator/factory.ts`
- Modify: `apps/content-engine/tests/unit/content-generator/factory.test.ts`

The phase 1 factory test (`returns the AI backend when "ai"`) just calls `createContentGenerator('ai')` and asserts `name === 'ai'`. After the constructor change, that call now requires an `apiKey`. The factory must read `ANTHROPIC_API_KEY` from `process.env`. Update both the factory and the test.

- [ ] **Step 1: Update factory.test.ts**

```typescript
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  trackAIUsage: vi.fn(),
}));

const ORIGINAL_KEY = process.env['ANTHROPIC_API_KEY'];

beforeAll(() => {
  process.env['ASSET_SERVER_BASE_URL'] = 'http://localhost:3002';
  process.env['ASSET_SERVER_PORT'] = '3002';
  process.env['ANTHROPIC_API_KEY'] = 'sk-test-fixture';
});

afterAll(() => {
  if (ORIGINAL_KEY === undefined) delete process.env['ANTHROPIC_API_KEY'];
  else process.env['ANTHROPIC_API_KEY'] = ORIGINAL_KEY;
});

const { createContentGenerator } = await import('../../../src/services/content-generator/factory.js');

describe('createContentGenerator', () => {
  it('returns the placeholder backend by default ("placeholder")', () => {
    const g = createContentGenerator('placeholder');
    expect(g.name).toBe('placeholder');
  });

  it('returns the AI backend when "ai" and ANTHROPIC_API_KEY is present', () => {
    const g = createContentGenerator('ai');
    expect(g.name).toBe('ai');
  });

  it('throws on an unknown backend string', () => {
    expect(() => createContentGenerator('chatgpt' as any)).toThrow(/unknown content generator backend/i);
  });

  it('throws a clear error when ai backend is selected but ANTHROPIC_API_KEY is missing', () => {
    const k = process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_API_KEY'];
    try {
      expect(() => createContentGenerator('ai')).toThrow(/ANTHROPIC_API_KEY/);
    } finally {
      if (k !== undefined) process.env['ANTHROPIC_API_KEY'] = k;
    }
  });
});
```

- [ ] **Step 2: Update factory.ts**

```typescript
/**
 * createContentGenerator -- selects the registered IContentGenerator backend
 * based on a flag string. Wired into worker.ts via the CONTENT_GENERATOR_BACKEND
 * env var. Default is 'placeholder' so existing deployments keep their current
 * behavior unless the flag is explicitly flipped.
 *
 * The 'ai' branch reads ANTHROPIC_API_KEY from process.env; missing key fails
 * loudly here at boot rather than silently falling back to the placeholder.
 *
 * Adding a new backend: extend the union, add a case, wire its dependencies
 * here. The worker stays dumb about per-backend wiring.
 */

import type { IContentGenerator } from './types.js';
import { PlaceholderContentGenerator } from './backends/placeholder/index.js';
import { AIContentGenerator } from './backends/ai/ai-content-generator.js';
import { RestaurantSpecialization } from './backends/ai/specialization/index.js';
import { AnthropicLLMProvider } from './backends/ai/llm/anthropic-provider.js';
import { PlaceholderMediaGenerator } from './backends/ai/media/placeholder-media-generator.js';

export type ContentGeneratorBackend = 'placeholder' | 'ai';

export function createContentGenerator(backend: ContentGeneratorBackend): IContentGenerator {
  switch (backend) {
    case 'placeholder':
      return new PlaceholderContentGenerator();
    case 'ai': {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error(
          'ANTHROPIC_API_KEY is required when CONTENT_GENERATOR_BACKEND=ai. Set it in apps/content-engine/.env or the deployment environment.',
        );
      }
      return new AIContentGenerator({
        specialization: new RestaurantSpecialization(),
        llm: new AnthropicLLMProvider({ apiKey }),
        media: new PlaceholderMediaGenerator(),
      });
    }
    default: {
      const exhaustive: never = backend;
      throw new Error(`Unknown content generator backend: ${String(exhaustive)}`);
    }
  }
}
```

- [ ] **Step 3: Verify**

`cd apps/content-engine && npx vitest run tests/unit/content-generator/factory.test.ts`
Expected: PASS, 4 assertions green.

---

## Task 15: Checkpoint B wrap - run all tests + STOP for user review

- [ ] **Step 1: Run pipeline tests**

`cd apps/content-engine && npx vitest run tests/unit/content-generator/backends/ai/pipeline tests/unit/content-generator/backends/ai/ai-content-generator.test.ts tests/unit/content-generator/factory.test.ts`
Expected: all green.

- [ ] **Step 2: Run the full content-engine suite**

`cd apps/content-engine && npx vitest run`
Expected: 32+ test files (30 from Checkpoint A + 2 new pipeline tests + updated ai-content-generator + updated factory tests), all assertions pass.

- [ ] **Step 3: Type-check**

`rtk npm run type-check --workspace=@restropulse/content-engine` -> exit 0.

- [ ] **Step 4: Show user, request approval to proceed to Checkpoint C**

`rtk git status`. **STOP. Tell the user: "Checkpoint B complete - draftCycle + reviseCycle wired through real LLM (mocked in tests). Approve continuing to Checkpoint C (post operations + final commit)?" Wait for explicit approval.**

---

# CHECKPOINT C - Post operations + final verify + commit

## Task 16: generate-post pipeline + tests

**Files:**
- Create: `apps/content-engine/src/services/content-generator/backends/ai/pipeline/generate-post.ts`
- Create: `apps/content-engine/tests/unit/content-generator/backends/ai/pipeline/generate-post.test.ts`

- [ ] **Step 1: Create the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  trackAIUsage: vi.fn(),
}));

vi.mock('@restropulse/db', () => ({
  insertCostEvent: vi.fn().mockResolvedValue({ id: 'ce_test' }),
}));

const { runGeneratePost } = await import(
  '../../../../../../src/services/content-generator/backends/ai/pipeline/generate-post.js'
);
const { RestaurantSpecialization } = await import(
  '../../../../../../src/services/content-generator/backends/ai/specialization/index.js'
);

beforeEach(() => {
  vi.clearAllMocks();
});

function makeDeps(captionOverrides: Partial<{ caption: string; suggestedHashtags: string[] }> = {}) {
  const generateObject = vi.fn().mockResolvedValue({
    object: {
      caption: captionOverrides.caption ?? 'Soft, flaky, ghee-laced parotta straight off the tawa.',
      suggestedHashtags: captionOverrides.suggestedHashtags ?? ['#parotta', '#ghee'],
      archetype: 'CHEFS_PICK',
    },
    usage: { inputTokens: 80, outputTokens: 40 },
    modelId: 'claude-haiku-4-5-20251001',
  });
  const generateImage = vi.fn().mockResolvedValue({
    jobId: 'job_img_1',
    status: 'COMPLETED',
    mediaUrl: 'http://localhost:3002/images/x.jpg',
    thumbnail: 'http://localhost:3002/images/x.jpg',
    metadata: { widthPx: 1080, heightPx: 1080 },
  });
  const generateVideo = vi.fn().mockResolvedValue({
    jobId: 'job_vid_1',
    status: 'COMPLETED',
    mediaUrl: 'http://localhost:3002/videos/x.mp4',
    thumbnail: 'http://localhost:3002/videos/x.jpg',
    metadata: { widthPx: 1080, heightPx: 1920, durationSeconds: 18 },
  });
  return {
    llm: { name: 'mock-llm', generateObject },
    media: { name: 'mock-media', generateImage, generateVideo, pollJob: vi.fn() },
    specialization: new RestaurantSpecialization(),
  };
}

describe('runGeneratePost', () => {
  it('produces caption + thumbnail for an IMAGE post', async () => {
    const deps = makeDeps();
    const out = await runGeneratePost(
      { concept: 'parotta', type: 'IMAGE', platforms: ['INSTAGRAM'] },
      deps,
      { restaurantId: 'r1', restaurantName: 'Spice Route', locale: 'en-IN' },
    );
    expect(out.caption).toContain('parotta');
    expect(out.thumbnail).toMatch(/^http:\/\//);
    expect(out.videoUrl).toBeUndefined();
  });

  it('routes REEL post type through generateVideo', async () => {
    const deps = makeDeps();
    await runGeneratePost(
      { concept: 'kitchen reel', type: 'REEL', platforms: ['INSTAGRAM'] },
      deps,
      {},
    );
    expect((deps.media.generateVideo as any)).toHaveBeenCalledTimes(1);
    expect((deps.media.generateImage as any)).not.toHaveBeenCalled();
  });

  it('routes CAROUSEL through generateImage with postType=CAROUSEL', async () => {
    const deps = makeDeps();
    (deps.media.generateImage as any).mockResolvedValueOnce({
      jobId: 'j_c1',
      status: 'COMPLETED',
      mediaUrls: ['http://localhost/a.jpg', 'http://localhost/b.jpg', 'http://localhost/c.jpg'],
      thumbnail: 'http://localhost/a.jpg',
      metadata: { widthPx: 1080, heightPx: 1080 },
    });
    const out = await runGeneratePost(
      { concept: 'menu', type: 'CAROUSEL', platforms: ['INSTAGRAM'] },
      deps,
      {},
    );
    expect((deps.media.generateImage as any).mock.calls[0][0].postType).toBe('CAROUSEL');
    expect(out.mediaUrls).toHaveLength(3);
    expect(out.thumbnail).toBe(out.mediaUrls![0]);
  });

  it('caption ends with hashtags merged from LLM + specialization, deduped, denylist applied', async () => {
    const deps = makeDeps({
      suggestedHashtags: ['#parotta', '#like4like', '#ghee'],  // like4like is on the denylist
    });
    const out = await runGeneratePost(
      { concept: 'parotta', type: 'IMAGE', platforms: ['INSTAGRAM'] },
      deps,
      { restaurantId: 'r1', locale: 'en-IN' },
    );
    expect(out.caption).not.toMatch(/like4like/i);
    // At least one hashtag from the model input survives:
    expect(out.caption).toMatch(/#parotta|#ghee/);
  });

  it('writes two cost events: one llm, one image', async () => {
    const { insertCostEvent } = await import('@restropulse/db');
    (insertCostEvent as any).mockClear();
    const deps = makeDeps();
    await runGeneratePost({ concept: 'x', type: 'IMAGE', platforms: ['INSTAGRAM'] }, deps, { restaurantId: 'r1' });
    expect(insertCostEvent).toHaveBeenCalledTimes(2);
    const surfaces = (insertCostEvent as any).mock.calls.map((c: any) => c[0].surface);
    expect(surfaces).toContain('llm');
    expect(surfaces).toContain('image');
  });

  it('throws ContentGenerationError on missing concept and type', async () => {
    const deps = makeDeps();
    await expect(
      runGeneratePost({ concept: '', type: 'IMAGE', platforms: ['INSTAGRAM'] }, deps, {}),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});
```

Verify it fails.

- [ ] **Step 2: Implement generate-post.ts**

```typescript
/**
 * runGeneratePost -- per-post caption + media orchestration.
 *
 * 1. Pick the model family (Haiku for captions per ADR §4.6).
 * 2. Build system + task prompts via the specialization.
 * 3. Call LLM(generateObject, schema=PostCaptionSchema) wrapped in withRetry +
 *    withCostTracking.
 * 4. In parallel-ish, request media via IMediaGenerator (image vs video chosen
 *    from postType). Image jobs in phase 2 resolve immediately (placeholder
 *    media generator); phase 5 introduces async video.
 * 5. Merge LLM-suggested hashtags with specialization.selectHashtags, apply
 *    denylist + count cap, append to caption.
 * 6. Validate the assembled post via specialization.validateOutput. Errors
 *    bubble; warnings are logged.
 */

import { createLogger } from '@restropulse/telemetry/server';
import {
  ContentGenerationError,
  type GeneratedPost,
  type GenerationContext,
  type GeneratePostInput,
  type MediaMetadata,
} from '../../../types.js';
import type { Platform, PostType } from '@restropulse/shared';
import { withRetry, RETRY_PROFILES } from '../with-retry.js';
import { withCostTracking } from '../with-cost-tracking.js';
import { PostCaptionSchema, type PostCaptionSchemaType } from '../llm/schemas.js';
import { computeCostUsd } from '../llm/pricing.js';
import { type PipelineDeps, toSpecializationContext } from './types.js';
import type { MediaGenJob } from '../media/types.js';

const log = createLogger('ai-generate-post');

const HASHTAG_HARD_CAP = 8;

function isVideoType(t: PostType): boolean {
  return t === 'REEL' || t === 'VIDEO';
}

function isStoryVideoCandidate(t: PostType, _platforms: Platform[]): boolean {
  // Phase 2 keeps STORY on the image path (matches placeholder behavior).
  // FalAIMediaGenerator in phase 4 may revisit.
  return false;
}

function mergeHashtags(
  caption: string,
  suggested: string[] | undefined,
  fromSpec: string[],
): string {
  const present = new Set(
    (caption.match(/#[\w-]+/g) ?? []).map((t) => t.toLowerCase()),
  );
  const candidates: string[] = [];
  for (const tag of [...(suggested ?? []), ...fromSpec]) {
    const norm = tag.startsWith('#') ? tag : `#${tag}`;
    const lower = norm.toLowerCase();
    if (present.has(lower)) continue;
    if (candidates.some((c) => c.toLowerCase() === lower)) continue;
    candidates.push(lower);
    if (candidates.length >= HASHTAG_HARD_CAP) break;
  }
  if (candidates.length === 0) return caption;
  const sep = caption.endsWith('\n\n') ? '' : caption.endsWith('\n') ? '\n' : '\n\n';
  return `${caption}${sep}${candidates.join(' ')}`;
}

function metadataFromMedia(job: MediaGenJob): MediaMetadata | undefined {
  if (!job.metadata) return undefined;
  const m: MediaMetadata = {};
  if (job.metadata.widthPx !== undefined) m.widthPx = job.metadata.widthPx;
  if (job.metadata.heightPx !== undefined) m.heightPx = job.metadata.heightPx;
  if (job.metadata.durationSeconds !== undefined) m.durationSeconds = job.metadata.durationSeconds;
  return Object.keys(m).length ? m : undefined;
}

async function runMediaForPost(
  input: GeneratePostInput,
  deps: PipelineDeps,
  ctx?: GenerationContext,
): Promise<MediaGenJob> {
  const labels = {
    ...(ctx?.restaurantId ? { restaurantId: ctx.restaurantId } : {}),
    operation: 'generatePost' as const,
    surface: (isVideoType(input.type) ? 'video' : 'image') as 'video' | 'image',
    step: isVideoType(input.type) ? 'video' : 'image',
    model: 'placeholder-media',
  };

  return withRetry(
    () => withCostTracking(
      async () => {
        const job = isVideoType(input.type) || isStoryVideoCandidate(input.type, input.platforms)
          ? await deps.media.generateVideo({
              postType: input.type as 'REEL' | 'VIDEO' | 'STORY',
              platforms: input.platforms,
              concept: input.concept,
              themes: input.themes,
            })
          : await deps.media.generateImage({
              postType: input.type,
              platforms: input.platforms,
              concept: input.concept,
              themes: input.themes,
            });

        if (job.status === 'FAILED') {
          throw new ContentGenerationError('UNKNOWN', `Media generation failed: ${job.error ?? 'unknown'}`);
        }

        return {
          result: job,
          // Placeholder media has no token cost; phase 4 fal.ai impl reports real per-call USD.
          usage: { costUsd: 0 },
        };
      },
      labels,
    ),
    // Image submission profile is more relaxed than LLM (see ADR §4.3).
    isVideoType(input.type) ? RETRY_PROFILES.VIDEO_SUBMIT : RETRY_PROFILES.IMAGE_SUBMIT,
  );
}

async function runCaptionForPost(
  input: GeneratePostInput,
  deps: PipelineDeps,
  ctx?: GenerationContext,
): Promise<PostCaptionSchemaType> {
  const specCtx = toSpecializationContext(ctx);
  const system = deps.specialization.getSystemPromptFragment(specCtx);
  const userPrompt = [
    deps.specialization.getTaskPrompt('generatePost', input, specCtx),
    input.themes?.length ? `Themes: ${input.themes.join(', ')}` : '',
    input.cycleId ? `Cycle id: ${input.cycleId}` : '',
    input.currentAffairsHints?.length
      ? `\nCurrent-affairs hints (use sparingly):\n- ${input.currentAffairsHints.join('\n- ')}`
      : '',
    `\nReturn just the caption (no hashtags inline) plus 2-5 suggestedHashtags as separate field.`,
  ].filter(Boolean).join('\n');

  const telemetryAttributes: Record<string, string> = { operation: 'generatePost', step: 'caption' };
  if (ctx?.restaurantId) telemetryAttributes.restaurantId = ctx.restaurantId;
  if (input.cycleId) telemetryAttributes.cycleId = input.cycleId;
  if (ctx?.correlationId) telemetryAttributes.correlationId = ctx.correlationId;

  return withRetry(
    () => withCostTracking(
      async () => {
        const { object, usage, modelId } = await deps.llm.generateObject({
          model: 'haiku',
          system,
          prompt: userPrompt,
          schema: PostCaptionSchema,
          telemetryAttributes,
        });
        const costUsd = computeCostUsd(modelId, usage);
        return {
          result: object,
          usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            costUsd,
          },
        };
      },
      {
        ...(ctx?.restaurantId ? { restaurantId: ctx.restaurantId } : {}),
        ...(input.cycleId ? { cycleId: input.cycleId } : {}),
        operation: 'generatePost',
        surface: 'llm',
        step: 'caption',
        model: 'claude-haiku-4-5-20251001',
      },
    ),
    RETRY_PROFILES.LLM,
  );
}

export async function runGeneratePost(
  input: GeneratePostInput,
  deps: PipelineDeps,
  ctx?: GenerationContext,
): Promise<GeneratedPost> {
  if (!input.concept || !input.concept.trim()) {
    throw new ContentGenerationError('INVALID_INPUT', 'generatePost requires a non-empty concept');
  }
  if (!input.type) {
    throw new ContentGenerationError('INVALID_INPUT', 'generatePost requires a post type');
  }
  if (!input.platforms || input.platforms.length === 0) {
    throw new ContentGenerationError('INVALID_INPUT', 'generatePost requires at least one platform');
  }

  // Run caption + media concurrently. They are independent; media latency
  // dominates in phase 4-5, so parallelism is non-trivial then.
  const [captionObj, mediaJob] = await Promise.all([
    runCaptionForPost(input, deps, ctx),
    runMediaForPost(input, deps, ctx),
  ]);

  const specCtx = toSpecializationContext(ctx);
  const specHashtags = deps.specialization.selectHashtags(captionObj.caption, specCtx);
  const fullCaption = mergeHashtags(captionObj.caption, captionObj.suggestedHashtags, specHashtags);

  const post: GeneratedPost = {
    caption: fullCaption,
    thumbnail: mediaJob.thumbnail ?? mediaJob.mediaUrl ?? '',
  };
  if (mediaJob.mediaUrls) post.mediaUrls = mediaJob.mediaUrls;
  if (isVideoType(input.type) && mediaJob.mediaUrl) post.videoUrl = mediaJob.mediaUrl;
  const metadata = metadataFromMedia(mediaJob);
  if (metadata) post.mediaMetadata = metadata;

  const validation = deps.specialization.validateOutput(post, specCtx);
  if (!validation.ok) {
    const errorIssue = validation.issues.find((i) => i.severity === 'error');
    throw new ContentGenerationError(
      'INVALID_INPUT',
      `Generated post failed specialization validation: ${errorIssue?.message ?? 'unknown'}`,
    );
  }
  if (validation.issues.length > 0) {
    log.warn({ issues: validation.issues, postType: input.type }, 'Generated post has warnings');
  }

  return post;
}
```

- [ ] **Step 3: Verify**

PASS, 6 assertions green.

---

## Task 17: revise-post pipeline + tests

**Files:**
- Create: `apps/content-engine/src/services/content-generator/backends/ai/pipeline/revise-post.ts`
- Create: `apps/content-engine/tests/unit/content-generator/backends/ai/pipeline/revise-post.test.ts`

- [ ] **Step 1: Create the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  trackAIUsage: vi.fn(),
}));

vi.mock('@restropulse/db', () => ({
  insertCostEvent: vi.fn().mockResolvedValue({ id: 'ce_test' }),
}));

const { runRevisePost } = await import(
  '../../../../../../src/services/content-generator/backends/ai/pipeline/revise-post.js'
);
const { RestaurantSpecialization } = await import(
  '../../../../../../src/services/content-generator/backends/ai/specialization/index.js'
);

beforeEach(() => {
  vi.clearAllMocks();
});

const baseInput = {
  existingPost: {
    type: 'IMAGE' as const,
    platforms: ['INSTAGRAM' as const],
    caption: 'Old caption with #fewhashtags',
    thumbnail: 'http://localhost/old.jpg',
  },
  feedback: {
    tags: ['caption', 'voice'],
    details: { voice: 'too formal' },
    note: 'Make it warmer and more inviting.',
  },
};

function makeDeps() {
  const generateObject = vi.fn().mockResolvedValue({
    object: {
      caption: 'A warmer, friendlier hello from our kitchen.',
      suggestedHashtags: ['#warm', '#kitchen'],
    },
    usage: { inputTokens: 100, outputTokens: 60 },
    modelId: 'claude-haiku-4-5-20251001',
  });
  const generateImage = vi.fn().mockResolvedValue({
    jobId: 'jr_img_1',
    status: 'COMPLETED',
    mediaUrl: 'http://localhost:3002/images/new.jpg',
    thumbnail: 'http://localhost:3002/images/new.jpg',
    metadata: { widthPx: 1080, heightPx: 1080 },
  });
  return {
    llm: { name: 'mock-llm', generateObject },
    media: { name: 'mock-media', generateImage, generateVideo: vi.fn(), pollJob: vi.fn() },
    specialization: new RestaurantSpecialization(),
  };
}

describe('runRevisePost', () => {
  it('returns a revised caption (LLM output) preserving the existing thumbnail when feedback does NOT request media changes', async () => {
    const deps = makeDeps();
    const out = await runRevisePost(baseInput, deps, { restaurantId: 'r1' });
    expect(out.caption).toContain('warmer');
    expect(out.thumbnail).toBe('http://localhost/old.jpg');  // existing thumbnail preserved
    expect((deps.media.generateImage as any)).not.toHaveBeenCalled();
  });

  it('regenerates media when feedback.tags includes "media" or "image"', async () => {
    const deps = makeDeps();
    const inputWithMediaFeedback = {
      ...baseInput,
      feedback: { tags: ['image'], details: {}, note: 'Try a different shot' },
    };
    const out = await runRevisePost(inputWithMediaFeedback, deps, {});
    expect((deps.media.generateImage as any)).toHaveBeenCalledTimes(1);
    expect(out.thumbnail).toBe('http://localhost:3002/images/new.jpg');
  });

  it('passes the existing caption + feedback into the LLM prompt', async () => {
    const deps = makeDeps();
    await runRevisePost(baseInput, deps, {});
    const arg = (deps.llm.generateObject as any).mock.calls[0][0];
    expect(arg.prompt).toContain('Old caption with #fewhashtags');
    expect(arg.prompt).toContain('too formal');
    expect(arg.prompt).toContain('Make it warmer and more inviting');
  });

  it('writes a cost event with operation=revisePost', async () => {
    const { insertCostEvent } = await import('@restropulse/db');
    (insertCostEvent as any).mockClear();
    const deps = makeDeps();
    await runRevisePost(baseInput, deps, { restaurantId: 'r1' });
    const llmEvent = (insertCostEvent as any).mock.calls.find((c: any) => c[0].surface === 'llm');
    expect(llmEvent).toBeDefined();
    expect(llmEvent[0].operation).toBe('revisePost');
  });
});
```

Verify it fails.

- [ ] **Step 2: Implement revise-post.ts**

```typescript
/**
 * runRevisePost -- single-call post revision.
 *
 * Caption is always re-LLM'd. Media is regenerated only when feedback.tags
 * mention 'media' or 'image' (or 'video') -- otherwise the caller's existing
 * thumbnail / videoUrl carry over to the result.
 *
 * Same model + retry + cost-tracking pattern as runGeneratePost.
 */

import { createLogger } from '@restropulse/telemetry/server';
import {
  ContentGenerationError,
  type GeneratedPost,
  type GenerationContext,
  type RevisePostInput,
  type MediaMetadata,
} from '../../../types.js';
import type { Platform, PostType } from '@restropulse/shared';
import { withRetry, RETRY_PROFILES } from '../with-retry.js';
import { withCostTracking } from '../with-cost-tracking.js';
import { PostCaptionSchema } from '../llm/schemas.js';
import { computeCostUsd } from '../llm/pricing.js';
import { type PipelineDeps, toSpecializationContext } from './types.js';
import type { MediaGenJob } from '../media/types.js';

const log = createLogger('ai-revise-post');

const MEDIA_FEEDBACK_TAGS = new Set(['media', 'image', 'video', 'thumbnail']);
const HASHTAG_HARD_CAP = 8;

function feedbackRequestsMedia(tags: string[]): boolean {
  return tags.some((t) => MEDIA_FEEDBACK_TAGS.has(t.toLowerCase()));
}

function isVideoType(t: PostType): boolean {
  return t === 'REEL' || t === 'VIDEO';
}

function mergeHashtags(caption: string, suggested: string[] | undefined, fromSpec: string[]): string {
  const present = new Set((caption.match(/#[\w-]+/g) ?? []).map((t) => t.toLowerCase()));
  const candidates: string[] = [];
  for (const tag of [...(suggested ?? []), ...fromSpec]) {
    const norm = tag.startsWith('#') ? tag : `#${tag}`;
    const lower = norm.toLowerCase();
    if (present.has(lower)) continue;
    if (candidates.some((c) => c.toLowerCase() === lower)) continue;
    candidates.push(lower);
    if (candidates.length >= HASHTAG_HARD_CAP) break;
  }
  if (candidates.length === 0) return caption;
  const sep = caption.endsWith('\n\n') ? '' : caption.endsWith('\n') ? '\n' : '\n\n';
  return `${caption}${sep}${candidates.join(' ')}`;
}

function metadataFromMedia(job: MediaGenJob): MediaMetadata | undefined {
  if (!job.metadata) return undefined;
  const m: MediaMetadata = {};
  if (job.metadata.widthPx !== undefined) m.widthPx = job.metadata.widthPx;
  if (job.metadata.heightPx !== undefined) m.heightPx = job.metadata.heightPx;
  if (job.metadata.durationSeconds !== undefined) m.durationSeconds = job.metadata.durationSeconds;
  return Object.keys(m).length ? m : undefined;
}

export async function runRevisePost(
  input: RevisePostInput,
  deps: PipelineDeps,
  ctx?: GenerationContext,
): Promise<GeneratedPost> {
  if (!input.existingPost) {
    throw new ContentGenerationError('INVALID_INPUT', 'revisePost requires existingPost');
  }
  if (!input.feedback) {
    throw new ContentGenerationError('INVALID_INPUT', 'revisePost requires feedback');
  }

  const specCtx = toSpecializationContext(ctx);
  const system = deps.specialization.getSystemPromptFragment(specCtx);
  const taskPrompt = deps.specialization.getTaskPrompt('revisePost', input, specCtx);

  const detailLines = Object.entries(input.feedback.details).map(([k, v]) => `  ${k}: ${v}`);
  const userPrompt = [
    taskPrompt,
    '',
    'Existing post:',
    `Type: ${input.existingPost.type}`,
    `Platforms: ${input.existingPost.platforms.join(', ')}`,
    `Caption: ${input.existingPost.caption}`,
    input.existingPost.themes?.length ? `Themes: ${input.existingPost.themes.join(', ')}` : '',
    '',
    'Feedback to address:',
    `Tags: ${input.feedback.tags.join(', ')}`,
    detailLines.length ? `Details:\n${detailLines.join('\n')}` : '',
    `Note: ${input.feedback.note}`,
    input.feedback.resolution ? `Resolution: ${input.feedback.resolution}` : '',
    input.currentAffairsHints?.length
      ? `\nCurrent-affairs hints (use sparingly):\n- ${input.currentAffairsHints.join('\n- ')}`
      : '',
    `\nReturn just the revised caption (no hashtags inline) plus 2-5 suggestedHashtags.`,
  ].filter(Boolean).join('\n');

  const telemetryAttributes: Record<string, string> = { operation: 'revisePost', step: 'caption' };
  if (ctx?.restaurantId) telemetryAttributes.restaurantId = ctx.restaurantId;
  if (ctx?.correlationId) telemetryAttributes.correlationId = ctx.correlationId;

  // 1. Always regenerate caption.
  const captionObj = await withRetry(
    () => withCostTracking(
      async () => {
        const { object, usage, modelId } = await deps.llm.generateObject({
          model: 'haiku',
          system,
          prompt: userPrompt,
          schema: PostCaptionSchema,
          telemetryAttributes,
        });
        const costUsd = computeCostUsd(modelId, usage);
        return {
          result: object,
          usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            costUsd,
          },
        };
      },
      {
        ...(ctx?.restaurantId ? { restaurantId: ctx.restaurantId } : {}),
        operation: 'revisePost',
        surface: 'llm',
        step: 'caption',
        model: 'claude-haiku-4-5-20251001',
      },
    ),
    RETRY_PROFILES.LLM,
  );

  // 2. Media: regenerate iff feedback tags request it; otherwise carry existing.
  let mediaSource: { thumbnail?: string; mediaUrls?: string[]; videoUrl?: string; metadata?: MediaMetadata };
  if (feedbackRequestsMedia(input.feedback.tags)) {
    const job = await withRetry(
      () => withCostTracking(
        async () => {
          const result = isVideoType(input.existingPost.type)
            ? await deps.media.generateVideo({
                postType: input.existingPost.type as 'REEL' | 'VIDEO' | 'STORY',
                platforms: input.existingPost.platforms,
                concept: captionObj.caption,
                themes: input.existingPost.themes,
              })
            : await deps.media.generateImage({
                postType: input.existingPost.type,
                platforms: input.existingPost.platforms,
                concept: captionObj.caption,
                themes: input.existingPost.themes,
              });
          if (result.status === 'FAILED') {
            throw new ContentGenerationError('UNKNOWN', `Media regeneration failed: ${result.error ?? 'unknown'}`);
          }
          return { result, usage: { costUsd: 0 } };
        },
        {
          ...(ctx?.restaurantId ? { restaurantId: ctx.restaurantId } : {}),
          operation: 'revisePost',
          surface: isVideoType(input.existingPost.type) ? 'video' : 'image',
          step: isVideoType(input.existingPost.type) ? 'video' : 'image',
          model: 'placeholder-media',
        },
      ),
      isVideoType(input.existingPost.type) ? RETRY_PROFILES.VIDEO_SUBMIT : RETRY_PROFILES.IMAGE_SUBMIT,
    );

    const mediaJobMeta = metadataFromMedia(job);
    mediaSource = {
      ...(job.thumbnail ? { thumbnail: job.thumbnail } : {}),
      ...(job.mediaUrls ? { mediaUrls: job.mediaUrls } : {}),
      ...(isVideoType(input.existingPost.type) && job.mediaUrl ? { videoUrl: job.mediaUrl } : {}),
      ...(mediaJobMeta ? { metadata: mediaJobMeta } : {}),
    };
  } else {
    mediaSource = {
      ...(input.existingPost.thumbnail ? { thumbnail: input.existingPost.thumbnail } : {}),
      ...(input.existingPost.mediaUrls ? { mediaUrls: input.existingPost.mediaUrls } : {}),
      ...(input.existingPost.videoUrl ? { videoUrl: input.existingPost.videoUrl } : {}),
    };
  }

  // 3. Hashtag merge + assemble
  const specHashtags = deps.specialization.selectHashtags(captionObj.caption, specCtx);
  const fullCaption = mergeHashtags(captionObj.caption, captionObj.suggestedHashtags, specHashtags);

  const post: GeneratedPost = {
    caption: fullCaption,
    thumbnail: mediaSource.thumbnail ?? '',
  };
  if (mediaSource.mediaUrls) post.mediaUrls = mediaSource.mediaUrls;
  if (mediaSource.videoUrl) post.videoUrl = mediaSource.videoUrl;
  if (mediaSource.metadata) post.mediaMetadata = mediaSource.metadata;

  const validation = deps.specialization.validateOutput(post, specCtx);
  if (!validation.ok) {
    const errorIssue = validation.issues.find((i) => i.severity === 'error');
    throw new ContentGenerationError(
      'INVALID_INPUT',
      `Revised post failed specialization validation: ${errorIssue?.message ?? 'unknown'}`,
    );
  }
  if (validation.issues.length > 0) {
    log.warn({ issues: validation.issues, postType: input.existingPost.type }, 'Revised post has warnings');
  }

  return post;
}
```

- [ ] **Step 3: Verify**

PASS, 4 assertions green.

---

## Task 18: Wire generate-post + revise-post into AIContentGenerator

**Files:**
- Modify: `apps/content-engine/src/services/content-generator/backends/ai/ai-content-generator.ts`
- Modify: `apps/content-engine/tests/unit/content-generator/backends/ai/ai-content-generator.test.ts`

- [ ] **Step 1: Replace the BACKEND_UNAVAILABLE throws in AIContentGenerator**

In `ai-content-generator.ts`, replace `generatePostContent` and `revisePostContent` bodies:

Old:
```typescript
async generatePostContent(_input: GeneratePostInput, _ctx?: GenerationContext): Promise<GeneratedPost> {
  throw new ContentGenerationError('BACKEND_UNAVAILABLE', POST_OPS_NOT_WIRED_DETAIL);
}

async revisePostContent(_input: RevisePostInput, _ctx?: GenerationContext): Promise<GeneratedPost> {
  throw new ContentGenerationError('BACKEND_UNAVAILABLE', POST_OPS_NOT_WIRED_DETAIL);
}
```

New:
```typescript
async generatePostContent(input: GeneratePostInput, ctx?: GenerationContext): Promise<GeneratedPost> {
  return runGeneratePost(input, this.deps, ctx);
}

async revisePostContent(input: RevisePostInput, ctx?: GenerationContext): Promise<GeneratedPost> {
  return runRevisePost(input, this.deps, ctx);
}
```

Add the imports at the top of the file:
```typescript
import { runGeneratePost } from './pipeline/generate-post.js';
import { runRevisePost } from './pipeline/revise-post.js';
```

Delete the now-unused `POST_OPS_NOT_WIRED_DETAIL` constant.

- [ ] **Step 2: Update the AIContentGenerator test**

In the existing `ai-content-generator.test.ts`, replace the two BACKEND_UNAVAILABLE test cases for `generatePost` and `revisePost` with success-path assertions. Add the `generateImage` mock to `makeGen()`.

Replace the test file content (full replacement) with:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  trackAIUsage: vi.fn(),
}));

vi.mock('@restropulse/db', () => ({
  insertCostEvent: vi.fn().mockResolvedValue({ id: 'ce_test' }),
}));

const { AIContentGenerator } = await import(
  '../../../../src/services/content-generator/backends/ai/ai-content-generator.js'
);
const { RestaurantSpecialization } = await import(
  '../../../../src/services/content-generator/backends/ai/specialization/index.js'
);
const { ContentGenerationError } = await import(
  '../../../../src/services/content-generator/types.js'
);

const cycleObject = {
  summary: 'A week of food storytelling',
  plannedPosts: [{ category: 'chef_special', count: 2 }],
  focus: ['Chef Specials'],
};

const captionObject = {
  caption: 'Soft, flaky, ghee-laced parotta straight off the tawa.',
  suggestedHashtags: ['#parotta', '#ghee'],
};

function makeGen() {
  const generateObject = vi.fn().mockImplementation(async (req: any) => {
    if (req.schema._def && req.schema._def.shape && 'plannedPosts' in req.schema._def.shape()) {
      return { object: cycleObject, usage: { inputTokens: 100, outputTokens: 50 }, modelId: 'claude-sonnet-4-6' };
    }
    return { object: captionObject, usage: { inputTokens: 80, outputTokens: 40 }, modelId: 'claude-haiku-4-5-20251001' };
  });
  const generateImage = vi.fn().mockResolvedValue({
    jobId: 'j1', status: 'COMPLETED',
    mediaUrl: 'http://localhost:3002/images/x.jpg',
    thumbnail: 'http://localhost:3002/images/x.jpg',
    metadata: { widthPx: 1080, heightPx: 1080 },
  });
  const generateVideo = vi.fn().mockResolvedValue({
    jobId: 'j2', status: 'COMPLETED',
    mediaUrl: 'http://localhost:3002/videos/x.mp4',
    thumbnail: 'http://localhost:3002/videos/x.jpg',
    metadata: { widthPx: 1080, heightPx: 1920, durationSeconds: 18 },
  });
  return {
    gen: new AIContentGenerator({
      specialization: new RestaurantSpecialization(),
      llm: { name: 'mock', generateObject },
      media: { name: 'mock-media', generateImage, generateVideo, pollJob: vi.fn() },
    }),
    generateObject,
    generateImage,
    generateVideo,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AIContentGenerator (phase 2 complete)', () => {
  it('exposes name "ai" and the configured specialization', () => {
    const { gen } = makeGen();
    expect(gen.name).toBe('ai');
    expect(gen.specialization.domain).toBe('restaurant');
  });

  it('throws when constructed without specialization, llm, or media', () => {
    expect(() => new AIContentGenerator({} as any)).toThrow(ContentGenerationError);
  });

  it('draftCycle returns the cycle from the LLM', async () => {
    const { gen } = makeGen();
    const out = await gen.draftCycle({ period: 'w1' });
    expect(out.summary).toBe(cycleObject.summary);
  });

  it('reviseCycle returns the cycle from the LLM', async () => {
    const { gen } = makeGen();
    const out = await gen.reviseCycle({
      existingCycle: { period: 'w1', summary: 's', plannedPosts: [{ category: 'a', count: 1 }], focus: ['x'] },
      feedback: { areas: ['cta'], note: 'add CTA' },
    });
    expect(out.summary).toBe(cycleObject.summary);
  });

  it('generatePost produces caption + thumbnail for IMAGE', async () => {
    const { gen } = makeGen();
    const out = await gen.generatePost({ concept: 'parotta', type: 'IMAGE', platforms: ['INSTAGRAM'] });
    expect(out.caption).toContain('parotta');
    expect(out.thumbnail).toMatch(/^http:\/\//);
  });

  it('revisePost regenerates caption only when feedback does not request media', async () => {
    const { gen, generateImage } = makeGen();
    await gen.revisePost({
      existingPost: { type: 'IMAGE', platforms: ['INSTAGRAM'], caption: 'old', thumbnail: 'http://existing/t.jpg' },
      feedback: { tags: ['voice'], details: {}, note: 'warmer please' },
    });
    expect(generateImage).not.toHaveBeenCalled();
  });

  it('healthCheck reports ok=true', async () => {
    const { gen } = makeGen();
    const r = await gen.healthCheck!();
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 3: Verify**

`cd apps/content-engine && npx vitest run tests/unit/content-generator/backends/ai/ai-content-generator.test.ts tests/unit/content-generator/backends/ai/pipeline`
Expected: all green.

---

## Task 19: End-to-end integration test (real Mongo for cost events, mocked external)

**Files:**
- Create: `apps/content-engine/tests/integration/ai-content-generator-end-to-end.test.ts`

This complements unit tests with a single end-to-end pass: real costEvents collection round-trip, real specialization, mocked LLM + media. Confirms wires line up.

- [ ] **Step 1: Create the test**

```typescript
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { setDB } from '@restropulse/db';

vi.mock('@restropulse/telemetry/server', () => {
  const noopLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    createLogger: vi.fn(() => noopLogger),
    initServerTelemetry: vi.fn(),
    shutdownServerTelemetry: vi.fn(),
    trackAIUsage: vi.fn(),
  };
});

const { AIContentGenerator } = await import(
  '../../src/services/content-generator/backends/ai/ai-content-generator.js'
);
const { RestaurantSpecialization } = await import(
  '../../src/services/content-generator/backends/ai/specialization/index.js'
);
const { findCostEventsByRestaurant } = await import('@restropulse/db');

let mongod: MongoMemoryServer;
let client: MongoClient;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongod.getUri());
  setDB(client.db('ai-end-to-end-test'));
}, 60000);

afterAll(async () => {
  await client.close();
  await mongod.stop();
}, 20000);

beforeEach(async () => {
  await client.db('ai-end-to-end-test').collection('costEvents').deleteMany({});
});

function makeGen() {
  const generateObject = vi.fn().mockImplementation(async (req: any) => {
    // Heuristic: cycle schema has plannedPosts; caption schema has just caption/suggestedHashtags
    const isCycle = req.system && req.prompt && req.prompt.toLowerCase().includes('cycle');
    if (isCycle) {
      return {
        object: { summary: 'cycle', plannedPosts: [{ category: 'a', count: 1 }], focus: ['x'] },
        usage: { inputTokens: 200, outputTokens: 80 },
        modelId: 'claude-sonnet-4-6',
      };
    }
    return {
      object: { caption: 'A warm, sensory caption from the kitchen.', suggestedHashtags: ['#warm', '#kitchen'] },
      usage: { inputTokens: 100, outputTokens: 50 },
      modelId: 'claude-haiku-4-5-20251001',
    };
  });

  const generateImage = vi.fn().mockResolvedValue({
    jobId: 'j_e2e', status: 'COMPLETED',
    mediaUrl: 'http://localhost:3002/images/x.jpg',
    thumbnail: 'http://localhost:3002/images/x.jpg',
    metadata: { widthPx: 1080, heightPx: 1080 },
  });

  return new AIContentGenerator({
    specialization: new RestaurantSpecialization(),
    llm: { name: 'mock', generateObject },
    media: { name: 'mock-media', generateImage, generateVideo: vi.fn(), pollJob: vi.fn() },
  });
}

describe('AIContentGenerator end-to-end (mocked external, real Mongo cost events)', () => {
  it('draftCycle then generatePost yields three cost events tagged for the same restaurant', async () => {
    const gen = makeGen();
    await gen.draftCycle({ period: 'w1' }, { restaurantId: 'r-end-to-end' });
    await gen.generatePost(
      { concept: 'parotta', type: 'IMAGE', platforms: ['INSTAGRAM'] },
      { restaurantId: 'r-end-to-end' },
    );

    const events = await findCostEventsByRestaurant('r-end-to-end');
    expect(events.length).toBe(3); // 1 LLM (cycle) + 1 LLM (caption) + 1 image
    const ops = events.map((e) => e.operation);
    expect(ops.filter((o) => o === 'draftCycle')).toHaveLength(1);
    expect(ops.filter((o) => o === 'generatePost')).toHaveLength(2);
    const surfaces = events.map((e) => e.surface);
    expect(surfaces).toContain('llm');
    expect(surfaces).toContain('image');
  });
});
```

- [ ] **Step 2: Verify**

`cd apps/content-engine && npx vitest run tests/integration/ai-content-generator-end-to-end.test.ts`
Expected: PASS.

---

## Task 20: Update ai/index.ts barrel to export new modules

**Files:**
- Modify: `apps/content-engine/src/services/content-generator/backends/ai/index.ts`

- [ ] **Step 1: Add exports**

Replace the existing barrel with:

```typescript
export { AIContentGenerator } from './ai-content-generator.js';
export type { AIContentGeneratorOptions } from './ai-content-generator.js';
export { withRetry, RETRY_PROFILES } from './with-retry.js';
export type { RetryProfile } from './with-retry.js';
export { withCostTracking } from './with-cost-tracking.js';
export type { CostTrackingLabels, AICallUsage, AICallResult } from './with-cost-tracking.js';
export { TransientError, RateLimitError, classifyError } from './errors.js';
export * from './specialization/index.js';

// Phase 2 additions
export type { ILLMProvider, GenerateObjectRequest, GenerateObjectResponse, LLMUsage, LLMModelFamily } from './llm/types.js';
export { AnthropicLLMProvider } from './llm/anthropic-provider.js';
export type { AnthropicLLMProviderOptions } from './llm/anthropic-provider.js';
export { ANTHROPIC_MODEL_IDS, pickModel } from './llm/model-selection.js';
export { MODEL_PRICING, computeCostUsd } from './llm/pricing.js';
export type { ModelPricing, UsageForCost } from './llm/pricing.js';
export { CycleSchema, PostCaptionSchema } from './llm/schemas.js';
export type { CycleSchemaType, PostCaptionSchemaType } from './llm/schemas.js';

export type { IMediaGenerator, MediaGenJob, MediaJobStatus, ImageGenInput, VideoGenInput } from './media/types.js';
export { PlaceholderMediaGenerator } from './media/placeholder-media-generator.js';
```

- [ ] **Step 2: Type-check**

`rtk npm run type-check --workspace=@restropulse/content-engine` -> exit 0.

---

## Task 21: Final regression sweep

- [ ] **Step 1: Full content-engine test suite**

`cd apps/content-engine && npx vitest run`
Expected: ~33 test files, ~50+ new assertions added on top of phase 1's 237 -> ~280-290 total. ALL pass.

- [ ] **Step 2: Type-check entire monorepo**

`rtk npm run type-check`
Expected: exit 0.

- [ ] **Step 3: Smoke test - factory builds AI backend with a fake apiKey**

```
cd apps/content-engine && ANTHROPIC_API_KEY=sk-fake npx tsx --eval "import('./src/services/content-generator/factory.js').then(m => console.log('ai backend name:', m.createContentGenerator('ai').name)).catch(e => { console.error(e); process.exit(1); })"
```
Expected: `ai backend name: ai`. (No real network call happens because no LLM operation is invoked.)

---

## Task 22: Stage everything

- [ ] **Step 1: Stage all phase-2 files**

Run from repo root:

```
rtk git add \
  apps/content-engine/package.json \
  package-lock.json \
  apps/content-engine/src/services/content-generator/backends/ai/llm/types.ts \
  apps/content-engine/src/services/content-generator/backends/ai/llm/anthropic-provider.ts \
  apps/content-engine/src/services/content-generator/backends/ai/llm/model-selection.ts \
  apps/content-engine/src/services/content-generator/backends/ai/llm/pricing.ts \
  apps/content-engine/src/services/content-generator/backends/ai/llm/schemas.ts \
  apps/content-engine/src/services/content-generator/backends/ai/media/types.ts \
  apps/content-engine/src/services/content-generator/backends/ai/media/placeholder-media-generator.ts \
  apps/content-engine/src/services/content-generator/backends/ai/pipeline/types.ts \
  apps/content-engine/src/services/content-generator/backends/ai/pipeline/draft-cycle.ts \
  apps/content-engine/src/services/content-generator/backends/ai/pipeline/revise-cycle.ts \
  apps/content-engine/src/services/content-generator/backends/ai/pipeline/generate-post.ts \
  apps/content-engine/src/services/content-generator/backends/ai/pipeline/revise-post.ts \
  apps/content-engine/src/services/content-generator/backends/ai/ai-content-generator.ts \
  apps/content-engine/src/services/content-generator/backends/ai/index.ts \
  apps/content-engine/src/services/content-generator/factory.ts \
  apps/content-engine/tests/unit/content-generator/backends/ai/ai-content-generator.test.ts \
  apps/content-engine/tests/unit/content-generator/backends/ai/llm/anthropic-provider.test.ts \
  apps/content-engine/tests/unit/content-generator/backends/ai/llm/model-selection.test.ts \
  apps/content-engine/tests/unit/content-generator/backends/ai/llm/pricing.test.ts \
  apps/content-engine/tests/unit/content-generator/backends/ai/llm/schemas.test.ts \
  apps/content-engine/tests/unit/content-generator/backends/ai/media/placeholder-media-generator.test.ts \
  apps/content-engine/tests/unit/content-generator/backends/ai/pipeline/draft-cycle.test.ts \
  apps/content-engine/tests/unit/content-generator/backends/ai/pipeline/revise-cycle.test.ts \
  apps/content-engine/tests/unit/content-generator/backends/ai/pipeline/generate-post.test.ts \
  apps/content-engine/tests/unit/content-generator/backends/ai/pipeline/revise-post.test.ts \
  apps/content-engine/tests/unit/content-generator/factory.test.ts \
  apps/content-engine/tests/integration/ai-content-generator-end-to-end.test.ts \
  docs/superpowers/plans/2026-05-03-content-engine-ai-phase-2.md

rtk git status
rtk git diff --staged --stat
```

## Task 23: STOP for commit approval, then commit

**STOP. Show user the staged status + stat. Ask: "Phase 2 complete. All four AIContentGenerator operations now produce real LLM output behind the flag. Mocked tests cover prompt assembly + retry + cost tracking + validation. Approve committing as a single phase-2 commit?"**

After explicit user approval:

```
rtk git commit -m "$(cat <<'EOF'
feat(content-engine): wire AI backend operations via Vercel AI SDK + IMediaGenerator seam

Phase 2 of the content-engine AI rollout per ADR 0001. All four
AIContentGenerator operations (draftCycle, reviseCycle, generatePost,
revisePost) now produce real LLM output behind CONTENT_GENERATOR_BACKEND=ai.
The default backend remains 'placeholder'; production behavior is unchanged
unless the flag is flipped.

Adds backends/ai/llm/:
- ILLMProvider interface + AnthropicLLMProvider (default impl using
  ai + @ai-sdk/anthropic, prompt caching enabled, OTel telemetry)
- model-selection: Haiku for per-post captions, Sonnet for cycle reasoning
- pricing: per-million USD rates per model, cost computation
- Zod schemas for cycle and post-caption structured outputs

Adds backends/ai/media/:
- IMediaGenerator interface (formal in ADR §6) -- shape supports the
  PENDING/RUNNING states phase 5 needs
- PlaceholderMediaGenerator wrapping the existing asset-manager catalog
  so the AI pipeline produces real-looking media URLs without calling
  fal.ai. Replaced by FalAIMediaGenerator in phase 4.

Adds backends/ai/pipeline/:
- runDraftCycle / runReviseCycle: single LLM call wrapped in withRetry +
  withCostTracking
- runGeneratePost: parallel caption (LLM) + media generation, hashtag
  merge with specialization, FSSAI validation
- runRevisePost: caption regen + conditional media regen based on feedback
  tags

AIContentGenerator constructor now takes { specialization, llm, media }
so tests inject mocks for any collaborator. The factory wires the defaults
(AnthropicLLMProvider with ANTHROPIC_API_KEY from env, PlaceholderMediaGenerator).
A missing ANTHROPIC_API_KEY when backend=ai fails loudly at boot.

Tests: 5 new unit test files (llm + media), 4 new pipeline test files,
1 new end-to-end integration test using mongodb-memory-server. All
prior 237 tests continue to pass.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
rtk git status
rtk git log --oneline -5
```

---

## Self-Review

**Spec coverage** (against phase 2 brainstorm):
- Vercel AI SDK + provider deps -> Task 1
- ILLMProvider with Anthropic default + Zod schemas + prompt caching + OTel -> Tasks 2, 6
- Model selection Haiku/Sonnet per operation -> Task 4
- IMediaGenerator interface (formal in ADR §6) + PlaceholderMediaGenerator -> Tasks 7, 8
- draftCycle / reviseCycle wired with cost tracking labels -> Tasks 11-13
- generatePost / revisePost wired with caption+media+specialization+validation -> Tasks 16-18
- Mocked-LLM tests asserting prompt assembly + retry + cost rows -> all pipeline tests
- End-to-end integration test with real cost-events Mongo -> Task 19
- Factory wiring + ANTHROPIC_API_KEY check -> Task 14
- Default backend remains placeholder -> covered (no change to env default)

**Placeholder scan**: searched plan for "TBD", "implement later", "fill in", "appropriate error handling" — none present. Every code block contains real code.

**Type consistency**:
- `ILLMProvider.generateObject` shape matches usage in pipeline files (`{ object, usage, modelId }`).
- `withCostTracking` from phase 1 expects `{ result, usage: { inputTokens, outputTokens, costUsd } }` — every pipeline call returns exactly that shape.
- `IMediaGenerator.generateImage` / `generateVideo` return `MediaGenJob` — pipelines treat `status === 'COMPLETED'` and unpack `mediaUrl`/`mediaUrls`/`thumbnail`/`metadata`.
- `AIContentGenerator` constructor signature is consistent across factory, tests, and impl: `{ specialization, llm, media }`.

**Cross-cutting notes for the implementer**:
- Plain ASCII only.
- `rtk` prefix for shell commands, except vitest (`npx vitest` directly per phase-1 convention).
- `import type` for type-only imports.
- Dynamic `await import(...)` AFTER `vi.mock(...)` calls in test files.
- Do not commit between tasks. Stage at end of phase 2.
- Do not modify worker.ts, processors, placeholder backend, or any non-AI test (unrelated to phase 2 scope).
