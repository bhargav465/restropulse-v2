# Content-Engine AI - Phase 4: fal.ai Image Generation + mediaJobs Collection

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire real fal.ai image generation behind a new `MEDIA_BACKEND=placeholder|fal-ai` env flag (default `placeholder`). When operators flip to `fal-ai`: text-to-image goes through Flux dev, user-supplied `baseImageUrl` routes to Flux dev image-to-image. CAROUSEL generates 3 parallel frames per post. STORY uses portrait sizing. REEL/VIDEO posts fail loudly with `BACKEND_UNAVAILABLE` until phase 5. Synchronous flow (image gen is 1-3s). The new `mediaJobs` MongoDB collection ships now so phase 5 can layer durable polling onto it without schema changes.

**Architecture:** `IMediaJobStore` is a new interface backed by `MongoMediaJobStore` against the `mediaJobs` collection. `FalAIMediaGenerator` writes a `MediaJobRecord` per call (status COMPLETED for phase 4 image jobs; phase 5 introduces PENDING/RUNNING for video). All fal.ai calls go through `withRetry(IMAGE_SUBMIT)` + `withCostTracking(surface='image')` from prior phases. The factory selects `PlaceholderMediaGenerator` or `FalAIMediaGenerator` based on `MEDIA_BACKEND`. Default behavior unchanged unless flag flipped.

**Tech Stack:** TypeScript (strict, ESM), MongoDB driver v6, native `fetch` for fal.ai HTTP, Vitest + mongodb-memory-server, `withRetry` + `withCostTracking` from phase 1.

---

## Phase 4 Checkpoints

Three review checkpoints, one final commit at the end.

- **Checkpoint A (Tasks 1-6):** Foundations - MediaJobRecord type, mediaJobs DB collection, IMediaJobStore + MongoMediaJobStore, FalClient, models + pricing. STOP for user approval.
- **Checkpoint B (Tasks 7-11):** FalAIMediaGenerator (text-to-image, image-edit, REEL throws), barrel, factory wiring. STOP for user approval.
- **Checkpoint C (Tasks 12-17):** Pipeline restaurantId/postId threading, worker.ts env, end-to-end test, smoke tests, stage + commit gate.

---

## File Structure

### New files

```
packages/shared/src/media-jobs.ts                                    MediaJobRecord, MediaJobStatus, MediaJobProvider types
packages/db/src/media-jobs.ts                                        DB helpers (insert, find, updateStatus, incrementAttempts)

apps/content-engine/src/services/content-generator/backends/ai/media/
  jobs/
    types.ts                                                         IMediaJobStore interface
    mongo-media-job-store.ts                                         MongoMediaJobStore
  fal-ai/
    index.ts                                                         barrel
    models.ts                                                        FAL_MODELS = { fluxDev, fluxImg2Img }
    pricing.ts                                                       FAL_PRICING + computeFalCostUsd(model)
    fal-client.ts                                                    FalClient (HTTP wrapper)
    fal-ai-media-generator.ts                                        FalAIMediaGenerator class

apps/content-engine/tests/unit/content-generator/backends/ai/media/
  jobs/
    mongo-media-job-store.test.ts                                    integration via mongodb-memory-server
  fal-ai/
    pricing.test.ts
    fal-client.test.ts
    fal-ai-media-generator.test.ts

apps/content-engine/tests/integration/
  fal-ai-end-to-end.test.ts                                          mocked fal HTTP, real Mongo
```

### Modified files

```
packages/db/src/connection.ts                                                                                          + getMediaJobsCollection()
packages/db/src/index.ts                                                                                               + re-exports
apps/content-engine/src/services/content-generator/backends/ai/media/types.ts                                          + restaurantId/postId/cycleId in ImageGenInput/VideoGenInput
apps/content-engine/src/services/content-generator/backends/ai/pipeline/generate-post.ts                               thread restaurantId/postId/cycleId into media call
apps/content-engine/src/services/content-generator/backends/ai/pipeline/revise-post.ts                                 thread same
apps/content-engine/src/services/content-generator/factory.ts                                                          MEDIA_BACKEND switch + FAL_API_KEY validation
apps/content-engine/src/services/content-generator/backends/ai/index.ts                                                re-export fal-ai + jobs barrel
apps/content-engine/src/worker.ts                                                                                      + MEDIA_BACKEND + FAL_API_KEY in env schema
apps/content-engine/tests/unit/content-generator/backends/ai/media/placeholder-media-generator.test.ts                 absorb new optional fields (no behavior change)
apps/content-engine/tests/unit/content-generator/factory.test.ts                                                       new test cases for MEDIA_BACKEND=fal-ai
```

---

# CHECKPOINT A - Foundations (types, store, client, pricing)

## Task 1: `MediaJobRecord` type in `@restropulse/shared`

**Files:**
- Create: `packages/shared/src/media-jobs.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Create `media-jobs.ts`**

```typescript
/**
 * Per-media-generation job record persisted in the mediaJobs collection.
 *
 * Phase 4 writes one row per fal.ai image call (always status=COMPLETED).
 * Phase 5 introduces PENDING/RUNNING transitions for slow video generation
 * (Kling/MiniMax) and a media-job-poller cron that watches RUNNING rows.
 *
 * The schema ships now so phase 5 only needs to layer the polling cron
 * without changing the document shape.
 */

import type { PostType } from './index.js';

export type MediaJobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
export type MediaJobProvider = 'placeholder-media' | 'fal-ai';

export interface MediaJobRecord {
  id?: string;
  /** Stable client-side id (UUID). */
  jobId: string;
  /** Provider-side request id (e.g. fal.ai request_id). Empty for synchronous providers. */
  providerJobId?: string;
  provider: MediaJobProvider;
  /** Concrete model that produced this job (e.g. 'fal-ai/flux/dev'). */
  modelId: string;
  /** Post type this job is intended for. */
  postType: PostType;
  status: MediaJobStatus;

  /** Single-image and video result URL. */
  mediaUrl?: string;
  /** Multi-image carousel result URLs. */
  mediaUrls?: string[];
  /** Thumbnail URL (for video and carousel). */
  thumbnail?: string;
  /** Width/height/duration metadata when known. */
  metadata?: {
    widthPx?: number;
    heightPx?: number;
    durationSeconds?: number;
  };

  /** Failure detail when status=FAILED. */
  error?: string;
  /** Submission attempts so far. Phase 4 increments at most once. */
  attempts: number;

  /** Cost-attribution labels (denormalized for fast dashboards). */
  restaurantId?: string;
  postId?: string;
  cycleId?: string;

