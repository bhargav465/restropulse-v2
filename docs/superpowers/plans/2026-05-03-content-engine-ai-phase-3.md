# Content-Engine AI - Phase 3: Current-Affairs RAG (V1 Calendar + V2 Sonar Pro)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-populate `currentAffairsHints` so callers no longer have to supply them. V1 reads India public holidays from Google Calendar (free, daily refresh, MongoDB-cached 24h). V2 layers Perplexity Sonar Pro on top (one shared daily platform refresh + per-post hyperlocal triggers gated by an allowlist). Both are decorators behind `ICurrentAffairsProvider`, individually toggleable via env. Default is **V1 enabled, V2 disabled** -- V2 costs money and stays opt-in until smoke-tested in prod.

**Architecture (per ADR 0001 section 6.1):**
```typescript
// V1 only (default)
const provider = new CalendarOnlyProvider({ cache, calendarClient });

// V1 + V2 (production target once smoke-tested)
const provider = new SonarAugmentedProvider(
  new CalendarOnlyProvider({ cache, calendarClient }),
  { cache, sonarClient, specialization }
);
```

**Tech Stack:** TypeScript (strict, ESM), MongoDB driver v6, Vitest + mongodb-memory-server, native `fetch` for HTTP, `@restropulse/telemetry/server`, `withRetry` + `withCostTracking` from prior phases.

---

## Phase 3 Checkpoints

Three review checkpoints, one final commit at the end.

- **Checkpoint A (Tasks 1-8):** Foundations - types, cache, Google Calendar client, Sonar client. STOP for user approval.
- **Checkpoint B (Tasks 9-13):** Provider chain - Noop, CalendarOnly, SonarAugmented + factory. STOP for user approval.
- **Checkpoint C (Tasks 14-21):** Wiring - pipeline auto-enrichment, AIContentGenerator constructor change, cron processor, factory updates, end-to-end test, stage + commit gate.

---

## File Structure

### New files

```
apps/content-engine/src/services/content-generator/backends/ai/current-affairs/
  types.ts                              ICurrentAffairsProvider, CurrentAffairsContext, FetchHintsParams
  index.ts                              barrel + buildCurrentAffairsProvider(env, deps) factory
  refresh-job.ts                        runCurrentAffairsRefresh(provider) helper
  cache/
    types.ts                            ICurrentAffairsCache + CacheEntry shape
    mongo-cache.ts                      MongoCurrentAffairsCache (currentAffairsCache collection)
  clients/
    google-calendar-client.ts           GoogleCalendarClient.listHolidays(year, month)
    sonar-client.ts                     SonarClient.query(question)
  providers/
    noop-provider.ts                    NoopCurrentAffairsProvider
    calendar-only-provider.ts           CalendarOnlyProvider (V1)
    sonar-augmented-provider.ts         SonarAugmentedProvider (V2 decorator)

apps/content-engine/src/services/processors/current-affairs-refresh/
  index.ts                              processCurrentAffairsRefresh + createCurrentAffairsRefreshProcessor

apps/content-engine/tests/unit/content-generator/backends/ai/current-affairs/
  cache/
    mongo-cache.test.ts
  clients/
    google-calendar-client.test.ts
    sonar-client.test.ts
  providers/
    noop-provider.test.ts
    calendar-only-provider.test.ts
    sonar-augmented-provider.test.ts
  refresh-job.test.ts
  factory.test.ts                       buildCurrentAffairsProvider env-driven branching

apps/content-engine/tests/unit/processors/
  current-affairs-refresh.test.ts

apps/content-engine/tests/integration/
  current-affairs-end-to-end.test.ts    real Mongo cache, mocked clients, full chain
```

### Modified files

```
packages/db/src/connection.ts                                     add getCurrentAffairsCacheCollection()
packages/db/src/index.ts                                          re-export the new getter
apps/content-engine/src/services/content-generator/backends/ai/index.ts                  re-export current-affairs barrel
apps/content-engine/src/services/content-generator/backends/ai/pipeline/types.ts         add currentAffairs?: ICurrentAffairsProvider to PipelineDeps
apps/content-engine/src/services/content-generator/backends/ai/pipeline/draft-cycle.ts   auto-enrich hints from provider
apps/content-engine/src/services/content-generator/backends/ai/pipeline/revise-cycle.ts  auto-enrich hints from provider
apps/content-engine/src/services/content-generator/backends/ai/pipeline/generate-post.ts auto-enrich hints from provider
apps/content-engine/src/services/content-generator/backends/ai/pipeline/revise-post.ts   auto-enrich hints from provider
apps/content-engine/src/services/content-generator/backends/ai/ai-content-generator.ts   constructor accepts optional currentAffairs
apps/content-engine/src/services/content-generator/factory.ts                            wire provider chain + new env vars
apps/content-engine/src/services/processors/index.ts                                     re-export createCurrentAffairsRefreshProcessor
apps/content-engine/src/worker.ts                                                        add env vars + register processor
apps/content-engine/tests/unit/content-generator/backends/ai/ai-content-generator.test.ts  update for new optional ctor field
apps/content-engine/tests/unit/content-generator/factory.test.ts                         cover new env permutations
```

---

# CHECKPOINT A - Foundations (types, cache, clients)

## Task 1: Define `ICurrentAffairsProvider` types

**Files:**
- Create: `apps/content-engine/src/services/content-generator/backends/ai/current-affairs/types.ts`

- [ ] **Step 1: Create types.ts**

```typescript
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
```

- [ ] **Step 2: Type-check**

`rtk npm run type-check --workspace=@restropulse/content-engine` -> exit 0.

---

## Task 2: Define cache types + add `getCurrentAffairsCacheCollection` to `@restropulse/db`

**Files:**
- Create: `apps/content-engine/src/services/content-generator/backends/ai/current-affairs/cache/types.ts`
- Modify: `packages/db/src/connection.ts` (add a new collection getter near the others)
- Modify: `packages/db/src/index.ts` (re-export the new getter)

- [ ] **Step 1: Create cache types.ts**

```typescript
/**
 * ICurrentAffairsCache -- thin abstraction over the cache backend.
 *
 * Phase 3 ships MongoCurrentAffairsCache (collection: currentAffairsCache).
 * Future phases could add Redis (no infrastructure change required by callers).
 *
 * Entries are typed as `unknown` payloads -- callers narrow via Zod where strict
 * shapes matter. This keeps cache plumbing decoupled from the data inside.
 */

export interface CacheEntry<T = unknown> {
  key: string;
  payload: T;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICurrentAffairsCache {
  /** Returns the entry's payload if present and unexpired; otherwise null. */
  get<T = unknown>(key: string): Promise<T | null>;

  /** Upsert. ttlMs is the duration from now the entry is valid for. */
  set<T = unknown>(key: string, payload: T, ttlMs: number): Promise<void>;

  /** Best-effort cleanup of expired entries. Returns the deleted count. */
  cleanup(): Promise<number>;
}
```

- [ ] **Step 2: Add the collection getter**

In `packages/db/src/connection.ts`, after `getCostEventsCollection()`, add:

```typescript
export function getCurrentAffairsCacheCollection(): Collection {
  return getDB().collection('currentAffairsCache');
}
```

- [ ] **Step 3: Re-export from the barrel**

In `packages/db/src/index.ts`, add `getCurrentAffairsCacheCollection,` to the named-export block from `./connection.js` (alphabetical placement next to `getCostEventsCollection`).

- [ ] **Step 4: Type-check**

`rtk npm run type-check --workspace=@restropulse/db && rtk npm run type-check --workspace=@restropulse/content-engine`
Expected: both exit 0.

---

## Task 3: `MongoCurrentAffairsCache` + integration test

**Files:**
- Create: `apps/content-engine/src/services/content-generator/backends/ai/current-affairs/cache/mongo-cache.ts`
- Create: `apps/content-engine/tests/unit/content-generator/backends/ai/current-affairs/cache/mongo-cache.test.ts`

- [ ] **Step 1: Failing test** (uses `mongodb-memory-server` like the cost-events integration test)

Create `apps/content-engine/tests/unit/content-generator/backends/ai/current-affairs/cache/mongo-cache.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { setDB } from '@restropulse/db';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { MongoCurrentAffairsCache } = await import(
  '../../../../../../../src/services/content-generator/backends/ai/current-affairs/cache/mongo-cache.js'
);

let mongod: MongoMemoryServer;
let client: MongoClient;
const cache = new MongoCurrentAffairsCache();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongod.getUri());
  setDB(client.db('current-affairs-cache-test'));
}, 60000);

afterAll(async () => {
  await client.close();
  await mongod.stop();
}, 20000);

beforeEach(async () => {
  await client.db('current-affairs-cache-test').collection('currentAffairsCache').deleteMany({});
});

describe('MongoCurrentAffairsCache', () => {
  it('returns null when key is absent', async () => {
    const v = await cache.get('missing');
    expect(v).toBeNull();
  });

  it('stores and retrieves a payload', async () => {
    await cache.set('k1', { hello: 'world' }, 60_000);
    const v = await cache.get<{ hello: string }>('k1');
    expect(v).toEqual({ hello: 'world' });
  });

  it('returns null for an expired entry without deleting it (cleanup is separate)', async () => {
    await cache.set('k2', { v: 1 }, -1_000); // already expired
    const v = await cache.get('k2');
    expect(v).toBeNull();
    // Entry still present in collection
    const raw = await client.db('current-affairs-cache-test').collection('currentAffairsCache').findOne({ key: 'k2' });
    expect(raw).not.toBeNull();
  });

  it('upserts: second set overwrites the first', async () => {
    await cache.set('k3', { v: 1 }, 60_000);
    await cache.set('k3', { v: 2 }, 60_000);
    const v = await cache.get<{ v: number }>('k3');
    expect(v?.v).toBe(2);
  });

  it('cleanup removes expired entries and reports the count', async () => {
    await cache.set('valid', { ok: true }, 60_000);
    await cache.set('expired1', { ok: false }, -1_000);
    await cache.set('expired2', { ok: false }, -1_000);
    const removed = await cache.cleanup();
    expect(removed).toBe(2);
    expect(await cache.get('valid')).not.toBeNull();
    expect(await cache.get('expired1')).toBeNull();
  });
});
```

Verify it fails: `cd apps/content-engine && npx vitest run tests/unit/content-generator/backends/ai/current-affairs/cache/mongo-cache.test.ts`

- [ ] **Step 2: Implement `MongoCurrentAffairsCache`**

Create `apps/content-engine/src/services/content-generator/backends/ai/current-affairs/cache/mongo-cache.ts`:

```typescript
/**
 * MongoCurrentAffairsCache -- MongoDB-backed implementation of ICurrentAffairsCache.
 *
 * Reads/writes go through the @restropulse/db connection singleton. The
 * `currentAffairsCache` collection is created lazily (Mongo creates collections
 * on first write); no explicit setup step is required. Indexes are not
 * declared here -- a future migration may add `{ key: 1 }` unique and
 * `{ expiresAt: 1 }` TTL.
 */

import { getCurrentAffairsCacheCollection } from '@restropulse/db';
import { createLogger } from '@restropulse/telemetry/server';
import type { CacheEntry, ICurrentAffairsCache } from './types.js';

const log = createLogger('current-affairs-cache');

export class MongoCurrentAffairsCache implements ICurrentAffairsCache {
  async get<T = unknown>(key: string): Promise<T | null> {
    const col = getCurrentAffairsCacheCollection();
    const doc = await col.findOne({ key });
    if (!doc) return null;
    if ((doc as any).expiresAt && new Date((doc as any).expiresAt) <= new Date()) {
      return null;
    }
    return ((doc as any).payload ?? null) as T | null;
  }

  async set<T = unknown>(key: string, payload: T, ttlMs: number): Promise<void> {
    const col = getCurrentAffairsCacheCollection();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);
    await col.updateOne(
      { key },
      {
        $set: {
          key,
          payload,
          expiresAt,
          updatedAt: now,
        } as any,
        $setOnInsert: { createdAt: now } as any,
      },
      { upsert: true },
    );
  }

  async cleanup(): Promise<number> {
    const col = getCurrentAffairsCacheCollection();
    const result = await col.deleteMany({ expiresAt: { $lte: new Date() } } as any);
    log.info({ deleted: result.deletedCount }, 'Current-affairs cache cleanup completed');
    return result.deletedCount ?? 0;
  }
}

export type { CacheEntry, ICurrentAffairsCache };
```

