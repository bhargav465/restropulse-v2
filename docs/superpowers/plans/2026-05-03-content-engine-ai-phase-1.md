# Content-Engine AI — Phase 1: Scaffolding, Feature Flag, Foundational Helpers, IDomainSpecialization

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the bones of the AI content generator: a feature-flagged factory in `worker.ts`, a stub `AIContentGenerator`, foundational helpers (`withRetry`, `withCostTracking`, classifier, `cost_events` collection), and the full `IDomainSpecialization` seam shipped with a real `RestaurantSpecialization` implementation. Placeholder generator remains the default backend.

**Architecture:** New `backends/ai/` directory under `apps/content-engine/src/services/content-generator/`. `AIContentGenerator` extends `BaseContentGenerator`, accepts a domain specialization via constructor, and throws `BACKEND_UNAVAILABLE` from each operation until phase 2 wires the LLM. A new `factory.ts` returns either `PlaceholderContentGenerator` or `AIContentGenerator` based on `CONTENT_GENERATOR_BACKEND` env var (default `placeholder`). Cost tracking writes to a new `cost_events` MongoDB collection via a new `@restropulse/db` helper, with the `CostEvent` type living in `@restropulse/shared`.

**Tech Stack:** TypeScript (strict, ESM), Express ecosystem, Vitest + mongodb-memory-server, MongoDB driver v6, `@restropulse/telemetry` (pino + OTel), Zod via `@restropulse/shared.loadAndValidateEnv`.

---

## Phase 1 Checkpoints

This phase is split into two review checkpoints. Each ends with you showing the user `rtk git status` + diff and STOPPING for approval. **The phase ends with a single commit at the end of Checkpoint B**, not after Checkpoint A.

- **Checkpoint A (Tasks 1–8):** Errors, retry, cost-events DB helper, cost-tracking wrapper, all unit + integration tests passing.
- **Checkpoint B (Tasks 9–18):** Specialization seam + RestaurantSpecialization + AIContentGenerator stub + factory + worker wiring + tests + commit.

---

## File Structure

### New files

```
apps/content-engine/src/services/content-generator/
  backends/ai/
    index.ts                       barrel export
    ai-content-generator.ts        AIContentGenerator (stub for phase 1)
    errors.ts                      TransientError, RateLimitError, classifyError
    with-retry.ts                  withRetry + 3 retry profiles
    with-cost-tracking.ts          withCostTracking wrapper
    cost-events.ts                 module-local helpers: shape + recordCostEvent
    specialization/
      index.ts                     barrel export of types + concretes
      types.ts                     IDomainSpecialization + SpecializationContext + helper types
      restaurant/
        index.ts                   RestaurantSpecialization class
        prompts.ts                 system prompt fragment + per-operation task prompts
        sonar-queries.ts           daily + per-post Sonar query templates
        content-patterns.ts        7 restaurant post archetypes
        visual-direction.ts        food-photography rules + image-prompt fragments
        platform-tactics.ts        Instagram + Facebook playbook
        hashtag-strategy.ts        selectHashtags + denylist
        psychology.ts              scarcity / social-proof / FOMO hook fragments
  factory.ts                       createContentGenerator(backend) factory

packages/db/src/
  cost-events.ts                   getCostEventsCollection + insertCostEvent + finders

packages/shared/src/
  cost-events.ts                   CostEvent type

apps/content-engine/tests/unit/content-generator/backends/ai/
  errors.test.ts
  with-retry.test.ts
  with-cost-tracking.test.ts
  ai-content-generator.test.ts
  specialization/
    restaurant.test.ts
apps/content-engine/tests/unit/content-generator/
  factory.test.ts

apps/content-engine/tests/integration/
  cost-events.test.ts              uses mongodb-memory-server
```

### Modified files

```
apps/content-engine/src/services/content-generator/index.ts   add ai-generator + factory exports
apps/content-engine/src/worker.ts                             add env var, swap setContentGenerator call
packages/db/src/connection.ts                                 add getCostEventsCollection()
packages/db/src/index.ts                                      add cost-events.ts re-export
packages/shared/src/index.ts                                  add cost-events.ts re-export
```

---

# CHECKPOINT A — Foundational helpers + cost events

## Task 1: Add `CostEvent` type to `@restropulse/shared`

**Files:**
- Create: `packages/shared/src/cost-events.ts`
- Modify: `packages/shared/src/index.ts`
- Test: (none — pure type, exercised in later tasks)

- [ ] **Step 1: Inspect the shared package barrel to confirm export style**

Run: `rtk read packages/shared/src/index.ts | head -40`
Expected: list of `export * from './<module>.js';` lines.

- [ ] **Step 2: Create the type file**

Create `packages/shared/src/cost-events.ts`:

```typescript
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
```

- [ ] **Step 3: Re-export from the barrel**

Add to `packages/shared/src/index.ts` (preserve alphabetical placement next to other exports):

```typescript
export * from './cost-events.js';
```

- [ ] **Step 4: Verify type-check passes**

Run: `rtk npm run type-check --workspace=@restropulse/shared`
Expected: exit 0.

---

## Task 2: Add `getCostEventsCollection` and `cost-events.ts` helper to `@restropulse/db`

**Files:**
- Modify: `packages/db/src/connection.ts:140-145` (add new collection getter near the others)
- Create: `packages/db/src/cost-events.ts`
- Modify: `packages/db/src/index.ts`
- Test: (covered by Task 8 integration test)

- [ ] **Step 1: Add the collection getter**

In `packages/db/src/connection.ts`, after `getArchivedAccountsCollection()` (line ~144), add:

```typescript
export function getCostEventsCollection(): Collection {
  return getDB().collection('costEvents');
}
```

- [ ] **Step 2: Add the new getter to the barrel**

In `packages/db/src/index.ts`, add `getCostEventsCollection,` to the named-export block from `./connection.js`.

- [ ] **Step 3: Create the cost-events helper module**

Create `packages/db/src/cost-events.ts`:

```typescript
/**
 * @restropulse/db - Cost events collection helpers
 *
 * Each AI/external API call writes a single row. Used by the per-restaurant
 * billing dashboards and the per-post audit dashboard (see ADR 0001 §4.3).
 */

import { getCostEventsCollection, toApiFormat, toApiFormatArray } from './connection.js';
import type { CostEvent } from '@restropulse/shared';

export async function insertCostEvent(event: Omit<CostEvent, 'id'>): Promise<CostEvent> {
  const col = getCostEventsCollection();
  const doc = { ...event, createdAt: event.createdAt ?? new Date() };
  const result = await col.insertOne(doc as any);
  return { ...doc, id: result.insertedId.toString() } as CostEvent;
}

export async function findCostEventsByPost(postId: string): Promise<CostEvent[]> {
  const col = getCostEventsCollection();
  const docs = await col.find({ postId }).sort({ createdAt: 1 }).toArray();
  return toApiFormatArray(docs) as CostEvent[];
}

export async function findCostEventsByRestaurant(
  restaurantId: string,
  range?: { from: Date; to: Date },
): Promise<CostEvent[]> {
  const col = getCostEventsCollection();
  const filter: Record<string, unknown> = { restaurantId };
  if (range) {
    filter.createdAt = { $gte: range.from, $lte: range.to };
  }
  const docs = await col.find(filter).sort({ createdAt: 1 }).toArray();
  return toApiFormatArray(docs) as CostEvent[];
}

export async function sumCostByRestaurant(
  restaurantId: string,
  range?: { from: Date; to: Date },
): Promise<number> {
  const events = await findCostEventsByRestaurant(restaurantId, range);
  return events.reduce((acc, e) => acc + (e.costUsd ?? 0), 0);
}
```

- [ ] **Step 4: Re-export the helper module**

In `packages/db/src/index.ts`, add (alphabetically placed):

```typescript
export * from './cost-events.js';
```

- [ ] **Step 5: Verify db type-check passes**

Run: `rtk npm run type-check --workspace=@restropulse/db`
Expected: exit 0.

---

## Task 3: Write failing tests for `errors.ts` (classifier + custom errors)

**Files:**
- Create: `apps/content-engine/tests/unit/content-generator/backends/ai/errors.test.ts`

- [ ] **Step 1: Create the test file**

Create `apps/content-engine/tests/unit/content-generator/backends/ai/errors.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  TransientError,
  RateLimitError,
  classifyError,
} from '../../../../src/services/content-generator/backends/ai/errors.js';

describe('TransientError / RateLimitError', () => {
  it('TransientError carries name + status + cause', () => {
    const root = new Error('socket hangup');
    const err = new TransientError('upstream 502', 502, root);
    expect(err.name).toBe('TransientError');
    expect(err.status).toBe(502);
    expect(err.cause).toBe(root);
    expect(err).toBeInstanceOf(Error);
  });

  it('RateLimitError extends TransientError and carries retryAfterMs', () => {
    const err = new RateLimitError('too many requests', 1500);
    expect(err.name).toBe('RateLimitError');
    expect(err.status).toBe(429);
    expect(err.retryAfterMs).toBe(1500);
    expect(err).toBeInstanceOf(TransientError);
  });
});

describe('classifyError', () => {
  it('returns the error itself when it is already a TransientError', () => {
    const t = new TransientError('x', 503);
    expect(classifyError(t)).toBe(t);
  });

  it('classifies HTTP 429 as RateLimitError, reading Retry-After when present', () => {
    const httpErr = { status: 429, message: 'rate limited', headers: { 'retry-after': '2' } };
    const out = classifyError(httpErr);
    expect(out).toBeInstanceOf(RateLimitError);
    expect((out as RateLimitError).retryAfterMs).toBe(2000);
  });

  it('classifies HTTP 502/503/504 as TransientError', () => {
    for (const status of [502, 503, 504]) {
      const out = classifyError({ status, message: `upstream ${status}` });
      expect(out).toBeInstanceOf(TransientError);
      expect((out as TransientError).status).toBe(status);
    }
  });

  it('returns the original error unchanged for 4xx (other than 429)', () => {
    const httpErr = { status: 400, message: 'bad request' };
    const out = classifyError(httpErr);
    expect(out).toBe(httpErr);
    expect(out).not.toBeInstanceOf(TransientError);
  });

  it('returns the original error for unknown shapes', () => {
    const weird = new Error('unparseable');
    expect(classifyError(weird)).toBe(weird);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `rtk vitest run tests/unit/content-generator/backends/ai/errors.test.ts --workspace apps/content-engine` (from repo root, prefix `cd apps/content-engine && ` if vitest can't resolve)

Expected: FAIL with "Cannot find module '.../backends/ai/errors.js'".

---

## Task 4: Implement `errors.ts`

**Files:**
- Create: `apps/content-engine/src/services/content-generator/backends/ai/errors.ts`

- [ ] **Step 1: Create the module**

Create `apps/content-engine/src/services/content-generator/backends/ai/errors.ts`:

```typescript
/**
 * Retry-classification error types for the AI content generator.
 *
 * The retry helper inspects thrown errors via classifyError(); errors that
 * resolve to TransientError or RateLimitError get retried per the configured
 * backoff profile. All other errors propagate immediately (e.g. 4xx auth,
 * validation failures, programmer mistakes).
 */