  /** Lifecycle timestamps. */
  startedAt: Date;
  lastPolledAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

- [ ] **Step 2: Re-export from the barrel**

In `packages/shared/src/index.ts`, add (alphabetically near `export * from './cost-events.js';`):

```typescript
export * from './media-jobs.js';
```

- [ ] **Step 3: Type-check**

`rtk npm run type-check --workspace=@restropulse/shared`
Expected: exit 0.

---

## Task 2: `getMediaJobsCollection` + `media-jobs.ts` helper in `@restropulse/db`

**Files:**
- Modify: `packages/db/src/connection.ts`
- Create: `packages/db/src/media-jobs.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Add the collection getter**

In `packages/db/src/connection.ts`, after `getCurrentAffairsCacheCollection()`, add:

```typescript
export function getMediaJobsCollection(): Collection {
  return getDB().collection('mediaJobs');
}
```

- [ ] **Step 2: Add `getMediaJobsCollection,` to the named exports** in `packages/db/src/index.ts` (alphabetical near `getCurrentAffairsCacheCollection`).

- [ ] **Step 3: Create the helper**

```typescript
/**
 * @restropulse/db - mediaJobs collection helpers.
 *
 * Each fal.ai (or other media-provider) call writes a MediaJobRecord. Phase 4
 * writes COMPLETED rows synchronously; phase 5 will write PENDING -> RUNNING
 * -> COMPLETED for slow video generation and add the media-job-poller cron.
 */

import { getMediaJobsCollection } from './connection.js';
import type { MediaJobRecord } from '@restropulse/shared';

export async function insertMediaJob(
  job: Omit<MediaJobRecord, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<MediaJobRecord> {
  const col = getMediaJobsCollection();
  const now = new Date();
  const doc = { ...job, createdAt: now, updatedAt: now };
  const result = await col.insertOne(doc as any);
  return { ...doc, id: result.insertedId.toString() } as MediaJobRecord;
}

export async function findMediaJobById(jobId: string): Promise<MediaJobRecord | null> {
  const col = getMediaJobsCollection();
  const doc = await col.findOne({ jobId });
  if (!doc) return null;
  const { _id, ...rest } = doc as any;
  return { ...rest, id: _id.toString() } as MediaJobRecord;
}

export type MediaJobUpdatable = Partial<
  Pick<
    MediaJobRecord,
    'status' | 'mediaUrl' | 'mediaUrls' | 'thumbnail' | 'metadata' | 'error' | 'lastPolledAt' | 'completedAt'
  >
>;

export async function updateMediaJobStatus(
  jobId: string,
  update: MediaJobUpdatable,
): Promise<MediaJobRecord | null> {
  const col = getMediaJobsCollection();
  const result = await col.findOneAndUpdate(
    { jobId },
    { $set: { ...update, updatedAt: new Date() } as any },
    { returnDocument: 'after' },
  );
  if (!result) return null;
  const { _id, ...rest } = result as any;
  return { ...rest, id: _id.toString() } as MediaJobRecord;
}

export async function incrementMediaJobAttempts(jobId: string): Promise<void> {
  const col = getMediaJobsCollection();
  await col.updateOne({ jobId }, { $inc: { attempts: 1 }, $set: { updatedAt: new Date() } } as any);
}

export async function findStaleRunningJobs(olderThan: Date): Promise<MediaJobRecord[]> {
  // Phase 5 uses this to reset stale RUNNING jobs to PENDING. Phase 4 ships
  // the helper so phase 5 has a one-line change to add the cron.
  const col = getMediaJobsCollection();
  const docs = await col.find({ status: 'RUNNING', startedAt: { $lt: olderThan } } as any).toArray();
  return docs.map((d) => {
    const { _id, ...rest } = d as any;
    return { ...rest, id: _id.toString() } as MediaJobRecord;
  });
}
```

- [ ] **Step 4: Re-export from `packages/db/src/index.ts`**

```typescript
export * from './media-jobs.js';
```

- [ ] **Step 5: Build + type-check**

```
rtk npm run build --workspace=@restropulse/shared
rtk npm run build --workspace=@restropulse/db
rtk npm run type-check --workspace=@restropulse/db
```
All exit 0.

---

## Task 3: `IMediaJobStore` interface + `MongoMediaJobStore` (TDD)

**Files:**
- Create: `apps/content-engine/src/services/content-generator/backends/ai/media/jobs/types.ts`
- Create: `apps/content-engine/src/services/content-generator/backends/ai/media/jobs/mongo-media-job-store.ts`
- Create: `apps/content-engine/tests/unit/content-generator/backends/ai/media/jobs/mongo-media-job-store.test.ts`

- [ ] **Step 1: Create `types.ts`**

```typescript
/**
 * IMediaJobStore -- thin abstraction over the mediaJobs persistence backend.
 * Phase 4 ships MongoMediaJobStore. Future backends (Redis for ephemeral,
 * Postgres for analytics) plug in here without changing FalAIMediaGenerator.
 */

import type { MediaJobRecord } from '@restropulse/shared';
import type { MediaJobUpdatable } from '@restropulse/db';

export interface IMediaJobStore {
  insert(job: Omit<MediaJobRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<MediaJobRecord>;
  findById(jobId: string): Promise<MediaJobRecord | null>;
  updateStatus(jobId: string, update: MediaJobUpdatable): Promise<MediaJobRecord | null>;
  incrementAttempts(jobId: string): Promise<void>;
}

export type { MediaJobUpdatable };
```

- [ ] **Step 2: Failing test**

Create `apps/content-engine/tests/unit/content-generator/backends/ai/media/jobs/mongo-media-job-store.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { setDB } from '@restropulse/db';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { MongoMediaJobStore } = await import(
  '../../../../../../../src/services/content-generator/backends/ai/media/jobs/mongo-media-job-store.js'
);

let mongod: MongoMemoryServer;
let client: MongoClient;
const store = new MongoMediaJobStore();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongod.getUri());
  setDB(client.db('media-job-store-test'));
}, 60000);

afterAll(async () => {
  await client.close();
  await mongod.stop();
}, 20000);

beforeEach(async () => {
  await client.db('media-job-store-test').collection('mediaJobs').deleteMany({});
});

const baseJob = {
  jobId: 'job_abc',
  provider: 'fal-ai' as const,
  modelId: 'fal-ai/flux/dev',
  postType: 'IMAGE' as const,
  status: 'COMPLETED' as const,
  mediaUrl: 'https://fal.media/files/x.jpg',
  thumbnail: 'https://fal.media/files/x.jpg',
  metadata: { widthPx: 1024, heightPx: 1024 },
  attempts: 1,
  restaurantId: 'r1',
  postId: 'p1',
  startedAt: new Date('2026-05-13T10:00:00Z'),
  completedAt: new Date('2026-05-13T10:00:02Z'),
};

describe('MongoMediaJobStore', () => {
  it('insert + findById round-trip', async () => {
    const inserted = await store.insert(baseJob);
    expect(inserted.id).toBeTruthy();
    expect(inserted.jobId).toBe('job_abc');

    const found = await store.findById('job_abc');
    expect(found).not.toBeNull();
    expect(found!.mediaUrl).toBe('https://fal.media/files/x.jpg');
    expect(found!.attempts).toBe(1);
  });

  it('findById returns null for unknown jobId', async () => {
    expect(await store.findById('nope')).toBeNull();
  });

  it('updateStatus persists provided fields and bumps updatedAt', async () => {
    await store.insert({ ...baseJob, jobId: 'job_upd', status: 'RUNNING' });
    const before = await store.findById('job_upd');
    const updated = await store.updateStatus('job_upd', {
      status: 'COMPLETED',
      mediaUrl: 'https://fal.media/done.jpg',
      completedAt: new Date('2026-05-13T10:00:05Z'),
    });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('COMPLETED');
    expect(updated!.mediaUrl).toBe('https://fal.media/done.jpg');
    expect(updated!.updatedAt.getTime()).toBeGreaterThan(before!.updatedAt.getTime());
  });

  it('updateStatus returns null when jobId is unknown', async () => {
    expect(await store.updateStatus('nope', { status: 'FAILED' })).toBeNull();
  });

  it('incrementAttempts increments by 1', async () => {
    await store.insert({ ...baseJob, jobId: 'job_inc', attempts: 0 });
    await store.incrementAttempts('job_inc');
    await store.incrementAttempts('job_inc');
    const after = await store.findById('job_inc');
    expect(after!.attempts).toBe(2);
  });
});
```

Run: expected FAIL (Cannot find module).

- [ ] **Step 3: Implement `mongo-media-job-store.ts`**

```typescript
/**
 * MongoMediaJobStore -- writes/reads MediaJobRecord rows in the mediaJobs
 * collection via the @restropulse/db helpers.
 */

import {
  insertMediaJob,
  findMediaJobById,
  updateMediaJobStatus,
  incrementMediaJobAttempts,
  type MediaJobUpdatable,
} from '@restropulse/db';
import type { MediaJobRecord } from '@restropulse/shared';
import type { IMediaJobStore } from './types.js';

export class MongoMediaJobStore implements IMediaJobStore {
  async insert(job: Omit<MediaJobRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<MediaJobRecord> {
    return insertMediaJob(job);
  }

  async findById(jobId: string): Promise<MediaJobRecord | null> {
    return findMediaJobById(jobId);
  }

  async updateStatus(jobId: string, update: MediaJobUpdatable): Promise<MediaJobRecord | null> {
    return updateMediaJobStatus(jobId, update);
  }

  async incrementAttempts(jobId: string): Promise<void> {
    return incrementMediaJobAttempts(jobId);
  }
}
```

- [ ] **Step 4: Verify**

`cd apps/content-engine && npx vitest run tests/unit/content-generator/backends/ai/media/jobs/mongo-media-job-store.test.ts`
Expected: PASS, 5 assertions.

(Note: depending on the workspace build state, may require `rtk npm run build --workspace=@restropulse/shared && rtk npm run build --workspace=@restropulse/db` first to surface the new exports.)

---

## Task 4: `models.ts` + `pricing.ts` (fal.ai constants + cost computation)

**Files:**
- Create: `apps/content-engine/src/services/content-generator/backends/ai/media/fal-ai/models.ts`
- Create: `apps/content-engine/src/services/content-generator/backends/ai/media/fal-ai/pricing.ts`
- Create: `apps/content-engine/tests/unit/content-generator/backends/ai/media/fal-ai/pricing.test.ts`

- [ ] **Step 1: `models.ts`**

```typescript
/**
 * fal.ai model identifiers used by FalAIMediaGenerator.
 *
 * Phase 4: text-to-image (Flux dev) + image-to-image (Flux dev img2img).
 * Phase 5 will add video models alongside these.
 */

export const FAL_MODELS = {
  fluxDev: 'fal-ai/flux/dev',
  fluxImg2Img: 'fal-ai/flux/dev/image-to-image',
} as const;

export type FalModelId = (typeof FAL_MODELS)[keyof typeof FAL_MODELS];
```

- [ ] **Step 2: Failing test for `pricing.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import {
  FAL_PRICING,
  computeFalCostUsd,
} from '../../../../../../../src/services/content-generator/backends/ai/media/fal-ai/pricing.js';

describe('FAL_PRICING', () => {
  it('declares prices for the two phase-4 models (text-to-image + image-to-image)', () => {
    expect(FAL_PRICING['fal-ai/flux/dev']).toBeDefined();
    expect(FAL_PRICING['fal-ai/flux/dev/image-to-image']).toBeDefined();
  });

  it('all prices are positive USD per call', () => {
    for (const [, p] of Object.entries(FAL_PRICING)) {
      expect(p.usdPerCall).toBeGreaterThan(0);
    }
  });
});

describe('computeFalCostUsd', () => {
  it('returns the per-call USD for a known model', () => {
    const cost = computeFalCostUsd('fal-ai/flux/dev');
    expect(cost).toBeCloseTo(FAL_PRICING['fal-ai/flux/dev'].usdPerCall, 6);
  });

  it('returns 0 for an unknown model rather than throwing', () => {
    expect(computeFalCostUsd('fal-ai/unknown-model')).toBe(0);
  });
});
```

Run: expected FAIL.

- [ ] **Step 3: Implement `pricing.ts`**

```typescript
/**
 * Per-model fal.ai pricing in USD per call.
 *
 * Source: fal.ai public pricing page (placeholder values; update when official
 * pricing changes). A wrong price degrades cost-tracking accuracy but does not
 * break the pipeline.
 */

export interface FalModelPricing {
  /** USD billed per generation call, regardless of size. */
  usdPerCall: number;
}

export const FAL_PRICING: Record<string, FalModelPricing> = {
  'fal-ai/flux/dev': { usdPerCall: 0.025 },
  'fal-ai/flux/dev/image-to-image': { usdPerCall: 0.025 },
  // Phase 5 video models added here.
};

export function computeFalCostUsd(modelId: string): number {
  return FAL_PRICING[modelId]?.usdPerCall ?? 0;
}
```

- [ ] **Step 4: Verify**

PASS, 4 assertions.

---

## Task 5: `FalClient` (HTTP wrapper) + tests

**Files:**
- Create: `apps/content-engine/src/services/content-generator/backends/ai/media/fal-ai/fal-client.ts`
- Create: `apps/content-engine/tests/unit/content-generator/backends/ai/media/fal-ai/fal-client.test.ts`

The fal.ai sync API:
- Endpoint: `POST https://fal.run/<model>`
- Headers: `Authorization: Key <FAL_API_KEY>`, `Content-Type: application/json`
- Body for text-to-image: `{ prompt, image_size, num_inference_steps, guidance_scale, num_images }`
- Body for image-to-image: `{ prompt, image_url, strength, num_inference_steps }`
- Response: `{ images: [{ url, width, height }], seed, has_nsfw_concepts: [...] }`

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { FalClient } = await import(
  '../../../../../../../src/services/content-generator/backends/ai/media/fal-ai/fal-client.js'
);

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  (globalThis as any).fetch = fetchMock;
});