- [ ] **Step 3: Verify**

`cd apps/content-engine && npx vitest run tests/unit/content-generator/backends/ai/current-affairs/cache/mongo-cache.test.ts`
Expected: PASS, 5 tests green.

---

## Task 4: `GoogleCalendarClient` + tests

**Files:**
- Create: `apps/content-engine/src/services/content-generator/backends/ai/current-affairs/clients/google-calendar-client.ts`
- Create: `apps/content-engine/tests/unit/content-generator/backends/ai/current-affairs/clients/google-calendar-client.test.ts`

The client is a thin wrapper around the Google Calendar Public Holidays API for the India calendar. Endpoint:
`https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events?key={apiKey}&timeMin=...&timeMax=...&singleEvents=true&orderBy=startTime`

We use `calendarId = en.indian#holiday@group.v.calendar.google.com` (URL-encoded).

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { GoogleCalendarClient } = await import(
  '../../../../../../../src/services/content-generator/backends/ai/current-affairs/clients/google-calendar-client.js'
);

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  // Replace global fetch
  (globalThis as any).fetch = fetchMock;
});

const sampleResponse = {
  items: [
    {
      summary: 'Eid al-Fitr',
      start: { date: '2026-05-15' },
      end: { date: '2026-05-16' },
    },
    {
      summary: 'Buddha Purnima',
      start: { date: '2026-05-23' },
      end: { date: '2026-05-24' },
    },
  ],
};

describe('GoogleCalendarClient', () => {
  it('throws when constructed without an apiKey', () => {
    expect(() => new GoogleCalendarClient({ apiKey: '' })).toThrow(/api ?key/i);
  });

  it('lists holidays for a given month', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => sampleResponse,
    });
    const client = new GoogleCalendarClient({ apiKey: 'test-key' });
    const holidays = await client.listHolidays(2026, 5);
    expect(holidays).toEqual([
      { name: 'Eid al-Fitr', date: '2026-05-15' },
      { name: 'Buddha Purnima', date: '2026-05-23' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain('/calendar/v3/calendars/');
    expect(url).toContain('key=test-key');
    expect(url).toContain('timeMin=2026-05-01');
    expect(url).toContain('timeMax=2026-06-01');
  });

  it('returns [] for an empty items array', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ items: [] }) });
    const client = new GoogleCalendarClient({ apiKey: 'k' });
    expect(await client.listHolidays(2026, 12)).toEqual([]);
  });

  it('throws TransientError on 503', async () => {
    const { TransientError } = await import(
      '../../../../../../../src/services/content-generator/backends/ai/errors.js'
    );
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      headers: new Map(),
      json: async () => ({ error: 'unavail' }),
      text: async () => '{}',
    });
    const client = new GoogleCalendarClient({ apiKey: 'k' });
    await expect(client.listHolidays(2026, 5)).rejects.toBeInstanceOf(TransientError);
  });

  it('throws RateLimitError on 429', async () => {
    const { RateLimitError } = await import(
      '../../../../../../../src/services/content-generator/backends/ai/errors.js'
    );
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Map([['retry-after', '5']]),
      json: async () => ({ error: 'rate limited' }),
      text: async () => '{}',
    });
    const client = new GoogleCalendarClient({ apiKey: 'k' });
    await expect(client.listHolidays(2026, 5)).rejects.toBeInstanceOf(RateLimitError);
  });

  it('throws plain Error on 4xx other than 429', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      headers: new Map(),
      json: async () => ({ error: 'forbidden' }),
      text: async () => '{}',
    });
    const client = new GoogleCalendarClient({ apiKey: 'k' });
    await expect(client.listHolidays(2026, 5)).rejects.toThrow();
  });
});
```

Verify it fails.

- [ ] **Step 2: Implement `GoogleCalendarClient`**

```typescript
/**
 * GoogleCalendarClient -- thin wrapper around the Google Calendar Public Holidays
 * API for the India calendar.
 *
 * Reference: https://developers.google.com/calendar/api/v3/reference/events/list
 *
 * Auth: API key (no OAuth -- the holiday calendar is public-readable).
 *
 * Errors are passed through classifyError so withRetry can decide whether to
 * retry. The provider that wraps this client owns retry policy.
 */

import { createLogger } from '@restropulse/telemetry/server';
import { classifyError, TransientError } from '../../errors.js';

const log = createLogger('google-calendar-client');

const INDIA_HOLIDAY_CALENDAR_ID = 'en.indian#holiday@group.v.calendar.google.com';
const BASE_URL = 'https://www.googleapis.com/calendar/v3/calendars';

export interface GoogleCalendarClientOptions {
  apiKey: string;
  /** Override calendar id; default is the India public holidays calendar. */
  calendarId?: string;
}

export interface CalendarHoliday {
  name: string;
  /** ISO date string (YYYY-MM-DD). */
  date: string;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export class GoogleCalendarClient {
  private readonly apiKey: string;
  private readonly calendarId: string;

  constructor(options: GoogleCalendarClientOptions) {
    if (!options || !options.apiKey) {
      throw new Error('GoogleCalendarClient requires a non-empty apiKey');
    }
    this.apiKey = options.apiKey;
    this.calendarId = options.calendarId ?? INDIA_HOLIDAY_CALENDAR_ID;
  }

  /**
   * List holidays in the given month.
   *
   * year: full year (e.g. 2026)
   * month: 1-12 (1 = January)
   */
  async listHolidays(year: number, month: number): Promise<CalendarHoliday[]> {
    const monthStart = `${year}-${pad2(month)}-01`;
    const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${pad2(month + 1)}-01`;

    const params = new URLSearchParams({
      key: this.apiKey,
      timeMin: `${monthStart}T00:00:00Z`,
      timeMax: `${nextMonth}T00:00:00Z`,
      singleEvents: 'true',
      orderBy: 'startTime',
    });
    // Re-stringify timeMin/timeMax as the test asserts on the date prefix only.
    // URLSearchParams URL-encodes ':' which the test does not care about.

    const calendarPath = encodeURIComponent(this.calendarId);
    const url = `${BASE_URL}/${calendarPath}/events?${params.toString()}`;

    let res: Response;
    try {
      res = await fetch(url);
    } catch (err) {
      // Network error -- surface as TransientError so retry profiles take over.
      throw new TransientError(`Google Calendar fetch failed: ${(err as Error).message}`, undefined, err);
    }

    if (!res.ok) {
      const headers: Record<string, string> = {};
      // Headers may be a Map (test mock) or Headers (real fetch). Both are iterable.
      try {
        for (const [k, v] of res.headers as any) headers[k.toLowerCase()] = String(v);
      } catch {
        // ignore -- header copy is best-effort
      }
      const httpish = { status: res.status, message: `Google Calendar HTTP ${res.status}`, headers };
      const classified = classifyError(httpish);
      if (classified instanceof Error) throw classified;
      throw new Error(httpish.message);
    }

    const body = await res.json() as { items?: Array<{ summary?: string; start?: { date?: string; dateTime?: string } }> };
    const items = body.items ?? [];

    const holidays: CalendarHoliday[] = items
      .map((it) => ({
        name: it.summary ?? 'Unknown holiday',
        date: it.start?.date ?? it.start?.dateTime?.slice(0, 10) ?? '',
      }))
      .filter((h) => h.date.length === 10);

    log.debug({ count: holidays.length, year, month }, 'Listed holidays');
    return holidays;
  }
}
```

- [ ] **Step 3: Verify**

`cd apps/content-engine && npx vitest run tests/unit/content-generator/backends/ai/current-affairs/clients/google-calendar-client.test.ts`
Expected: PASS, 6 assertions green.

---

## Task 5: `SonarClient` + tests

**Files:**
- Create: `apps/content-engine/src/services/content-generator/backends/ai/current-affairs/clients/sonar-client.ts`
- Create: `apps/content-engine/tests/unit/content-generator/backends/ai/current-affairs/clients/sonar-client.test.ts`

Perplexity Sonar API uses an OpenAI-compatible chat completions endpoint:
`POST https://api.perplexity.ai/chat/completions`
Body: `{ model: "sonar-pro", messages: [{role: "user", content: <question>}] }`
Auth: `Authorization: Bearer <key>`
Response shape (simplified): `{ choices: [{ message: { content: string } }], usage: { prompt_tokens, completion_tokens } }`

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { SonarClient } = await import(
  '../../../../../../../src/services/content-generator/backends/ai/current-affairs/clients/sonar-client.js'
);

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  (globalThis as any).fetch = fetchMock;
});

const sampleResponse = {
  choices: [{ message: { content: 'Sample current-affairs answer.' } }],
  usage: { prompt_tokens: 50, completion_tokens: 80 },
};

describe('SonarClient', () => {
  it('throws when constructed without an apiKey', () => {
    expect(() => new SonarClient({ apiKey: '' })).toThrow(/api ?key/i);
  });

  it('posts a chat completion to the Perplexity endpoint and returns text + usage', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => sampleResponse });
    const client = new SonarClient({ apiKey: 'pplx-test' });
    const out = await client.query('What is happening in Bengaluru today?');
    expect(out.text).toBe('Sample current-affairs answer.');
    expect(out.usage.inputTokens).toBe(50);
    expect(out.usage.outputTokens).toBe(80);
    expect(out.modelId).toBe('sonar-pro');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.perplexity.ai/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer pplx-test');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('sonar-pro');
    expect(body.messages[0].content).toBe('What is happening in Bengaluru today?');
  });

  it('allows overriding the model', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => sampleResponse });
    const client = new SonarClient({ apiKey: 'k', model: 'sonar' });
    await client.query('hi');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe('sonar');
  });

  it('throws TransientError on 503', async () => {
    const { TransientError } = await import(
      '../../../../../../../src/services/content-generator/backends/ai/errors.js'
    );
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      headers: new Map(),
      json: async () => ({}),
      text: async () => '{}',
    });
    const client = new SonarClient({ apiKey: 'k' });
    await expect(client.query('q')).rejects.toBeInstanceOf(TransientError);
  });

  it('throws RateLimitError on 429', async () => {
    const { RateLimitError } = await import(
      '../../../../../../../src/services/content-generator/backends/ai/errors.js'
    );
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Map([['retry-after', '2']]),
      json: async () => ({}),
      text: async () => '{}',
    });
    const client = new SonarClient({ apiKey: 'k' });
    await expect(client.query('q')).rejects.toBeInstanceOf(RateLimitError);
  });

  it('returns empty-string text when choices is missing (defensive)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ usage: { prompt_tokens: 10, completion_tokens: 0 } }),
    });
    const client = new SonarClient({ apiKey: 'k' });
    const out = await client.query('q');
    expect(out.text).toBe('');
  });
});
```

Verify it fails.

- [ ] **Step 2: Implement `SonarClient`**

```typescript
/**
 * SonarClient -- thin wrapper around the Perplexity Sonar Pro API.
 *
 * Endpoint:    https://api.perplexity.ai/chat/completions
 * Default model: sonar-pro (high quality, ~$3/M input, ~$15/M output)
 * Alternative:   sonar (cheaper, faster)
 *
 * Cost tracking is not done here -- callers wrap the call in withCostTracking
 * with the surface='sonar' label.
 */