export class TransientError extends Error {
  readonly status?: number;
  readonly cause?: unknown;

  constructor(message: string, status?: number, cause?: unknown) {
    super(message);
    this.name = 'TransientError';
    if (status !== undefined) this.status = status;
    if (cause !== undefined) this.cause = cause;
  }
}

export class RateLimitError extends TransientError {
  readonly retryAfterMs?: number;

  constructor(message: string, retryAfterMs?: number, cause?: unknown) {
    super(message, 429, cause);
    this.name = 'RateLimitError';
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs;
  }
}

interface MaybeHttpError {
  status?: number;
  message?: string;
  headers?: Record<string, string | string[] | undefined>;
}

function readRetryAfterMs(headers: MaybeHttpError['headers']): number | undefined {
  if (!headers) return undefined;
  const raw = headers['retry-after'] ?? headers['Retry-After'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

/**
 * Classify an unknown error into TransientError / RateLimitError when possible,
 * otherwise return it unchanged. Pure function — no side effects.
 */
export function classifyError(err: unknown): unknown {
  if (err instanceof TransientError) return err;

  const httpish = err as MaybeHttpError | null;
  const status = httpish?.status;

  if (status === 429) {
    return new RateLimitError(
      httpish?.message ?? 'Rate limited',
      readRetryAfterMs(httpish?.headers),
      err,
    );
  }

  if (status === 502 || status === 503 || status === 504) {
    return new TransientError(httpish?.message ?? `Upstream ${status}`, status, err);
  }

  return err;
}
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `cd apps/content-engine && rtk vitest run tests/unit/content-generator/backends/ai/errors.test.ts`
Expected: PASS, all 7 assertions green.

---

## Task 5: Write failing tests for `with-retry.ts`

**Files:**
- Create: `apps/content-engine/tests/unit/content-generator/backends/ai/with-retry.test.ts`

- [ ] **Step 1: Create the test file**

Create `apps/content-engine/tests/unit/content-generator/backends/ai/with-retry.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  withRetry,
  RETRY_PROFILES,
} from '../../../../src/services/content-generator/backends/ai/with-retry.js';
import {
  TransientError,
  RateLimitError,
} from '../../../../src/services/content-generator/backends/ai/errors.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RETRY_PROFILES', () => {
  it('exposes the three documented profiles with the ADR-specified backoffs', () => {
    expect(RETRY_PROFILES.LLM).toEqual({ maxAttempts: 3, backoffMs: [1000, 2000, 4000] });
    expect(RETRY_PROFILES.IMAGE_SUBMIT).toEqual({ maxAttempts: 3, backoffMs: [5000, 10000, 20000] });
    expect(RETRY_PROFILES.VIDEO_SUBMIT).toEqual({
      maxAttempts: 5,
      backoffMs: [10000, 20000, 40000, 80000, 160000],
    });
  });
});

describe('withRetry', () => {
  it('returns the result on first success without sleeping', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const promise = withRetry(fn, RETRY_PROFILES.LLM);
    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on TransientError up to maxAttempts and resolves when one succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new TransientError('x', 503))
      .mockRejectedValueOnce(new TransientError('x', 503))
      .mockResolvedValueOnce('done');

    const promise = withRetry(fn, RETRY_PROFILES.LLM);
    await vi.advanceTimersByTimeAsync(1000);  // first backoff
    await vi.advanceTimersByTimeAsync(2000);  // second backoff
    await expect(promise).resolves.toBe('done');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('rethrows after exhausting maxAttempts', async () => {
    const fn = vi.fn().mockRejectedValue(new TransientError('persistent', 503));
    const promise = withRetry(fn, RETRY_PROFILES.LLM);
    promise.catch(() => undefined); // prevent unhandled rejection warning
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(4000);
    await expect(promise).rejects.toBeInstanceOf(TransientError);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('honors RateLimitError.retryAfterMs over the profile backoff', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new RateLimitError('rl', 7000))
      .mockResolvedValueOnce('ok');

    const promise = withRetry(fn, RETRY_PROFILES.LLM);
    // profile says 1000ms, but Retry-After says 7000ms -- must wait the longer
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(6000);
    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('classifies raw HTTP-shaped errors via classifyError before deciding to retry', async () => {
    const httpErr = { status: 502, message: 'bad gateway' };
    const fn = vi.fn()
      .mockRejectedValueOnce(httpErr)
      .mockResolvedValueOnce('ok');

    const promise = withRetry(fn, RETRY_PROFILES.LLM);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry on 4xx errors (other than 429)', async () => {
    const httpErr = { status: 400, message: 'bad request' };
    const fn = vi.fn().mockRejectedValue(httpErr);
    const promise = withRetry(fn, RETRY_PROFILES.LLM);
    await expect(promise).rejects.toBe(httpErr);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/content-engine && rtk vitest run tests/unit/content-generator/backends/ai/with-retry.test.ts`
Expected: FAIL with "Cannot find module".

---

## Task 6: Implement `with-retry.ts`

**Files:**
- Create: `apps/content-engine/src/services/content-generator/backends/ai/with-retry.ts`

- [ ] **Step 1: Create the module**

Create `apps/content-engine/src/services/content-generator/backends/ai/with-retry.ts`:

```typescript
/**
 * withRetry — wraps any async function with the retry/backoff policy from ADR 0001 §4.3.
 *
 * Profiles are intentionally small and explicit (no algorithmic schedules) so the
 * exact behavior is greppable from the test names.
 */

import { createLogger } from '@restropulse/telemetry/server';
import { classifyError, RateLimitError, TransientError } from './errors.js';

const log = createLogger('ai-retry');

export interface RetryProfile {
  readonly maxAttempts: number;
  readonly backoffMs: readonly number[]; // length must be >= maxAttempts; index i = wait BEFORE attempt i+1
}

export const RETRY_PROFILES = {
  LLM: { maxAttempts: 3, backoffMs: [1000, 2000, 4000] },
  IMAGE_SUBMIT: { maxAttempts: 3, backoffMs: [5000, 10000, 20000] },
  VIDEO_SUBMIT: { maxAttempts: 5, backoffMs: [10000, 20000, 40000, 80000, 160000] },
} as const satisfies Record<string, RetryProfile>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  profile: RetryProfile,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= profile.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (rawError) {
      const classified = classifyError(rawError);
      lastError = classified;

      const isRetryable = classified instanceof TransientError;
      if (!isRetryable || attempt === profile.maxAttempts) {
        throw classified;
      }

      const profileBackoff = profile.backoffMs[attempt - 1] ?? profile.backoffMs[profile.backoffMs.length - 1] ?? 1000;
      const retryAfter =
        classified instanceof RateLimitError && classified.retryAfterMs !== undefined
          ? classified.retryAfterMs
          : 0;
      const waitMs = Math.max(profileBackoff, retryAfter);

      log.warn(
        { attempt, maxAttempts: profile.maxAttempts, waitMs, errorName: (classified as Error).name },
        'Transient error; will retry',
      );
      await sleep(waitMs);
    }
  }

  throw lastError;
}
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `cd apps/content-engine && rtk vitest run tests/unit/content-generator/backends/ai/with-retry.test.ts`
Expected: PASS, all 7 assertions green.

---

## Task 7: Write + implement `with-cost-tracking.ts` (red → green in one task)

This task is split across two checkpoints inside itself: write the test first, watch it fail, then implement. Both happen in the same task because the surface area is small.

**Files:**
- Create: `apps/content-engine/tests/unit/content-generator/backends/ai/with-cost-tracking.test.ts`
- Create: `apps/content-engine/src/services/content-generator/backends/ai/with-cost-tracking.ts`

- [ ] **Step 1: Create the failing test**

Create `apps/content-engine/tests/unit/content-generator/backends/ai/with-cost-tracking.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  trackAIUsage: vi.fn(),
}));

vi.mock('@restropulse/db', () => ({
  insertCostEvent: vi.fn().mockResolvedValue({ id: 'ce_1' }),
}));

const { trackAIUsage } = await import('@restropulse/telemetry/server');
const { insertCostEvent } = await import('@restropulse/db');
const { withCostTracking } = await import(
  '../../../../src/services/content-generator/backends/ai/with-cost-tracking.js'
);