const sampleImageResponse = {
  images: [{ url: 'https://fal.media/files/abc.jpg', width: 1024, height: 1024 }],
  seed: 42,
  has_nsfw_concepts: [false],
  prompt: 'a paneer tikka platter',
};

describe('FalClient', () => {
  it('throws when constructed without an apiKey', () => {
    expect(() => new FalClient({ apiKey: '' })).toThrow(/api ?key/i);
  });

  it('generateImage POSTs to fal.run/<model> with prompt + size + auth header', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => sampleImageResponse });
    const client = new FalClient({ apiKey: 'fal-test' });
    const out = await client.generateImage({
      model: 'fal-ai/flux/dev',
      prompt: 'a paneer tikka platter',
      imageSize: 'square_hd',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://fal.run/fal-ai/flux/dev');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Key fal-test');
    expect(init.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body);
    expect(body.prompt).toBe('a paneer tikka platter');
    expect(body.image_size).toBe('square_hd');
    expect(body.num_images).toBe(1);

    expect(out.images).toHaveLength(1);
    expect(out.images[0].url).toBe('https://fal.media/files/abc.jpg');
    expect(out.images[0].width).toBe(1024);
    expect(out.modelId).toBe('fal-ai/flux/dev');
  });

  it('editImage POSTs image_url + strength + prompt for img2img', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => sampleImageResponse });
    const client = new FalClient({ apiKey: 'k' });
    await client.editImage({
      model: 'fal-ai/flux/dev/image-to-image',
      prompt: 'warmer lighting',
      imageUrl: 'https://example.com/base.jpg',
      strength: 0.6,
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.prompt).toBe('warmer lighting');
    expect(body.image_url).toBe('https://example.com/base.jpg');
    expect(body.strength).toBe(0.6);
  });

  it('throws TransientError on 503', async () => {
    const { TransientError } = await import(
      '../../../../../../../src/services/content-generator/backends/ai/errors.js'
    );
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, headers: new Map(), json: async () => ({}), text: async () => '{}' });
    const client = new FalClient({ apiKey: 'k' });
    await expect(client.generateImage({ model: 'fal-ai/flux/dev', prompt: 'p' })).rejects.toBeInstanceOf(TransientError);
  });

  it('throws RateLimitError on 429 honoring retry-after', async () => {
    const { RateLimitError } = await import(
      '../../../../../../../src/services/content-generator/backends/ai/errors.js'
    );
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, headers: new Map([['retry-after', '4']]), json: async () => ({}), text: async () => '{}' });
    const client = new FalClient({ apiKey: 'k' });
    await expect(client.generateImage({ model: 'fal-ai/flux/dev', prompt: 'p' })).rejects.toBeInstanceOf(RateLimitError);
  });

  it('passes 4xx (non-429) errors through unchanged', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 422, headers: new Map(), json: async () => ({ error: 'bad prompt' }), text: async () => '{}' });
    const client = new FalClient({ apiKey: 'k' });
    await expect(client.generateImage({ model: 'fal-ai/flux/dev', prompt: 'p' })).rejects.toThrow();
  });

  it('handles empty images array gracefully (returns empty list, not crash)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ images: [] }) });
    const client = new FalClient({ apiKey: 'k' });
    const out = await client.generateImage({ model: 'fal-ai/flux/dev', prompt: 'p' });
    expect(out.images).toEqual([]);
  });
});
```

Run: expected FAIL.

- [ ] **Step 2: Implement `FalClient`**

```typescript
/**
 * FalClient -- thin wrapper around the fal.ai sync inference API.
 *
 * Endpoint: POST https://fal.run/<model>
 * Auth:     Authorization: Key <FAL_API_KEY>
 *
 * Phase 4 uses the sync subscribe pattern (one HTTP call returns the result).
 * Phase 5 may add the queue submit + poll pattern for slow video using
 * https://queue.fal.run/<model>.
 *
 * Errors are routed through classifyError so withRetry handles transient/
 * rate-limit failures with the IMAGE_SUBMIT profile.
 */

import { createLogger } from '@restropulse/telemetry/server';
import { classifyError, TransientError } from '../../errors.js';

const log = createLogger('fal-client');

const SYNC_BASE_URL = 'https://fal.run';

export interface FalClientOptions {
  apiKey: string;
}

export interface FalImageRequest {
  model: string;
  prompt: string;
  imageSize?: string; // 'square_hd' | 'portrait_16_9' | etc.
  numInferenceSteps?: number;
  guidanceScale?: number;
  numImages?: number;
}

export interface FalImageEditRequest {
  model: string;
  prompt: string;
  imageUrl: string;
  strength?: number;
  numInferenceSteps?: number;
}

export interface FalGeneratedImage {
  url: string;
  width: number;
  height: number;
}

export interface FalImageResponse {
  images: FalGeneratedImage[];
  seed?: number;
  modelId: string;
}

export class FalClient {
  private readonly apiKey: string;

  constructor(options: FalClientOptions) {
    if (!options || !options.apiKey) {
      throw new Error('FalClient requires a non-empty apiKey');
    }
    this.apiKey = options.apiKey;
  }

  async generateImage(req: FalImageRequest): Promise<FalImageResponse> {
    const body = {
      prompt: req.prompt,
      image_size: req.imageSize ?? 'square_hd',
      num_inference_steps: req.numInferenceSteps ?? 28,
      guidance_scale: req.guidanceScale ?? 3.5,
      num_images: req.numImages ?? 1,
    };
    return this.postAndParse(req.model, body);
  }

  async editImage(req: FalImageEditRequest): Promise<FalImageResponse> {
    const body = {
      prompt: req.prompt,
      image_url: req.imageUrl,
      strength: req.strength ?? 0.7,
      num_inference_steps: req.numInferenceSteps ?? 28,
    };
    return this.postAndParse(req.model, body);
  }