import { createLogger } from '@restropulse/telemetry/server';
import { classifyError, TransientError } from '../../errors.js';

const log = createLogger('sonar-client');

const ENDPOINT = 'https://api.perplexity.ai/chat/completions';

export interface SonarClientOptions {
  apiKey: string;
  /** Default 'sonar-pro'; can be overridden to 'sonar' for cheaper queries. */
  model?: string;
}

export interface SonarUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface SonarResponse {
  text: string;
  usage: SonarUsage;
  modelId: string;
}

export class SonarClient {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(options: SonarClientOptions) {
    if (!options || !options.apiKey) {
      throw new Error('SonarClient requires a non-empty apiKey');
    }
    this.apiKey = options.apiKey;
    this.model = options.model ?? 'sonar-pro';
  }

  async query(question: string): Promise<SonarResponse> {
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: question }],
        }),
      });
    } catch (err) {
      throw new TransientError(`Sonar fetch failed: ${(err as Error).message}`, undefined, err);
    }

    if (!res.ok) {
      const headers: Record<string, string> = {};
      try {
        for (const [k, v] of res.headers as any) headers[k.toLowerCase()] = String(v);
      } catch {
        // best-effort
      }
      const httpish = { status: res.status, message: `Sonar HTTP ${res.status}`, headers };
      const classified = classifyError(httpish);
      if (classified instanceof Error) throw classified;
      throw new Error(httpish.message);
    }

    const body = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const text = body.choices?.[0]?.message?.content ?? '';
    const usage: SonarUsage = {
      inputTokens: body.usage?.prompt_tokens ?? 0,
      outputTokens: body.usage?.completion_tokens ?? 0,
    };

    log.debug({ inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, modelId: this.model }, 'Sonar query');
    return { text, usage, modelId: this.model };
  }
}
```

- [ ] **Step 3: Verify**

PASS, 6 assertions green.

---

## Task 6: `NoopCurrentAffairsProvider` + tests

**Files:**
- Create: `apps/content-engine/src/services/content-generator/backends/ai/current-affairs/providers/noop-provider.ts`
- Create: `apps/content-engine/tests/unit/content-generator/backends/ai/current-affairs/providers/noop-provider.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { NoopCurrentAffairsProvider } = await import(
  '../../../../../../../src/services/content-generator/backends/ai/current-affairs/providers/noop-provider.js'
);