beforeEach(() => {
  vi.clearAllMocks();
});

const baseLabels = {
  restaurantId: 'r1',
  postId: 'p1',
  cycleId: 'c1',
  operation: 'generatePost' as const,
  surface: 'llm' as const,
  step: 'caption',
  model: 'claude-sonnet-4-6',
};

describe('withCostTracking', () => {
  it('returns the wrapped function result and unwraps usage', async () => {
    const out = await withCostTracking(
      async () => ({
        result: { caption: 'hi' },
        usage: { inputTokens: 100, outputTokens: 50, costUsd: 0.012 },
      }),
      baseLabels,
    );
    expect(out).toEqual({ caption: 'hi' });
  });

  it('records a success cost event with all labels and usage fields', async () => {
    await withCostTracking(
      async () => ({
        result: 'x',
        usage: { inputTokens: 100, outputTokens: 50, costUsd: 0.012 },
      }),
      baseLabels,
    );
    expect(insertCostEvent).toHaveBeenCalledTimes(1);
    const event = (insertCostEvent as any).mock.calls[0][0];
    expect(event.restaurantId).toBe('r1');
    expect(event.postId).toBe('p1');
    expect(event.cycleId).toBe('c1');
    expect(event.operation).toBe('generatePost');
    expect(event.surface).toBe('llm');
    expect(event.step).toBe('caption');
    expect(event.model).toBe('claude-sonnet-4-6');
    expect(event.inputTokens).toBe(100);
    expect(event.outputTokens).toBe(50);
    expect(event.costUsd).toBe(0.012);
    expect(event.status).toBe('success');
    expect(typeof event.durationMs).toBe('number');
    expect(event.durationMs).toBeGreaterThanOrEqual(0);
    expect(event.createdAt).toBeInstanceOf(Date);
  });

  it('forwards the success metric to trackAIUsage', async () => {
    await withCostTracking(
      async () => ({
        result: 'x',
        usage: { inputTokens: 10, outputTokens: 20, costUsd: 0.001 },
      }),
      baseLabels,
    );
    expect(trackAIUsage).toHaveBeenCalledTimes(1);
    const usage = (trackAIUsage as any).mock.calls[0][0];
    expect(usage.model).toBe('claude-sonnet-4-6');
    expect(usage.operation).toBe('generatePost');
    expect(usage.inputTokens).toBe(10);
    expect(usage.outputTokens).toBe(20);
    expect(usage.costUsd).toBe(0.001);
    expect(usage.restaurantId).toBe('r1');
  });

  it('records a failure cost event and rethrows the error', async () => {
    const boom = new Error('boom');
    await expect(
      withCostTracking(async () => { throw boom; }, baseLabels),
    ).rejects.toBe(boom);
    expect(insertCostEvent).toHaveBeenCalledTimes(1);
    const event = (insertCostEvent as any).mock.calls[0][0];
    expect(event.status).toBe('failure');
    expect(event.errorCode).toBe('Error');
    expect(event.costUsd).toBe(0);
  });

  it('does not throw if the cost-event write itself fails', async () => {
    (insertCostEvent as any).mockRejectedValueOnce(new Error('mongo down'));
    const out = await withCostTracking(
      async () => ({ result: 42, usage: { costUsd: 0 } }),
      baseLabels,
    );
    expect(out).toBe(42);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/content-engine && rtk vitest run tests/unit/content-generator/backends/ai/with-cost-tracking.test.ts`
Expected: FAIL with "Cannot find module '.../with-cost-tracking.js'".

- [ ] **Step 3: Implement `with-cost-tracking.ts`**

Create `apps/content-engine/src/services/content-generator/backends/ai/with-cost-tracking.ts`:

```typescript
/**
 * withCostTracking — emits an OTel metric (via trackAIUsage) and persists a
 * denormalized row to the costEvents collection for every wrapped call.
 *
 * The wrapped function returns its result PLUS a usage object. withCostTracking
 * unwraps the result for the caller and side-effects the cost tracking. Failures
 * are recorded as status='failure' with costUsd=0, and the original error is
 * rethrown so callers can react.
 *
 * The cost-event write itself is best-effort: a Mongo outage must NOT poison
 * the AI generation call.
 */

import { createLogger, trackAIUsage } from '@restropulse/telemetry/server';
import { insertCostEvent } from '@restropulse/db';
import type { CostEvent, CostOperation, CostSurface } from '@restropulse/shared';

const log = createLogger('ai-cost-tracker');

export interface CostTrackingLabels {
  restaurantId?: string;
  postId?: string;
  cycleId?: string;
  operation: CostOperation;
  surface: CostSurface;
  step: string;
  model: string;
}

export interface AICallUsage {
  inputTokens?: number;
  outputTokens?: number;
  costUsd: number;
}

export interface AICallResult<T> {
  result: T;
  usage: AICallUsage;
}

export async function withCostTracking<T>(
  fn: () => Promise<AICallResult<T>>,
  labels: CostTrackingLabels,
): Promise<T> {
  const start = Date.now();
  try {
    const { result, usage } = await fn();
    const durationMs = Date.now() - start;

    trackAIUsage({
      model: labels.model,
      operation: labels.operation,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      costUsd: usage.costUsd,
      durationMs,
      restaurantId: labels.restaurantId,
    });

    await persistCostEvent({
      ...labels,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: usage.costUsd,
      durationMs,
      status: 'success',
      createdAt: new Date(),
    });

    return result;
  } catch (err) {
    const durationMs = Date.now() - start;
    const errorCode = (err as Error)?.name ?? 'UnknownError';

    await persistCostEvent({
      ...labels,
      costUsd: 0,
      durationMs,
      status: 'failure',
      errorCode,
      createdAt: new Date(),
    });

    throw err;
  }
}

async function persistCostEvent(event: Omit<CostEvent, 'id'>): Promise<void> {
  try {
    await insertCostEvent(event);
  } catch (err) {
    log.error({ err, postId: event.postId, restaurantId: event.restaurantId }, 'Failed to persist cost event; continuing');
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/content-engine && rtk vitest run tests/unit/content-generator/backends/ai/with-cost-tracking.test.ts`
Expected: PASS, all 5 assertions green.

---

## Task 8: Integration test — `cost-events` round-trip via `mongodb-memory-server`

**Files:**
- Create: `apps/content-engine/tests/integration/cost-events.test.ts`

- [ ] **Step 1: Create the failing test**

Create `apps/content-engine/tests/integration/cost-events.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
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

const {
  insertCostEvent,
  findCostEventsByPost,
  findCostEventsByRestaurant,
  sumCostByRestaurant,
} = await import('@restropulse/db');

let mongod: MongoMemoryServer;
let client: MongoClient;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongod.getUri());
  setDB(client.db('cost-events-test'));
}, 60000);

afterAll(async () => {
  await client.close();
  await mongod.stop();
}, 20000);

beforeEach(async () => {
  await client.db('cost-events-test').collection('costEvents').deleteMany({});
});

describe('costEvents collection helpers', () => {
  it('insertCostEvent persists and returns id', async () => {
    const saved = await insertCostEvent({
      restaurantId: 'r1',
      postId: 'p1',
      operation: 'generatePost',
      surface: 'llm',
      step: 'caption',
      model: 'claude-sonnet-4-6',
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.012,
      durationMs: 800,
      status: 'success',
      createdAt: new Date(),
    });
    expect(saved.id).toBeTruthy();
    expect(saved.costUsd).toBe(0.012);
  });

  it('findCostEventsByPost returns rows in createdAt order', async () => {
    const t0 = new Date('2026-05-03T10:00:00Z');
    const t1 = new Date('2026-05-03T10:00:01Z');
    await insertCostEvent({
      postId: 'p1', operation: 'generatePost', surface: 'llm', step: 'caption',
      model: 'm', costUsd: 0.01, durationMs: 1, status: 'success', createdAt: t1,
    });
    await insertCostEvent({
      postId: 'p1', operation: 'generatePost', surface: 'image', step: 'image',
      model: 'flux', costUsd: 0.025, durationMs: 1500, status: 'success', createdAt: t0,
    });
    const rows = await findCostEventsByPost('p1');
    expect(rows).toHaveLength(2);
    expect(rows[0].surface).toBe('image');
    expect(rows[1].surface).toBe('llm');
  });

  it('findCostEventsByRestaurant filters by date range', async () => {
    await insertCostEvent({
      restaurantId: 'r1', operation: 'generatePost', surface: 'llm', step: 'caption',
      model: 'm', costUsd: 0.01, durationMs: 1, status: 'success', createdAt: new Date('2026-05-01T00:00:00Z'),
    });
    await insertCostEvent({
      restaurantId: 'r1', operation: 'generatePost', surface: 'llm', step: 'caption',
      model: 'm', costUsd: 0.02, durationMs: 1, status: 'success', createdAt: new Date('2026-05-15T00:00:00Z'),
    });
    const inRange = await findCostEventsByRestaurant('r1', {
      from: new Date('2026-05-10T00:00:00Z'),
      to: new Date('2026-05-20T00:00:00Z'),
    });
    expect(inRange).toHaveLength(1);
    expect(inRange[0].costUsd).toBe(0.02);
  });

  it('sumCostByRestaurant adds up costUsd', async () => {
    for (const cost of [0.01, 0.02, 0.05]) {
      await insertCostEvent({
        restaurantId: 'r1', operation: 'generatePost', surface: 'llm', step: 'caption',
        model: 'm', costUsd: cost, durationMs: 1, status: 'success', createdAt: new Date(),
      });
    }
    const total = await sumCostByRestaurant('r1');
    expect(total).toBeCloseTo(0.08, 5);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `cd apps/content-engine && rtk vitest run tests/integration/cost-events.test.ts`
Expected: PASS, all 4 assertions green. (Also verifies Tasks 1-2 wired correctly.)

- [ ] **Step 3: Run all `ai-generator` + cost-events tests together**

Run: `cd apps/content-engine && rtk vitest run tests/unit/content-generator/backends/ai tests/integration/cost-events.test.ts`
Expected: 4 test files, all green.

- [ ] **Step 4: Run type-check across affected workspaces**

Run (from repo root): `rtk npm run type-check --workspace=@restropulse/shared && rtk npm run type-check --workspace=@restropulse/db && rtk npm run type-check --workspace=@restropulse/content-engine`
Expected: all exit 0.

- [ ] **Step 5: Stage Checkpoint A files and request user review**

Run:
```bash
rtk git add \
  packages/shared/src/cost-events.ts packages/shared/src/index.ts \
  packages/db/src/cost-events.ts packages/db/src/connection.ts packages/db/src/index.ts \
  apps/content-engine/src/services/content-generator/backends/ai/errors.ts \
  apps/content-engine/src/services/content-generator/backends/ai/with-retry.ts \
  apps/content-engine/src/services/content-generator/backends/ai/with-cost-tracking.ts \
  apps/content-engine/tests/unit/content-generator/backends/ai/errors.test.ts \
  apps/content-engine/tests/unit/content-generator/backends/ai/with-retry.test.ts \
  apps/content-engine/tests/unit/content-generator/backends/ai/with-cost-tracking.test.ts \
  apps/content-engine/tests/integration/cost-events.test.ts
rtk git status
rtk git diff --staged --stat
```

**STOP. Show the user the status + stat output and ASK: "Checkpoint A complete — foundational helpers + cost-events plumbing. Approve continuing to Checkpoint B (specialization + AIContentGenerator stub + factory + worker wiring)?" Do NOT commit. Do NOT proceed until the user explicitly approves.**

---

# CHECKPOINT B — IDomainSpecialization, RestaurantSpecialization, AIContentGenerator stub, factory, worker wiring

## Task 9: Define `IDomainSpecialization` interface + supporting types

**Files:**
- Create: `apps/content-engine/src/services/content-generator/backends/ai/specialization/types.ts`
- Create: `apps/content-engine/src/services/content-generator/backends/ai/specialization/index.ts`

- [ ] **Step 1: Create the types module**

Create `apps/content-engine/src/services/content-generator/backends/ai/specialization/types.ts`:

```typescript
/**
 * IDomainSpecialization — the seam at which the content engine becomes
 * multi-domain. This phase ships exactly one concrete implementation
 * (RestaurantSpecialization). The interface stays small enough that adding
 * a second domain (salon, fitness, retail) does not force a redesign.
 *
 * See ADR 0001 §6.2 for the rationale behind every method on this interface.
 */

import type {
  GeneratedCycle,
  GeneratedPost,
  GeneratePostInput,
  PostType,
  Platform,
  DraftCycleInput,
  ReviseCycleInput,
  RevisePostInput,
} from '../../types.js';

export type SpecializationOperation = 'draftCycle' | 'reviseCycle' | 'generatePost' | 'revisePost';

export type SpecializationOperationInput =
  | DraftCycleInput
  | ReviseCycleInput
  | GeneratePostInput
  | RevisePostInput;

export type SonarQueryScope = 'daily-platform' | 'per-post-trigger';

export interface SpecializationContext {
  restaurantId?: string;
  restaurantName?: string;
  cuisine?: string;
  region?: string;
  brandVoice?: string;
  dietaryFocus?: string[];
  locale?: string;
}

export interface ImageGenInput {
  postType: PostType;
  platforms: Platform[];
  concept: string;
  themes?: string[];
  caption?: string;
}

export interface ValidationIssue {
  severity: 'error' | 'warning';
  field: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

export interface IDomainSpecialization {
  readonly domain: string;
  readonly version: string;

  getSystemPromptFragment(ctx: SpecializationContext): string;

  getTaskPrompt(
    operation: SpecializationOperation,
    input: SpecializationOperationInput,
    ctx: SpecializationContext,
  ): string;

  getSonarQueries(scope: SonarQueryScope, ctx: SpecializationContext): string[];

  getImagePromptFragment(input: ImageGenInput, ctx: SpecializationContext): string;

  selectHashtags(caption: string, ctx: SpecializationContext): string[];

  validateOutput(
    output: GeneratedPost | GeneratedCycle,
    ctx: SpecializationContext,
  ): ValidationResult;
}
```

- [ ] **Step 2: Create the barrel**

Create `apps/content-engine/src/services/content-generator/backends/ai/specialization/index.ts`:

```typescript
export * from './types.js';
export { RestaurantSpecialization } from './restaurant/index.js';
```

(The `restaurant/index.ts` file is created in Task 11; type-check on this barrel will fail until then. That is expected.)

- [ ] **Step 3: Verify TS recognizes the new types module**

Run: `cd apps/content-engine && rtk tsc --noEmit src/services/content-generator/backends/ai/specialization/types.ts 2>&1 | head -20`
Expected: no errors specific to `types.ts` itself (errors in `index.ts` about missing `./restaurant/index.js` are expected and resolve in Task 11).

---

## Task 10: Write failing tests for `RestaurantSpecialization`

**Files:**
- Create: `apps/content-engine/tests/unit/content-generator/backends/ai/specialization/restaurant.test.ts`

- [ ] **Step 1: Create the test file**

Create `apps/content-engine/tests/unit/content-generator/backends/ai/specialization/restaurant.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { RestaurantSpecialization } from '../../../../../src/services/content-generator/backends/ai/specialization/index.js';
import type {
  GeneratedPost,
  GeneratePostInput,
} from '../../../../../src/services/content-generator/types.js';

const spec = new RestaurantSpecialization();
const ctx = {
  restaurantId: 'r1',
  restaurantName: 'Spice Route',
  cuisine: 'South Indian',
  region: 'Bengaluru',
  brandVoice: 'homestyle',
  dietaryFocus: ['vegetarian'],
  locale: 'en-IN',
};

describe('RestaurantSpecialization metadata', () => {
  it('declares domain "restaurant"', () => {
    expect(spec.domain).toBe('restaurant');
  });

  it('exposes a semver version string', () => {
    expect(spec.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('getSystemPromptFragment', () => {
  it('mentions restaurants and the supplied brand voice', () => {
    const out = spec.getSystemPromptFragment(ctx);
    expect(out.toLowerCase()).toContain('restaurant');
    expect(out).toContain('homestyle');
    expect(out).toContain('Spice Route');
  });

  it('includes the FSSAI guardrail (no over-promising health claims)', () => {
    const out = spec.getSystemPromptFragment(ctx);
    expect(out.toLowerCase()).toContain('fssai');
  });
});

describe('getTaskPrompt', () => {
  it('returns a non-empty prompt per operation', () => {
    const input: GeneratePostInput = {
      concept: 'Friday biryani special',
      type: 'IMAGE',
      platforms: ['INSTAGRAM'],
    };
    const ops = ['draftCycle', 'reviseCycle', 'generatePost', 'revisePost'] as const;
    for (const op of ops) {
      const out = spec.getTaskPrompt(op, input as any, ctx);
      expect(out.length).toBeGreaterThan(20);
    }
  });
});

describe('getSonarQueries', () => {
  it('daily-platform scope returns at least one restaurant-framed query', () => {
    const queries = spec.getSonarQueries('daily-platform', ctx);
    expect(queries.length).toBeGreaterThan(0);
    expect(queries[0].toLowerCase()).toContain('restaurant');
  });

  it('per-post-trigger scope tunes to cuisine/region from context', () => {
    const queries = spec.getSonarQueries('per-post-trigger', ctx);
    expect(queries.some((q) => q.includes('Bengaluru'))).toBe(true);
    expect(queries.some((q) => q.includes('South Indian'))).toBe(true);
  });
});

describe('getImagePromptFragment', () => {
  it('includes food-photography lighting + angle direction for IMAGE posts', () => {
    const fragment = spec.getImagePromptFragment(
      { postType: 'IMAGE', platforms: ['INSTAGRAM'], concept: 'paneer tikka' },
      ctx,
    );
    expect(fragment.toLowerCase()).toMatch(/lighting|golden|warm/);
    expect(fragment.toLowerCase()).toMatch(/angle|hero|flat/);
  });
});

describe('selectHashtags', () => {
  it('returns between 5 and 8 hashtags', () => {
    const tags = spec.selectHashtags('Try our weekend dosa platter', ctx);
    expect(tags.length).toBeGreaterThanOrEqual(5);
    expect(tags.length).toBeLessThanOrEqual(8);
  });

  it('mixes broad + cuisine + location tiers', () => {
    const tags = spec.selectHashtags('Try our weekend dosa platter', ctx);
    expect(tags.some((t) => t.toLowerCase().includes('food'))).toBe(true);
    expect(tags.some((t) => t.toLowerCase().includes('south'))).toBe(true);
    expect(tags.some((t) => t.toLowerCase().includes('bengaluru'))).toBe(true);
  });

  it('filters denylisted tags', () => {
    const tags = spec.selectHashtags('Try our weekend dosa platter', ctx);
    expect(tags.every((t) => !t.toLowerCase().includes('like4like'))).toBe(true);
  });

  it('returns lowercase tags prefixed with #', () => {
    const tags = spec.selectHashtags('Try our weekend dosa platter', ctx);
    for (const t of tags) {
      expect(t.startsWith('#')).toBe(true);
      expect(t).toBe(t.toLowerCase());
    }
  });
});

describe('validateOutput', () => {
  const validPost: GeneratedPost = {
    caption: 'Soft, flaky, ghee-laced parotta straight off the tawa.\n\n#food #southindian #bengaluru #parotta #ghee',
    thumbnail: 'http://localhost/x.jpg',
  };

  it('returns ok=true for a clean post', () => {
    const r = spec.validateOutput(validPost, ctx);
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it('rejects FSSAI-violating health claims', () => {
    const bad: GeneratedPost = {
      caption: 'Our biryani cures diabetes and prevents cancer!',
      thumbnail: 'http://localhost/x.jpg',
    };
    const r = spec.validateOutput(bad, ctx);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.severity === 'error' && /fssai|health/i.test(i.message))).toBe(true);
  });

  it('warns on captions exceeding Instagram total limit (2200)', () => {
    const long: GeneratedPost = {
      caption: 'x'.repeat(2300),
      thumbnail: 'http://localhost/x.jpg',
    };
    const r = spec.validateOutput(long, ctx);
    expect(r.issues.some((i) => i.severity === 'warning' && /2200|length/i.test(i.message))).toBe(true);
  });

  it('warns on hashtag count outside [3,15]', () => {
    const tooFew: GeneratedPost = {
      caption: 'Plain caption with #only #two',
      thumbnail: 'http://localhost/x.jpg',
    };
    const r = spec.validateOutput(tooFew, ctx);
    expect(r.issues.some((i) => /hashtag/i.test(i.message))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/content-engine && rtk vitest run tests/unit/content-generator/backends/ai/specialization/restaurant.test.ts`
Expected: FAIL with "Cannot find module '.../specialization/index.js'" or `RestaurantSpecialization is not a constructor`.

---

## Task 11: Implement `RestaurantSpecialization` and its supporting modules

**Files:**
- Create: `apps/content-engine/src/services/content-generator/backends/ai/specialization/restaurant/prompts.ts`
- Create: `apps/content-engine/src/services/content-generator/backends/ai/specialization/restaurant/sonar-queries.ts`
- Create: `apps/content-engine/src/services/content-generator/backends/ai/specialization/restaurant/content-patterns.ts`
- Create: `apps/content-engine/src/services/content-generator/backends/ai/specialization/restaurant/visual-direction.ts`
- Create: `apps/content-engine/src/services/content-generator/backends/ai/specialization/restaurant/platform-tactics.ts`
- Create: `apps/content-engine/src/services/content-generator/backends/ai/specialization/restaurant/hashtag-strategy.ts`
- Create: `apps/content-engine/src/services/content-generator/backends/ai/specialization/restaurant/psychology.ts`
- Create: `apps/content-engine/src/services/content-generator/backends/ai/specialization/restaurant/index.ts`

- [ ] **Step 1: `prompts.ts`**

Create `apps/content-engine/src/services/content-generator/backends/ai/specialization/restaurant/prompts.ts`:

```typescript
/**
 * Restaurant-domain system + per-operation task prompts.
 *
 * Plain string assembly. Anthropic prompt caching (added in phase 2) will treat
 * the system prompt fragment as a cache breakpoint; keep it stable.
 */

import type {
  SpecializationContext,
  SpecializationOperation,
  SpecializationOperationInput,
} from '../types.js';

export function buildSystemPromptFragment(ctx: SpecializationContext): string {
  const name = ctx.restaurantName ?? 'the restaurant';
  const voice = ctx.brandVoice ?? 'warm and inviting';
  const cuisine = ctx.cuisine ?? 'multi-cuisine';
  const dietary = ctx.dietaryFocus?.length ? ctx.dietaryFocus.join(', ') : 'none specified';

  return [
    `You are an expert social media copywriter and creative director for restaurants in India.`,
    `You write content for ${name}, a ${cuisine} restaurant.`,
    `Brand voice: ${voice}.`,
    `Dietary focus: ${dietary}.`,
    ``,
    `RULES:`,
    `- Use sensory-first language (texture, aroma, temperature, sound). Specificity wins.`,
    `- Do NOT make health claims. FSSAI restricts wording like "cures", "prevents disease",`,
    `  "weight loss", "boosts immunity". Avoid them entirely.`,
    `- Match the brand voice on every line.`,
    `- Never invent menu items, ingredients, prices, or offers that were not provided.`,
    `- Captions should pull readers in within the first sentence (the above-the-fold cut at ~125 chars on Instagram).`,
  ].join('\n');
}

export function buildTaskPrompt(
  operation: SpecializationOperation,
  input: SpecializationOperationInput,
  ctx: SpecializationContext,
): string {
  switch (operation) {
    case 'draftCycle':
      return [
        `Draft a content cycle for ${ctx.restaurantName ?? 'the restaurant'}.`,
        `Period: ${(input as any).period ?? 'unspecified'}.`,
        `Themes: ${((input as any).strategyThemes ?? []).join(', ') || 'general'}.`,
        `Produce a balanced mix across the seven restaurant content archetypes.`,
      ].join('\n');

    case 'reviseCycle':
      return [
        `Revise the supplied cycle while addressing every item in the feedback.`,
        `Keep what worked; change only what the feedback flags.`,
      ].join('\n');

    case 'generatePost':
      return [
        `Generate a single post for the supplied concept.`,
        `Concept: ${(input as any).concept ?? 'unspecified'}.`,
        `Type: ${(input as any).type ?? 'IMAGE'}. Platforms: ${((input as any).platforms ?? []).join(', ') || 'INSTAGRAM'}.`,
      ].join('\n');

    case 'revisePost':
      return [
        `Revise the existing post to address every item in the feedback.`,
        `Preserve the original concept and tone; modify only what feedback flags.`,
      ].join('\n');
  }
}
```

- [ ] **Step 2: `sonar-queries.ts`**

Create:

```typescript
/**
 * Restaurant-tuned Perplexity Sonar query templates (phase 3 will call these).
 */

import type { SonarQueryScope, SpecializationContext } from '../types.js';

export function buildSonarQueries(scope: SonarQueryScope, ctx: SpecializationContext): string[] {
  if (scope === 'daily-platform') {
    return [
      'What major Indian holidays, sports events, festivals, weather events, and trending topics today and tomorrow could a restaurant reference in social media content?',
    ];
  }

  const cuisine = ctx.cuisine ?? 'Indian';
  const region = ctx.region ?? 'India';

  return [
    `What are the trending food and dining conversations in ${region} this week that a ${cuisine} restaurant could tap into on Instagram?`,
    `What ${cuisine} cuisine moments (dish history, regional traditions) would resonate with diners in ${region} right now?`,
    `What sports, festival, or weather hooks in ${region} are restaurant audiences engaging with on social media this week?`,
  ];
}
```

- [ ] **Step 3: `content-patterns.ts`**

Create:

```typescript
/**
 * Seven high-performing restaurant content archetypes (ADR 0001 §6.2).
 *
 * Phase 2's caption generator will sample these when no specific archetype is
 * supplied. Phase 1 only ships the catalog and a shape.
 */

export type RestaurantArchetypeId =
  | 'CHEFS_PICK'
  | 'BEHIND_THE_SCENES'
  | 'SOCIAL_PROOF'
  | 'FESTIVAL_TIE_IN'
  | 'CUISINE_EDUCATION'
  | 'OFFER_PROMO'
  | 'ORIGIN_STORY';

export interface RestaurantArchetype {
  id: RestaurantArchetypeId;
  label: string;
  description: string;
  hook: string;
}

export const RESTAURANT_ARCHETYPES: ReadonlyArray<RestaurantArchetype> = [
  { id: 'CHEFS_PICK', label: "Chef's Pick", description: 'Featured dish + price + scarcity hook', hook: 'Today only:' },
  { id: 'BEHIND_THE_SCENES', label: 'Behind the Scenes', description: 'Kitchen prep, plating, sourcing', hook: 'How it is made:' },
  { id: 'SOCIAL_PROOF', label: 'Social Proof', description: 'Reviews, UGC reposts, occasion celebrations', hook: 'Loved by:' },
  { id: 'FESTIVAL_TIE_IN', label: 'Festival Tie-in', description: 'Holiday/season-themed combos and specials', hook: 'Just in time for:' },
  { id: 'CUISINE_EDUCATION', label: 'Cuisine Education', description: 'Origin / technique / ingredient explainer', hook: 'Did you know:' },
  { id: 'OFFER_PROMO', label: 'Offer / Promo', description: 'Combo deal, weekday discount, loyalty reward', hook: 'This week:' },
  { id: 'ORIGIN_STORY', label: 'Origin Story', description: 'Chef interview, sourcing story, sustainability angle', hook: 'Behind the brand:' },
];
```

- [ ] **Step 4: `visual-direction.ts`**

Create:

```typescript
import type { ImageGenInput, SpecializationContext } from '../types.js';

export function buildImagePromptFragment(input: ImageGenInput, ctx: SpecializationContext): string {
  const lighting = 'warm golden-hour-style lighting';
  const angleByType: Record<string, string> = {
    IMAGE: '45-degree hero angle for plated dishes',
    CAROUSEL: 'consistent angle and lighting across all frames',
    REEL: 'cinematic close-ups; macro for textures',
    VIDEO: 'cinematic close-ups; macro for textures',
    STORY: 'portrait 9:16 framing; centered subject',
    FACEBOOK: 'environmental shot showing the dish in context',
  };
  const angle = angleByType[input.postType] ?? '45-degree hero angle';
  const surface = ctx.cuisine?.toLowerCase().includes('south') ? 'banana leaf or weathered wood' : 'wooden or marble surface';

  return [
    `Style: appetizing food photography for an Indian restaurant, ${lighting}.`,
    `Angle: ${angle}.`,
    `Surface: ${surface}; thoughtful garnish; minimal but natural composition.`,
    `Avoid: heavy filters, oversaturation, plastic-looking food, fingers in frame.`,
  ].join('\n');
}
```

- [ ] **Step 5: `platform-tactics.ts`**

Create:

```typescript
import type { Platform, PostType } from '@restropulse/shared';

export interface PlatformTactics {
  aspectRatio: string;
  hashtagPosition: 'inline-end' | 'first-comment';
  hashtagCount: { min: number; max: number };
  captionLength: { aboveFoldChars: number; totalChars: number };
}

export function getPlatformTactics(platform: Platform, _postType: PostType): PlatformTactics {
  switch (platform) {
    case 'INSTAGRAM':
      return {
        aspectRatio: '1:1 (feed) / 9:16 (reel/story)',
        hashtagPosition: 'inline-end',
        hashtagCount: { min: 5, max: 8 },
        captionLength: { aboveFoldChars: 125, totalChars: 2200 },
      };
    case 'FACEBOOK':
      return {
        aspectRatio: '4:5 (feed) / 9:16 (reel)',
        hashtagPosition: 'inline-end',
        hashtagCount: { min: 1, max: 3 },
        captionLength: { aboveFoldChars: 250, totalChars: 5000 },
      };
    default:
      return {
        aspectRatio: '1:1',
        hashtagPosition: 'inline-end',
        hashtagCount: { min: 3, max: 8 },
        captionLength: { aboveFoldChars: 125, totalChars: 2200 },
      };
  }
}
```

- [ ] **Step 6: `hashtag-strategy.ts`**

Create:

```typescript
import type { SpecializationContext } from '../types.js';

const BROAD_TAGS = ['#foodie', '#foodlover', '#instafood', '#foodphotography', '#foodgram'];

const CUISINE_TAGS_BY_KEYWORD: Record<string, string[]> = {
  south: ['#southindianfood', '#southindiancuisine', '#dosa', '#idli'],
  north: ['#northindianfood', '#punjabifood'],
  italian: ['#italianfood', '#pasta', '#pizza'],
  chinese: ['#chinesefood', '#indochinese'],
  multi: ['#indianfood', '#indiancuisine'],
};

const DENYLIST = new Set([
  '#like4like', '#follow4follow', '#l4l', '#f4f', '#tagsforlikes', '#followforfollow',
]);

function lower(s: string): string {
  return s.toLowerCase();
}

function locationTags(region?: string): string[] {
  if (!region) return [];
  const slug = region.toLowerCase().replace(/[^a-z]/g, '');
  return [`#${slug}food`, `#${slug}foodie`, `#${slug}`];
}

function cuisineTags(cuisine?: string): string[] {
  if (!cuisine) return CUISINE_TAGS_BY_KEYWORD.multi;
  const c = cuisine.toLowerCase();
  for (const key of Object.keys(CUISINE_TAGS_BY_KEYWORD)) {
    if (c.includes(key)) return CUISINE_TAGS_BY_KEYWORD[key];
  }
  return CUISINE_TAGS_BY_KEYWORD.multi;
}

export function selectRestaurantHashtags(_caption: string, ctx: SpecializationContext): string[] {
  const merged = [
    ...BROAD_TAGS.slice(0, 2),
    ...cuisineTags(ctx.cuisine).slice(0, 2),
    ...locationTags(ctx.region).slice(0, 3),
  ]
    .map(lower)
    .filter((t, i, arr) => arr.indexOf(t) === i)
    .filter((t) => !DENYLIST.has(t));

  const target = Math.min(8, Math.max(5, merged.length));
  return merged.slice(0, target);
}
```

- [ ] **Step 7: `psychology.ts`**

Create:

```typescript
/**
 * Buyer-psychology hook fragments. Phase 2 caption generation may inject
 * one of these into prompts based on the post archetype.
 */

export const PSYCHOLOGY_HOOKS = {
  SCARCITY: 'Limited servings each evening — first come, first served.',
  SOCIAL_PROOF: 'Loved by diners who know their {cuisine}.',
  FOMO: 'Available only this week — back in two months.',
  CURIOSITY: 'Three things even regulars do not know about this dish:',
  AUTHORITY: 'A 40-year-old family recipe, plated as we plate it for our own table.',
} as const;

export type PsychologyHookId = keyof typeof PSYCHOLOGY_HOOKS;
```

- [ ] **Step 8: `index.ts` — assemble `RestaurantSpecialization`**

Create `apps/content-engine/src/services/content-generator/backends/ai/specialization/restaurant/index.ts`:

```typescript
import type { GeneratedCycle, GeneratedPost } from '../../../types.js';
import type {
  IDomainSpecialization,
  SpecializationContext,
  SpecializationOperation,
  SpecializationOperationInput,
  SonarQueryScope,
  ImageGenInput,
  ValidationIssue,
  ValidationResult,
} from '../types.js';
import { buildSystemPromptFragment, buildTaskPrompt } from './prompts.js';
import { buildSonarQueries } from './sonar-queries.js';
import { buildImagePromptFragment } from './visual-direction.js';
import { selectRestaurantHashtags } from './hashtag-strategy.js';

const FSSAI_VIOLATING_PATTERNS: RegExp[] = [
  /\bcures?\b/i,
  /\bprevents?\s+(disease|cancer|diabetes)/i,
  /\bweight\s*loss\b/i,
  /\bboosts?\s+immunity\b/i,
  /\btreats?\s+(disease|illness)/i,
];

const INSTAGRAM_TOTAL_CHAR_LIMIT = 2200;
const HASHTAG_MIN = 3;
const HASHTAG_MAX = 15;

function countHashtags(caption: string): number {
  return (caption.match(/#[\w-]+/g) ?? []).length;
}

function validateGeneratedPost(post: GeneratedPost): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const pattern of FSSAI_VIOLATING_PATTERNS) {
    if (pattern.test(post.caption)) {
      issues.push({
        severity: 'error',
        field: 'caption',
        message: 'Caption contains an FSSAI-restricted health claim. Remove wording about cures, disease prevention, weight loss, or immunity.',
      });
      break;
    }
  }

  if (post.caption.length > INSTAGRAM_TOTAL_CHAR_LIMIT) {
    issues.push({
      severity: 'warning',
      field: 'caption',
      message: `Caption length ${post.caption.length} exceeds Instagram total limit of ${INSTAGRAM_TOTAL_CHAR_LIMIT} characters.`,
    });
  }

  const hashtagCount = countHashtags(post.caption);
  if (hashtagCount < HASHTAG_MIN || hashtagCount > HASHTAG_MAX) {
    issues.push({
      severity: 'warning',
      field: 'caption',
      message: `Hashtag count ${hashtagCount} is outside recommended range [${HASHTAG_MIN}, ${HASHTAG_MAX}].`,
    });
  }

  return issues;
}

export class RestaurantSpecialization implements IDomainSpecialization {
  readonly domain = 'restaurant';
  readonly version = '0.1.0';

  getSystemPromptFragment(ctx: SpecializationContext): string {
    return buildSystemPromptFragment(ctx);
  }

  getTaskPrompt(
    operation: SpecializationOperation,
    input: SpecializationOperationInput,
    ctx: SpecializationContext,
  ): string {
    return buildTaskPrompt(operation, input, ctx);
  }

  getSonarQueries(scope: SonarQueryScope, ctx: SpecializationContext): string[] {
    return buildSonarQueries(scope, ctx);
  }

  getImagePromptFragment(input: ImageGenInput, ctx: SpecializationContext): string {
    return buildImagePromptFragment(input, ctx);
  }

  selectHashtags(caption: string, ctx: SpecializationContext): string[] {
    return selectRestaurantHashtags(caption, ctx);
  }

  validateOutput(
    output: GeneratedPost | GeneratedCycle,
    _ctx: SpecializationContext,
  ): ValidationResult {
    if ('caption' in output) {
      const issues = validateGeneratedPost(output);
      return { ok: issues.every((i) => i.severity !== 'error'), issues };
    }
    return { ok: true, issues: [] };
  }
}
```

- [ ] **Step 9: Run the restaurant tests to verify they pass**

Run: `cd apps/content-engine && rtk vitest run tests/unit/content-generator/backends/ai/specialization/restaurant.test.ts`
Expected: PASS, all assertions green.

---

## Task 12: Write failing tests for `AIContentGenerator` stub

**Files:**
- Create: `apps/content-engine/tests/unit/content-generator/backends/ai/ai-content-generator.test.ts`

- [ ] **Step 1: Create the test file**

Create `apps/content-engine/tests/unit/content-generator/backends/ai/ai-content-generator.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { AIContentGenerator } from '../../../../src/services/content-generator/backends/ai/ai-content-generator.js';
import { RestaurantSpecialization } from '../../../../src/services/content-generator/backends/ai/specialization/index.js';
import { ContentGenerationError } from '../../../../src/services/content-generator/types.js';

const gen = new AIContentGenerator({ specialization: new RestaurantSpecialization() });

describe('AIContentGenerator (phase 1 stub)', () => {
  it('exposes name "ai"', () => {
    expect(gen.name).toBe('ai');
  });

  it('exposes the configured specialization', () => {
    expect(gen.specialization.domain).toBe('restaurant');
  });

  it('throws BACKEND_UNAVAILABLE from draftCycle until phase 2 wires the LLM', async () => {
    await expect(
      gen.draftCycle({ period: 'week-of-2026-05-04' }),
    ).rejects.toMatchObject({ name: 'ContentGenerationError', code: 'BACKEND_UNAVAILABLE' });
  });

  it('throws BACKEND_UNAVAILABLE from reviseCycle until phase 2 wires the LLM', async () => {
    await expect(
      gen.reviseCycle({
        existingCycle: {
          period: 'w', summary: 's', plannedPosts: [], focus: [],
        },
        feedback: { areas: [], note: '' },
      }),
    ).rejects.toMatchObject({ code: 'BACKEND_UNAVAILABLE' });
  });

  it('throws BACKEND_UNAVAILABLE from generatePost until phase 2 wires the LLM', async () => {
    await expect(
      gen.generatePost({ concept: 'test', type: 'IMAGE', platforms: ['INSTAGRAM'] }),
    ).rejects.toMatchObject({ code: 'BACKEND_UNAVAILABLE' });
  });

  it('throws BACKEND_UNAVAILABLE from revisePost until phase 2 wires the LLM', async () => {
    await expect(
      gen.revisePost({
        existingPost: { type: 'IMAGE', platforms: ['INSTAGRAM'], caption: 'c' },
        feedback: { tags: [], details: {}, note: '' },
      }),
    ).rejects.toMatchObject({ code: 'BACKEND_UNAVAILABLE' });
  });

  it('reports unhealthy from healthCheck while LLM is not wired', async () => {
    const r = await gen.healthCheck!();
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/llm|not wired|phase 2/i);
  });

  it('throws when constructed without a specialization', () => {
    expect(() => new AIContentGenerator({} as any)).toThrow(ContentGenerationError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/content-engine && rtk vitest run tests/unit/content-generator/backends/ai/ai-content-generator.test.ts`
Expected: FAIL with "Cannot find module '.../ai-content-generator.js'".

---

## Task 13: Implement `AIContentGenerator` stub

**Files:**
- Create: `apps/content-engine/src/services/content-generator/backends/ai/ai-content-generator.ts`

- [ ] **Step 1: Create the module**

Create `apps/content-engine/src/services/content-generator/backends/ai/ai-content-generator.ts`:

```typescript
/**
 * AIContentGenerator — phase 1 stub.
 *
 * Implements IContentGenerator (via BaseContentGenerator) and holds a reference
 * to its IDomainSpecialization. Each operation throws BACKEND_UNAVAILABLE until
 * phase 2 wires Vercel AI SDK LLM calls. The factory still returns this when
 * CONTENT_GENERATOR_BACKEND=ai so the seam is exercised end-to-end and any
 * misconfigured environment fails loudly at the first generation attempt rather
 * than silently falling back to placeholder.
 */

import { createLogger } from '@restropulse/telemetry/server';
import { BaseContentGenerator } from '../base-generator.js';
import {
  ContentGenerationError,
  type DraftCycleInput,
  type GeneratedCycle,
  type GeneratedPost,
  type GenerationContext,
  type GeneratePostInput,
  type ReviseCycleInput,
  type RevisePostInput,
} from '../types.js';
import type { IDomainSpecialization } from './specialization/index.js';

const log = createLogger('ai-content-generator');

const NOT_WIRED_DETAIL = 'AI generator scaffolded but the LLM provider is not yet wired. This lands in phase 2.';

export interface AIContentGeneratorOptions {
  specialization: IDomainSpecialization;
}

export class AIContentGenerator extends BaseContentGenerator {
  readonly name = 'ai';
  readonly specialization: IDomainSpecialization;

  constructor(options: AIContentGeneratorOptions) {
    super();
    if (!options || !options.specialization) {
      throw new ContentGenerationError(
        'INVALID_INPUT',
        'AIContentGenerator requires a specialization in its constructor options.',
      );
    }
    this.specialization = options.specialization;
    log.info(
      { domain: this.specialization.domain, version: this.specialization.version },
      'AIContentGenerator instantiated (phase 1 stub)',
    );
  }

  async draftCycle(_input: DraftCycleInput, _ctx?: GenerationContext): Promise<GeneratedCycle> {
    throw new ContentGenerationError('BACKEND_UNAVAILABLE', NOT_WIRED_DETAIL);
  }

  async reviseCycle(_input: ReviseCycleInput, _ctx?: GenerationContext): Promise<GeneratedCycle> {
    throw new ContentGenerationError('BACKEND_UNAVAILABLE', NOT_WIRED_DETAIL);
  }

  async generatePostContent(_input: GeneratePostInput, _ctx?: GenerationContext): Promise<GeneratedPost> {
    throw new ContentGenerationError('BACKEND_UNAVAILABLE', NOT_WIRED_DETAIL);
  }

  async revisePostContent(_input: RevisePostInput, _ctx?: GenerationContext): Promise<GeneratedPost> {
    throw new ContentGenerationError('BACKEND_UNAVAILABLE', NOT_WIRED_DETAIL);
  }

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: false, detail: NOT_WIRED_DETAIL };
  }
}
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `cd apps/content-engine && rtk vitest run tests/unit/content-generator/backends/ai/ai-content-generator.test.ts`
Expected: PASS, all assertions green.

---

## Task 14: Add `backends/ai/index.ts` barrel export

**Files:**
- Create: `apps/content-engine/src/services/content-generator/backends/ai/index.ts`

- [ ] **Step 1: Create the barrel**

Create `apps/content-engine/src/services/content-generator/backends/ai/index.ts`:

```typescript
export { AIContentGenerator } from './ai-content-generator.js';
export type { AIContentGeneratorOptions } from './ai-content-generator.js';
export { withRetry, RETRY_PROFILES } from './with-retry.js';
export type { RetryProfile } from './with-retry.js';
export { withCostTracking } from './with-cost-tracking.js';
export type { CostTrackingLabels, AICallUsage, AICallResult } from './with-cost-tracking.js';
export { TransientError, RateLimitError, classifyError } from './errors.js';
export * from './specialization/index.js';
```

- [ ] **Step 2: Verify the barrel type-checks**

Run: `cd apps/content-engine && rtk npm run type-check`
Expected: exit 0.

---

## Task 15: Write failing tests for `factory.ts`

**Files:**
- Create: `apps/content-engine/tests/unit/content-generator/factory.test.ts`

- [ ] **Step 1: Create the test file**

Create `apps/content-engine/tests/unit/content-generator/factory.test.ts`:

```typescript
import { describe, it, expect, beforeAll, vi } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  trackAIUsage: vi.fn(),
}));

beforeAll(() => {
  process.env['ASSET_SERVER_BASE_URL'] = 'http://localhost:3002';
});

const { createContentGenerator } = await import('../../../src/services/content-generator/factory.js');

describe('createContentGenerator', () => {
  it('returns the placeholder backend by default ("placeholder")', () => {
    const g = createContentGenerator('placeholder');
    expect(g.name).toBe('placeholder');
  });

  it('returns the AI backend when "ai"', () => {
    const g = createContentGenerator('ai');
    expect(g.name).toBe('ai');
  });

  it('throws on an unknown backend string', () => {
    expect(() => createContentGenerator('chatgpt' as any)).toThrow(/unknown content generator backend/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/content-engine && rtk vitest run tests/unit/content-generator/factory.test.ts`
Expected: FAIL with "Cannot find module '.../factory.js'".

---

## Task 16: Implement `factory.ts` and update `content-generator/index.ts` barrel

**Files:**
- Create: `apps/content-engine/src/services/content-generator/factory.ts`
- Modify: `apps/content-engine/src/services/content-generator/index.ts`

- [ ] **Step 1: Create the factory**

Create `apps/content-engine/src/services/content-generator/factory.ts`:

```typescript
/**
 * createContentGenerator — selects the registered IContentGenerator backend
 * based on a flag string. Wired into worker.ts via the CONTENT_GENERATOR_BACKEND
 * env var. Default is 'placeholder' so existing deployments keep their
 * current behavior unless the flag is explicitly flipped.
 *
 * Adding a new backend: extend the union, add a case, and wire its dependencies
 * here (the worker should not learn the implementation details of any backend).
 */

import type { IContentGenerator } from './types.js';
import { PlaceholderContentGenerator } from './backends/placeholder/index.js';
import { AIContentGenerator } from './backends/ai/ai-content-generator.js';
import { RestaurantSpecialization } from './backends/ai/specialization/index.js';

export type ContentGeneratorBackend = 'placeholder' | 'ai';

export function createContentGenerator(backend: ContentGeneratorBackend): IContentGenerator {
  switch (backend) {
    case 'placeholder':
      return new PlaceholderContentGenerator();
    case 'ai':
      return new AIContentGenerator({ specialization: new RestaurantSpecialization() });
    default: {
      const exhaustive: never = backend;
      throw new Error(`Unknown content generator backend: ${String(exhaustive)}`);
    }
  }
}
```

- [ ] **Step 2: Update the barrel to expose factory + ai-generator**

Modify `apps/content-engine/src/services/content-generator/index.ts` to:

```typescript
export * from './types.js';
export { BaseContentGenerator } from './base-generator.js';
export { PlaceholderContentGenerator } from './backends/placeholder/index.js';
export {
  setContentGenerator,
  getContentGenerator,
  resetContentGenerator,
} from './provider.js';
export { createContentGenerator } from './factory.js';
export type { ContentGeneratorBackend } from './factory.js';
export * from './backends/ai/index.js';
```

- [ ] **Step 3: Run the factory test to verify it passes**

Run: `cd apps/content-engine && rtk vitest run tests/unit/content-generator/factory.test.ts`
Expected: PASS, all assertions green.

---

## Task 17: Wire the factory into `worker.ts` behind the env flag

**Files:**
- Modify: `apps/content-engine/src/worker.ts:38-71` (env schema + import) and `apps/content-engine/src/worker.ts:113-115` (registration call)

- [ ] **Step 1: Update the import block**

In `apps/content-engine/src/worker.ts`, replace lines 38-42:

```typescript
import {
  PlaceholderContentGenerator,
  setContentGenerator,
} from './services/content-generator/index.js';
```

With:

```typescript
import {
  createContentGenerator,
  setContentGenerator,
  type ContentGeneratorBackend,
} from './services/content-generator/index.js';
```

- [ ] **Step 2: Add `CONTENT_GENERATOR_BACKEND` to the env schema**

In `apps/content-engine/src/worker.ts`, inside the `loadAndValidateEnv` Zod schema (currently lines 48-70), add this line just after `ENABLED_PLATFORMS`:

```typescript
    CONTENT_GENERATOR_BACKEND: z.enum(['placeholder', 'ai']).default('placeholder'),
```

The full schema should look like (showing only the relevant block for context):

```typescript
    ENABLED_PLATFORMS: z.string().default('INSTAGRAM,FACEBOOK'),
    CONTENT_GENERATOR_BACKEND: z.enum(['placeholder', 'ai']).default('placeholder'),
  }).passthrough(),
});
```

- [ ] **Step 3: Replace the registration call**

In `apps/content-engine/src/worker.ts`, replace lines 113-115:

```typescript
    // Register the default content generator backend. Tests swap this via setContentGenerator().
    setContentGenerator(new PlaceholderContentGenerator());
    logger.info({ generator: 'placeholder' }, 'Content generator registered');
```

With:

```typescript
    // Register the configured content generator backend. Default is 'placeholder';
    // flip CONTENT_GENERATOR_BACKEND=ai to engage the AI generator (see ADR 0001).
    // Tests swap this via setContentGenerator().
    const backend: ContentGeneratorBackend = env.CONTENT_GENERATOR_BACKEND;
    setContentGenerator(createContentGenerator(backend));
    logger.info({ generator: backend }, 'Content generator registered');
```

- [ ] **Step 4: Type-check the worker**

Run: `cd apps/content-engine && rtk npm run type-check`
Expected: exit 0.

- [ ] **Step 5: Smoke test — boot the worker briefly with the default flag**

Run: `cd apps/content-engine && CONTENT_GENERATOR_BACKEND=placeholder rtk npx tsx --eval "import('./src/services/content-generator/factory.js').then(m => console.log(m.createContentGenerator('placeholder').name))"`
Expected: stdout contains `placeholder`.

Run: `cd apps/content-engine && rtk npx tsx --eval "import('./src/services/content-generator/factory.js').then(m => console.log(m.createContentGenerator('ai').name))"`
Expected: stdout contains `ai`.

---

## Task 18: Final verification + stage Checkpoint B + request commit approval

- [ ] **Step 1: Run the full test suite for the workspace**

Run: `cd apps/content-engine && rtk vitest run`
Expected: ALL tests pass, including pre-existing placeholder + processor tests. If anything fails, investigate before staging.

- [ ] **Step 2: Run type-check across all impacted workspaces**

Run (from repo root): `rtk npm run type-check`
Expected: exit 0.

- [ ] **Step 3: Run lint on the changed workspaces**

Run: `rtk npm run lint --workspace=@restropulse/content-engine && rtk npm run lint --workspace=@restropulse/db && rtk npm run lint --workspace=@restropulse/shared`
Expected: exit 0 (or warnings only).

- [ ] **Step 4: Stage Checkpoint B files (added to Checkpoint A's already-staged set)**

Run:
```bash
rtk git add \
  apps/content-engine/src/services/content-generator/backends/ai/ai-content-generator.ts \
  apps/content-engine/src/services/content-generator/backends/ai/index.ts \
  apps/content-engine/src/services/content-generator/backends/ai/specialization/types.ts \
  apps/content-engine/src/services/content-generator/backends/ai/specialization/index.ts \
  apps/content-engine/src/services/content-generator/backends/ai/specialization/restaurant/index.ts \
  apps/content-engine/src/services/content-generator/backends/ai/specialization/restaurant/prompts.ts \
  apps/content-engine/src/services/content-generator/backends/ai/specialization/restaurant/sonar-queries.ts \
  apps/content-engine/src/services/content-generator/backends/ai/specialization/restaurant/content-patterns.ts \
  apps/content-engine/src/services/content-generator/backends/ai/specialization/restaurant/visual-direction.ts \
  apps/content-engine/src/services/content-generator/backends/ai/specialization/restaurant/platform-tactics.ts \
  apps/content-engine/src/services/content-generator/backends/ai/specialization/restaurant/hashtag-strategy.ts \
  apps/content-engine/src/services/content-generator/backends/ai/specialization/restaurant/psychology.ts \
  apps/content-engine/src/services/content-generator/factory.ts \
  apps/content-engine/src/services/content-generator/index.ts \
  apps/content-engine/src/worker.ts \
  apps/content-engine/tests/unit/content-generator/backends/ai/ai-content-generator.test.ts \
  apps/content-engine/tests/unit/content-generator/backends/ai/specialization/restaurant.test.ts \
  apps/content-engine/tests/unit/content-generator/factory.test.ts \
  docs/superpowers/plans/2026-05-03-content-engine-ai-phase-1.md
rtk git status
rtk git diff --staged --stat
```

- [ ] **Step 5: Show user, request commit approval**

**STOP. Show the user the staged status + stat. Ask: "Phase 1 complete. All tests pass, type-check green, default backend is still placeholder. Approve committing as a single phase-1 commit?" Do NOT commit. Wait for explicit "approved" / "commit it".**

- [ ] **Step 6: After user approval — commit**

Run:
```bash
rtk git commit -m "$(cat <<'EOF'
feat(content-engine): scaffold ai-generator with feature flag, helpers, and RestaurantSpecialization

Phase 1 of the content-engine AI rollout per ADR 0001.

Adds the backends/ai/ directory under apps/content-engine with:
- AIContentGenerator stub (throws BACKEND_UNAVAILABLE until phase 2 wires the LLM)
- withRetry helper + the three ADR retry profiles (LLM, IMAGE_SUBMIT, VIDEO_SUBMIT)
- withCostTracking wrapper + new costEvents collection in @restropulse/db
- TransientError/RateLimitError + classifyError for retry decisions
- IDomainSpecialization seam plus a real RestaurantSpecialization implementation
  (system + task prompts, Sonar query templates, hashtag strategy, FSSAI validation)

Wires a CONTENT_GENERATOR_BACKEND env flag (default 'placeholder') and a
new factory in worker.ts. Existing placeholder behavior is unchanged.

CostEvent type lives in @restropulse/shared so future API/web dashboards can
consume it without owning the schema.

Tests: errors, with-retry, with-cost-tracking, ai-content-generator,
restaurant specialization, factory (unit) plus cost-events round-trip
(integration via mongodb-memory-server). All pre-existing placeholder
and processor tests continue to pass.
EOF
)"
rtk git status
```

Expected: working tree clean, branch ahead of origin by 1 commit. Do NOT push.

---

## Self-Review Checklist (run before declaring the plan ready)

**Spec coverage** — every Phase 1 deliverable in the phasing message has a task:

- [x] `backends/ai/` directory + barrel — Tasks 13, 14
- [x] `CONTENT_GENERATOR_BACKEND` env var — Task 17
- [x] Factory selecting placeholder vs ai — Tasks 15, 16
- [x] `worker.ts:114` rewiring — Task 17
- [x] `withRetry` with 3 profiles — Tasks 5, 6
- [x] `TransientError`/`RateLimitError`/classifier — Tasks 3, 4
- [x] `withCostTracking` + `cost_events` (collection name `costEvents`) — Tasks 1, 2, 7
- [x] `IDomainSpecialization` interface — Task 9
- [x] `RestaurantSpecialization` with all sub-modules — Task 11
- [x] AIContentGenerator stub throws BACKEND_UNAVAILABLE — Tasks 12, 13

**Placeholder scan** — searched for "TBD", "implement later", "fill in", "appropriate error handling", "similar to Task". None present. All code blocks contain real code.

**Type consistency** — verified across tasks:
- `RetryProfile` shape `{ maxAttempts, backoffMs }` consistent across Tasks 5/6.
- `CostTrackingLabels` (`operation: CostOperation`, `surface: CostSurface`) matches `CostEvent` from `@restropulse/shared` (Task 1) and the helper in Task 7.
- `IDomainSpecialization` methods (`getSystemPromptFragment`, `getTaskPrompt`, `getSonarQueries`, `getImagePromptFragment`, `selectHashtags`, `validateOutput`) match between Task 9 (interface) and Task 11 (impl) and the Task 10 tests.
- `AIContentGeneratorOptions.specialization` is the same name in Task 12 tests, Task 13 impl, and Task 16 factory.
- Collection name is `costEvents` (camelCase, matching project convention) consistently across `connection.ts`, helper, and test setup.

---

## Cross-Cutting Notes for the Implementer

- **Plain ASCII only.** No emoji, no smart quotes, no em-dashes in code or comments. The repo's `.github/copilot-instructions.md` is strict about this.
- **`rtk` prefix for every shell command**, including in command chains with `&&`. The CLAUDE.md is explicit about this.
- **No new dependencies in this phase.** Phase 2 adds `ai`, `@ai-sdk/anthropic`, etc. Phase 1 uses only what's already installed.
- **Logging**: every new module that logs uses `const log = createLogger('<component-name>');` from `@restropulse/telemetry/server`. Never `console.log`.
- **Test file imports**: prefer dynamic `await import(...)` AFTER `vi.mock(...)` calls (see `with-cost-tracking.test.ts`) so mocks are set before module evaluation. This mirrors the existing `placeholder-generator.test.ts` pattern.
- **Do not touch** `apps/api`, `apps/web`, `apps/publisher`, or any docs other than this plan in phase 1. Architecture docs land in phase 6.
- **One commit per phase.** Checkpoint A stages but does not commit; Checkpoint B stages additional files and (after approval) commits the lot.