  private async postAndParse(model: string, body: Record<string, unknown>): Promise<FalImageResponse> {
    const url = `${SYNC_BASE_URL}/${model}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Key ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new TransientError(`fal.ai fetch failed: ${(err as Error).message}`, undefined, err);
    }

    if (!res.ok) {
      const headers: Record<string, string> = {};
      try {
        for (const [k, v] of res.headers as any) headers[k.toLowerCase()] = String(v);
      } catch {
        // best-effort
      }
      const httpish = { status: res.status, message: `fal.ai HTTP ${res.status}`, headers };
      const classified = classifyError(httpish);
      if (classified instanceof Error) throw classified;
      throw new Error(httpish.message);
    }

    const json = await res.json() as { images?: Array<{ url?: string; width?: number; height?: number }>; seed?: number };
    const images: FalGeneratedImage[] = (json.images ?? [])
      .filter((i) => !!i.url)
      .map((i) => ({ url: i.url!, width: i.width ?? 0, height: i.height ?? 0 }));

    log.debug({ model, count: images.length }, 'fal.ai image response');
    return {
      images,
      ...(json.seed !== undefined ? { seed: json.seed } : {}),
      modelId: model,
    };
  }
}
```

- [ ] **Step 3: Verify**

PASS, 7 assertions.

---

## Task 6: Checkpoint A wrap

- [ ] **Step 1: Run all phase-4 Checkpoint A tests**

`cd apps/content-engine && npx vitest run tests/unit/content-generator/backends/ai/media/jobs tests/unit/content-generator/backends/ai/media/fal-ai`
Expected: 3 test files (mongo-media-job-store, pricing, fal-client), all green.

- [ ] **Step 2: Run full content-engine suite**

`cd apps/content-engine && npx vitest run`
Expected: 44 baseline (phase 3) + 3 new files / +16 assertions = ~47 files / ~347 assertions, all green.

- [ ] **Step 3: Type-check**

`rtk npm run type-check --workspace=@restropulse/shared && rtk npm run type-check --workspace=@restropulse/db && rtk npm run type-check --workspace=@restropulse/content-engine`
All exit 0.

- [ ] **Step 4: Show user, request approval to proceed to Checkpoint B**

`rtk git status`. **STOP. Tell the user: "Phase 4 Checkpoint A complete - mediaJobs collection + IMediaJobStore + FalClient + pricing/models. Approve continuing to Checkpoint B (FalAIMediaGenerator + factory wiring)?"** Wait for explicit approval.

---

# CHECKPOINT B - FalAIMediaGenerator + factory

## Task 7: `FalAIMediaGenerator` (text-to-image path) (TDD)

**Files:**
- Create: `apps/content-engine/src/services/content-generator/backends/ai/media/fal-ai/fal-ai-media-generator.ts`
- Create: `apps/content-engine/tests/unit/content-generator/backends/ai/media/fal-ai/fal-ai-media-generator.test.ts`

The generator:
1. Computes a fal-suitable prompt from `concept` + `caption` + `themes` + specialization (specialization is NOT passed in -- prompt construction is intentionally simple here; the calling pipeline owns prompt richness).
2. Picks the model based on `baseImageUrl` presence.
3. Picks `image_size` from postType + platforms.
4. Generates a `jobId` (UUID).
5. Calls `client.generateImage` (or `editImage`) wrapped in `withRetry(IMAGE_SUBMIT)` + `withCostTracking(surface='image')`.
6. Inserts a `MediaJobRecord` with status COMPLETED on success.
7. For CAROUSEL post types: makes 3 parallel calls and returns `mediaUrls=[a, b, c]` + 3 separate MediaJobRecords (one per frame).
8. For REEL/VIDEO: throws `BACKEND_UNAVAILABLE` with a "phase 5" detail.

Phase 4 simplification: prompt construction is just `concept + (themes ? ', themes: ${...}' : '')`. The calling pipeline already runs Anthropic for caption assembly, so the visual prompt is intentionally lean here. Future phase can enrich.

- [ ] **Step 1: Failing test (text-to-image happy path + REEL throws)**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  trackAIUsage: vi.fn(),
}));

vi.mock('@restropulse/db', () => ({
  insertCostEvent: vi.fn().mockResolvedValue({ id: 'ce_test' }),
  // FalAIMediaGenerator goes through IMediaJobStore (injected), not these helpers
  // -- but these are mocked for any incidental import paths.
}));

const { FalAIMediaGenerator } = await import(
  '../../../../../../../src/services/content-generator/backends/ai/media/fal-ai/fal-ai-media-generator.js'
);
const { ContentGenerationError } = await import(
  '../../../../../../../src/services/content-generator/types.js'
);

function makeStore(captureInsert: (j: any) => void = () => {}) {
  return {
    insert: vi.fn(async (j: any) => { captureInsert(j); return { ...j, id: 'persisted' }; }),
    findById: vi.fn(async () => null),
    updateStatus: vi.fn(async () => null),
    incrementAttempts: vi.fn(async () => undefined),
  };
}