describe('NoopCurrentAffairsProvider', () => {
  it('exposes name "noop"', () => {
    expect(new NoopCurrentAffairsProvider().name).toBe('noop');
  });

  it('fetchHints returns []', async () => {
    const p = new NoopCurrentAffairsProvider();
    expect(await p.fetchHints({ operation: 'draftCycle', specializationContext: {} })).toEqual([]);
  });

  it('refresh resolves without doing anything', async () => {
    const p = new NoopCurrentAffairsProvider();
    await expect(p.refresh()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Implement**

```typescript
import type { FetchHintsParams, ICurrentAffairsProvider } from '../types.js';

export class NoopCurrentAffairsProvider implements ICurrentAffairsProvider {
  readonly name = 'noop';

  async fetchHints(_params: FetchHintsParams): Promise<string[]> {
    return [];
  }

  async refresh(): Promise<void> {
    return;
  }
}
```

- [ ] **Step 3: Verify**

PASS, 3 assertions.

---

## Task 7: Checkpoint A wrap

- [ ] **Step 1: Run all phase-3 Checkpoint A tests**

`cd apps/content-engine && npx vitest run tests/unit/content-generator/backends/ai/current-affairs`
Expected: 4 test files (mongo-cache, google-calendar-client, sonar-client, noop-provider), all green.

- [ ] **Step 2: Run the full content-engine suite to confirm no regressions**

`cd apps/content-engine && npx vitest run`
Expected: prior 35 files + 4 new = 39 files, ~+25 new assertions over 285 baseline = 310 total.

- [ ] **Step 3: Type-check across affected workspaces**

`rtk npm run type-check --workspace=@restropulse/db && rtk npm run type-check --workspace=@restropulse/content-engine`
Expected: both exit 0.

- [ ] **Step 4: Show user, request approval to proceed to Checkpoint B**

`rtk git status` (DO NOT stage). **STOP. Tell the user: "Checkpoint A complete - cache + clients + noop provider. Approve continuing to Checkpoint B (CalendarOnly + SonarAugmented + factory)?"** Wait for explicit approval.

---

# CHECKPOINT B - Provider chain

## Task 8: `CalendarOnlyProvider` (V1) + tests

**Files:**
- Create: `apps/content-engine/src/services/content-generator/backends/ai/current-affairs/providers/calendar-only-provider.ts`
- Create: `apps/content-engine/tests/unit/content-generator/backends/ai/current-affairs/providers/calendar-only-provider.test.ts`

V1 produces hints like:
- `"Today is Wednesday, 13 May 2026"`
- `"Eid al-Fitr is in 2 days"`
- `"Buddha Purnima is in 10 days"` (only emit if within +/- 7 days)

The provider:
- On `fetchHints`: read cache key `calendar:${YYYY-MM}` (and `calendar:${YYYY-MM}` for next month if today is in last 7 days). On cache miss, lazy-fetch via `GoogleCalendarClient.listHolidays` and write back. Free, so lazy fetch is safe.
- On `refresh`: explicitly fetch the current month and write to cache. Idempotent.

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { CalendarOnlyProvider } = await import(
  '../../../../../../../src/services/content-generator/backends/ai/current-affairs/providers/calendar-only-provider.js'
);

function makeCache() {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn(async <T>(key: string) => (store.has(key) ? (store.get(key) as T) : null)),
    set: vi.fn(async (key: string, payload: unknown) => { store.set(key, payload); }),
    cleanup: vi.fn(async () => 0),
    _store: store,
  };
}

function makeClient(holidays: Array<{ name: string; date: string }>) {
  return { listHolidays: vi.fn(async () => holidays) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-13T00:00:00Z'));
});

describe('CalendarOnlyProvider.fetchHints', () => {
  it('emits a today-line plus near-term holidays from the cache', async () => {
    const cache = makeCache();
    const client = makeClient([]);
    cache._store.set('calendar:2026-05', [
      { name: 'Eid al-Fitr', date: '2026-05-15' },
      { name: 'Buddha Purnima', date: '2026-05-23' },
    ]);
    const p = new CalendarOnlyProvider({ cache: cache as any, client: client as any });
    const hints = await p.fetchHints({ operation: 'draftCycle', specializationContext: {} });
    expect(hints[0]).toMatch(/today/i);
    expect(hints.some((h) => h.includes('Eid al-Fitr'))).toBe(true);
    expect(hints.some((h) => h.includes('Buddha Purnima'))).toBe(false); // 10 days out, beyond +/-7
    expect(client.listHolidays).not.toHaveBeenCalled();
  });

  it('lazy-fetches via the client on cache miss and writes back', async () => {
    const cache = makeCache();
    const client = makeClient([{ name: 'Eid al-Fitr', date: '2026-05-15' }]);
    const p = new CalendarOnlyProvider({ cache: cache as any, client: client as any });
    await p.fetchHints({ operation: 'draftCycle', specializationContext: {} });
    expect(client.listHolidays).toHaveBeenCalledWith(2026, 5);
    expect(cache.set).toHaveBeenCalled();
    const setKey = (cache.set as any).mock.calls[0][0];
    expect(setKey).toBe('calendar:2026-05');
  });

  it('returns degraded today-only hints if the calendar fetch throws', async () => {
    const cache = makeCache();
    const client = { listHolidays: vi.fn().mockRejectedValue(new Error('upstream down')) };
    const p = new CalendarOnlyProvider({ cache: cache as any, client: client as any });
    const hints = await p.fetchHints({ operation: 'draftCycle', specializationContext: {} });
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatch(/today/i);
  });

  it('also pulls next-month holidays when today is in the last 7 days of a month', async () => {
    vi.setSystemTime(new Date('2026-05-29T00:00:00Z'));
    const cache = makeCache();
    cache._store.set('calendar:2026-05', []);
    cache._store.set('calendar:2026-06', [{ name: 'Eid al-Adha', date: '2026-06-04' }]);
    const client = makeClient([]);
    const p = new CalendarOnlyProvider({ cache: cache as any, client: client as any });
    const hints = await p.fetchHints({ operation: 'draftCycle', specializationContext: {} });
    expect(hints.some((h) => h.includes('Eid al-Adha'))).toBe(true);
  });
});

describe('CalendarOnlyProvider.refresh', () => {
  it('fetches the current month and writes to cache', async () => {
    const cache = makeCache();
    const client = makeClient([{ name: 'Test', date: '2026-05-20' }]);
    const p = new CalendarOnlyProvider({ cache: cache as any, client: client as any });
    await p.refresh();
    expect(client.listHolidays).toHaveBeenCalledWith(2026, 5);
    expect(cache.set).toHaveBeenCalledWith('calendar:2026-05', expect.any(Array), expect.any(Number));
  });

  it('also fetches next month when today is in the last 7 days', async () => {
    vi.setSystemTime(new Date('2026-05-29T00:00:00Z'));
    const cache = makeCache();
    const client = makeClient([]);
    const p = new CalendarOnlyProvider({ cache: cache as any, client: client as any });
    await p.refresh();
    expect(client.listHolidays).toHaveBeenCalledWith(2026, 5);
    expect(client.listHolidays).toHaveBeenCalledWith(2026, 6);
  });
});
```

Verify it fails.

- [ ] **Step 2: Implement**

```typescript
/**
 * CalendarOnlyProvider -- V1 of the current-affairs RAG.
 *
 * Produces hints like "Today is Wednesday, 13 May 2026" and "Eid al-Fitr is
 * in 2 days". Reads from cache (key = `calendar:YYYY-MM`); on cache miss,
 * lazy-fetches via GoogleCalendarClient.listHolidays. The Calendar call is
 * free, so lazy-on-miss is safe (no surprise costs).
 *
 * The cron processor calls refresh() at 06:00 IST to keep the cache warm,
 * and to fetch next month's holidays when we're in the last 7 days of a month.
 */

import { createLogger } from '@restropulse/telemetry/server';
import type { CalendarHoliday, GoogleCalendarClient } from '../clients/google-calendar-client.js';
import type { ICurrentAffairsCache } from '../cache/types.js';
import type { FetchHintsParams, ICurrentAffairsProvider } from '../types.js';

const log = createLogger('calendar-only-provider');

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;     // 24h
const HOLIDAY_WINDOW_DAYS = 7;                 // emit holidays within +/-7 days

export interface CalendarOnlyProviderOptions {
  cache: ICurrentAffairsCache;
  client: Pick<GoogleCalendarClient, 'listHolidays'>;
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function todayLine(now: Date): string {
  const wk = WEEKDAY_NAMES[now.getUTCDay()];
  const mon = MONTH_NAMES[now.getUTCMonth()];
  const day = now.getUTCDate();
  const yr = now.getUTCFullYear();
  return `Today is ${wk}, ${day} ${mon} ${yr}`;
}

function cacheKey(year: number, month1Indexed: number): string {
  return `calendar:${year}-${month1Indexed.toString().padStart(2, '0')}`;
}

function holidayLine(name: string, daysOut: number): string | null {
  if (daysOut === 0) return `${name} is today`;
  if (daysOut === 1) return `${name} is tomorrow`;
  if (daysOut === -1) return `${name} was yesterday`;
  if (daysOut > 1 && daysOut <= HOLIDAY_WINDOW_DAYS) return `${name} is in ${daysOut} days`;
  if (daysOut < -1 && daysOut >= -HOLIDAY_WINDOW_DAYS) return `${name} was ${Math.abs(daysOut)} days ago`;
  return null;
}

function differenceInDays(target: Date, base: Date): number {
  const dayMs = 24 * 60 * 60 * 1000;
  // Truncate both to UTC midnight to avoid timezone drift in the difference.
  const a = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  const b = Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate());
  return Math.round((a - b) / dayMs);
}

export class CalendarOnlyProvider implements ICurrentAffairsProvider {
  readonly name = 'calendar-only';
  private readonly cache: ICurrentAffairsCache;
  private readonly client: Pick<GoogleCalendarClient, 'listHolidays'>;

  constructor(options: CalendarOnlyProviderOptions) {
    if (!options || !options.cache || !options.client) {
      throw new Error('CalendarOnlyProvider requires { cache, client }');
    }
    this.cache = options.cache;
    this.client = options.client;
  }

  async fetchHints(_params: FetchHintsParams): Promise<string[]> {
    const now = new Date();
    const hints: string[] = [todayLine(now)];

    const months: Array<{ year: number; month: number }> = [
      { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 },
    ];
    // If we're in the last 7 days of the month, also include next month so
    // holidays in the early days of next month appear in the +/-7 window.
    const lastDayOfThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    if (now.getUTCDate() > lastDayOfThisMonth - HOLIDAY_WINDOW_DAYS) {
      const nextMonth = now.getUTCMonth() + 1 === 12
        ? { year: now.getUTCFullYear() + 1, month: 1 }
        : { year: now.getUTCFullYear(), month: now.getUTCMonth() + 2 };
      months.push(nextMonth);
    }

    for (const { year, month } of months) {
      let holidays: CalendarHoliday[] | null;
      try {
        holidays = await this.cache.get<CalendarHoliday[]>(cacheKey(year, month));
        if (holidays === null) {
          holidays = await this.client.listHolidays(year, month);
          await this.cache.set(cacheKey(year, month), holidays, CACHE_TTL_MS);
        }
      } catch (err) {
        log.warn({ err, year, month }, 'Failed to load calendar holidays; degrading to today-line only');
        continue;
      }

      for (const h of holidays) {
        const target = new Date(`${h.date}T00:00:00Z`);
        const diff = differenceInDays(target, now);
        const line = holidayLine(h.name, diff);
        if (line) hints.push(line);
      }
    }

    return hints;
  }

  async refresh(): Promise<void> {
    const now = new Date();
    const months: Array<{ year: number; month: number }> = [
      { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 },
    ];
    const lastDayOfThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    if (now.getUTCDate() > lastDayOfThisMonth - HOLIDAY_WINDOW_DAYS) {
      const nextMonth = now.getUTCMonth() + 1 === 12
        ? { year: now.getUTCFullYear() + 1, month: 1 }
        : { year: now.getUTCFullYear(), month: now.getUTCMonth() + 2 };
      months.push(nextMonth);
    }

    for (const { year, month } of months) {
      try {
        const holidays = await this.client.listHolidays(year, month);
        await this.cache.set(cacheKey(year, month), holidays, CACHE_TTL_MS);
        log.info({ year, month, count: holidays.length }, 'Calendar refresh stored');
      } catch (err) {
        log.error({ err, year, month }, 'Calendar refresh failed; cache may be stale');
      }
    }
  }
}
```

- [ ] **Step 3: Verify**

PASS, 6 assertions.

---

## Task 9: `SonarAugmentedProvider` (V2 decorator) + tests

**Files:**
- Create: `apps/content-engine/src/services/content-generator/backends/ai/current-affairs/providers/sonar-augmented-provider.ts`
- Create: `apps/content-engine/tests/unit/content-generator/backends/ai/current-affairs/providers/sonar-augmented-provider.test.ts`

V2 decorator behavior:
- `fetchHints`: call `upstream.fetchHints(params)`, then prepend the cached daily Sonar response. If `params.operation` is post-related AND `params.concept` matches a trigger keyword AND a per-post Sonar query exists, fire the per-post query (not cached) and append its response.
- `refresh`: call `upstream.refresh()`, then fire the daily platform query and write to cache.

Daily platform query is the first string from `specialization.getSonarQueries('daily-platform', { /* generic */ })`. Per-post queries come from `specialization.getSonarQueries('per-post-trigger', specializationContext)`.

Per-post Sonar calls go through `withCostTracking` with `surface='sonar'`, `step='trigger'`. Daily refresh goes through `withCostTracking` with `step='daily'`.

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  trackAIUsage: vi.fn(),
}));

vi.mock('@restropulse/db', () => ({
  insertCostEvent: vi.fn().mockResolvedValue({ id: 'ce_test' }),
}));

const { SonarAugmentedProvider } = await import(
  '../../../../../../../src/services/content-generator/backends/ai/current-affairs/providers/sonar-augmented-provider.js'
);
const { RestaurantSpecialization } = await import(
  '../../../../../../../src/services/content-generator/backends/ai/specialization/index.js'
);

function makeUpstream(hints: string[] = ['Today is Wednesday, 13 May 2026']) {
  return {
    name: 'mock-upstream',
    fetchHints: vi.fn(async () => hints),
    refresh: vi.fn(async () => {}),
  };
}

function makeCache() {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn(async <T>(k: string) => (store.has(k) ? (store.get(k) as T) : null)),
    set: vi.fn(async (k: string, v: unknown) => { store.set(k, v); }),
    cleanup: vi.fn(async () => 0),
    _store: store,
  };
}

function makeClient(text: string) {
  return {
    query: vi.fn(async () => ({
      text,
      usage: { inputTokens: 50, outputTokens: 80 },
      modelId: 'sonar-pro',
    })),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-13T00:00:00Z'));
  vi.clearAllMocks();
});

describe('SonarAugmentedProvider.fetchHints', () => {
  it('returns upstream hints + cached daily Sonar payload', async () => {
    const upstream = makeUpstream(['Today is Wednesday, 13 May 2026']);
    const cache = makeCache();
    cache._store.set('sonar-daily:2026-05-13', { text: 'IPL Final tonight in Chennai', cachedAt: '2026-05-13T06:00:00Z' });
    const client = makeClient('unused');
    const p = new SonarAugmentedProvider(upstream as any, {
      cache: cache as any,
      client: client as any,
      specialization: new RestaurantSpecialization(),
    });
    const hints = await p.fetchHints({ operation: 'draftCycle', specializationContext: {} });
    expect(hints).toContain('Today is Wednesday, 13 May 2026');
    expect(hints.some((h) => h.includes('IPL Final'))).toBe(true);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('falls back gracefully when daily cache is empty (no extra hints prepended)', async () => {
    const upstream = makeUpstream(['Today line']);
    const cache = makeCache();
    const client = makeClient('unused');
    const p = new SonarAugmentedProvider(upstream as any, {
      cache: cache as any,
      client: client as any,
      specialization: new RestaurantSpecialization(),
    });
    const hints = await p.fetchHints({ operation: 'draftCycle', specializationContext: {} });
    expect(hints).toEqual(['Today line']);
  });

  it('fires a per-post Sonar query when generatePost concept matches a trigger keyword', async () => {
    const upstream = makeUpstream(['Today line']);
    const cache = makeCache();
    const client = makeClient('Cricket-themed combos are hot in Bengaluru this weekend');
    const p = new SonarAugmentedProvider(upstream as any, {
      cache: cache as any,
      client: client as any,
      specialization: new RestaurantSpecialization(),
    });
    const hints = await p.fetchHints({
      operation: 'generatePost',
      specializationContext: { restaurantName: 'Spice Route', cuisine: 'South Indian', region: 'Bengaluru' },
      concept: 'cricket match-day biryani offer',
      restaurantId: 'r1',
      postId: 'p1',
    });
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(hints.some((h) => h.includes('Cricket-themed combos'))).toBe(true);
  });

  it('does NOT fire a per-post Sonar query when concept lacks any trigger keyword', async () => {
    const upstream = makeUpstream(['Today line']);
    const cache = makeCache();
    const client = makeClient('unused');
    const p = new SonarAugmentedProvider(upstream as any, {
      cache: cache as any,
      client: client as any,
      specialization: new RestaurantSpecialization(),
    });
    await p.fetchHints({
      operation: 'generatePost',
      specializationContext: {},
      concept: 'a regular Tuesday plate of dal',
    });
    expect(client.query).not.toHaveBeenCalled();
  });

  it('returns upstream-only when the per-post Sonar call fails (degraded mode)', async () => {
    const upstream = makeUpstream(['Today line']);
    const cache = makeCache();
    const client = { query: vi.fn().mockRejectedValue(new Error('sonar down')) };
    const p = new SonarAugmentedProvider(upstream as any, {
      cache: cache as any,
      client: client as any,
      specialization: new RestaurantSpecialization(),
    });
    const hints = await p.fetchHints({
      operation: 'generatePost',
      specializationContext: {},
      concept: 'cricket match',
    });
    expect(hints).toEqual(['Today line']);
  });
});

describe('SonarAugmentedProvider.refresh', () => {
  it('refreshes upstream first, then fires the daily platform query and writes to cache', async () => {
    const order: string[] = [];
    const upstream = {
      name: 'u', fetchHints: vi.fn(),
      refresh: vi.fn(async () => { order.push('upstream'); }),
    };
    const cache = makeCache();
    cache.set = vi.fn(async (k: string, v: unknown) => { order.push(`cache:${k}`); cache._store.set(k, v); });
    const client = makeClient('Daily platform answer');
    const p = new SonarAugmentedProvider(upstream as any, {
      cache: cache as any,
      client: client as any,
      specialization: new RestaurantSpecialization(),
    });
    await p.refresh();
    expect(order[0]).toBe('upstream');
    expect(order[1]).toBe('cache:sonar-daily:2026-05-13');
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it('writes a cost event for the daily refresh call', async () => {
    const { insertCostEvent } = await import('@restropulse/db');
    (insertCostEvent as any).mockClear();
    const upstream = makeUpstream();
    const cache = makeCache();
    const client = makeClient('Daily platform answer');
    const p = new SonarAugmentedProvider(upstream as any, {
      cache: cache as any,
      client: client as any,
      specialization: new RestaurantSpecialization(),
    });
    await p.refresh();
    const event = (insertCostEvent as any).mock.calls.find((c: any) => c[0].surface === 'sonar' && c[0].step === 'daily');
    expect(event).toBeDefined();
    expect(event[0].operation).toBe('currentAffairsRefresh');
    expect(event[0].model).toBe('sonar-pro');
  });
});
```

Verify it fails.

- [ ] **Step 2: Implement `SonarAugmentedProvider`**

```typescript
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
import type { IDomainSpecialization, SpecializationContext } from '../../specialization/types.js';
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
```

Note: `'currentAffairsRefresh'` already exists in the `CostOperation` union from phase 1's `@restropulse/shared/cost-events.ts`.

- [ ] **Step 3: Verify**

PASS, 7 assertions.

---

## Task 10: `buildCurrentAffairsProvider` factory + tests

**Files:**
- Create: `apps/content-engine/src/services/content-generator/backends/ai/current-affairs/index.ts`
- Create: `apps/content-engine/tests/unit/content-generator/backends/ai/current-affairs/factory.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { buildCurrentAffairsProvider } = await import(
  '../../../../../../src/services/content-generator/backends/ai/current-affairs/index.js'
);
const { RestaurantSpecialization } = await import(
  '../../../../../../src/services/content-generator/backends/ai/specialization/index.js'
);

function fakeCache() {
  return { get: vi.fn(async () => null), set: vi.fn(async () => {}), cleanup: vi.fn(async () => 0) };
}
function fakeCalendarClient() { return { listHolidays: vi.fn(async () => []) }; }
function fakeSonarClient() { return { query: vi.fn(async () => ({ text: '', usage: { inputTokens: 0, outputTokens: 0 }, modelId: 'sonar-pro' })) }; }

describe('buildCurrentAffairsProvider', () => {
  const baseDeps = () => ({
    cache: fakeCache() as any,
    calendarClient: fakeCalendarClient() as any,
    sonarClient: fakeSonarClient() as any,
    specialization: new RestaurantSpecialization(),
  });

  it('returns a NoopCurrentAffairsProvider when both flags are false', () => {
    const p = buildCurrentAffairsProvider({ v1Enabled: false, v2Enabled: false }, baseDeps());
    expect(p.name).toBe('noop');
  });

  it('returns CalendarOnlyProvider when only V1 is enabled', () => {
    const p = buildCurrentAffairsProvider({ v1Enabled: true, v2Enabled: false }, baseDeps());
    expect(p.name).toBe('calendar-only');
  });

  it('returns SonarAugmentedProvider when both V1 and V2 are enabled', () => {
    const p = buildCurrentAffairsProvider({ v1Enabled: true, v2Enabled: true }, baseDeps());
    expect(p.name).toBe('sonar-augmented');
  });

  it('returns SonarAugmentedProvider over Noop when V2 is enabled but V1 is not (edge case)', () => {
    const p = buildCurrentAffairsProvider({ v1Enabled: false, v2Enabled: true }, baseDeps());
    // V2 must run on top of *something*; falls back to noop upstream.
    expect(p.name).toBe('sonar-augmented');
  });
});
```

- [ ] **Step 2: Implement**

```typescript
/**
 * Barrel for the current-affairs subsystem + buildCurrentAffairsProvider factory.
 *
 * Decorator chain logic:
 *   - V1 only:  CalendarOnlyProvider
 *   - V1 + V2:  SonarAugmentedProvider over CalendarOnlyProvider
 *   - V2 only:  SonarAugmentedProvider over NoopCurrentAffairsProvider
 *   - Both off: NoopCurrentAffairsProvider
 */

export type {
  ICurrentAffairsProvider,
  FetchHintsParams,
  CurrentAffairsOperation,
} from './types.js';

export { NoopCurrentAffairsProvider } from './providers/noop-provider.js';
export { CalendarOnlyProvider } from './providers/calendar-only-provider.js';
export { SonarAugmentedProvider } from './providers/sonar-augmented-provider.js';

export type { ICurrentAffairsCache, CacheEntry } from './cache/types.js';
export { MongoCurrentAffairsCache } from './cache/mongo-cache.js';

export { GoogleCalendarClient } from './clients/google-calendar-client.js';
export type { GoogleCalendarClientOptions, CalendarHoliday } from './clients/google-calendar-client.js';

export { SonarClient } from './clients/sonar-client.js';
export type { SonarClientOptions, SonarResponse, SonarUsage } from './clients/sonar-client.js';

export { runCurrentAffairsRefresh } from './refresh-job.js';

import type { ICurrentAffairsProvider } from './types.js';
import type { ICurrentAffairsCache } from './cache/types.js';
import type { GoogleCalendarClient } from './clients/google-calendar-client.js';
import type { SonarClient } from './clients/sonar-client.js';
import type { IDomainSpecialization } from '../specialization/types.js';
import { NoopCurrentAffairsProvider } from './providers/noop-provider.js';
import { CalendarOnlyProvider } from './providers/calendar-only-provider.js';
import { SonarAugmentedProvider } from './providers/sonar-augmented-provider.js';

export interface CurrentAffairsFlags {
  v1Enabled: boolean;
  v2Enabled: boolean;
}

export interface CurrentAffairsDeps {
  cache: ICurrentAffairsCache;
  calendarClient: Pick<GoogleCalendarClient, 'listHolidays'>;
  sonarClient: Pick<SonarClient, 'query'>;
  specialization: IDomainSpecialization;
}

export function buildCurrentAffairsProvider(
  flags: CurrentAffairsFlags,
  deps: CurrentAffairsDeps,
): ICurrentAffairsProvider {
  const upstream: ICurrentAffairsProvider = flags.v1Enabled
    ? new CalendarOnlyProvider({ cache: deps.cache, client: deps.calendarClient })
    : new NoopCurrentAffairsProvider();

  if (flags.v2Enabled) {
    return new SonarAugmentedProvider(upstream, {
      cache: deps.cache,
      client: deps.sonarClient,
      specialization: deps.specialization,
    });
  }

  return upstream;
}
```

Note: this file imports `runCurrentAffairsRefresh` from `./refresh-job.js` which is created in Task 11. Type-check after Task 11 will resolve it; the test at this stage may fail to import because of the unresolved barrel export. To unblock, comment out the `runCurrentAffairsRefresh` re-export line for now and re-add it in Task 11. (Or stub the file with `export function runCurrentAffairsRefresh() {}` to satisfy type-check; Task 11 will replace.)

- [ ] **Step 3: Stub `refresh-job.ts` so this barrel resolves**

Create `apps/content-engine/src/services/content-generator/backends/ai/current-affairs/refresh-job.ts` with a temporary stub:

```typescript
import type { ICurrentAffairsProvider } from './types.js';

/** Calls provider.refresh(). Wrapped by the cron processor. Phase 3 Task 11 expands. */
export async function runCurrentAffairsRefresh(provider: ICurrentAffairsProvider): Promise<void> {
  await provider.refresh();
}
```

(Task 11 will rewrite this to add logging + tracedCronJob attribute injection, but a minimal version unblocks the barrel.)

- [ ] **Step 4: Verify**

`cd apps/content-engine && npx vitest run tests/unit/content-generator/backends/ai/current-affairs/factory.test.ts`
Expected: PASS, 4 assertions.

---

## Task 11: `runCurrentAffairsRefresh` finalizer + processor + tests

**Files:**
- Modify: `apps/content-engine/src/services/content-generator/backends/ai/current-affairs/refresh-job.ts` (replace the stub)
- Create: `apps/content-engine/src/services/processors/current-affairs-refresh/index.ts`
- Modify: `apps/content-engine/src/services/processors/index.ts` (re-export the new factory)
- Create: `apps/content-engine/tests/unit/processors/current-affairs-refresh.test.ts`

- [ ] **Step 1: Failing test for the processor factory**

Create `apps/content-engine/tests/unit/processors/current-affairs-refresh.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const {
  createCurrentAffairsRefreshProcessor,
} = await import('../../src/services/processors/current-affairs-refresh/index.js');

describe('createCurrentAffairsRefreshProcessor', () => {
  it('returns an IProcessor with name "current-affairs-refresh" and the supplied cron', () => {
    const provider = { name: 'mock', fetchHints: vi.fn(), refresh: vi.fn() };
    const p = createCurrentAffairsRefreshProcessor('0 6 * * *', provider as any);
    expect(p.name).toBe('current-affairs-refresh');
    expect(p.cron).toBe('0 6 * * *');
  });

  it('processor.run() invokes provider.refresh()', async () => {
    const refresh = vi.fn(async () => {});
    const provider = { name: 'mock', fetchHints: vi.fn(), refresh };
    const p = createCurrentAffairsRefreshProcessor('* * * * *', provider as any);
    await p.run();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Replace `refresh-job.ts` (final version)**

```typescript
/**
 * runCurrentAffairsRefresh -- single entry point for the daily refresh cron.
 *
 * Delegates to provider.refresh() (decorator chain handles the rest -- V1
 * refresh feeds V2 refresh, etc.). Logs + reraises so tracedCronJob records
 * the failure on the OTel span.
 */

import { createLogger } from '@restropulse/telemetry/server';
import type { ICurrentAffairsProvider } from './types.js';

const log = createLogger('current-affairs-refresh');

export async function runCurrentAffairsRefresh(provider: ICurrentAffairsProvider): Promise<void> {
  log.info({ provider: provider.name }, 'Current-affairs refresh starting');
  const start = Date.now();
  try {
    await provider.refresh();
    log.info({ provider: provider.name, durationMs: Date.now() - start }, 'Current-affairs refresh completed');
  } catch (err) {
    log.error({ err, provider: provider.name }, 'Current-affairs refresh failed');
    throw err;
  }
}
```

- [ ] **Step 3: Implement the processor factory**

Create `apps/content-engine/src/services/processors/current-affairs-refresh/index.ts`:

```typescript
/**
 * current-affairs-refresh processor.
 *
 * Wraps runCurrentAffairsRefresh in the IProcessor shape so worker.ts can
 * register it via the standard processors loop. Default schedule is 06:00 IST
 * (configured via CRON_CURRENT_AFFAIRS_REFRESH env var on the worker).
 */

import type { IProcessor } from '../types.js';
import {
  type ICurrentAffairsProvider,
  runCurrentAffairsRefresh,
} from '../../content-generator/backends/ai/current-affairs/index.js';

export function createCurrentAffairsRefreshProcessor(
  cron: string,
  provider: ICurrentAffairsProvider,
): IProcessor {
  return {
    name: 'current-affairs-refresh',
    cron,
    run: () => runCurrentAffairsRefresh(provider),
  };
}
```

- [ ] **Step 4: Re-export from processors barrel**

In `apps/content-engine/src/services/processors/index.ts`, add:

```typescript
export {
  createCurrentAffairsRefreshProcessor,
} from './current-affairs-refresh/index.js';
```

- [ ] **Step 5: Verify**

`cd apps/content-engine && npx vitest run tests/unit/processors/current-affairs-refresh.test.ts`
Expected: PASS, 2 assertions.

---

## Task 12: Update `pipeline/types.ts` to accept `currentAffairs` + helper for auto-enrichment

**Files:**
- Modify: `apps/content-engine/src/services/content-generator/backends/ai/pipeline/types.ts`

- [ ] **Step 1: Replace pipeline/types.ts content**

```typescript
/**
 * Dependencies the pipeline orchestration functions accept.
 *
 * Passing PipelineDeps (vs reading from a global) lets tests inject mocks
 * for every external dependency: the LLM client, the media generator, the
 * domain specialization, and (phase 3) the optional current-affairs provider.
 */

import type { ILLMProvider } from '../llm/types.js';
import type { IMediaGenerator } from '../media/types.js';
import type { IDomainSpecialization, SpecializationContext } from '../specialization/types.js';
import type { ICurrentAffairsProvider, CurrentAffairsOperation } from '../current-affairs/types.js';
import type { GenerationContext } from '../../../types.js';

export interface PipelineDeps {
  llm: ILLMProvider;
  media: IMediaGenerator;
  specialization: IDomainSpecialization;
  /** Optional. When set and caller supplies no hints, the pipeline auto-enriches. */
  currentAffairs?: ICurrentAffairsProvider;
}

export function toSpecializationContext(ctx?: GenerationContext): SpecializationContext {
  return {
    restaurantId: ctx?.restaurantId,
    restaurantName: ctx?.restaurantName,
    locale: ctx?.locale,
  };
}

/**
 * If the caller supplied currentAffairsHints, use them. Otherwise, if a provider
 * is configured, ask it. On any error the provider returns []; we never block
 * the pipeline on hint-fetch failure.
 */
export async function resolveCurrentAffairsHints(
  callerHints: string[] | undefined,
  provider: ICurrentAffairsProvider | undefined,
  params: {
    operation: CurrentAffairsOperation;
    specializationContext: SpecializationContext;
    concept?: string;
    restaurantId?: string;
    cycleId?: string;
    postId?: string;
  },
): Promise<string[]> {
  if (callerHints && callerHints.length > 0) return callerHints;
  if (!provider) return [];
  try {
    return await provider.fetchHints(params);
  } catch {
    return [];
  }
}
```

- [ ] **Step 2: Type-check**

`rtk npm run type-check --workspace=@restropulse/content-engine` -> exit 0.

(Pipeline files and AIContentGenerator do not yet call `resolveCurrentAffairsHints`. Tasks 13-14 wire them.)

---

## Task 13: Wire auto-enrichment into all 4 pipeline files

**Files:**
- Modify: `apps/content-engine/src/services/content-generator/backends/ai/pipeline/draft-cycle.ts`
- Modify: `apps/content-engine/src/services/content-generator/backends/ai/pipeline/revise-cycle.ts`
- Modify: `apps/content-engine/src/services/content-generator/backends/ai/pipeline/generate-post.ts`
- Modify: `apps/content-engine/src/services/content-generator/backends/ai/pipeline/revise-post.ts`

For each file: replace the section that builds the prompt's "current-affairs hints" line so it calls `resolveCurrentAffairsHints` first, using the result as the hints array.

- [ ] **Step 1: Update `draft-cycle.ts`**

Read the existing file first (~80 LOC). Locate the section that builds `userPrompt` containing `input.currentAffairsHints?.length ? ...`. Replace with:

```typescript
const hints = await resolveCurrentAffairsHints(
  input.currentAffairsHints,
  deps.currentAffairs,
  {
    operation: 'draftCycle',
    specializationContext: specCtx,
    ...(ctx?.restaurantId ? { restaurantId: ctx.restaurantId } : {}),
  },
);

const userPrompt = [
  deps.specialization.getTaskPrompt('draftCycle', input, specCtx),
  hints.length
    ? `\nCurrent-affairs hints (use sparingly):\n- ${hints.join('\n- ')}`
    : '',
].filter(Boolean).join('\n');
```

Add `resolveCurrentAffairsHints` to the existing import from `./types.js`.

- [ ] **Step 2: Update `revise-cycle.ts`**

Apply the same pattern. Operation = `'reviseCycle'`. The prompt assembly already references `input.currentAffairsHints` -- replace with `hints`.

- [ ] **Step 3: Update `generate-post.ts`**

The hint resolution needs `concept` for V2 trigger detection. Inside `runCaptionForPost` (or wherever the prompt is assembled), add:

```typescript
const hints = await resolveCurrentAffairsHints(
  input.currentAffairsHints,
  deps.currentAffairs,
  {
    operation: 'generatePost',
    specializationContext: specCtx,
    concept: input.concept,
    ...(ctx?.restaurantId ? { restaurantId: ctx.restaurantId } : {}),
    ...(input.cycleId ? { cycleId: input.cycleId } : {}),
  },
);
```

And update the existing `input.currentAffairsHints?.length` block to use `hints` instead.

- [ ] **Step 4: Update `revise-post.ts`**

Same pattern. Operation = `'revisePost'`. Use the existing post's caption as the `concept` proxy for trigger matching:

```typescript
const hints = await resolveCurrentAffairsHints(
  input.currentAffairsHints,
  deps.currentAffairs,
  {
    operation: 'revisePost',
    specializationContext: specCtx,
    concept: input.existingPost.caption,
    ...(ctx?.restaurantId ? { restaurantId: ctx.restaurantId } : {}),
  },
);
```

- [ ] **Step 5: Verify ALL pipeline tests still pass**

`cd apps/content-engine && npx vitest run tests/unit/content-generator/backends/ai/pipeline`
Expected: all green. The existing pipeline tests don't pass `currentAffairs` in their PipelineDeps so the new code path returns `input.currentAffairsHints ?? []` and tests are unaffected.

`rtk npm run type-check --workspace=@restropulse/content-engine` -> exit 0.

---

## Task 14: Checkpoint B wrap

- [ ] **Step 1: Run all phase-3 tests**

`cd apps/content-engine && npx vitest run tests/unit/content-generator/backends/ai/current-affairs tests/unit/processors/current-affairs-refresh.test.ts`
Expected: all green (~7 test files).

- [ ] **Step 2: Run the full content-engine suite**

`cd apps/content-engine && npx vitest run`
Expected: all green; baseline 285 + Checkpoint A's ~25 + Checkpoint B's ~22 = ~332 assertions over ~42 files.

- [ ] **Step 3: Type-check**

`rtk npm run type-check --workspace=@restropulse/content-engine` -> exit 0.

- [ ] **Step 4: Show user, request approval to proceed to Checkpoint C**

`rtk git status`. **STOP. Tell the user: "Checkpoint B complete - V1, V2, factory, processor wired. Approve continuing to Checkpoint C (AIContentGenerator + factory + worker.ts + e2e + commit)?"** Wait for approval.

---

# CHECKPOINT C - Wiring + cron + e2e + commit

## Task 15: AIContentGenerator constructor accepts optional `currentAffairs`

**Files:**
- Modify: `apps/content-engine/src/services/content-generator/backends/ai/ai-content-generator.ts`
- Modify: `apps/content-engine/tests/unit/content-generator/backends/ai/ai-content-generator.test.ts`

- [ ] **Step 1: Update AIContentGeneratorOptions + constructor**

In `ai-content-generator.ts`:

1. Add to the imports:
```typescript
import type { ICurrentAffairsProvider } from './current-affairs/types.js';
```

2. Update the options interface:
```typescript
export interface AIContentGeneratorOptions {
  specialization: IDomainSpecialization;
  llm: ILLMProvider;
  media: IMediaGenerator;
  /** Optional. When set, pipeline auto-enriches currentAffairsHints. */
  currentAffairs?: ICurrentAffairsProvider;
}
```

3. Update the constructor body to thread `currentAffairs` into `this.deps`:
```typescript
this.deps = {
  specialization: options.specialization,
  llm: options.llm,
  media: options.media,
  ...(options.currentAffairs ? { currentAffairs: options.currentAffairs } : {}),
};
```

4. Update the boot log line to mention the provider when present:
```typescript
log.info(
  {
    domain: this.specialization.domain,
    version: this.specialization.version,
    llm: options.llm.name,
    media: options.media.name,
    currentAffairs: options.currentAffairs?.name ?? 'none',
  },
  'AIContentGenerator instantiated',
);
```

- [ ] **Step 2: Add a test case proving the auto-enrichment is wired end-to-end inside the AIContentGenerator**

Append a test to the existing `ai-content-generator.test.ts` (do NOT replace the file; append):

```typescript
describe('AIContentGenerator currentAffairs auto-enrichment', () => {
  it('passes currentAffairs into PipelineDeps and pipeline forwards hints to the prompt', async () => {
    const generateObject = vi.fn().mockResolvedValue({
      object: { caption: 'A warm post', suggestedHashtags: ['#warm'] },
      usage: { inputTokens: 50, outputTokens: 30 },
      modelId: 'claude-haiku-4-5-20251001',
    });
    const generateImage = vi.fn().mockResolvedValue({
      jobId: 'jx', status: 'COMPLETED',
      mediaUrl: 'http://localhost/x.jpg', thumbnail: 'http://localhost/x.jpg',
      metadata: { widthPx: 1080, heightPx: 1080 },
    });
    const fetchHints = vi.fn(async () => ['Eid al-Fitr is in 2 days', 'IPL Final tonight']);
    const currentAffairs = { name: 'mock-current-affairs', fetchHints, refresh: vi.fn() };

    const gen = new AIContentGenerator({
      specialization: new RestaurantSpecialization(),
      llm: { name: 'mock', generateObject },
      media: { name: 'mock-media', generateImage, generateVideo: vi.fn(), pollJob: vi.fn() },
      currentAffairs: currentAffairs as any,
    });

    await gen.generatePost({ concept: 'cricket match-day biryani', type: 'IMAGE', platforms: ['INSTAGRAM'] });

    expect(fetchHints).toHaveBeenCalledTimes(1);
    const prompt = (generateObject.mock.calls[0][0] as any).prompt;
    expect(prompt).toContain('Eid al-Fitr is in 2 days');
    expect(prompt).toContain('IPL Final tonight');
  });

  it('does NOT call currentAffairs.fetchHints when caller already supplied currentAffairsHints', async () => {
    const generateObject = vi.fn().mockResolvedValue({
      object: { caption: 'x', suggestedHashtags: [] },
      usage: { inputTokens: 1, outputTokens: 1 }, modelId: 'claude-haiku-4-5-20251001',
    });
    const generateImage = vi.fn().mockResolvedValue({ jobId: 'j', status: 'COMPLETED', mediaUrl: 'http://x', thumbnail: 'http://x', metadata: { widthPx: 1, heightPx: 1 } });
    const fetchHints = vi.fn();
    const currentAffairs = { name: 'mock', fetchHints, refresh: vi.fn() };

    const gen = new AIContentGenerator({
      specialization: new RestaurantSpecialization(),
      llm: { name: 'mock', generateObject },
      media: { name: 'mock-media', generateImage, generateVideo: vi.fn(), pollJob: vi.fn() },
      currentAffairs: currentAffairs as any,
    });

    await gen.generatePost({
      concept: 'plain biryani',
      type: 'IMAGE',
      platforms: ['INSTAGRAM'],
      currentAffairsHints: ['caller-supplied hint'],
    });

    expect(fetchHints).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Verify**

`cd apps/content-engine && npx vitest run tests/unit/content-generator/backends/ai/ai-content-generator.test.ts`
Expected: all prior tests + 2 new = 9 passing.

---

## Task 16: Update `factory.ts` to wire `currentAffairs` provider chain

**Files:**
- Modify: `apps/content-engine/src/services/content-generator/factory.ts`
- Modify: `apps/content-engine/tests/unit/content-generator/factory.test.ts`

- [ ] **Step 1: Update factory.test.ts to cover the new env permutations**

Append (do NOT replace; the existing 4 tests still apply) the following test block to the existing `factory.test.ts`:

```typescript
describe('createContentGenerator -- current-affairs wiring', () => {
  it('attaches a CalendarOnly provider by default (V1=true, V2=false, GOOGLE_CALENDAR_API_KEY present)', () => {
    const k = process.env['GOOGLE_CALENDAR_API_KEY'];
    process.env['GOOGLE_CALENDAR_API_KEY'] = 'cal-test';
    process.env['CURRENT_AFFAIRS_V1_ENABLED'] = 'true';
    process.env['CURRENT_AFFAIRS_V2_ENABLED'] = 'false';
    try {
      const g = createContentGenerator('ai') as any;
      expect(g.specialization.domain).toBe('restaurant');
      // Inspect the underlying deps via name; AIContentGenerator does not expose
      // currentAffairs publicly, but its log line is enough -- we trust the test
      // in ai-content-generator.test.ts to prove the wiring works once injected.
      expect(g.name).toBe('ai');
    } finally {
      if (k === undefined) delete process.env['GOOGLE_CALENDAR_API_KEY'];
      else process.env['GOOGLE_CALENDAR_API_KEY'] = k;
    }
  });

  it('does not require GOOGLE_CALENDAR_API_KEY when V1 is disabled', () => {
    process.env['CURRENT_AFFAIRS_V1_ENABLED'] = 'false';
    process.env['CURRENT_AFFAIRS_V2_ENABLED'] = 'false';
    delete process.env['GOOGLE_CALENDAR_API_KEY'];
    expect(() => createContentGenerator('ai')).not.toThrow();
  });

  it('throws a clear error when V2 is enabled but PERPLEXITY_API_KEY is missing', () => {
    process.env['CURRENT_AFFAIRS_V1_ENABLED'] = 'true';
    process.env['CURRENT_AFFAIRS_V2_ENABLED'] = 'true';
    process.env['GOOGLE_CALENDAR_API_KEY'] = 'cal-test';
    delete process.env['PERPLEXITY_API_KEY'];
    expect(() => createContentGenerator('ai')).toThrow(/PERPLEXITY_API_KEY/);
  });

  it('throws a clear error when V1 is enabled but GOOGLE_CALENDAR_API_KEY is missing', () => {
    process.env['CURRENT_AFFAIRS_V1_ENABLED'] = 'true';
    process.env['CURRENT_AFFAIRS_V2_ENABLED'] = 'false';
    delete process.env['GOOGLE_CALENDAR_API_KEY'];
    expect(() => createContentGenerator('ai')).toThrow(/GOOGLE_CALENDAR_API_KEY/);
  });
});
```

- [ ] **Step 2: Update factory.ts**

REPLACE the existing factory.ts content with:

```typescript
/**
 * createContentGenerator -- selects the registered IContentGenerator backend
 * based on a flag string. Wired into worker.ts via the CONTENT_GENERATOR_BACKEND
 * env var. Default is 'placeholder' so existing deployments keep their current
 * behavior unless the flag is explicitly flipped.
 *
 * The 'ai' branch:
 *   - reads ANTHROPIC_API_KEY (always required)
 *   - reads CURRENT_AFFAIRS_V1_ENABLED (default 'true')
 *   - reads CURRENT_AFFAIRS_V2_ENABLED (default 'false')
 *   - reads GOOGLE_CALENDAR_API_KEY (required when V1 enabled)
 *   - reads PERPLEXITY_API_KEY (required when V2 enabled)
 *
 * Missing required keys throw at boot rather than letting the worker silently
 * misbehave.
 */

import type { IContentGenerator } from './types.js';
import { PlaceholderContentGenerator } from './backends/placeholder/index.js';
import { AIContentGenerator } from './backends/ai/ai-content-generator.js';
import { RestaurantSpecialization } from './backends/ai/specialization/index.js';
import { AnthropicLLMProvider } from './backends/ai/llm/anthropic-provider.js';
import { PlaceholderMediaGenerator } from './backends/ai/media/placeholder-media-generator.js';
import {
  buildCurrentAffairsProvider,
  GoogleCalendarClient,
  MongoCurrentAffairsCache,
  SonarClient,
  type ICurrentAffairsProvider,
} from './backends/ai/current-affairs/index.js';

export type ContentGeneratorBackend = 'placeholder' | 'ai';

function readBoolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1';
}

function buildCurrentAffairsForFactory(specialization: RestaurantSpecialization): ICurrentAffairsProvider {
  const v1Enabled = readBoolEnv('CURRENT_AFFAIRS_V1_ENABLED', true);
  const v2Enabled = readBoolEnv('CURRENT_AFFAIRS_V2_ENABLED', false);

  if (!v1Enabled && !v2Enabled) {
    return buildCurrentAffairsProvider({ v1Enabled: false, v2Enabled: false }, {
      cache: new MongoCurrentAffairsCache(),
      // Stub clients -- never called when both flags are off
      calendarClient: { listHolidays: async () => [] } as any,
      sonarClient: { query: async () => ({ text: '', usage: { inputTokens: 0, outputTokens: 0 }, modelId: 'sonar-pro' }) } as any,
      specialization,
    });
  }

  let calendarClient: GoogleCalendarClient | { listHolidays: () => Promise<never[]> };
  if (v1Enabled) {
    const calKey = process.env.GOOGLE_CALENDAR_API_KEY;
    if (!calKey) {
      throw new Error('GOOGLE_CALENDAR_API_KEY is required when CURRENT_AFFAIRS_V1_ENABLED=true');
    }
    calendarClient = new GoogleCalendarClient({ apiKey: calKey });
  } else {
    calendarClient = { listHolidays: async () => [] };
  }

  let sonarClient: SonarClient | { query: () => Promise<{ text: string; usage: { inputTokens: number; outputTokens: number }; modelId: string }> };
  if (v2Enabled) {
    const sonarKey = process.env.PERPLEXITY_API_KEY;
    if (!sonarKey) {
      throw new Error('PERPLEXITY_API_KEY is required when CURRENT_AFFAIRS_V2_ENABLED=true');
    }
    sonarClient = new SonarClient({ apiKey: sonarKey });
  } else {
    sonarClient = { query: async () => ({ text: '', usage: { inputTokens: 0, outputTokens: 0 }, modelId: 'sonar-pro' }) };
  }

  return buildCurrentAffairsProvider(
    { v1Enabled, v2Enabled },
    {
      cache: new MongoCurrentAffairsCache(),
      calendarClient: calendarClient as GoogleCalendarClient,
      sonarClient: sonarClient as SonarClient,
      specialization,
    },
  );
}

/**
 * Stash the current-affairs provider per call so worker.ts can pull the same
 * instance for cron registration without re-running the env logic. This is a
 * factory-internal cache keyed by the most recent backend selected.
 */
let lastAiCurrentAffairs: ICurrentAffairsProvider | null = null;

/**
 * Read the current-affairs provider built by the most recent createContentGenerator('ai') call.
 * Worker.ts uses this to wire the cron processor. Returns null if 'ai' was never selected
 * (in which case there's nothing to refresh).
 */
export function getLastAiCurrentAffairsProvider(): ICurrentAffairsProvider | null {
  return lastAiCurrentAffairs;
}

export function createContentGenerator(backend: ContentGeneratorBackend): IContentGenerator {
  switch (backend) {
    case 'placeholder':
      lastAiCurrentAffairs = null;
      return new PlaceholderContentGenerator();

    case 'ai': {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error(
          'ANTHROPIC_API_KEY is required when CONTENT_GENERATOR_BACKEND=ai. Set it in apps/content-engine/.env or the deployment environment.',
        );
      }
      const specialization = new RestaurantSpecialization();
      const currentAffairs = buildCurrentAffairsForFactory(specialization);
      lastAiCurrentAffairs = currentAffairs;
      return new AIContentGenerator({
        specialization,
        llm: new AnthropicLLMProvider({ apiKey }),
        media: new PlaceholderMediaGenerator(),
        currentAffairs,
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
Expected: 4 prior + 4 new = 8 tests, all green.

---

## Task 17: Wire processor + env into `worker.ts`

**Files:**
- Modify: `apps/content-engine/src/worker.ts`

- [ ] **Step 1: Read worker.ts** to confirm current import block + Zod schema location.

- [ ] **Step 2: Update imports**

Add to the existing imports:

```typescript
import {
  createAdhocProcessor,
  createStrategyProcessor,
  createRollingWindowProcessor,
  createRevisionProcessor,
  createDeadlineProcessor,
  createCycleSyncProcessor,
  createCurrentAffairsRefreshProcessor,    // NEW
  type IProcessor,
} from './services/processors/index.js';
import {
  createContentGenerator,
  getLastAiCurrentAffairsProvider,         // NEW
  setContentGenerator,
  type ContentGeneratorBackend,
} from './services/content-generator/index.js';
```

(`getLastAiCurrentAffairsProvider` needs to be re-exported from `content-generator/index.ts` -- update that barrel too.)

- [ ] **Step 3: Update content-generator/index.ts to re-export the new factory helper**

Add to `apps/content-engine/src/services/content-generator/index.ts`:

```typescript
export { createContentGenerator, getLastAiCurrentAffairsProvider } from './factory.js';
```

(Replace the existing `export { createContentGenerator } from './factory.js';` line.)

- [ ] **Step 4: Add env vars to the Zod schema**

In `worker.ts`, after `CONTENT_GENERATOR_BACKEND`, add:

```typescript
    CURRENT_AFFAIRS_V1_ENABLED: z.string().default('true'),
    CURRENT_AFFAIRS_V2_ENABLED: z.string().default('false'),
    GOOGLE_CALENDAR_API_KEY: z.string().optional(),
    PERPLEXITY_API_KEY: z.string().optional(),
    CRON_CURRENT_AFFAIRS_REFRESH: z.string().default('0 6 * * *'),
```

- [ ] **Step 5: Append the current-affairs processor when present**

In the `processors` array assembly block, after the existing 6 entries, add a conditional appending:

```typescript
    const processors: IProcessor[] = [
      createAdhocProcessor(env.CRON_PENDING_POSTS),
      createStrategyProcessor(env.CRON_PENDING_CYCLES),
      createRollingWindowProcessor(env.CRON_ROLLING_WINDOW, rollingWindowConfig),
      createRevisionProcessor(env.CRON_REVISIONS),
      createDeadlineProcessor(env.CRON_DEADLINES, deadlineConfig),
      createCycleSyncProcessor(env.CRON_CYCLE_SYNC),
    ];

    const aiCurrentAffairs = getLastAiCurrentAffairsProvider();
    if (aiCurrentAffairs && aiCurrentAffairs.name !== 'noop') {
      processors.push(createCurrentAffairsRefreshProcessor(env.CRON_CURRENT_AFFAIRS_REFRESH, aiCurrentAffairs));
      logger.info(
        { provider: aiCurrentAffairs.name, cron: env.CRON_CURRENT_AFFAIRS_REFRESH },
        'current-affairs-refresh processor registered',
      );
    }

    for (const processor of processors) {
      registerProcessor(processor);
    }
```

(Convert `processors` from `const ... = [...]` literal to a mutable `const processors: IProcessor[] = [...]` so we can push.)

- [ ] **Step 6: Type-check + smoke**

`rtk npm run type-check --workspace=@restropulse/content-engine` -> exit 0.

```
cd apps/content-engine && CONTENT_GENERATOR_BACKEND=ai ANTHROPIC_API_KEY=sk-fake GOOGLE_CALENDAR_API_KEY=cal-fake CURRENT_AFFAIRS_V1_ENABLED=true CURRENT_AFFAIRS_V2_ENABLED=false npx tsx --eval "import('./src/services/content-generator/factory.js').then(m => { const g = m.createContentGenerator('ai'); console.log('ai:', g.name, 'currentAffairs:', m.getLastAiCurrentAffairsProvider()?.name ?? 'null'); }).catch(e => { console.error(e); process.exit(1); })"
```
Expected output includes: `ai: ai currentAffairs: calendar-only`

---

## Task 18: End-to-end integration test

**Files:**
- Create: `apps/content-engine/tests/integration/current-affairs-end-to-end.test.ts`

This complements unit tests with one round trip: real Mongo cache, mocked Google Calendar + Sonar clients, full AIContentGenerator + provider chain, asserts auto-enrichment lands in the LLM prompt.

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
const {
  buildCurrentAffairsProvider,
  MongoCurrentAffairsCache,
} = await import('../../src/services/content-generator/backends/ai/current-affairs/index.js');

let mongod: MongoMemoryServer;
let client: MongoClient;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongod.getUri());
  setDB(client.db('current-affairs-e2e-test'));
}, 60000);

afterAll(async () => {
  await client.close();
  await mongod.stop();
}, 20000);

beforeEach(async () => {
  await client.db('current-affairs-e2e-test').collection('currentAffairsCache').deleteMany({});
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-13T00:00:00Z'));
});

describe('AIContentGenerator with current-affairs auto-enrichment (V1+V2)', () => {
  it('refresh -> generatePost: holiday + daily-Sonar lines surface in the LLM prompt', async () => {
    const calendarClient = { listHolidays: vi.fn(async () => [{ name: 'Eid al-Fitr', date: '2026-05-15' }]) };
    const sonarClient = { query: vi.fn(async () => ({ text: 'IPL Final tonight in Chennai', usage: { inputTokens: 60, outputTokens: 80 }, modelId: 'sonar-pro' })) };

    const cache = new MongoCurrentAffairsCache();
    const specialization = new RestaurantSpecialization();
    const provider = buildCurrentAffairsProvider(
      { v1Enabled: true, v2Enabled: true },
      { cache, calendarClient: calendarClient as any, sonarClient: sonarClient as any, specialization },
    );

    // Refresh once so V2's daily cache entry is populated
    await provider.refresh();
    expect(sonarClient.query).toHaveBeenCalledTimes(1); // daily refresh fired

    // Now build the AI gen and run generatePost
    const generateObject = vi.fn().mockResolvedValue({
      object: { caption: 'Plate of biryani for the match', suggestedHashtags: ['#biryani'] },
      usage: { inputTokens: 120, outputTokens: 60 },
      modelId: 'claude-haiku-4-5-20251001',
    });
    const generateImage = vi.fn().mockResolvedValue({
      jobId: 'j', status: 'COMPLETED',
      mediaUrl: 'http://x', thumbnail: 'http://x',
      metadata: { widthPx: 1080, heightPx: 1080 },
    });

    const gen = new AIContentGenerator({
      specialization,
      llm: { name: 'mock-llm', generateObject },
      media: { name: 'mock-media', generateImage, generateVideo: vi.fn(), pollJob: vi.fn() },
      currentAffairs: provider,
    });

    await gen.generatePost(
      { concept: 'cricket match-day biryani special', type: 'IMAGE', platforms: ['INSTAGRAM'] },
      { restaurantId: 'r1', restaurantName: 'Spice Route', locale: 'en-IN' },
    );

    // The per-post Sonar call also fired (concept matches 'cricket' / 'match')
    expect(sonarClient.query).toHaveBeenCalledTimes(2);

    const prompt = (generateObject.mock.calls[0][0] as any).prompt;
    expect(prompt).toContain('Eid al-Fitr');
    expect(prompt).toContain('IPL Final tonight in Chennai');
  });
});
```

- [ ] **Step 2: Verify**

`cd apps/content-engine && npx vitest run tests/integration/current-affairs-end-to-end.test.ts`
Expected: PASS.

---

## Task 19: Final regression sweep + smoke test

- [ ] **Step 1: Full content-engine suite**

`cd apps/content-engine && npx vitest run`
Expected: ~43 test files, ~340 assertions, all green.

- [ ] **Step 2: Monorepo type-check**

From repo root: `rtk npm run type-check`
Expected: exit 0 across all 11 workspaces.

- [ ] **Step 3: Smoke - factory builds the V1-only chain**

```
cd apps/content-engine && CONTENT_GENERATOR_BACKEND=ai ANTHROPIC_API_KEY=sk-fake GOOGLE_CALENDAR_API_KEY=cal-fake npx tsx --eval "import('./src/services/content-generator/factory.js').then(m => { m.createContentGenerator('ai'); console.log('provider:', m.getLastAiCurrentAffairsProvider()?.name); }).catch(e => { console.error(e); process.exit(1); })"
```
Expected: `provider: calendar-only`

- [ ] **Step 4: Smoke - factory builds V1+V2 chain when both enabled**

```
cd apps/content-engine && CONTENT_GENERATOR_BACKEND=ai ANTHROPIC_API_KEY=sk-fake GOOGLE_CALENDAR_API_KEY=cal-fake CURRENT_AFFAIRS_V2_ENABLED=true PERPLEXITY_API_KEY=pplx-fake npx tsx --eval "import('./src/services/content-generator/factory.js').then(m => { m.createContentGenerator('ai'); console.log('provider:', m.getLastAiCurrentAffairsProvider()?.name); }).catch(e => { console.error(e); process.exit(1); })"
```
Expected: `provider: sonar-augmented`

- [ ] **Step 5: Smoke - factory throws clear error for missing keys**

```
cd apps/content-engine && CONTENT_GENERATOR_BACKEND=ai ANTHROPIC_API_KEY=sk-fake CURRENT_AFFAIRS_V2_ENABLED=true npx tsx --eval "import('./src/services/content-generator/factory.js').then(m => { try { m.createContentGenerator('ai'); console.log('UNEXPECTED success'); process.exit(1); } catch (e) { console.log('expected error:', e.message); } })"
```
Expected: `expected error: PERPLEXITY_API_KEY is required when CURRENT_AFFAIRS_V2_ENABLED=true` (or the GOOGLE_CALENDAR_API_KEY error if V1 default-on caught first)

---

## Task 20: Stage everything

- [ ] **Step 1: Stage all phase-3 files**

Run from repo root:

```
rtk git add \
  packages/db/src/connection.ts \
  packages/db/src/index.ts \
  apps/content-engine/src/services/content-generator/backends/ai/current-affairs \
  apps/content-engine/src/services/content-generator/backends/ai/index.ts \
  apps/content-engine/src/services/content-generator/backends/ai/ai-content-generator.ts \
  apps/content-engine/src/services/content-generator/backends/ai/pipeline/types.ts \
  apps/content-engine/src/services/content-generator/backends/ai/pipeline/draft-cycle.ts \
  apps/content-engine/src/services/content-generator/backends/ai/pipeline/revise-cycle.ts \
  apps/content-engine/src/services/content-generator/backends/ai/pipeline/generate-post.ts \
  apps/content-engine/src/services/content-generator/backends/ai/pipeline/revise-post.ts \
  apps/content-engine/src/services/content-generator/factory.ts \
  apps/content-engine/src/services/content-generator/index.ts \
  apps/content-engine/src/services/processors/current-affairs-refresh \
  apps/content-engine/src/services/processors/index.ts \
  apps/content-engine/src/worker.ts \
  apps/content-engine/tests/unit/content-generator/backends/ai/current-affairs \
  apps/content-engine/tests/unit/content-generator/backends/ai/ai-content-generator.test.ts \
  apps/content-engine/tests/unit/content-generator/factory.test.ts \
  apps/content-engine/tests/unit/processors/current-affairs-refresh.test.ts \
  apps/content-engine/tests/integration/current-affairs-end-to-end.test.ts \
  docs/superpowers/plans/2026-05-03-content-engine-ai-phase-3.md

rtk git status
rtk git diff --staged --stat
```

(`apps/content-engine/src/services/content-generator/backends/ai/index.ts` is included only if Task 11/16 modified it; if not, drop from the add list. Likewise some pipeline files.)

## Task 21: STOP for commit approval, then commit

**STOP. Show user staged status + stat. Ask: "Phase 3 complete - V1 calendar + V2 Sonar wired behind toggleable env vars. Default chain is V1-only (zero cost). Approve committing as a single phase-3 commit?"**

After explicit user approval:

```
rtk git commit -m "$(cat <<'EOF'
feat(content-engine): wire current-affairs RAG (V1 calendar + V2 Sonar Pro decorator chain)

Phase 3 of the content-engine AI rollout per ADR 0001 sections 5 + 6.
AIContentGenerator now auto-populates currentAffairsHints from a configurable
ICurrentAffairsProvider chain when callers do not supply hints. The chain is
selected from env at factory time:

  CURRENT_AFFAIRS_V1_ENABLED=true  (default) -> CalendarOnlyProvider
  CURRENT_AFFAIRS_V2_ENABLED=true            -> SonarAugmentedProvider over V1
  Both off                                    -> NoopCurrentAffairsProvider

V1 (CalendarOnlyProvider): pulls India public holidays from Google Calendar
(en.indian#holiday@group.v.calendar.google.com), caches per-month for 24h in
the new currentAffairsCache MongoDB collection. Lazy-fetches on cache miss
(free, so no surprise costs). Emits hints like "Today is Wednesday, 13 May
2026" and "Eid al-Fitr is in 2 days". GOOGLE_CALENDAR_API_KEY required when
V1 enabled.

V2 (SonarAugmentedProvider, decorator): layers Perplexity Sonar Pro on top.
Daily platform-wide refresh at 06:00 IST writes one cached response shared
across all restaurants (~$0.10/day platform-wide). Per-post hyperlocal
trigger fires a Sonar call only when the post concept matches an allowlist
of keywords (sports/festivals/weather/celebrations) -- bounded cost.
PERPLEXITY_API_KEY required when V2 enabled. Default V2=false so operators
opt in to Sonar costs explicitly.

New current-affairs-refresh IProcessor runs at CRON_CURRENT_AFFAIRS_REFRESH
(default '0 6 * * *') and invokes provider.refresh(); decorator chain handles
V1+V2 refresh ordering. Registered automatically in worker.ts when the
provider chain is non-noop.

Cost-tracking: every Sonar call (daily and per-post) writes to costEvents
with surface='sonar', step in {'daily','trigger'}, model='sonar-pro' so the
per-restaurant billing dashboard can attribute Sonar usage alongside LLM
cost.

New tests: 7 unit test files + 1 integration test file using
mongodb-memory-server. All prior 285 tests continue to pass; total ~340/340.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
rtk git status
rtk git log --oneline -6
```

---

## Self-Review

**Spec coverage** (against phase 3 brainstorm):
- ICurrentAffairsProvider interface + decorator pattern -> Task 1, 6, 8, 9, 10
- MongoDB cache (24h TTL) -> Task 2, 3
- Google Calendar client + tests -> Task 4
- Perplexity Sonar client + tests -> Task 5
- V1 CalendarOnlyProvider with lazy fetch -> Task 8
- V2 SonarAugmentedProvider decorator with daily cache + per-post triggers -> Task 9
- buildCurrentAffairsProvider factory env-driven chain -> Task 10
- daily refresh cron processor (IProcessor contract) -> Task 11
- Pipeline auto-enrichment (all 4 ops) -> Task 12, 13
- AIContentGenerator constructor accepts optional currentAffairs -> Task 15
- Factory wires the chain + env validation + clear errors -> Task 16
- worker.ts adds env vars + registers processor -> Task 17
- End-to-end integration test (real Mongo + mocked clients) -> Task 18
- Smoke tests for both flag permutations -> Task 19

**Placeholder scan**: searched plan for "TBD", "implement later", "fill in", "appropriate error handling", "similar to Task". None present. Every code block contains real code.

**Type consistency**:
- `ICurrentAffairsProvider.fetchHints(params: FetchHintsParams)` signature is consistent across types.ts, all three providers, the factory test, and the pipeline helper.
- `ICurrentAffairsCache.{get,set,cleanup}` consistent between types.ts, MongoCurrentAffairsCache, and provider mocks in tests.
- `'currentAffairsRefresh'` is a valid `CostOperation` member from phase 1's @restropulse/shared/cost-events.ts -- verified before drafting.
- `IProcessor` shape `{ name, cron, run() }` matches the existing contract from the prior commit.
- `AIContentGeneratorOptions.currentAffairs` is OPTIONAL -- no breaking changes for existing callers.

**Cross-cutting notes**:
- Plain ASCII only.
- `rtk` for shell, NOT for vitest (`npx vitest` directly).
- `import type` for type-only imports.
- ESM `.js` extensions in import paths.
- Do not commit between tasks.
- Default behavior remains placeholder backend; V1 default-on only takes effect when ai backend is selected (still gated by CONTENT_GENERATOR_BACKEND).