function makeClient(images = [{ url: 'https://fal.media/x.jpg', width: 1024, height: 1024 }]) {
  return {
    generateImage: vi.fn(async () => ({ images, seed: 1, modelId: 'fal-ai/flux/dev' })),
    editImage: vi.fn(async () => ({ images, seed: 2, modelId: 'fal-ai/flux/dev/image-to-image' })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('FalAIMediaGenerator IMAGE happy path', () => {
  it('produces a COMPLETED MediaGenJob with the fal-returned URL', async () => {
    const store = makeStore();
    const client = makeClient();
    const gen = new FalAIMediaGenerator({ client: client as any, store: store as any });

    const job = await gen.generateImage({
      postType: 'IMAGE',
      platforms: ['INSTAGRAM'],
      concept: 'paneer tikka',
      restaurantId: 'r1',
      postId: 'p1',
    });

    expect(job.status).toBe('COMPLETED');
    expect(job.mediaUrl).toBe('https://fal.media/x.jpg');
    expect(job.metadata?.widthPx).toBe(1024);
    expect(client.generateImage).toHaveBeenCalledTimes(1);
  });

  it('writes a MediaJobRecord with restaurantId/postId/modelId/status=COMPLETED', async () => {
    let captured: any = null;
    const store = makeStore((j) => { captured = j; });
    const client = makeClient();
    const gen = new FalAIMediaGenerator({ client: client as any, store: store as any });

    await gen.generateImage({
      postType: 'IMAGE',
      platforms: ['INSTAGRAM'],
      concept: 'paneer tikka',
      restaurantId: 'r1',
      postId: 'p1',
      cycleId: 'c1',
    });

    expect(captured).not.toBeNull();
    expect(captured.provider).toBe('fal-ai');
    expect(captured.modelId).toBe('fal-ai/flux/dev');
    expect(captured.status).toBe('COMPLETED');
    expect(captured.restaurantId).toBe('r1');
    expect(captured.postId).toBe('p1');
    expect(captured.cycleId).toBe('c1');
    expect(captured.attempts).toBe(1);
    expect(captured.mediaUrl).toBe('https://fal.media/x.jpg');
  });

  it('writes an LLM cost event tagged surface=image when generation succeeds', async () => {
    const { insertCostEvent } = await import('@restropulse/db');
    (insertCostEvent as any).mockClear();
    const store = makeStore();
    const client = makeClient();
    const gen = new FalAIMediaGenerator({ client: client as any, store: store as any });

    await gen.generateImage({
      postType: 'IMAGE',
      platforms: ['INSTAGRAM'],
      concept: 'paneer tikka',
      restaurantId: 'r1',
      postId: 'p1',
    });

    expect(insertCostEvent).toHaveBeenCalledTimes(1);
    const event = (insertCostEvent as any).mock.calls[0][0];
    expect(event.surface).toBe('image');
    expect(event.operation).toBe('generatePost');
    expect(event.model).toBe('fal-ai/flux/dev');
    expect(event.restaurantId).toBe('r1');
    expect(event.postId).toBe('p1');
    expect(event.costUsd).toBeGreaterThan(0);
  });

  it('routes baseImageUrl through editImage (img2img) instead of generateImage', async () => {
    const store = makeStore();
    const client = makeClient();
    const gen = new FalAIMediaGenerator({ client: client as any, store: store as any });

    const job = await gen.generateImage({
      postType: 'IMAGE',
      platforms: ['INSTAGRAM'],
      concept: 'warmer lighting on this dish',
      baseImageUrl: 'https://example.com/uploaded.jpg',
      restaurantId: 'r1',
      postId: 'p1',
    });

    expect(client.generateImage).not.toHaveBeenCalled();
    expect(client.editImage).toHaveBeenCalledTimes(1);
    expect(job.status).toBe('COMPLETED');
  });

  it('STORY post type uses portrait_16_9 image_size', async () => {
    const store = makeStore();
    const client = makeClient();
    const gen = new FalAIMediaGenerator({ client: client as any, store: store as any });
    await gen.generateImage({
      postType: 'STORY',
      platforms: ['INSTAGRAM'],
      concept: 'kitchen behind the scenes',
    });
    const arg = (client.generateImage as any).mock.calls[0][0];
    expect(arg.imageSize).toBe('portrait_16_9');
  });

  it('CAROUSEL post type generates 3 parallel frames + 3 MediaJobRecords', async () => {
    const insertCalls: any[] = [];
    const store = makeStore((j) => { insertCalls.push(j); });
    const client = makeClient();
    const gen = new FalAIMediaGenerator({ client: client as any, store: store as any });

    const job = await gen.generateImage({
      postType: 'CAROUSEL',
      platforms: ['INSTAGRAM'],
      concept: 'menu highlights',
      restaurantId: 'r1',
      postId: 'p1',
    });

    expect(client.generateImage).toHaveBeenCalledTimes(3);
    expect(insertCalls).toHaveLength(3);
    expect(job.mediaUrls).toHaveLength(3);
    expect(job.thumbnail).toBe(job.mediaUrls![0]);
    expect(job.status).toBe('COMPLETED');
  });

  it('returns FAILED MediaGenJob when fal.ai returns no images', async () => {
    const store = makeStore();
    const client = { generateImage: vi.fn(async () => ({ images: [], modelId: 'fal-ai/flux/dev' })), editImage: vi.fn() };
    const gen = new FalAIMediaGenerator({ client: client as any, store: store as any });

    const job = await gen.generateImage({
      postType: 'IMAGE',
      platforms: ['INSTAGRAM'],
      concept: 'x',
    });
    expect(job.status).toBe('FAILED');
    expect(job.error).toMatch(/no images/i);
  });
});

describe('FalAIMediaGenerator REEL/VIDEO throws BACKEND_UNAVAILABLE', () => {
  it('generateVideo throws ContentGenerationError BACKEND_UNAVAILABLE', async () => {
    const store = makeStore();
    const client = makeClient();
    const gen = new FalAIMediaGenerator({ client: client as any, store: store as any });

    await expect(
      gen.generateVideo({ postType: 'REEL', platforms: ['INSTAGRAM'], concept: 'x' }),
    ).rejects.toMatchObject({ code: 'BACKEND_UNAVAILABLE' });
  });
});

describe('FalAIMediaGenerator pollJob', () => {
  it('returns the latest record from the store', async () => {
    const store = {
      insert: vi.fn(),
      findById: vi.fn(async (id: string) => ({
        id: 'persisted', jobId: id, provider: 'fal-ai', modelId: 'fal-ai/flux/dev',
        postType: 'IMAGE', status: 'COMPLETED', mediaUrl: 'https://fal.media/x.jpg',
        attempts: 1, startedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
      })),
      updateStatus: vi.fn(),
      incrementAttempts: vi.fn(),
    };
    const client = makeClient();
    const gen = new FalAIMediaGenerator({ client: client as any, store: store as any });
    const out = await gen.pollJob('job_xyz');
    expect(out.status).toBe('COMPLETED');
    expect(out.mediaUrl).toBe('https://fal.media/x.jpg');
  });

  it('returns FAILED when the store has no record for jobId (degraded)', async () => {
    const store = makeStore();
    const client = makeClient();
    const gen = new FalAIMediaGenerator({ client: client as any, store: store as any });
    const out = await gen.pollJob('unknown');
    expect(out.status).toBe('FAILED');
    expect(out.error).toMatch(/not found/i);
  });
});
```

Run: expected FAIL.

- [ ] **Step 2: Implement `FalAIMediaGenerator`**

```typescript
/**
 * FalAIMediaGenerator -- IMediaGenerator backed by fal.ai sync inference.
 *
 * Phase 4 supports IMAGE, CAROUSEL, STORY (text-to-image OR image-to-image
 * when input.baseImageUrl is present). REEL/VIDEO throw BACKEND_UNAVAILABLE
 * until phase 5 wires Kling/MiniMax via the queue + poll pattern.
 *
 * Every generation path:
 *   1. Pick model + image_size from postType + baseImageUrl.
 *   2. Call FalClient (with retry + cost tracking).
 *   3. Insert MediaJobRecord with status=COMPLETED on success, FAILED on
 *      empty/invalid response.
 *
 * CAROUSEL fans out to 3 parallel calls; each gets its own MediaJobRecord.
 */

import { randomUUID } from 'node:crypto';
import { createLogger } from '@restropulse/telemetry/server';
import type { Platform, PostType, MediaJobRecord } from '@restropulse/shared';
import {
  ContentGenerationError,
} from '../../../../types.js';
import { withRetry, RETRY_PROFILES } from '../../with-retry.js';
import { withCostTracking } from '../../with-cost-tracking.js';
import { FAL_MODELS } from './models.js';
import { computeFalCostUsd } from './pricing.js';
import type { FalClient, FalImageResponse } from './fal-client.js';
import type { IMediaJobStore } from '../jobs/types.js';
import type {
  IMediaGenerator,
  ImageGenInput,
  MediaGenJob,
  VideoGenInput,
} from '../types.js';

const log = createLogger('fal-ai-media-generator');

const CAROUSEL_FRAME_COUNT = 3;

export interface FalAIMediaGeneratorOptions {
  client: Pick<FalClient, 'generateImage' | 'editImage'>;
  store: IMediaJobStore;
}

function pickImageSize(postType: PostType, _platforms: Platform[]): string {
  switch (postType) {
    case 'STORY':
      return 'portrait_16_9';
    case 'IMAGE':
    case 'CAROUSEL':
    default:
      return 'square_hd';
  }
}

function buildPrompt(input: Pick<ImageGenInput, 'concept' | 'themes' | 'caption'>): string {
  const themePart = input.themes?.length ? `, themes: ${input.themes.join(', ')}` : '';
  const captionPart = input.caption ? `, alongside the caption "${input.caption.slice(0, 200)}"` : '';
  return `${input.concept}${themePart}${captionPart}`.slice(0, 1000);
}

export class FalAIMediaGenerator implements IMediaGenerator {
  readonly name = 'fal-ai';
  private readonly client: Pick<FalClient, 'generateImage' | 'editImage'>;
  private readonly store: IMediaJobStore;

  constructor(options: FalAIMediaGeneratorOptions) {
    if (!options || !options.client || !options.store) {
      throw new Error('FalAIMediaGenerator requires { client, store }');
    }
    this.client = options.client;
    this.store = options.store;
  }

  async generateImage(input: ImageGenInput): Promise<MediaGenJob> {
    if (input.postType === 'CAROUSEL') {
      return this.generateCarousel(input);
    }
    return this.generateSingleImage(input);
  }

  async generateVideo(_input: VideoGenInput): Promise<MediaGenJob> {
    throw new ContentGenerationError(
      'BACKEND_UNAVAILABLE',
      'fal-ai video generation lands in phase 5. Set MEDIA_BACKEND=placeholder for video posts until then.',
    );
  }

  async pollJob(jobId: string): Promise<MediaGenJob> {
    const record = await this.store.findById(jobId);
    if (!record) {
      return { jobId, status: 'FAILED', error: 'job not found' };
    }
    return this.recordToMediaGenJob(record);
  }

  private async generateSingleImage(input: ImageGenInput): Promise<MediaGenJob> {
    const jobId = randomUUID();
    const useEdit = !!input.baseImageUrl;
    const modelId = useEdit ? FAL_MODELS.fluxImg2Img : FAL_MODELS.fluxDev;
    const prompt = buildPrompt(input);
    const imageSize = pickImageSize(input.postType, input.platforms);

    let response: FalImageResponse;
    try {
      response = await withRetry(
        () => withCostTracking(
          async () => {
            const result = useEdit
              ? await this.client.editImage({
                  model: modelId,
                  prompt,
                  imageUrl: input.baseImageUrl!,
                })
              : await this.client.generateImage({
                  model: modelId,
                  prompt,
                  imageSize,
                });
            return {
              result,
              usage: { costUsd: computeFalCostUsd(modelId) },
            };
          },
          {
            ...(input.restaurantId ? { restaurantId: input.restaurantId } : {}),
            ...(input.postId ? { postId: input.postId } : {}),
            ...(input.cycleId ? { cycleId: input.cycleId } : {}),
            operation: 'generatePost',
            surface: 'image',
            step: useEdit ? 'image-edit' : 'image',
            model: modelId,
          },
        ),
        RETRY_PROFILES.IMAGE_SUBMIT,
      );
    } catch (err) {
      log.error({ err, jobId, modelId }, 'fal.ai image submission failed after retries');
      const failedRecord = await this.persistFailedJob(jobId, modelId, input, (err as Error).message ?? 'unknown');
      return this.recordToMediaGenJob(failedRecord);
    }

    if (!response.images || response.images.length === 0) {
      log.warn({ jobId, modelId }, 'fal.ai returned no images');
      const failedRecord = await this.persistFailedJob(jobId, modelId, input, 'no images returned');
      return this.recordToMediaGenJob(failedRecord);
    }

    const image = response.images[0];
    const record = await this.store.insert({
      jobId,
      provider: 'fal-ai',
      modelId,
      postType: input.postType,
      status: 'COMPLETED',
      mediaUrl: image.url,
      thumbnail: image.url,
      metadata: { widthPx: image.width, heightPx: image.height },
      attempts: 1,
      ...(input.restaurantId ? { restaurantId: input.restaurantId } : {}),
      ...(input.postId ? { postId: input.postId } : {}),
      ...(input.cycleId ? { cycleId: input.cycleId } : {}),
      startedAt: new Date(),
      completedAt: new Date(),
    });

    return this.recordToMediaGenJob(record);
  }

  private async generateCarousel(input: ImageGenInput): Promise<MediaGenJob> {
    const carouselId = randomUUID();
    const frameInputs: ImageGenInput[] = Array.from({ length: CAROUSEL_FRAME_COUNT }, (_, i) => ({
      ...input,
      // Slightly vary the concept so frames differ; cheap and deterministic.
      concept: `${input.concept} (frame ${i + 1} of ${CAROUSEL_FRAME_COUNT})`,
      // Treat each frame as IMAGE so the inner generateSingleImage path runs.
      postType: 'IMAGE',
    }));

    const results = await Promise.all(
      frameInputs.map((frame) => this.generateSingleImage(frame)),
    );
    const succeeded = results.filter((r) => r.status === 'COMPLETED' && r.mediaUrl);
    if (succeeded.length === 0) {
      return { jobId: carouselId, status: 'FAILED', error: 'all carousel frames failed' };
    }
    const urls = succeeded.map((r) => r.mediaUrl!);
    const meta = succeeded[0].metadata;
    return {
      jobId: carouselId,
      status: 'COMPLETED',
      mediaUrls: urls,
      thumbnail: urls[0],
      ...(meta ? { metadata: meta } : {}),
    };
  }

  private async persistFailedJob(
    jobId: string,
    modelId: string,
    input: ImageGenInput,
    error: string,
  ): Promise<MediaJobRecord> {
    return this.store.insert({
      jobId,
      provider: 'fal-ai',
      modelId,
      postType: input.postType,
      status: 'FAILED',
      error,
      attempts: 1,
      ...(input.restaurantId ? { restaurantId: input.restaurantId } : {}),
      ...(input.postId ? { postId: input.postId } : {}),
      ...(input.cycleId ? { cycleId: input.cycleId } : {}),
      startedAt: new Date(),
    });
  }

  private recordToMediaGenJob(record: MediaJobRecord): MediaGenJob {
    return {
      jobId: record.jobId,
      status: record.status,
      ...(record.mediaUrl ? { mediaUrl: record.mediaUrl } : {}),
      ...(record.mediaUrls ? { mediaUrls: record.mediaUrls } : {}),
      ...(record.thumbnail ? { thumbnail: record.thumbnail } : {}),
      ...(record.metadata ? { metadata: record.metadata } : {}),
      ...(record.error ? { error: record.error } : {}),
    };
  }
}
```

- [ ] **Step 3: Verify**

PASS, ~10 assertions across happy-path + carousel + REEL throw + pollJob.

---

## Task 8: Extend `IMediaGenerator` inputs with optional `restaurantId`/`postId`/`cycleId`

**Files:**
- Modify: `apps/content-engine/src/services/content-generator/backends/ai/media/types.ts`

The phase 7 test in Task 7 already passes these fields. The `ImageGenInput` and `VideoGenInput` interfaces need to accept them.

- [ ] **Step 1: Edit types.ts**

In `apps/content-engine/src/services/content-generator/backends/ai/media/types.ts`, extend both interfaces:

```typescript
export interface ImageGenInput {
  postType: PostType;
  platforms: Platform[];
  concept: string;
  themes?: string[];
  caption?: string;
  baseImageUrl?: string;
  // Phase 4 -- optional, used for cost attribution + audit
  restaurantId?: string;
  postId?: string;
  cycleId?: string;
}

export interface VideoGenInput {
  postType: 'REEL' | 'VIDEO' | 'STORY';
  platforms: Platform[];
  concept: string;
  themes?: string[];
  caption?: string;
  // Phase 4 -- optional
  restaurantId?: string;
  postId?: string;
  cycleId?: string;
}
```

- [ ] **Step 2: Type-check**

`rtk npm run type-check --workspace=@restropulse/content-engine` -> exit 0.

- [ ] **Step 3: Run pre-existing media tests**

`cd apps/content-engine && npx vitest run tests/unit/content-generator/backends/ai/media`
Expected: existing PlaceholderMediaGenerator tests + new fal-ai tests all green. (Placeholder generator ignores the new optional fields; no behavior change.)

---

## Task 9: Add fal-ai barrel + extend `backends/ai/index.ts`

**Files:**
- Create: `apps/content-engine/src/services/content-generator/backends/ai/media/fal-ai/index.ts`
- Modify: `apps/content-engine/src/services/content-generator/backends/ai/index.ts`

- [ ] **Step 1: Create the barrel**

```typescript
export { FalClient } from './fal-client.js';
export type {
  FalClientOptions,
  FalImageRequest,
  FalImageEditRequest,
  FalImageResponse,
  FalGeneratedImage,
} from './fal-client.js';

export { FalAIMediaGenerator } from './fal-ai-media-generator.js';
export type { FalAIMediaGeneratorOptions } from './fal-ai-media-generator.js';

export { FAL_MODELS } from './models.js';
export type { FalModelId } from './models.js';

export { FAL_PRICING, computeFalCostUsd } from './pricing.js';
export type { FalModelPricing } from './pricing.js';
```

- [ ] **Step 2: Extend `backends/ai/index.ts`**

Append (do NOT replace):

```typescript
export type { IMediaJobStore, MediaJobUpdatable } from './media/jobs/types.js';
export { MongoMediaJobStore } from './media/jobs/mongo-media-job-store.js';
export * from './media/fal-ai/index.js';
```

- [ ] **Step 3: Type-check**

`rtk npm run type-check --workspace=@restropulse/content-engine` -> exit 0.

---

## Task 10: Update `factory.ts` for `MEDIA_BACKEND`

**Files:**
- Modify: `apps/content-engine/src/services/content-generator/factory.ts`
- Modify: `apps/content-engine/tests/unit/content-generator/factory.test.ts`

- [ ] **Step 1: Update factory.test.ts**

Append (do NOT replace) a new describe block at the bottom:

```typescript
describe('createContentGenerator -- media backend wiring', () => {
  it('defaults MEDIA_BACKEND to placeholder when env is unset', () => {
    delete process.env['MEDIA_BACKEND'];
    process.env['ANTHROPIC_API_KEY'] = 'sk-test';
    process.env['GOOGLE_CALENDAR_API_KEY'] = 'cal-test';
    process.env['CURRENT_AFFAIRS_V1_ENABLED'] = 'true';
    const g = createContentGenerator('ai');
    expect(g.name).toBe('ai');
    // No way to inspect the media generator from outside; the factory uses
    // PlaceholderMediaGenerator unless MEDIA_BACKEND=fal-ai.
  });

  it('builds the FalAIMediaGenerator when MEDIA_BACKEND=fal-ai and FAL_API_KEY is present', () => {
    process.env['MEDIA_BACKEND'] = 'fal-ai';
    process.env['FAL_API_KEY'] = 'fal-test';
    process.env['ANTHROPIC_API_KEY'] = 'sk-test';
    process.env['GOOGLE_CALENDAR_API_KEY'] = 'cal-test';
    process.env['CURRENT_AFFAIRS_V1_ENABLED'] = 'true';
    const g = createContentGenerator('ai');
    expect(g.name).toBe('ai');
  });

  it('throws a clear error when MEDIA_BACKEND=fal-ai but FAL_API_KEY is missing', () => {
    process.env['MEDIA_BACKEND'] = 'fal-ai';
    delete process.env['FAL_API_KEY'];
    process.env['ANTHROPIC_API_KEY'] = 'sk-test';
    process.env['GOOGLE_CALENDAR_API_KEY'] = 'cal-test';
    process.env['CURRENT_AFFAIRS_V1_ENABLED'] = 'true';
    expect(() => createContentGenerator('ai')).toThrow(/FAL_API_KEY/);
  });

  it('throws on an unknown MEDIA_BACKEND value', () => {
    process.env['MEDIA_BACKEND'] = 'midjourney';
    process.env['ANTHROPIC_API_KEY'] = 'sk-test';
    process.env['GOOGLE_CALENDAR_API_KEY'] = 'cal-test';
    process.env['CURRENT_AFFAIRS_V1_ENABLED'] = 'true';
    expect(() => createContentGenerator('ai')).toThrow(/MEDIA_BACKEND/i);
  });
});
```

- [ ] **Step 2: Replace factory.ts**

Modify `apps/content-engine/src/services/content-generator/factory.ts` -- in the `'ai'` branch, replace the line `media: new PlaceholderMediaGenerator(),` with a call to a new `buildMediaGeneratorForFactory()` helper.

Add at the top, alongside other imports:

```typescript
import {
  FalAIMediaGenerator,
  FalClient,
  MongoMediaJobStore,
} from './backends/ai/index.js';
import type { IMediaGenerator } from './backends/ai/media/types.js';
```

(Or import them through their direct paths if the barrel doesn't export them yet -- it does after Task 9.)

Add the helper function above `createContentGenerator`:

```typescript
type MediaBackend = 'placeholder' | 'fal-ai';

function readMediaBackend(): MediaBackend {
  const raw = (process.env.MEDIA_BACKEND ?? 'placeholder').trim();
  if (raw === 'placeholder' || raw === 'fal-ai') return raw;
  throw new Error(`Unknown MEDIA_BACKEND value: ${raw}. Expected 'placeholder' or 'fal-ai'.`);
}

function buildMediaGeneratorForFactory(): IMediaGenerator {
  const backend = readMediaBackend();
  if (backend === 'fal-ai') {
    const apiKey = process.env.FAL_API_KEY;
    if (!apiKey) {
      throw new Error('FAL_API_KEY is required when MEDIA_BACKEND=fal-ai.');
    }
    return new FalAIMediaGenerator({
      client: new FalClient({ apiKey }),
      store: new MongoMediaJobStore(),
    });
  }
  return new PlaceholderMediaGenerator();
}
```

Update the `'ai'` case:

```typescript
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
    media: buildMediaGeneratorForFactory(),
    currentAffairs,
  });
}
```

Update the file-level comment block to mention the new env vars.

- [ ] **Step 3: Verify**

`cd apps/content-engine && npx vitest run tests/unit/content-generator/factory.test.ts`
Expected: 8 prior + 4 new = 12 tests, all green.

---

## Task 11: Checkpoint B wrap

- [ ] **Step 1: Run all phase-4 tests**

`cd apps/content-engine && npx vitest run tests/unit/content-generator/backends/ai/media tests/unit/content-generator/factory.test.ts`
Expected: ~5 test files green, ~30 assertions.

- [ ] **Step 2: Run full content-engine suite**

`cd apps/content-engine && npx vitest run`
Expected: ~48 files / ~360 assertions, all green.

- [ ] **Step 3: Type-check**

`rtk npm run type-check --workspace=@restropulse/content-engine` -> exit 0.

- [ ] **Step 4: STOP for user review**

`rtk git status`. **STOP. Tell the user: "Phase 4 Checkpoint B complete - FalAIMediaGenerator + factory wired. Approve continuing to Checkpoint C (pipeline restaurantId threading + worker.ts + e2e + commit)?"** Wait for explicit approval.

---

# CHECKPOINT C - Pipeline threading + worker + e2e + commit

## Task 12: Thread `restaurantId`/`postId`/`cycleId` into pipeline media calls

**Files:**
- Modify: `apps/content-engine/src/services/content-generator/backends/ai/pipeline/generate-post.ts`
- Modify: `apps/content-engine/src/services/content-generator/backends/ai/pipeline/revise-post.ts`

The pipelines currently pass only `{postType, platforms, concept, themes}` to the media generator. Thread the audit fields through.

- [ ] **Step 1: Edit generate-post.ts**

Find the `runMediaForPost` function. Update the calls to `deps.media.generateImage` and `deps.media.generateVideo` to include the audit fields:

```typescript
const job = isVideoType(input.type) || isStoryVideoCandidate(input.type, input.platforms)
  ? await deps.media.generateVideo({
      postType: input.type as 'REEL' | 'VIDEO' | 'STORY',
      platforms: input.platforms,
      concept: input.concept,
      themes: input.themes,
      ...(ctx?.restaurantId ? { restaurantId: ctx.restaurantId } : {}),
      ...(input.cycleId ? { cycleId: input.cycleId } : {}),
    })
  : await deps.media.generateImage({
      postType: input.type,
      platforms: input.platforms,
      concept: input.concept,
      themes: input.themes,
      ...(ctx?.restaurantId ? { restaurantId: ctx.restaurantId } : {}),
      ...(input.cycleId ? { cycleId: input.cycleId } : {}),
    });
```

(Note: `postId` is not in `GeneratePostInput`. Posts are identified by an externally-assigned id which the calling layer doesn't pass to the pipeline. Phase 4 leaves `postId` field absent on MediaJobRecord for `generatePost` -- only `revisePost` knows the existing post id, but even there it's not wired into RevisePostInput. This is acceptable: cost attribution at the restaurant + cycle granularity covers the dashboards. Phase 6 can revisit if per-post drilldown becomes important.)

- [ ] **Step 2: Edit revise-post.ts**

Update both `deps.media.generateImage` and `deps.media.generateVideo` calls inside the media-regeneration branch to include `restaurantId` from `ctx`:

```typescript
const result = isVideoType(input.existingPost.type)
  ? await deps.media.generateVideo({
      postType: input.existingPost.type as 'REEL' | 'VIDEO' | 'STORY',
      platforms: input.existingPost.platforms,
      concept: captionObj.caption,
      themes: input.existingPost.themes,
      ...(ctx?.restaurantId ? { restaurantId: ctx.restaurantId } : {}),
    })
  : await deps.media.generateImage({
      postType: input.existingPost.type,
      platforms: input.existingPost.platforms,
      concept: captionObj.caption,
      themes: input.existingPost.themes,
      ...(ctx?.restaurantId ? { restaurantId: ctx.restaurantId } : {}),
    });
```

- [ ] **Step 3: Verify**

`cd apps/content-engine && npx vitest run tests/unit/content-generator/backends/ai/pipeline`
Expected: all pre-existing pipeline tests still green.

---

## Task 13: Wire `MEDIA_BACKEND` + `FAL_API_KEY` into `worker.ts` env schema

**Files:**
- Modify: `apps/content-engine/src/worker.ts`

- [ ] **Step 1: Add to the Zod env schema**

After `CRON_CURRENT_AFFAIRS_REFRESH`, add:

```typescript
    MEDIA_BACKEND: z.enum(['placeholder', 'fal-ai']).default('placeholder'),
    FAL_API_KEY: z.string().optional(),
```

- [ ] **Step 2: Type-check**

`rtk npm run type-check --workspace=@restropulse/content-engine` -> exit 0.

- [ ] **Step 3: Smoke test**

```
cd apps/content-engine && CONTENT_GENERATOR_BACKEND=ai ANTHROPIC_API_KEY=sk-fake GOOGLE_CALENDAR_API_KEY=cal-fake MEDIA_BACKEND=fal-ai FAL_API_KEY=fal-fake npx tsx --eval "import('./src/services/content-generator/factory.js').then(m => console.log('ai:', m.createContentGenerator('ai').name)).catch(e => { console.error(e.message); process.exit(1); })"
```
Expected: `ai: ai`

---

## Task 14: End-to-end integration test

**Files:**
- Create: `apps/content-engine/tests/integration/fal-ai-end-to-end.test.ts`

This complements the unit tests with one round-trip: real Mongo (mediaJobs + costEvents collections), mocked fal HTTP, full `AIContentGenerator.generatePost`, asserts a MediaJobRecord row + a costEvents row land with matching `restaurantId`.

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

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  (globalThis as any).fetch = fetchMock;
});

const { AIContentGenerator } = await import(
  '../../src/services/content-generator/backends/ai/ai-content-generator.js'
);
const { RestaurantSpecialization } = await import(
  '../../src/services/content-generator/backends/ai/specialization/index.js'
);
const { FalClient, FalAIMediaGenerator, MongoMediaJobStore } = await import(
  '../../src/services/content-generator/backends/ai/index.js'
);
const { findCostEventsByRestaurant, findMediaJobById } = await import('@restropulse/db');

let mongod: MongoMemoryServer;
let client: MongoClient;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongod.getUri());
  setDB(client.db('fal-ai-e2e-test'));
}, 60000);

afterAll(async () => {
  await client.close();
  await mongod.stop();
}, 20000);

beforeEach(async () => {
  await client.db('fal-ai-e2e-test').collection('mediaJobs').deleteMany({});
  await client.db('fal-ai-e2e-test').collection('costEvents').deleteMany({});
});

describe('AIContentGenerator + FalAIMediaGenerator end-to-end', () => {
  it('generatePost(IMAGE) writes both a mediaJobs row and a costEvents row tagged for the restaurant', async () => {
    // fal.ai returns one image
    fetchMock.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({
        images: [{ url: 'https://fal.media/files/end2end.jpg', width: 1024, height: 1024 }],
        seed: 7,
      }),
    });

    // LLM mock for caption
    const generateObject = vi.fn().mockResolvedValue({
      object: { caption: 'A delicious-looking image of paneer tikka', suggestedHashtags: ['#paneer', '#food'] },
      usage: { inputTokens: 80, outputTokens: 40 },
      modelId: 'claude-haiku-4-5-20251001',
    });

    const falClient = new FalClient({ apiKey: 'fal-fake' });
    const store = new MongoMediaJobStore();
    const media = new FalAIMediaGenerator({ client: falClient, store });

    const gen = new AIContentGenerator({
      specialization: new RestaurantSpecialization(),
      llm: { name: 'mock-llm', generateObject },
      media,
    });

    const post = await gen.generatePost(
      { concept: 'paneer tikka platter', type: 'IMAGE', platforms: ['INSTAGRAM'] },
      { restaurantId: 'r-fal-e2e', restaurantName: 'Spice Route', locale: 'en-IN' },
    );

    expect(post.thumbnail).toBe('https://fal.media/files/end2end.jpg');

    // mediaJobs row exists
    const allMediaJobs = await client.db('fal-ai-e2e-test').collection('mediaJobs').find({}).toArray();
    expect(allMediaJobs).toHaveLength(1);
    expect(allMediaJobs[0].provider).toBe('fal-ai');
    expect(allMediaJobs[0].status).toBe('COMPLETED');
    expect(allMediaJobs[0].restaurantId).toBe('r-fal-e2e');

    // costEvents row exists for the image surface
    const events = await findCostEventsByRestaurant('r-fal-e2e');
    const imageEvent = events.find((e) => e.surface === 'image');
    expect(imageEvent).toBeDefined();
    expect(imageEvent!.model).toBe('fal-ai/flux/dev');
    expect(imageEvent!.costUsd).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Verify**

`cd apps/content-engine && npx vitest run tests/integration/fal-ai-end-to-end.test.ts`
Expected: PASS.

---

## Task 15: Final regression sweep + smoke tests

- [ ] **Step 1: Full content-engine suite**

`cd apps/content-engine && npx vitest run`
Expected: ~49 test files / ~365 assertions, all green.

- [ ] **Step 2: Monorepo type-check**

From repo root: `rtk npm run type-check`
Expected: exit 0.

- [ ] **Step 3: Smoke - placeholder default**

```
cd apps/content-engine && CONTENT_GENERATOR_BACKEND=ai ANTHROPIC_API_KEY=sk-fake GOOGLE_CALENDAR_API_KEY=cal-fake npx tsx --eval "import('./src/services/content-generator/factory.js').then(m => console.log('ai:', m.createContentGenerator('ai').name)).catch(e => { console.error(e.message); process.exit(1); })"
```
Expected: `ai: ai`

- [ ] **Step 4: Smoke - fal-ai backend**

```
cd apps/content-engine && CONTENT_GENERATOR_BACKEND=ai ANTHROPIC_API_KEY=sk-fake GOOGLE_CALENDAR_API_KEY=cal-fake MEDIA_BACKEND=fal-ai FAL_API_KEY=fal-fake npx tsx --eval "import('./src/services/content-generator/factory.js').then(m => console.log('ai:', m.createContentGenerator('ai').name)).catch(e => { console.error(e.message); process.exit(1); })"
```
Expected: `ai: ai`

- [ ] **Step 5: Smoke - missing FAL_API_KEY error**

```
cd apps/content-engine && CONTENT_GENERATOR_BACKEND=ai ANTHROPIC_API_KEY=sk-fake GOOGLE_CALENDAR_API_KEY=cal-fake MEDIA_BACKEND=fal-ai npx tsx --eval "import('./src/services/content-generator/factory.js').then(m => { try { m.createContentGenerator('ai'); console.log('UNEXPECTED success'); process.exit(1); } catch (e) { console.log('expected error:', e.message); } })"
```
Expected: `expected error: FAL_API_KEY is required when MEDIA_BACKEND=fal-ai.`

---

## Task 16: Stage everything

- [ ] **Step 1: Stage all phase-4 files**

```
rtk git add \
  packages/shared/src/media-jobs.ts \
  packages/shared/src/index.ts \
  packages/db/src/connection.ts \
  packages/db/src/index.ts \
  packages/db/src/media-jobs.ts \
  apps/content-engine/src/services/content-generator/backends/ai/media/types.ts \
  apps/content-engine/src/services/content-generator/backends/ai/media/jobs \
  apps/content-engine/src/services/content-generator/backends/ai/media/fal-ai \
  apps/content-engine/src/services/content-generator/backends/ai/index.ts \
  apps/content-engine/src/services/content-generator/backends/ai/pipeline/generate-post.ts \
  apps/content-engine/src/services/content-generator/backends/ai/pipeline/revise-post.ts \
  apps/content-engine/src/services/content-generator/factory.ts \
  apps/content-engine/src/worker.ts \
  apps/content-engine/tests/unit/content-generator/backends/ai/media/jobs \
  apps/content-engine/tests/unit/content-generator/backends/ai/media/fal-ai \
  apps/content-engine/tests/unit/content-generator/factory.test.ts \
  apps/content-engine/tests/integration/fal-ai-end-to-end.test.ts \
  docs/superpowers/plans/2026-05-03-content-engine-ai-phase-4.md
rtk git status
rtk git diff --staged --stat
```

## Task 17: STOP for commit approval, then commit

**STOP. Show user staged status + stat. Ask: "Phase 4 complete - fal.ai image generation wired behind MEDIA_BACKEND=fal-ai flag. Default remains placeholder. Approve committing as a single phase-4 commit?"**

After explicit user approval:

```
rtk git commit -m "$(cat <<'EOF'
feat(content-engine): wire fal.ai image generation + mediaJobs collection

Phase 4 of the content-engine AI rollout per ADR 0001 sections 4.4 + 6.
AIContentGenerator now optionally produces real fal.ai images behind a new
MEDIA_BACKEND=fal-ai flag. Default remains 'placeholder' so production keeps
using the asset catalog unless operators explicitly opt in.

Adds backends/ai/media/jobs/:
- IMediaJobStore interface + MongoMediaJobStore (collection: mediaJobs)
- New @restropulse/shared MediaJobRecord type with PENDING/RUNNING/COMPLETED/FAILED
  states. Shape matches what phase 5 needs for durable video polling so phase 5
  only adds a cron, not new schema.
- New @restropulse/db helpers: insertMediaJob, findMediaJobById,
  updateMediaJobStatus, incrementMediaJobAttempts, findStaleRunningJobs.

Adds backends/ai/media/fal-ai/:
- FalClient wrapping fal.ai sync inference at https://fal.run/<model> with
  Authorization: Key <FAL_API_KEY>. Errors classified via existing classifyError
  for retry compatibility.
- FAL_MODELS catalog (flux/dev for text-to-image, flux/dev/image-to-image for
  edits). Pricing at \$0.025/call placeholder.
- FalAIMediaGenerator implementing IMediaGenerator:
  * IMAGE/STORY: text-to-image via Flux dev, picks portrait_16_9 for STORY,
    square_hd for IMAGE.
  * baseImageUrl: routes to image-to-image path automatically.
  * CAROUSEL: 3 parallel calls, 3 mediaJobs rows, returns mediaUrls=[a,b,c].
  * REEL/VIDEO: throws BACKEND_UNAVAILABLE pending phase 5.
  * pollJob: reads from store (mostly a no-op for synchronous phase 4 jobs;
    phase 5 will be where this matters for video).
- Every fal call wrapped in withRetry(IMAGE_SUBMIT) + withCostTracking with
  surface='image' so per-restaurant cost dashboards now attribute image gen
  alongside LLM and Sonar.

Pipelines (generate-post, revise-post) now thread restaurantId + cycleId into
the IMediaGenerator inputs so MediaJobRecord rows carry attribution fields.
ImageGenInput and VideoGenInput gain optional restaurantId/postId/cycleId
fields (backward compatible).

Factory wires MEDIA_BACKEND from env: 'placeholder' (default) builds the
existing PlaceholderMediaGenerator; 'fal-ai' requires FAL_API_KEY and builds
FalAIMediaGenerator. worker.ts adds MEDIA_BACKEND + FAL_API_KEY to the Zod
schema.

Tests: 4 new unit test files (mongo store, pricing, fal client, fal-ai
generator) + 1 new integration test using mongodb-memory-server and mocked
fetch. All prior 331 tests continue to pass; suite total ~365.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
rtk git status
rtk git log --oneline -7
```

---

## Self-Review

**Spec coverage** (against phase 4 brainstorm):
- IMediaJobStore + MongoMediaJobStore + mediaJobs collection -> Tasks 1-3
- FalClient + pricing + models -> Tasks 4, 5
- FalAIMediaGenerator (text-to-image, img2img, CAROUSEL fan-out, REEL throws, pollJob) -> Task 7
- IMediaGenerator inputs extended with audit fields -> Task 8
- backends/ai/media/fal-ai barrel + ai barrel re-export -> Task 9
- Factory MEDIA_BACKEND switch + FAL_API_KEY validation -> Task 10
- Pipeline restaurantId/cycleId threading -> Task 12
- worker.ts env additions -> Task 13
- End-to-end integration test (real Mongo, mocked fal HTTP) -> Task 14
- Smoke tests for default + fal-ai + missing-key -> Task 15

**Placeholder scan**: searched plan for "TBD", "implement later", "fill in", "appropriate error handling", "similar to Task". None present. Every code block contains real code.

**Type consistency**:
- `MediaJobRecord` shape consistent across packages/shared, packages/db, IMediaJobStore, MongoMediaJobStore, FalAIMediaGenerator persists.
- `MediaJobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'` matches phase 2's IMediaGenerator.MediaJobStatus.
- `FalImageResponse.images: FalGeneratedImage[]` consistent between FalClient and FalAIMediaGenerator.
- `FAL_MODELS.fluxDev` and `FAL_MODELS.fluxImg2Img` -- both used as `model:` argument in FalClient and as cost-tracking `model:` label.
- `IMediaGenerator.generateImage(input: ImageGenInput)` shape unchanged in phase 2's seam (added optional fields only).
- `MEDIA_BACKEND='placeholder' | 'fal-ai'` enum consistent in factory.ts and worker.ts.

**Cross-cutting notes**:
- Plain ASCII only.
- `rtk` for shell, NOT for vitest (`npx vitest` directly).
- `import type` for type-only imports.
- ESM `.js` extensions in import paths.
- Do not commit between tasks; commit only at Task 17.
- Default behavior remains placeholder backend; fal.ai opt-in via `MEDIA_BACKEND=fal-ai`.
- After modifying packages/shared or packages/db, run `rtk npm run build --workspace=...` before downstream tests pick up new exports.
