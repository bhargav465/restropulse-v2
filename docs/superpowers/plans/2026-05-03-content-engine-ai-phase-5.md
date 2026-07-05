# Content-Engine AI - Phase 5: Video Generation, Durable Polling, Crash-Safe Resume

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** REEL/VIDEO posts now produce real video via fal.ai (Kling 1.6 standard) without blocking the content engine. Submission writes a `mediaJobs` row + sets the post to a new `PENDING_MEDIA` state. A new `media-job-poller` cron runs every 30s, polls running jobs via fal.ai's queue API, and advances posts to `PENDING_APPROVAL` on completion. Worker boot re-enqueues posts stuck in non-terminal states. `generationStep` checkpoints on each post let crashed runs resume from the last completed step.

**Architecture:**
- `FalClient` extended with queue API (`https://queue.fal.run/<model>` submit + status + result endpoints).
- `FalAIMediaGenerator.generateVideo`: queue submit + write `MediaJobRecord` (status=RUNNING) + return immediately.
- `pipeline/generate-post.ts` video branch: caption is sync; media is "submitted, will arrive later". Returns `GeneratedPost` with `pendingMedia: true` discriminator.
- `services/processors/adhoc` + `revision`: detect `pendingMedia` and write post with status=`PENDING_MEDIA` instead of `PENDING_APPROVAL`.
- New `services/processors/media-job-poller/` polls running jobs every 30s, transitions posts to `PENDING_APPROVAL` on COMPLETED, marks FAILED on hard errors, and reaps stale RUNNING jobs (>10 min) as FAILED with diagnostic info.
- `services/post-resume.ts` runs once on worker boot: scans for posts in `PENDING_MEDIA` with `lastStepAt` >5 min ago and triggers a poll cycle. Idempotent.

Default behavior unchanged when `MEDIA_BACKEND=placeholder` (the poller isn't even registered).

**Tech Stack:** TypeScript (strict, ESM), MongoDB driver v6, native `fetch` for fal.ai queue API, Vitest + mongodb-memory-server, `withRetry` + `withCostTracking` from prior phases, IProcessor contract from the standardization commit.

---

## Phase 5 Checkpoints

Three review checkpoints, one final commit at the end.

- **Checkpoint A (Tasks 1-7):** Schema + DB helpers + fal.ai queue API client. STOP for user approval.
- **Checkpoint B (Tasks 8-14):** Video submission flow + media-job-poller cron + processor edits. STOP for user approval.
- **Checkpoint C (Tasks 15-21):** Crash-safe resume + e2e + commit gate.

---

## File Structure

### New files

```
apps/content-engine/src/services/content-generator/backends/ai/media/fal-ai/queue-types.ts             FalQueueSubmission, FalQueueStatus, FalQueueStatusValue
apps/content-engine/src/services/processors/media-job-poller/
  index.ts                                                                                              processMediaJobs + createMediaJobPollerProcessor
  poll-runner.ts                                                                                        pollMediaJob(jobId, deps)
apps/content-engine/src/services/post-resume.ts                                                         runPostResumeOnBoot
apps/content-engine/tests/unit/content-generator/backends/ai/media/fal-ai/queue-api.test.ts
apps/content-engine/tests/unit/processors/media-job-poller/
  poll-runner.test.ts
  index.test.ts
apps/content-engine/tests/unit/post-resume.test.ts
apps/content-engine/tests/integration/video-flow-end-to-end.test.ts
apps/content-engine/tests/integration/stale-job-recovery.test.ts
```

### Modified files

```
packages/shared/src/index.ts                                                                            + 'PENDING_MEDIA' in PostStatus; + Post.mediaJobId, Post.generationStep, Post.lastStepAt
packages/db/src/posts.ts                                                                                + findStalePendingMediaPosts, setPostMediaJobReference, advanceGenerationStep, markPostFailedWithMedia, applyMediaJobResultToPost
apps/content-engine/src/services/content-generator/types.ts                                             + GeneratedPost.pendingMedia, mediaJobId, generationStep
apps/content-engine/src/services/content-generator/backends/ai/media/fal-ai/fal-client.ts               + submitToQueue, getQueueStatus, getQueueResult
apps/content-engine/src/services/content-generator/backends/ai/media/fal-ai/models.ts                   + FAL_MODELS.klingVideo, FAL_MODELS.minimaxVideo
apps/content-engine/src/services/content-generator/backends/ai/media/fal-ai/pricing.ts                  + per-call rates for the two video models
apps/content-engine/src/services/content-generator/backends/ai/media/fal-ai/fal-ai-media-generator.ts   generateVideo: queue submit + RUNNING return; pollJob: queue-aware
apps/content-engine/src/services/content-generator/backends/ai/pipeline/generate-post.ts                video branch returns pendingMedia + writes generationStep checkpoints
apps/content-engine/src/services/processors/adhoc/index.ts                                              detect pendingMedia -> set status=PENDING_MEDIA + mediaJobId + generationStep
apps/content-engine/src/services/processors/revision/index.ts                                           same
apps/content-engine/src/services/processors/index.ts                                                    + re-export createMediaJobPollerProcessor
apps/content-engine/src/services/content-generator/factory.ts                                           + getLastAiMediaJobStore() and helpers for poller wiring
apps/content-engine/src/services/content-generator/index.ts                                             re-export the factory helpers
apps/content-engine/src/worker.ts                                                                       + CRON_MEDIA_JOB_POLLER env, register poller when MEDIA_BACKEND=fal-ai, call post-resume on boot
apps/content-engine/tests/unit/content-generator/backends/ai/media/fal-ai/fal-ai-media-generator.test.ts   add video submit test cases
apps/content-engine/tests/unit/content-generator/backends/ai/pipeline/generate-post.test.ts             update REEL test for new pendingMedia return
```

---

# CHECKPOINT A - Schema + DB + queue API client

## Task 1: Add `PENDING_MEDIA` + `mediaJobId`/`generationStep`/`lastStepAt` to `@restropulse/shared`

**Files:**
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Extend the `PostStatus` union**

In `packages/shared/src/index.ts`, change the existing `PostStatus` definition (line 27-34) to add `PENDING_MEDIA`:

```typescript
export type PostStatus =
  | 'PENDING_CONTENT'        // Awaiting content generation by content-engine
  | 'PENDING_MEDIA'          // Caption ready; media generation in flight (phase 5)
  | 'PENDING_APPROVAL'       // Content created, awaiting user review
  | 'CHANGES_REQUESTED'      // User requested changes
  | 'SCHEDULED'              // Approved and scheduled for publishing
  | 'PUBLISHING'             // Currently being published by publisher worker
  | 'POSTED'                 // Successfully published
  | 'MISSED_DEADLINE';       // Failed after max retries
```

- [ ] **Step 2: Add the new optional fields to `Post`**

In `packages/shared/src/index.ts`, change the existing `Post` interface (lines 162-183) by adding three optional fields after `cycleId?: string;`:

```typescript
export interface Post {
  id: string;
  type: PostType;
  status: PostStatus;
  thumbnail: string;
  mediaUrls?: string[];
  videoUrl?: string;
  caption: string;
  platforms: Platform[];
  restaurantId?: string;
  scheduledFor?: string;
  postedAt?: string;
  feedback?: string;
  publishError?: string;
  publishAttempts?: number;
  duration?: string;
  cycleId?: string;
  // Phase 5 -- async media generation lifecycle
  mediaJobId?: string;          // FK to mediaJobs.jobId when status=PENDING_MEDIA
  generationStep?: GenerationStep;
  lastStepAt?: string;          // ISO; updated when generationStep advances
  isAdhoc?: boolean;
  instagramMediaId?: string;
  facebookPostId?: string;
  stats?: PostStats;
}
```

Add the new `GenerationStep` type definition right after `PostStatus`:

```typescript
export type GenerationStep =
  | 'SEARCHING_TRENDS'   // currentAffairsHints being fetched (rare; sync)
  | 'CAPTION_DONE'       // LLM caption produced
  | 'MEDIA_REQUESTED'    // media job submitted (fal queue request_id captured)
  | 'MEDIA_DONE';        // media URL retrieved and applied to post
```

- [ ] **Step 3: Type-check + build shared**

```
rtk npm run type-check --workspace=@restropulse/shared
rtk npm run build --workspace=@restropulse/shared
```
Expected: both exit 0.

---

## Task 2: Add Phase-5 helpers to `@restropulse/db/posts.ts` + tests

**Files:**
- Modify: `packages/db/src/posts.ts`

The new helpers operate on the posts collection. They are tested via the integration test in Task 3 (mongodb-memory-server) rather than separate unit tests — their bodies are thin Mongo wrappers.

- [ ] **Step 1: Append new helpers at the bottom of `packages/db/src/posts.ts`**

Add these exports after the existing `findPostsByStatus`:

```typescript
import type { GenerationStep, MediaJobRecord, PostStatus } from '@restropulse/shared';

/**
 * Find posts whose status is PENDING_MEDIA and whose lastStepAt is older than
 * the cutoff (or unset). Used by the media-job-poller and the worker boot
 * resume scan to surface jobs that need attention.
 */
export async function findStalePendingMediaPosts(olderThan: Date): Promise<Post[]> {
  const col = getPostsCollection();
  // Match either no lastStepAt (legacy) OR lastStepAt before the cutoff.
  const docs = await col.find({
    status: 'PENDING_MEDIA',
    $or: [
      { lastStepAt: { $exists: false } },
      { lastStepAt: { $lt: olderThan.toISOString() } },
    ],
  } as any).sort({ updatedAt: 1 }).toArray();
  return toApiFormatArray(docs) as Post[];
}

/**
 * Find every post still in PENDING_MEDIA. Used by the poller every tick.
 */
export async function findAllPendingMediaPosts(): Promise<Post[]> {
  const col = getPostsCollection();
  const docs = await col.find({ status: 'PENDING_MEDIA' } as any).sort({ updatedAt: 1 }).toArray();
  return toApiFormatArray(docs) as Post[];
}

/**
 * Atomically attach a mediaJobId + step to the post and flip its status to
 * PENDING_MEDIA. The status guard prevents accidental overwrites if the post
 * has already moved on (e.g. concurrent revision).
 */
export async function setPostMediaJobReference(
  postId: string,
  mediaJobId: string,
  step: GenerationStep,
): Promise<Post | null> {
  const col = getPostsCollection();
  const result = await col.findOneAndUpdate(
    { _id: toObjectId(postId) as any, status: { $in: ['PENDING_CONTENT', 'PENDING_MEDIA', 'CHANGES_REQUESTED'] } as any },
    {
      $set: {
        status: 'PENDING_MEDIA' as PostStatus,
        mediaJobId,
        generationStep: step,
        lastStepAt: new Date().toISOString(),
        updatedAt: new Date(),
      } as any,
    },
    { returnDocument: 'after' },
  );
  return toApiFormat(result) as Post | null;
}

/**
 * Advance the post's generationStep checkpoint. Does not change status.
 */
export async function advanceGenerationStep(postId: string, step: GenerationStep): Promise<Post | null> {
  const col = getPostsCollection();
  const result = await col.findOneAndUpdate(
    { _id: toObjectId(postId) as any },
    {
      $set: {
        generationStep: step,
        lastStepAt: new Date().toISOString(),
        updatedAt: new Date(),
      } as any,
    },
    { returnDocument: 'after' },
  );
  return toApiFormat(result) as Post | null;
}

/**
 * On COMPLETED media job: copy the media URL/thumbnail/metadata onto the post,
 * mark generationStep MEDIA_DONE, and flip status to PENDING_APPROVAL.
 */
export async function applyMediaJobResultToPost(
  postId: string,
  job: MediaJobRecord,
): Promise<Post | null> {
  const col = getPostsCollection();
  const update: Record<string, unknown> = {
    status: 'PENDING_APPROVAL' as PostStatus,
    generationStep: 'MEDIA_DONE' as GenerationStep,
    lastStepAt: new Date().toISOString(),
    updatedAt: new Date(),
  };
  if (job.mediaUrl) {
    // Video posts use videoUrl + thumbnail; image posts use thumbnail and optionally mediaUrls.
    update.thumbnail = job.thumbnail ?? job.mediaUrl;
    if (job.postType === 'REEL' || job.postType === 'VIDEO') {
      update.videoUrl = job.mediaUrl;
    }
  }
  if (job.mediaUrls) {
    update.mediaUrls = job.mediaUrls;
    if (!update.thumbnail) update.thumbnail = job.mediaUrls[0];
  }
  if (job.metadata?.durationSeconds !== undefined) {
    update.duration = `${job.metadata.durationSeconds}s`;
  }
  const result = await col.findOneAndUpdate(
    { _id: toObjectId(postId) as any, status: 'PENDING_MEDIA' as any },
    { $set: update as any },
    { returnDocument: 'after' },
  );
  return toApiFormat(result) as Post | null;
}

/**
 * On FAILED media job: mark the post FAILED with a diagnostic error message.
 * (Reuses existing publishError field for surfacing; phase 6 may split out a
 * dedicated mediaError field.)
 */
export async function markPostFailedWithMedia(postId: string, error: string): Promise<Post | null> {
  const col = getPostsCollection();
  const result = await col.findOneAndUpdate(
    { _id: toObjectId(postId) as any, status: 'PENDING_MEDIA' as any },
    {
      $set: {
        status: 'MISSED_DEADLINE' as PostStatus,
        publishError: `media-generation: ${error}`,
        lastStepAt: new Date().toISOString(),
        updatedAt: new Date(),
      } as any,
    },
    { returnDocument: 'after' },
  );
  return toApiFormat(result) as Post | null;
}
```

Note: the imports at the top of the file already include `Post`. Add `GenerationStep, MediaJobRecord, PostStatus` to that import line. Build will fail loudly if any of those types are missing.

- [ ] **Step 2: Build + type-check**

```
rtk npm run build --workspace=@restropulse/shared
rtk npm run build --workspace=@restropulse/db
rtk npm run type-check --workspace=@restropulse/db
```
Exit 0.

---

## Task 3: Integration test for the new posts.ts helpers

**Files:**
- Create: `apps/content-engine/tests/integration/post-helpers-phase5.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import {
  setDB,
  createPost,
  findStalePendingMediaPosts,
  findAllPendingMediaPosts,
  setPostMediaJobReference,
  advanceGenerationStep,
  applyMediaJobResultToPost,
  markPostFailedWithMedia,
} from '@restropulse/db';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

let mongod: MongoMemoryServer;
let client: MongoClient;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongod.getUri());
  setDB(client.db('post-helpers-phase5'));
}, 60000);

afterAll(async () => {
  await client.close();
  await mongod.stop();
}, 20000);

beforeEach(async () => {
  await client.db('post-helpers-phase5').collection('posts').deleteMany({});
});

const basePost = {
  type: 'REEL' as const,
  status: 'PENDING_CONTENT' as const,
  thumbnail: 'http://x',
  caption: 'c',
  platforms: ['INSTAGRAM' as const],
  restaurantId: 'r1',
};

describe('Phase-5 posts.ts helpers', () => {
  it('setPostMediaJobReference flips status PENDING_CONTENT -> PENDING_MEDIA + writes mediaJobId/step/lastStepAt', async () => {
    const created = await createPost(basePost);
    const updated = await setPostMediaJobReference(created.id, 'job_xyz', 'MEDIA_REQUESTED');
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('PENDING_MEDIA');
    expect(updated!.mediaJobId).toBe('job_xyz');
    expect(updated!.generationStep).toBe('MEDIA_REQUESTED');
    expect(updated!.lastStepAt).toBeTruthy();
  });

  it('setPostMediaJobReference rejects posts already moved past PENDING (returns null)', async () => {
    const created = await createPost({ ...basePost, status: 'POSTED' });
    const updated = await setPostMediaJobReference(created.id, 'jobX', 'MEDIA_REQUESTED');
    expect(updated).toBeNull();
  });

  it('advanceGenerationStep updates step + lastStepAt without changing status', async () => {
    const created = await createPost({ ...basePost, status: 'PENDING_MEDIA' });
    const updated = await advanceGenerationStep(created.id, 'CAPTION_DONE');
    expect(updated!.generationStep).toBe('CAPTION_DONE');
    expect(updated!.status).toBe('PENDING_MEDIA');
  });

  it('applyMediaJobResultToPost flips PENDING_MEDIA -> PENDING_APPROVAL with media URL + duration', async () => {
    const created = await createPost({ ...basePost, status: 'PENDING_MEDIA' });
    const job = {
      jobId: 'j1',
      provider: 'fal-ai' as const,
      modelId: 'fal-ai/kling-video/v1.6/standard/text-to-video',
      postType: 'REEL' as const,
      status: 'COMPLETED' as const,
      mediaUrl: 'https://fal.media/video.mp4',
      thumbnail: 'https://fal.media/thumb.jpg',
      metadata: { widthPx: 1080, heightPx: 1920, durationSeconds: 5 },
      attempts: 1,
      startedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const updated = await applyMediaJobResultToPost(created.id, job);
    expect(updated!.status).toBe('PENDING_APPROVAL');
    expect(updated!.videoUrl).toBe('https://fal.media/video.mp4');
    expect(updated!.thumbnail).toBe('https://fal.media/thumb.jpg');
    expect(updated!.duration).toBe('5s');
    expect(updated!.generationStep).toBe('MEDIA_DONE');
  });

  it('markPostFailedWithMedia surfaces the error on publishError', async () => {
    const created = await createPost({ ...basePost, status: 'PENDING_MEDIA' });
    const updated = await markPostFailedWithMedia(created.id, 'fal queue timeout');
    expect(updated!.status).toBe('MISSED_DEADLINE');
    expect(updated!.publishError).toContain('media-generation');
    expect(updated!.publishError).toContain('fal queue timeout');
  });

  it('findStalePendingMediaPosts surfaces posts with old lastStepAt', async () => {
    const recent = await createPost({ ...basePost, status: 'PENDING_MEDIA', lastStepAt: new Date().toISOString() });
    const stale = await createPost({ ...basePost, status: 'PENDING_MEDIA', lastStepAt: new Date(Date.now() - 10 * 60 * 1000).toISOString() });
    const noStep = await createPost({ ...basePost, status: 'PENDING_MEDIA' });

    const stalePosts = await findStalePendingMediaPosts(new Date(Date.now() - 5 * 60 * 1000));
    const ids = stalePosts.map((p) => p.id);
    expect(ids).toContain(stale.id);
    expect(ids).toContain(noStep.id);
    expect(ids).not.toContain(recent.id);
  });

  it('findAllPendingMediaPosts returns every PENDING_MEDIA post', async () => {
    await createPost({ ...basePost, status: 'PENDING_MEDIA' });
    await createPost({ ...basePost, status: 'PENDING_MEDIA' });
    await createPost({ ...basePost, status: 'PENDING_APPROVAL' });
    const all = await findAllPendingMediaPosts();
    expect(all).toHaveLength(2);
  });
});
```

Run: expected FAIL.

- [ ] **Step 2: Re-run after Tasks 1+2 land**

`cd apps/content-engine && npx vitest run tests/integration/post-helpers-phase5.test.ts`
Expected: PASS, 7 assertions.

---

## Task 4: Add video models + pricing

**Files:**
- Modify: `apps/content-engine/src/services/content-generator/backends/ai/media/fal-ai/models.ts`
- Modify: `apps/content-engine/src/services/content-generator/backends/ai/media/fal-ai/pricing.ts`
- Modify: `apps/content-engine/tests/unit/content-generator/backends/ai/media/fal-ai/pricing.test.ts`

- [ ] **Step 1: Extend `FAL_MODELS`**

```typescript
export const FAL_MODELS = {
  fluxDev: 'fal-ai/flux/dev',
  fluxImg2Img: 'fal-ai/flux/dev/image-to-image',
  klingVideo: 'fal-ai/kling-video/v1.6/standard/text-to-video',
  minimaxVideo: 'fal-ai/minimax-video/text-to-video',
} as const;

export type FalModelId = (typeof FAL_MODELS)[keyof typeof FAL_MODELS];
```

- [ ] **Step 2: Extend `FAL_PRICING`**

```typescript
export const FAL_PRICING: Record<string, FalModelPricing> = {
  'fal-ai/flux/dev': { usdPerCall: 0.025 },
  'fal-ai/flux/dev/image-to-image': { usdPerCall: 0.025 },
  'fal-ai/kling-video/v1.6/standard/text-to-video': { usdPerCall: 0.30 },
  'fal-ai/minimax-video/text-to-video': { usdPerCall: 0.40 },
};
```

- [ ] **Step 3: Append two assertions to `pricing.test.ts`**

Inside the existing `describe('FAL_PRICING', ...)` block, after the existing tests, add:

```typescript
  it('declares prices for the phase-5 video models (Kling + MiniMax)', () => {
    expect(FAL_PRICING['fal-ai/kling-video/v1.6/standard/text-to-video']).toBeDefined();
    expect(FAL_PRICING['fal-ai/minimax-video/text-to-video']).toBeDefined();
    expect(FAL_PRICING['fal-ai/kling-video/v1.6/standard/text-to-video'].usdPerCall).toBeGreaterThan(0);
  });
```

Verify: `cd apps/content-engine && npx vitest run tests/unit/content-generator/backends/ai/media/fal-ai/pricing.test.ts`
Expected: PASS, +1 test (5 total now).

---

## Task 5: Extend `FalClient` with queue API methods

**Files:**
- Create: `apps/content-engine/src/services/content-generator/backends/ai/media/fal-ai/queue-types.ts`
- Modify: `apps/content-engine/src/services/content-generator/backends/ai/media/fal-ai/fal-client.ts`
- Create: `apps/content-engine/tests/unit/content-generator/backends/ai/media/fal-ai/queue-api.test.ts`

The fal.ai queue API:
- `POST https://queue.fal.run/<model>` -> `{ request_id, status_url, response_url }`
- `GET https://queue.fal.run/<model>/requests/<id>/status` -> `{ status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED', queue_position?, logs? }`
- `GET https://queue.fal.run/<model>/requests/<id>` -> the actual response (matches sync API response shape)

- [ ] **Step 1: Create `queue-types.ts`**

```typescript
/**
 * fal.ai queue API types.
 * https://queue.fal.run/<model> for async submission + polling.
 */

export type FalQueueStatusValue = 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';

export interface FalQueueSubmission {
  requestId: string;
  /** fal.ai-provided URLs; we ignore them and reconstruct via model + requestId. */
  statusUrl?: string;
  responseUrl?: string;
}

export interface FalQueueStatus {
  status: FalQueueStatusValue;
  queuePosition?: number;
  logs?: Array<{ message?: string; level?: string }>;
}
```

- [ ] **Step 2: Create the failing test**

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

describe('FalClient queue API', () => {
  it('submitToQueue POSTs to queue.fal.run/<model> and returns the requestId', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ request_id: 'req_abc', status_url: 's', response_url: 'r' }),
    });
    const client = new FalClient({ apiKey: 'k' });
    const out = await client.submitToQueue('fal-ai/kling-video/v1.6/standard/text-to-video', { prompt: 'a kitchen reel' });
    expect(out.requestId).toBe('req_abc');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://queue.fal.run/fal-ai/kling-video/v1.6/standard/text-to-video');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Key k');
    expect(JSON.parse(init.body).prompt).toBe('a kitchen reel');
  });

  it('getQueueStatus GETs status URL and returns the status value', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ status: 'IN_PROGRESS', queue_position: 0 }),
    });
    const client = new FalClient({ apiKey: 'k' });
    const out = await client.getQueueStatus('fal-ai/kling-video/v1.6/standard/text-to-video', 'req_abc');
    expect(out.status).toBe('IN_PROGRESS');
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://queue.fal.run/fal-ai/kling-video/v1.6/standard/text-to-video/requests/req_abc/status');
  });

  it('getQueueResult GETs result URL and returns the typed response shape', async () => {
    const videoResponse = {
      video: { url: 'https://fal.media/v.mp4', file_size: 1024 },
      seed: 7,
    };
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => videoResponse });
    const client = new FalClient({ apiKey: 'k' });
    const out = await client.getQueueResult('fal-ai/kling-video/v1.6/standard/text-to-video', 'req_abc');
    expect((out as any).video.url).toBe('https://fal.media/v.mp4');
  });

  it('submitToQueue propagates 5xx as TransientError', async () => {
    const { TransientError } = await import(
      '../../../../../../../src/services/content-generator/backends/ai/errors.js'
    );
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, headers: new Map(), json: async () => ({}), text: async () => '{}' });
    const client = new FalClient({ apiKey: 'k' });
    await expect(client.submitToQueue('fal-ai/kling-video/v1.6/standard/text-to-video', { prompt: 'x' })).rejects.toBeInstanceOf(TransientError);
  });

  it('getQueueStatus surfaces 404 as a regular Error (not retryable)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, headers: new Map(), json: async () => ({}), text: async () => '{}' });
    const client = new FalClient({ apiKey: 'k' });
    await expect(client.getQueueStatus('fal-ai/kling-video/v1.6/standard/text-to-video', 'req_abc')).rejects.toThrow();
  });
});
```

Run: expected FAIL.

- [ ] **Step 3: Extend `FalClient`**

In `fal-client.ts`, add these imports near the top:

```typescript
import type { FalQueueSubmission, FalQueueStatus } from './queue-types.js';
```

And add these methods to the `FalClient` class (after `editImage`, before `postAndParse`):

```typescript
async submitToQueue(model: string, body: Record<string, unknown>): Promise<FalQueueSubmission> {
  const url = `https://queue.fal.run/${model}`;
  const json = await this.fetchJson(url, {
    method: 'POST',
    headers: this.authHeaders(),
    body: JSON.stringify(body),
  }) as { request_id: string; status_url?: string; response_url?: string };
  return {
    requestId: json.request_id,
    ...(json.status_url ? { statusUrl: json.status_url } : {}),
    ...(json.response_url ? { responseUrl: json.response_url } : {}),
  };
}

async getQueueStatus(model: string, requestId: string): Promise<FalQueueStatus> {
  const url = `https://queue.fal.run/${model}/requests/${requestId}/status`;
  const json = await this.fetchJson(url, {
    method: 'GET',
    headers: this.authHeaders(),
  }) as { status: string; queue_position?: number; logs?: Array<{ message?: string; level?: string }> };
  return {
    status: json.status as FalQueueStatus['status'],
    ...(json.queue_position !== undefined ? { queuePosition: json.queue_position } : {}),
    ...(json.logs ? { logs: json.logs } : {}),
  };
}

async getQueueResult<T = unknown>(model: string, requestId: string): Promise<T> {
  const url = `https://queue.fal.run/${model}/requests/${requestId}`;
  return this.fetchJson(url, { method: 'GET', headers: this.authHeaders() }) as Promise<T>;
}
```

You'll also need to extract two private helpers used by all three methods. Refactor the existing `postAndParse` so it uses these helpers; both old `generateImage` / `editImage` continue to work via `postAndParse` -> `fetchJson`:

```typescript
private authHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Key ${this.apiKey}`,
  };
}

private async fetchJson(url: string, init: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, init);
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
  return res.json();
}
```

Update the existing `postAndParse` body to use `fetchJson + authHeaders`:

```typescript
private async postAndParse(model: string, body: Record<string, unknown>): Promise<FalImageResponse> {
  const url = `${SYNC_BASE_URL}/${model}`;
  const json = await this.fetchJson(url, {
    method: 'POST',
    headers: this.authHeaders(),
    body: JSON.stringify(body),
  }) as { images?: Array<{ url?: string; width?: number; height?: number }>; seed?: number };
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
```

- [ ] **Step 4: Run all fal-client tests**

`cd apps/content-engine && npx vitest run tests/unit/content-generator/backends/ai/media/fal-ai`
Expected: existing 7 fal-client tests + 5 new queue-api tests + pricing tests = all green.

---

## Task 6: Checkpoint A wrap

- [ ] **Step 1: Run all phase-5 Checkpoint A tests**

`cd apps/content-engine && npx vitest run tests/integration/post-helpers-phase5.test.ts tests/unit/content-generator/backends/ai/media/fal-ai`
Expected: all green.

- [ ] **Step 2: Run full content-engine suite**

`cd apps/content-engine && npx vitest run`
Expected: ~50 files / ~370 assertions, all green.

- [ ] **Step 3: Type-check across affected workspaces**

```
rtk npm run type-check --workspace=@restropulse/shared
rtk npm run type-check --workspace=@restropulse/db
rtk npm run type-check --workspace=@restropulse/content-engine
```
All exit 0.

- [ ] **Step 4: Show user, request approval to proceed to Checkpoint B**

`rtk git status`. **STOP. Tell the user: "Phase 5 Checkpoint A complete - PostStatus extension + DB helpers + fal queue API client. Approve continuing to Checkpoint B (video submission flow + media-job-poller)?"** Wait for explicit approval.

---

# CHECKPOINT B - Video submission + media-job-poller cron

## Task 7: Extend `FalAIMediaGenerator.generateVideo` with queue submit + tests

**Files:**
- Modify: `apps/content-engine/src/services/content-generator/backends/ai/media/fal-ai/fal-ai-media-generator.ts`
- Modify: `apps/content-engine/tests/unit/content-generator/backends/ai/media/fal-ai/fal-ai-media-generator.test.ts`

The existing generateVideo throws `BACKEND_UNAVAILABLE`. Replace with:
1. Pick model (Kling 1.6 default)
2. Build prompt
3. Submit via FalClient.submitToQueue (wrapped in withRetry(VIDEO_SUBMIT) + withCostTracking(surface='video'))
4. Insert MediaJobRecord with status='RUNNING', providerJobId=request_id, modelId, postType
5. Return MediaGenJob with status='RUNNING', jobId, no mediaUrl

Also update `pollJob` to live-poll the queue when the stored record is still RUNNING (used by the post-resume scan and by the poller cron).

- [ ] **Step 1: Update `fal-ai-media-generator.test.ts` to cover the new behavior**

Add a new `describe` block:

```typescript
describe('FalAIMediaGenerator generateVideo (queue submit)', () => {
  it('submits a video job via the queue API and inserts a RUNNING MediaJobRecord', async () => {
    let captured: any = null;
    const store = makeStore((j) => { captured = j; });
    const client = {
      generateImage: vi.fn(),
      editImage: vi.fn(),
      submitToQueue: vi.fn(async () => ({ requestId: 'req_v1' })),
      getQueueStatus: vi.fn(),
      getQueueResult: vi.fn(),
    };
    const gen = new FalAIMediaGenerator({ client: client as any, store: store as any });

    const job = await gen.generateVideo({
      postType: 'REEL',
      platforms: ['INSTAGRAM'],
      concept: 'kitchen reel',
      restaurantId: 'r1',
      postId: 'p1',
    });

    expect(job.status).toBe('RUNNING');
    expect(job.jobId).toBeTruthy();
    expect(client.submitToQueue).toHaveBeenCalledTimes(1);
    expect(captured.status).toBe('RUNNING');
    expect(captured.providerJobId).toBe('req_v1');
    expect(captured.modelId).toBe('fal-ai/kling-video/v1.6/standard/text-to-video');
    expect(captured.postType).toBe('REEL');
    expect(captured.restaurantId).toBe('r1');
    expect(captured.postId).toBe('p1');
  });

  it('writes a cost event tagged surface=video at submission time', async () => {
    const { insertCostEvent } = await import('@restropulse/db');
    (insertCostEvent as any).mockClear();
    const store = makeStore();
    const client = {
      generateImage: vi.fn(), editImage: vi.fn(),
      submitToQueue: vi.fn(async () => ({ requestId: 'req_v2' })),
      getQueueStatus: vi.fn(), getQueueResult: vi.fn(),
    };
    const gen = new FalAIMediaGenerator({ client: client as any, store: store as any });
    await gen.generateVideo({
      postType: 'REEL', platforms: ['INSTAGRAM'], concept: 'x',
      restaurantId: 'r1', postId: 'p1',
    });
    expect(insertCostEvent).toHaveBeenCalledTimes(1);
    const event = (insertCostEvent as any).mock.calls[0][0];
    expect(event.surface).toBe('video');
    expect(event.step).toBe('video-submit');
    expect(event.model).toBe('fal-ai/kling-video/v1.6/standard/text-to-video');
    expect(event.costUsd).toBeGreaterThan(0);
  });

  it('returns FAILED MediaGenJob when queue submission fails permanently', async () => {
    const store = makeStore();
    const client = {
      generateImage: vi.fn(), editImage: vi.fn(),
      submitToQueue: vi.fn().mockRejectedValue({ status: 422, message: 'bad prompt' }),
      getQueueStatus: vi.fn(), getQueueResult: vi.fn(),
    };
    const gen = new FalAIMediaGenerator({ client: client as any, store: store as any });
    const job = await gen.generateVideo({ postType: 'REEL', platforms: ['INSTAGRAM'], concept: 'x' });
    expect(job.status).toBe('FAILED');
  });
});

describe('FalAIMediaGenerator pollJob (queue-aware)', () => {
  it('returns store-record unchanged when status is COMPLETED', async () => {
    const completedRecord = {
      id: 'p', jobId: 'j_done', provider: 'fal-ai', modelId: 'fal-ai/kling-video/v1.6/standard/text-to-video',
      postType: 'REEL', status: 'COMPLETED', mediaUrl: 'https://fal.media/v.mp4',
      attempts: 1, startedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
      providerJobId: 'req',
    };
    const store = {
      insert: vi.fn(),
      findById: vi.fn(async () => completedRecord),
      updateStatus: vi.fn(),
      incrementAttempts: vi.fn(),
    };
    const client = {
      generateImage: vi.fn(), editImage: vi.fn(),
      submitToQueue: vi.fn(),
      getQueueStatus: vi.fn(),
      getQueueResult: vi.fn(),
    };
    const gen = new FalAIMediaGenerator({ client: client as any, store: store as any });
    const out = await gen.pollJob('j_done');
    expect(out.status).toBe('COMPLETED');
    expect(out.mediaUrl).toBe('https://fal.media/v.mp4');
    expect(client.getQueueStatus).not.toHaveBeenCalled();
  });

  it('live-polls the queue when stored status is RUNNING; transitions to COMPLETED when fal says so', async () => {
    const runningRecord = {
      id: 'p', jobId: 'j_run', provider: 'fal-ai', modelId: 'fal-ai/kling-video/v1.6/standard/text-to-video',
      postType: 'REEL', status: 'RUNNING', providerJobId: 'req_xyz',
      attempts: 1, startedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
    };
    const store = {
      insert: vi.fn(),
      findById: vi.fn(async () => runningRecord),
      updateStatus: vi.fn(async (jobId: string, update: any) => ({
        ...runningRecord, ...update, jobId,
      })),
      incrementAttempts: vi.fn(),
    };
    const client = {
      generateImage: vi.fn(), editImage: vi.fn(),
      submitToQueue: vi.fn(),
      getQueueStatus: vi.fn(async () => ({ status: 'COMPLETED' })),
      getQueueResult: vi.fn(async () => ({ video: { url: 'https://fal.media/done.mp4' } })),
    };
    const gen = new FalAIMediaGenerator({ client: client as any, store: store as any });
    const out = await gen.pollJob('j_run');

    expect(client.getQueueStatus).toHaveBeenCalledWith('fal-ai/kling-video/v1.6/standard/text-to-video', 'req_xyz');
    expect(client.getQueueResult).toHaveBeenCalledTimes(1);
    expect(store.updateStatus).toHaveBeenCalled();
    const update = (store.updateStatus as any).mock.calls[0][1];
    expect(update.status).toBe('COMPLETED');
    expect(update.mediaUrl).toBe('https://fal.media/done.mp4');
    expect(out.status).toBe('COMPLETED');
    expect(out.mediaUrl).toBe('https://fal.media/done.mp4');
  });

  it('returns RUNNING from pollJob when fal still in progress', async () => {
    const runningRecord = {
      id: 'p', jobId: 'j_inprog', provider: 'fal-ai', modelId: 'fal-ai/kling-video/v1.6/standard/text-to-video',
      postType: 'REEL', status: 'RUNNING', providerJobId: 'req_in',
      attempts: 1, startedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
    };
    const store = {
      insert: vi.fn(),
      findById: vi.fn(async () => runningRecord),
      updateStatus: vi.fn(async (_jobId: string, update: any) => ({ ...runningRecord, ...update })),
      incrementAttempts: vi.fn(),
    };
    const client = {
      generateImage: vi.fn(), editImage: vi.fn(),
      submitToQueue: vi.fn(),
      getQueueStatus: vi.fn(async () => ({ status: 'IN_PROGRESS', queue_position: 0 })),
      getQueueResult: vi.fn(),
    };
    const gen = new FalAIMediaGenerator({ client: client as any, store: store as any });
    const out = await gen.pollJob('j_inprog');
    expect(out.status).toBe('RUNNING');
    expect(client.getQueueResult).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Replace `generateVideo` and `pollJob` in `fal-ai-media-generator.ts`**

Add at the top, alongside other imports:

```typescript
import type { FalQueueStatusValue } from './queue-types.js';

const DEFAULT_VIDEO_MODEL = FAL_MODELS.klingVideo;
```

Replace `generateVideo`:

```typescript
async generateVideo(input: VideoGenInput): Promise<MediaGenJob> {
  const jobId = randomUUID();
  const modelId = DEFAULT_VIDEO_MODEL;
  const prompt = buildPrompt(input);

  let submission: { requestId: string };
  try {
    submission = await withRetry(
      () => withCostTracking(
        async () => {
          const result = await this.client.submitToQueue(modelId, { prompt });
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
          surface: 'video',
          step: 'video-submit',
          model: modelId,
        },
      ),
      RETRY_PROFILES.VIDEO_SUBMIT,
    );
  } catch (err) {
    log.error({ err, jobId, modelId }, 'fal.ai queue submission failed after retries');
    const failed = await this.store.insert({
      jobId,
      provider: 'fal-ai',
      modelId,
      postType: input.postType,
      status: 'FAILED',
      error: (err as Error).message ?? 'unknown',
      attempts: 1,
      ...(input.restaurantId ? { restaurantId: input.restaurantId } : {}),
      ...(input.postId ? { postId: input.postId } : {}),
      ...(input.cycleId ? { cycleId: input.cycleId } : {}),
      startedAt: new Date(),
    });
    return this.recordToMediaGenJob(failed);
  }

  const record = await this.store.insert({
    jobId,
    providerJobId: submission.requestId,
    provider: 'fal-ai',
    modelId,
    postType: input.postType,
    status: 'RUNNING',
    attempts: 1,
    ...(input.restaurantId ? { restaurantId: input.restaurantId } : {}),
    ...(input.postId ? { postId: input.postId } : {}),
    ...(input.cycleId ? { cycleId: input.cycleId } : {}),
    startedAt: new Date(),
  });

  return this.recordToMediaGenJob(record);
}
```

Replace `pollJob`:

```typescript
async pollJob(jobId: string): Promise<MediaGenJob> {
  const record = await this.store.findById(jobId);
  if (!record) {
    return { jobId, status: 'FAILED', error: 'job not found' };
  }
  if (record.status !== 'RUNNING' || !record.providerJobId) {
    return this.recordToMediaGenJob(record);
  }

  let queueStatus: FalQueueStatusValue;
  try {
    const out = await this.client.getQueueStatus(record.modelId, record.providerJobId);
    queueStatus = out.status;
  } catch (err) {
    log.warn({ err, jobId, providerJobId: record.providerJobId }, 'fal.ai queue status poll failed; leaving record RUNNING');
    return this.recordToMediaGenJob(record);
  }

  if (queueStatus === 'COMPLETED') {
    let result: { video?: { url?: string }; images?: Array<{ url?: string; width?: number; height?: number }>; seed?: number } | null = null;
    try {
      result = await this.client.getQueueResult(record.modelId, record.providerJobId) as any;
    } catch (err) {
      log.error({ err, jobId }, 'fal.ai queue result fetch failed despite COMPLETED status');
      const updated = await this.store.updateStatus(jobId, {
        status: 'FAILED',
        error: 'queue COMPLETED but result fetch failed',
        completedAt: new Date(),
        lastPolledAt: new Date(),
      });
      return this.recordToMediaGenJob(updated ?? record);
    }
    const mediaUrl = result?.video?.url ?? result?.images?.[0]?.url;
    if (!mediaUrl) {
      const updated = await this.store.updateStatus(jobId, {
        status: 'FAILED',
        error: 'queue COMPLETED but response had no media URL',
        completedAt: new Date(),
        lastPolledAt: new Date(),
      });
      return this.recordToMediaGenJob(updated ?? record);
    }
    const updated = await this.store.updateStatus(jobId, {
      status: 'COMPLETED',
      mediaUrl,
      thumbnail: mediaUrl,
      completedAt: new Date(),
      lastPolledAt: new Date(),
    });
    return this.recordToMediaGenJob(updated ?? record);
  }

  if (queueStatus === 'FAILED') {
    const updated = await this.store.updateStatus(jobId, {
      status: 'FAILED',
      error: 'fal.ai queue status FAILED',
      completedAt: new Date(),
      lastPolledAt: new Date(),
    });
    return this.recordToMediaGenJob(updated ?? record);
  }

  // IN_QUEUE / IN_PROGRESS -- still running. Just bump lastPolledAt.
  await this.store.updateStatus(jobId, { lastPolledAt: new Date() });
  return this.recordToMediaGenJob(record);
}
```

- [ ] **Step 3: Run video tests**

`cd apps/content-engine && npx vitest run tests/unit/content-generator/backends/ai/media/fal-ai/fal-ai-media-generator.test.ts`
Expected: existing 10 + 6 new = ~16 tests green.

---

## Task 8: Extend `GeneratedPost` type with `pendingMedia` discriminator

**Files:**
- Modify: `apps/content-engine/src/services/content-generator/types.ts`

- [ ] **Step 1: Add fields to `GeneratedPost`**

```typescript
export interface GeneratedPost {
  caption: string;
  thumbnail: string;
  mediaUrls?: string[];
  videoUrl?: string;
  mediaMetadata?: MediaMetadata;
  // Phase 5 -- async media flow markers
  pendingMedia?: boolean;       // true means caller should set post.status=PENDING_MEDIA
  mediaJobId?: string;          // present when pendingMedia=true
  generationStep?: 'CAPTION_DONE' | 'MEDIA_REQUESTED' | 'MEDIA_DONE';
}
```

- [ ] **Step 2: Type-check** -> exit 0.

---

## Task 9: Update `pipeline/generate-post.ts` video branch

**Files:**
- Modify: `apps/content-engine/src/services/content-generator/backends/ai/pipeline/generate-post.ts`
- Modify: `apps/content-engine/tests/unit/content-generator/backends/ai/pipeline/generate-post.test.ts`

Currently `runMediaForPost` returns the full `MediaGenJob`. The post assembly later assumes `mediaJob.status === 'COMPLETED'`. For video, the job status will be 'RUNNING' and we need to short-circuit.

- [ ] **Step 1: Edit `runGeneratePost`**

After the `Promise.all([captionPromise, mediaPromise])` resolves, ADD a branch for `mediaJob.status === 'RUNNING'`:

```typescript
const [captionObj, mediaJob] = await Promise.all([
  runCaptionForPost(input, deps, ctx),
  runMediaForPost(input, deps, ctx),
]);

const specCtx = toSpecializationContext(ctx);
const specHashtags = deps.specialization.selectHashtags(captionObj.caption, specCtx);
const fullCaption = mergeHashtags(captionObj.caption, captionObj.suggestedHashtags, specHashtags);

// Phase 5: video media may still be RUNNING. Caller writes post.status=PENDING_MEDIA
// and waits for the media-job-poller cron to advance it.
if (mediaJob.status === 'RUNNING') {
  return {
    caption: fullCaption,
    thumbnail: '',           // populated when poller transitions COMPLETED
    pendingMedia: true,
    mediaJobId: mediaJob.jobId,
    generationStep: 'MEDIA_REQUESTED',
  };
}

if (mediaJob.status === 'FAILED') {
  throw new ContentGenerationError(
    'UNKNOWN',
    `Media generation failed: ${mediaJob.error ?? 'unknown'}`,
  );
}

// COMPLETED -- existing path:
const post: GeneratedPost = {
  caption: fullCaption,
  thumbnail: mediaJob.thumbnail ?? mediaJob.mediaUrl ?? '',
};
// ... unchanged ...
```

(Keep the rest of the existing assembly logic intact below the new branch.)

- [ ] **Step 2: Update the existing REEL test**

The existing `generate-post.test.ts` has a test asserting REEL routes to `generateVideo`. With phase 5 the mock should now return `{ status: 'RUNNING', jobId, ... }`, and the assertion changes to: `expect(out.pendingMedia).toBe(true); expect(out.mediaJobId).toBe('jobX')`.

Replace the `routes REEL post type through generateVideo` test with:

```typescript
it('routes REEL post type through generateVideo and returns pendingMedia=true', async () => {
  const deps = makeDeps();
  (deps.media.generateVideo as any).mockResolvedValueOnce({
    jobId: 'jobV1', status: 'RUNNING',
  });
  const out = await runGeneratePost(
    { concept: 'kitchen reel', type: 'REEL', platforms: ['INSTAGRAM'] },
    deps,
    {},
  );
  expect(deps.media.generateVideo).toHaveBeenCalledTimes(1);
  expect(out.pendingMedia).toBe(true);
  expect(out.mediaJobId).toBe('jobV1');
  expect(out.generationStep).toBe('MEDIA_REQUESTED');
});
```

- [ ] **Step 3: Verify**

`cd apps/content-engine && npx vitest run tests/unit/content-generator/backends/ai/pipeline/generate-post.test.ts`
Expected: all green.

---

## Task 10: Update adhoc-processor + revision-processor to handle `pendingMedia`

**Files:**
- Modify: `apps/content-engine/src/services/processors/adhoc/index.ts`
- Modify: `apps/content-engine/src/services/processors/revision/index.ts`

- [ ] **Step 1: Edit adhoc-processor**

In `apps/content-engine/src/services/processors/adhoc/index.ts`, after the `await generator.generatePost(...)` call, BEFORE the existing `col.updateOne(...)`, add:

```typescript
if (content.pendingMedia && content.mediaJobId) {
  const result = await col.updateOne(
    { _id: postDoc._id, status: 'PENDING_CONTENT' },
    {
      $set: {
        caption: content.caption,
        status: 'PENDING_MEDIA',
        mediaJobId: content.mediaJobId,
        generationStep: content.generationStep ?? 'MEDIA_REQUESTED',
        lastStepAt: new Date().toISOString(),
        updatedAt: new Date(),
      },
    },
  );
  if (result.matchedCount === 0) {
    logger.warn({ postId }, 'Post no longer in PENDING_CONTENT; skipping advance');
    continue;
  }
  logger.info({ postId, mediaJobId: content.mediaJobId }, 'Post advanced to PENDING_MEDIA awaiting fal.ai queue');
  stats.processed++;
  continue;
}
```

(The existing `col.updateOne(...)` writing PENDING_APPROVAL is left intact — the new branch returns early via `continue` for video posts.)

- [ ] **Step 2: Edit revision-processor**

Apply the same pattern to `apps/content-engine/src/services/processors/revision/index.ts` — after `generator.revisePost(...)` returns, check `result.pendingMedia` and write `status=PENDING_MEDIA + mediaJobId + generationStep + lastStepAt`. Reuse the same field set.

- [ ] **Step 3: Verify**

`cd apps/content-engine && npx vitest run tests/integration/adhoc-processor.test.ts tests/unit/revision-processor.test.ts`
Expected: existing tests still green (mocks return non-pendingMedia results so the new branch isn't exercised; that's fine — the e2e test in Task 16 covers it).

---

## Task 11: Implement `media-job-poller/poll-runner.ts` + tests

**Files:**
- Create: `apps/content-engine/src/services/processors/media-job-poller/poll-runner.ts`
- Create: `apps/content-engine/tests/unit/processors/media-job-poller/poll-runner.test.ts`

The poll runner:
1. For one post, fetch its mediaJob row.
2. If job.status === 'RUNNING' and startedAt > 10 min ago: mark FAILED + post FAILED. Done.
3. Else call `media.pollJob(job.jobId)` (queue-aware -- transitions stored record).
4. After pollJob: re-fetch updated job. If COMPLETED -> applyMediaJobResultToPost. If FAILED -> markPostFailedWithMedia. If still RUNNING -> noop.

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const dbMocks = vi.hoisted(() => ({
  applyMediaJobResultToPost: vi.fn(),
  markPostFailedWithMedia: vi.fn(),
}));
vi.mock('@restropulse/db', () => dbMocks);

const { pollMediaJob } = await import(
  '../../../../src/services/processors/media-job-poller/poll-runner.js'
);

beforeEach(() => {
  vi.clearAllMocks();
});

const baseRunningJob = {
  id: 'mj1', jobId: 'job_v1', provider: 'fal-ai' as const,
  modelId: 'fal-ai/kling-video/v1.6/standard/text-to-video',
  postType: 'REEL' as const, status: 'RUNNING' as const,
  providerJobId: 'req_xyz', attempts: 1,
  startedAt: new Date(),
  createdAt: new Date(), updatedAt: new Date(),
};

const post = { id: 'p1', mediaJobId: 'job_v1', restaurantId: 'r1' };

describe('pollMediaJob', () => {
  it('reaps stale RUNNING jobs (>10 min) as FAILED and marks post FAILED', async () => {
    const stale = { ...baseRunningJob, startedAt: new Date(Date.now() - 11 * 60 * 1000) };
    const store = {
      findById: vi.fn(async () => stale),
      updateStatus: vi.fn(async () => ({ ...stale, status: 'FAILED' })),
      insert: vi.fn(), incrementAttempts: vi.fn(),
    };
    const media = { name: 'm', generateImage: vi.fn(), generateVideo: vi.fn(), pollJob: vi.fn() };

    await pollMediaJob(post as any, { store: store as any, media: media as any });

    expect(store.updateStatus).toHaveBeenCalledWith('job_v1', expect.objectContaining({ status: 'FAILED' }));
    expect(media.pollJob).not.toHaveBeenCalled();
    expect(dbMocks.markPostFailedWithMedia).toHaveBeenCalledWith('p1', expect.stringMatching(/stale|10/i));
  });

  it('delegates to media.pollJob for fresh RUNNING jobs', async () => {
    const fresh = { ...baseRunningJob, startedAt: new Date() };
    const store = {
      findById: vi.fn()
        .mockResolvedValueOnce(fresh)               // first lookup
        .mockResolvedValueOnce({ ...fresh, status: 'COMPLETED', mediaUrl: 'https://fal.media/v.mp4' }), // after pollJob
      updateStatus: vi.fn(), insert: vi.fn(), incrementAttempts: vi.fn(),
    };
    const media = {
      name: 'm', generateImage: vi.fn(), generateVideo: vi.fn(),
      pollJob: vi.fn(async () => ({ jobId: 'job_v1', status: 'COMPLETED', mediaUrl: 'https://fal.media/v.mp4' })),
    };
    await pollMediaJob(post as any, { store: store as any, media: media as any });
    expect(media.pollJob).toHaveBeenCalledWith('job_v1');
    expect(dbMocks.applyMediaJobResultToPost).toHaveBeenCalledTimes(1);
  });

  it('no-ops when the job is still RUNNING after pollJob', async () => {
    const fresh = { ...baseRunningJob, startedAt: new Date() };
    const store = {
      findById: vi.fn().mockResolvedValue(fresh),
      updateStatus: vi.fn(), insert: vi.fn(), incrementAttempts: vi.fn(),
    };
    const media = {
      name: 'm', generateImage: vi.fn(), generateVideo: vi.fn(),
      pollJob: vi.fn(async () => ({ jobId: 'job_v1', status: 'RUNNING' })),
    };
    await pollMediaJob(post as any, { store: store as any, media: media as any });
    expect(dbMocks.applyMediaJobResultToPost).not.toHaveBeenCalled();
    expect(dbMocks.markPostFailedWithMedia).not.toHaveBeenCalled();
  });

  it('marks post FAILED when pollJob returns FAILED status', async () => {
    const fresh = { ...baseRunningJob, startedAt: new Date() };
    const store = {
      findById: vi.fn()
        .mockResolvedValueOnce(fresh)
        .mockResolvedValueOnce({ ...fresh, status: 'FAILED', error: 'fal queue FAILED' }),
      updateStatus: vi.fn(), insert: vi.fn(), incrementAttempts: vi.fn(),
    };
    const media = {
      name: 'm', generateImage: vi.fn(), generateVideo: vi.fn(),
      pollJob: vi.fn(async () => ({ jobId: 'job_v1', status: 'FAILED', error: 'fal queue FAILED' })),
    };
    await pollMediaJob(post as any, { store: store as any, media: media as any });
    expect(dbMocks.markPostFailedWithMedia).toHaveBeenCalledWith('p1', expect.stringContaining('fal queue FAILED'));
  });

  it('skips silently when post.mediaJobId is unset', async () => {
    const store = { findById: vi.fn(), updateStatus: vi.fn(), insert: vi.fn(), incrementAttempts: vi.fn() };
    const media = { name: 'm', generateImage: vi.fn(), generateVideo: vi.fn(), pollJob: vi.fn() };
    await pollMediaJob({ id: 'p2' } as any, { store: store as any, media: media as any });
    expect(store.findById).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement `poll-runner.ts`**

```typescript
/**
 * pollMediaJob -- per-post poll runner. Called by the media-job-poller
 * processor for each PENDING_MEDIA post on every tick.
 *
 * State machine on each call:
 *   stored RUNNING + startedAt > 10 min  ->  FAILED, post FAILED
 *   stored RUNNING                        ->  delegate to media.pollJob
 *   after delegate: RUNNING               ->  no-op
 *   after delegate: COMPLETED             ->  applyMediaJobResultToPost
 *   after delegate: FAILED                ->  markPostFailedWithMedia
 *   stored COMPLETED                      ->  applyMediaJobResultToPost (idempotent)
 *   stored FAILED                         ->  markPostFailedWithMedia (idempotent)
 */

import { createLogger } from '@restropulse/telemetry/server';
import {
  applyMediaJobResultToPost,
  markPostFailedWithMedia,
} from '@restropulse/db';
import type { Post } from '@restropulse/shared';
import type { IMediaJobStore } from '../../content-generator/backends/ai/media/jobs/types.js';
import type { IMediaGenerator } from '../../content-generator/backends/ai/media/types.js';

const log = createLogger('media-job-poller');

const STALE_RUNNING_BUDGET_MS = 10 * 60 * 1000;  // 10 min

export interface PollRunnerDeps {
  store: IMediaJobStore;
  media: IMediaGenerator;
}

export async function pollMediaJob(post: Post, deps: PollRunnerDeps): Promise<void> {
  if (!post.mediaJobId) {
    log.debug({ postId: post.id }, 'Post has no mediaJobId; skipping');
    return;
  }

  const before = await deps.store.findById(post.mediaJobId);
  if (!before) {
    log.warn({ postId: post.id, mediaJobId: post.mediaJobId }, 'Post references missing mediaJob; marking FAILED');
    await markPostFailedWithMedia(post.id, 'mediaJob row missing');
    return;
  }

  // Reap stale RUNNING jobs (no progress for >10 min)
  if (before.status === 'RUNNING') {
    const ageMs = Date.now() - new Date(before.startedAt).getTime();
    if (ageMs > STALE_RUNNING_BUDGET_MS) {
      log.warn({ jobId: before.jobId, ageMs }, 'Reaping stale RUNNING job as FAILED');
      await deps.store.updateStatus(before.jobId, {
        status: 'FAILED',
        error: `stale RUNNING -- exceeded ${STALE_RUNNING_BUDGET_MS / 1000}s budget`,
        completedAt: new Date(),
        lastPolledAt: new Date(),
      });
      await markPostFailedWithMedia(post.id, `stale RUNNING -- exceeded 10 minute budget`);
      return;
    }
    // Delegate to the media generator's pollJob (queue-aware).
    await deps.media.pollJob(before.jobId);
  }

  // Read the (possibly updated) job state.
  const after = await deps.store.findById(post.mediaJobId);
  if (!after) return;

  if (after.status === 'COMPLETED') {
    await applyMediaJobResultToPost(post.id, after);
    log.info({ postId: post.id, jobId: after.jobId }, 'Post advanced to PENDING_APPROVAL');
    return;
  }
  if (after.status === 'FAILED') {
    await markPostFailedWithMedia(post.id, after.error ?? 'unknown media-job failure');
    log.warn({ postId: post.id, jobId: after.jobId, err: after.error }, 'Post marked FAILED from media-job poll');
    return;
  }
  // Still RUNNING / PENDING -- next tick will revisit.
}
```

- [ ] **Step 3: Verify**

PASS, 5 assertions.

---

## Task 12: Implement `media-job-poller/index.ts` (IProcessor) + tests

**Files:**
- Create: `apps/content-engine/src/services/processors/media-job-poller/index.ts`
- Create: `apps/content-engine/tests/unit/processors/media-job-poller/index.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const dbMocks = vi.hoisted(() => ({
  findAllPendingMediaPosts: vi.fn().mockResolvedValue([
    { id: 'p1', mediaJobId: 'j1' },
    { id: 'p2', mediaJobId: 'j2' },
    { id: 'p3' /* no mediaJobId */ },
  ]),
}));
vi.mock('@restropulse/db', () => dbMocks);

const pollMediaJobMock = vi.fn();
vi.mock('../../../../src/services/processors/media-job-poller/poll-runner.js', () => ({
  pollMediaJob: pollMediaJobMock,
}));

const {
  processMediaJobs,
  createMediaJobPollerProcessor,
} = await import('../../../../src/services/processors/media-job-poller/index.js');

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.findAllPendingMediaPosts.mockResolvedValue([
    { id: 'p1', mediaJobId: 'j1' },
    { id: 'p2', mediaJobId: 'j2' },
    { id: 'p3' /* no mediaJobId -- pollMediaJob skips */ },
  ]);
});

describe('media-job-poller processor', () => {
  it('createMediaJobPollerProcessor returns IProcessor with name + cron + run', () => {
    const p = createMediaJobPollerProcessor('*/30 * * * * *', { store: {} as any, media: {} as any });
    expect(p.name).toBe('media-job-poller');
    expect(p.cron).toBe('*/30 * * * * *');
    expect(typeof p.run).toBe('function');
  });

  it('processMediaJobs invokes pollMediaJob for every PENDING_MEDIA post', async () => {
    const deps = { store: {} as any, media: {} as any };
    await processMediaJobs(deps);
    expect(pollMediaJobMock).toHaveBeenCalledTimes(3);
  });

  it('a single post failure does not stop the loop', async () => {
    pollMediaJobMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);
    const deps = { store: {} as any, media: {} as any };
    await processMediaJobs(deps);
    expect(pollMediaJobMock).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: Implement**

```typescript
/**
 * media-job-poller -- IProcessor that runs every 30s, finds posts in
 * PENDING_MEDIA, and delegates each to pollMediaJob. Per-post failures are
 * caught + logged so one bad job doesn't stop the loop.
 */

import { createLogger } from '@restropulse/telemetry/server';
import { findAllPendingMediaPosts } from '@restropulse/db';
import type { IProcessor } from '../types.js';
import { pollMediaJob, type PollRunnerDeps } from './poll-runner.js';

const log = createLogger('media-job-poller');

export async function processMediaJobs(deps: PollRunnerDeps): Promise<void> {
  const posts = await findAllPendingMediaPosts();
  log.info({ count: posts.length }, 'media-job-poller tick');
  for (const post of posts) {
    try {
      await pollMediaJob(post, deps);
    } catch (err) {
      log.error({ err, postId: post.id }, 'pollMediaJob threw; continuing with next post');
    }
  }
}

export function createMediaJobPollerProcessor(
  cron: string,
  deps: PollRunnerDeps,
): IProcessor {
  return {
    name: 'media-job-poller',
    cron,
    run: () => processMediaJobs(deps),
  };
}
```

- [ ] **Step 3: Re-export from `services/processors/index.ts`** (append):

```typescript
export {
  createMediaJobPollerProcessor,
} from './media-job-poller/index.js';
```

- [ ] **Step 4: Verify**

`cd apps/content-engine && npx vitest run tests/unit/processors/media-job-poller`
Expected: 8 assertions across 2 files green.

---

## Task 13: Wire factory + worker to register the poller when `MEDIA_BACKEND=fal-ai`

**Files:**
- Modify: `apps/content-engine/src/services/content-generator/factory.ts`
- Modify: `apps/content-engine/src/services/content-generator/index.ts`
- Modify: `apps/content-engine/src/worker.ts`

- [ ] **Step 1: Factory exposes the last-built media + store**

In `factory.ts`, mirror the `lastAiCurrentAffairs` pattern. Add module-level state and a getter:

```typescript
let lastAiMediaJobStore: import('./backends/ai/media/jobs/types.js').IMediaJobStore | null = null;
let lastAiMediaGenerator: import('./backends/ai/media/types.js').IMediaGenerator | null = null;

export function getLastAiMediaJobStore() {
  return lastAiMediaJobStore;
}

export function getLastAiMediaGenerator() {
  return lastAiMediaGenerator;
}
```

Update `buildMediaGeneratorForFactory` so it stores the references when `fal-ai`:

```typescript
function buildMediaGeneratorForFactory(): IMediaGenerator {
  const backend = readMediaBackend();
  if (backend === 'fal-ai') {
    const apiKey = process.env.FAL_API_KEY;
    if (!apiKey) {
      throw new Error('FAL_API_KEY is required when MEDIA_BACKEND=fal-ai.');
    }
    const store = new MongoMediaJobStore();
    const media = new FalAIMediaGenerator({ client: new FalClient({ apiKey }), store });
    lastAiMediaJobStore = store;
    lastAiMediaGenerator = media;
    return media;
  }
  lastAiMediaJobStore = null;
  lastAiMediaGenerator = null;
  return new PlaceholderMediaGenerator();
}
```

The `'placeholder'` case in `createContentGenerator` should also reset both to null.

- [ ] **Step 2: Re-export from `content-generator/index.ts`**

```typescript
export {
  createContentGenerator,
  getLastAiCurrentAffairsProvider,
  getLastAiMediaJobStore,
  getLastAiMediaGenerator,
} from './factory.js';
```

- [ ] **Step 3: Update `worker.ts`**

Add to imports:

```typescript
import {
  createAdhocProcessor,
  createStrategyProcessor,
  createRollingWindowProcessor,
  createRevisionProcessor,
  createDeadlineProcessor,
  createCycleSyncProcessor,
  createCurrentAffairsRefreshProcessor,
  createMediaJobPollerProcessor,
  type IProcessor,
} from './services/processors/index.js';
import {
  createContentGenerator,
  getLastAiCurrentAffairsProvider,
  getLastAiMediaJobStore,
  getLastAiMediaGenerator,
  setContentGenerator,
  type ContentGeneratorBackend,
} from './services/content-generator/index.js';
```

Add to env schema:

```typescript
    CRON_MEDIA_JOB_POLLER: z.string().default('*/30 * * * * *'),
```

After the existing current-affairs-refresh registration block, add:

```typescript
    const aiMediaStore = getLastAiMediaJobStore();
    const aiMediaGen = getLastAiMediaGenerator();
    if (aiMediaStore && aiMediaGen) {
      processors.push(createMediaJobPollerProcessor(env.CRON_MEDIA_JOB_POLLER, {
        store: aiMediaStore,
        media: aiMediaGen,
      }));
      logger.info(
        { cron: env.CRON_MEDIA_JOB_POLLER },
        'media-job-poller processor registered',
      );
    }
```

- [ ] **Step 4: Type-check + smoke**

`rtk npm run type-check --workspace=@restropulse/content-engine` -> exit 0.

```
cd apps/content-engine && CONTENT_GENERATOR_BACKEND=ai ANTHROPIC_API_KEY=sk-fake GOOGLE_CALENDAR_API_KEY=cal-fake MEDIA_BACKEND=fal-ai FAL_API_KEY=fal-fake npx tsx --eval "import('./src/services/content-generator/factory.js').then(m => { m.createContentGenerator('ai'); console.log('store:', m.getLastAiMediaJobStore() ? 'set' : 'null', 'media:', m.getLastAiMediaGenerator()?.name); }).catch(e => { console.error(e.message); process.exit(1); })"
```
Expected: `store: set media: fal-ai`

---

## Task 14: Checkpoint B wrap

- [ ] **Step 1: Run all phase-5 + regression tests**

`cd apps/content-engine && npx vitest run`
Expected: ~52 files / ~390 assertions, all green.

`rtk npm run type-check --workspace=@restropulse/content-engine` -> exit 0.

- [ ] **Step 2: Show user, request approval to proceed to Checkpoint C**

`rtk git status`. **STOP. Tell the user: "Phase 5 Checkpoint B complete - video submission + media-job-poller + factory wiring. Approve continuing to Checkpoint C (post-resume + e2e + commit)?"** Wait for approval.

---

# CHECKPOINT C - Crash-safe resume + e2e + commit

## Task 15: `services/post-resume.ts` + tests

**Files:**
- Create: `apps/content-engine/src/services/post-resume.ts`
- Create: `apps/content-engine/tests/unit/post-resume.test.ts`

The boot scan finds posts whose `lastStepAt` is older than 5 min and triggers a single poll for each. Reuses `pollMediaJob` so the state machine matches the cron path.

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const dbMocks = vi.hoisted(() => ({
  findStalePendingMediaPosts: vi.fn(),
}));
vi.mock('@restropulse/db', () => dbMocks);

const pollMediaJobMock = vi.fn();
vi.mock('../../src/services/processors/media-job-poller/poll-runner.js', () => ({
  pollMediaJob: pollMediaJobMock,
}));

const { runPostResumeOnBoot } = await import('../../src/services/post-resume.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runPostResumeOnBoot', () => {
  it('polls every stale PENDING_MEDIA post', async () => {
    dbMocks.findStalePendingMediaPosts.mockResolvedValueOnce([
      { id: 'p1', mediaJobId: 'j1' },
      { id: 'p2', mediaJobId: 'j2' },
    ]);
    await runPostResumeOnBoot({ store: {} as any, media: {} as any });
    expect(pollMediaJobMock).toHaveBeenCalledTimes(2);
  });

  it('no-ops when there are no stale posts', async () => {
    dbMocks.findStalePendingMediaPosts.mockResolvedValueOnce([]);
    await runPostResumeOnBoot({ store: {} as any, media: {} as any });
    expect(pollMediaJobMock).not.toHaveBeenCalled();
  });

  it('one failed poll does not stop the loop', async () => {
    dbMocks.findStalePendingMediaPosts.mockResolvedValueOnce([
      { id: 'a', mediaJobId: 'j1' },
      { id: 'b', mediaJobId: 'j2' },
    ]);
    pollMediaJobMock
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValueOnce(undefined);
    await runPostResumeOnBoot({ store: {} as any, media: {} as any });
    expect(pollMediaJobMock).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Implement**

```typescript
/**
 * runPostResumeOnBoot -- worker startup scan that picks up posts stuck in
 * PENDING_MEDIA after a crash. Idempotent: pollMediaJob is the same call the
 * media-job-poller cron makes every 30s, so re-running on boot just gets the
 * post one tick early.
 */

import { createLogger } from '@restropulse/telemetry/server';
import { findStalePendingMediaPosts } from '@restropulse/db';
import {
  pollMediaJob,
  type PollRunnerDeps,
} from './processors/media-job-poller/poll-runner.js';

const log = createLogger('post-resume');

const STALE_BOOT_BUDGET_MS = 5 * 60 * 1000;  // 5 min

export async function runPostResumeOnBoot(deps: PollRunnerDeps): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_BOOT_BUDGET_MS);
  const stalePosts = await findStalePendingMediaPosts(cutoff);
  log.info({ count: stalePosts.length, cutoff: cutoff.toISOString() }, 'post-resume scan');
  for (const post of stalePosts) {
    try {
      await pollMediaJob(post, deps);
    } catch (err) {
      log.error({ err, postId: post.id }, 'post-resume pollMediaJob threw; continuing');
    }
  }
}
```

- [ ] **Step 3: Wire into `worker.ts`**

After the processors loop registers everything, add:

```typescript
    if (aiMediaStore && aiMediaGen) {
      // Best-effort -- failures don't block worker boot.
      runPostResumeOnBoot({ store: aiMediaStore, media: aiMediaGen }).catch((err) => {
        logger.error({ err }, 'post-resume scan failed');
      });
    }
```

(Add `import { runPostResumeOnBoot } from './services/post-resume.js';` to the top.)

- [ ] **Step 4: Verify**

PASS, 3 assertions.

---

## Task 16: End-to-end video flow integration test

**Files:**
- Create: `apps/content-engine/tests/integration/video-flow-end-to-end.test.ts`

Real Mongo (posts + mediaJobs collections), mocked fal queue API. Submits a REEL post via the AIContentGenerator + adhoc-processor flow. Then runs the poller twice (RUNNING -> COMPLETED). Asserts post lands in PENDING_APPROVAL with videoUrl set.

- [ ] **Step 1: Create the test**

```typescript
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { setDB, createPost, findPostById } from '@restropulse/db';

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
const { processMediaJobs } = await import(
  '../../src/services/processors/media-job-poller/index.js'
);

let mongod: MongoMemoryServer;
let client: MongoClient;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongod.getUri());
  setDB(client.db('video-e2e-test'));
}, 60000);

afterAll(async () => {
  await client.close();
  await mongod.stop();
}, 20000);

beforeEach(async () => {
  await client.db('video-e2e-test').collection('posts').deleteMany({});
  await client.db('video-e2e-test').collection('mediaJobs').deleteMany({});
  await client.db('video-e2e-test').collection('costEvents').deleteMany({});
});

describe('Video flow end-to-end (submit -> poll -> COMPLETED)', () => {
  it('REEL post: submit lands in PENDING_MEDIA, two poll ticks transition to PENDING_APPROVAL', async () => {
    // Seed a PENDING_CONTENT REEL post
    const seeded = await createPost({
      type: 'REEL',
      status: 'PENDING_CONTENT',
      thumbnail: '',
      caption: 'kitchen close-up',
      platforms: ['INSTAGRAM'],
      restaurantId: 'r-vid',
    });

    // LLM mock for caption
    const generateObject = vi.fn().mockResolvedValue({
      object: { caption: 'A warm kitchen reel', suggestedHashtags: ['#kitchen'] },
      usage: { inputTokens: 80, outputTokens: 40 },
      modelId: 'claude-haiku-4-5-20251001',
    });

    // fetch mock: queue submit then status (IN_PROGRESS -> COMPLETED) then result
    let stage: 'submit' | 'status1' | 'status2' | 'result' = 'submit';
    fetchMock.mockImplementation(async (url: string, _init?: any) => {
      if (typeof url === 'string' && url.endsWith('/text-to-video') && stage === 'submit') {
        stage = 'status1';
        return { ok: true, status: 200, json: async () => ({ request_id: 'req_e2e' }) };
      }
      if (typeof url === 'string' && url.endsWith('/status')) {
        if (stage === 'status1') {
          stage = 'status2';
          return { ok: true, status: 200, json: async () => ({ status: 'IN_PROGRESS' }) };
        }
        if (stage === 'status2') {
          stage = 'result';
          return { ok: true, status: 200, json: async () => ({ status: 'COMPLETED' }) };
        }
      }
      if (typeof url === 'string' && url.includes('/requests/req_e2e') && !url.endsWith('/status') && stage === 'result') {
        return { ok: true, status: 200, json: async () => ({ video: { url: 'https://fal.media/done.mp4' } }) };
      }
      throw new Error(`Unexpected fetch in stage ${stage} for ${url}`);
    });

    const falClient = new FalClient({ apiKey: 'fal-fake' });
    const store = new MongoMediaJobStore();
    const media = new FalAIMediaGenerator({ client: falClient, store });
    const gen = new AIContentGenerator({
      specialization: new RestaurantSpecialization(),
      llm: { name: 'mock-llm', generateObject },
      media,
    });

    // 1. Submit (caption + queue)
    const result = await gen.generatePost(
      { concept: 'kitchen close-up', type: 'REEL', platforms: ['INSTAGRAM'], cycleId: undefined },
      { restaurantId: 'r-vid' },
    );
    expect(result.pendingMedia).toBe(true);
    expect(result.mediaJobId).toBeTruthy();

    // 2. Simulate adhoc-processor's PENDING_MEDIA write
    await client.db('video-e2e-test').collection('posts').updateOne(
      { _id: { $eq: (await client.db('video-e2e-test').collection('posts').findOne({}))!._id } },
      {
        $set: {
          status: 'PENDING_MEDIA',
          mediaJobId: result.mediaJobId,
          generationStep: 'MEDIA_REQUESTED',
          lastStepAt: new Date().toISOString(),
        },
      },
    );

    // 3. First poller tick -- still IN_PROGRESS
    await processMediaJobs({ store, media });
    let updated = await findPostById(seeded.id);
    expect(updated!.status).toBe('PENDING_MEDIA');

    // 4. Second poller tick -- COMPLETED
    await processMediaJobs({ store, media });
    updated = await findPostById(seeded.id);
    expect(updated!.status).toBe('PENDING_APPROVAL');
    expect(updated!.videoUrl).toBe('https://fal.media/done.mp4');
    expect(updated!.generationStep).toBe('MEDIA_DONE');
  });
});
```

- [ ] **Step 2: Verify**

`cd apps/content-engine && npx vitest run tests/integration/video-flow-end-to-end.test.ts`
Expected: PASS.

---

## Task 17: Stale-job recovery integration test

**Files:**
- Create: `apps/content-engine/tests/integration/stale-job-recovery.test.ts`

- [ ] **Step 1: Create the test**

```typescript
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import {
  setDB,
  createPost,
  findPostById,
  insertMediaJob,
  findMediaJobById,
} from '@restropulse/db';

vi.mock('@restropulse/telemetry/server', () => {
  const noopLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    createLogger: vi.fn(() => noopLogger),
    initServerTelemetry: vi.fn(),
    shutdownServerTelemetry: vi.fn(),
    trackAIUsage: vi.fn(),
  };
});

const { processMediaJobs } = await import(
  '../../src/services/processors/media-job-poller/index.js'
);
const { FalAIMediaGenerator, MongoMediaJobStore } = await import(
  '../../src/services/content-generator/backends/ai/index.js'
);

let mongod: MongoMemoryServer;
let client: MongoClient;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongod.getUri());
  setDB(client.db('stale-recovery-test'));
}, 60000);

afterAll(async () => {
  await client.close();
  await mongod.stop();
}, 20000);

beforeEach(async () => {
  await client.db('stale-recovery-test').collection('posts').deleteMany({});
  await client.db('stale-recovery-test').collection('mediaJobs').deleteMany({});
});

describe('Stale-job recovery', () => {
  it('reaps a RUNNING job older than 10 min as FAILED and marks the post FAILED', async () => {
    const post = await createPost({
      type: 'REEL', status: 'PENDING_MEDIA',
      thumbnail: '', caption: 'old', platforms: ['INSTAGRAM'],
      restaurantId: 'r-stale',
      mediaJobId: 'job_stale',
      lastStepAt: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
    });

    // Insert a stale RUNNING job (started 11 min ago)
    await insertMediaJob({
      jobId: 'job_stale',
      providerJobId: 'req_stale',
      provider: 'fal-ai',
      modelId: 'fal-ai/kling-video/v1.6/standard/text-to-video',
      postType: 'REEL',
      status: 'RUNNING',
      attempts: 1,
      restaurantId: 'r-stale',
      postId: post.id,
      startedAt: new Date(Date.now() - 11 * 60 * 1000),
    });

    // Run the poller -- the runner should reap stale jobs WITHOUT calling fal
    const noFetchClient = { generateImage: vi.fn(), editImage: vi.fn(), submitToQueue: vi.fn(), getQueueStatus: vi.fn(), getQueueResult: vi.fn() };
    const store = new MongoMediaJobStore();
    const media = new FalAIMediaGenerator({ client: noFetchClient as any, store });

    await processMediaJobs({ store, media });

    const updatedJob = await findMediaJobById('job_stale');
    expect(updatedJob!.status).toBe('FAILED');
    expect(updatedJob!.error).toMatch(/stale|10/i);

    const updatedPost = await findPostById(post.id);
    expect(updatedPost!.status).toBe('MISSED_DEADLINE');
    expect(updatedPost!.publishError).toContain('media-generation');

    expect(noFetchClient.getQueueStatus).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Verify** -> PASS.

---

## Task 18: Final regression sweep + smoke tests

- [ ] **Step 1: Full content-engine suite**

`cd apps/content-engine && npx vitest run`
Expected: ~55 test files / ~415 assertions, all green.

- [ ] **Step 2: Monorepo type-check**

`rtk npm run type-check`
Expected: exit 0.

- [ ] **Step 3: Smoke - factory builds full chain with poller**

```
cd apps/content-engine && CONTENT_GENERATOR_BACKEND=ai ANTHROPIC_API_KEY=sk-fake GOOGLE_CALENDAR_API_KEY=cal-fake MEDIA_BACKEND=fal-ai FAL_API_KEY=fal-fake npx tsx --eval "import('./src/services/content-generator/factory.js').then(m => { m.createContentGenerator('ai'); console.log('store:', m.getLastAiMediaJobStore() ? 'set' : 'null', 'media:', m.getLastAiMediaGenerator()?.name); }).catch(e => { console.error(e.message); process.exit(1); })"
```
Expected: `store: set media: fal-ai`

- [ ] **Step 4: Smoke - placeholder default has no store**

```
cd apps/content-engine && CONTENT_GENERATOR_BACKEND=ai ANTHROPIC_API_KEY=sk-fake GOOGLE_CALENDAR_API_KEY=cal-fake npx tsx --eval "import('./src/services/content-generator/factory.js').then(m => { m.createContentGenerator('ai'); console.log('store:', m.getLastAiMediaJobStore() ? 'set' : 'null'); }).catch(e => { console.error(e.message); process.exit(1); })"
```
Expected: `store: null`

---

## Task 19: Stage all phase-5 files

- [ ] **Step 1: Stage**

```
rtk git add \
  packages/shared/src/index.ts \
  packages/db/src/posts.ts \
  apps/content-engine/src/services/content-generator/types.ts \
  apps/content-engine/src/services/content-generator/factory.ts \
  apps/content-engine/src/services/content-generator/index.ts \
  apps/content-engine/src/services/content-generator/backends/ai/media/fal-ai/fal-client.ts \
  apps/content-engine/src/services/content-generator/backends/ai/media/fal-ai/fal-ai-media-generator.ts \
  apps/content-engine/src/services/content-generator/backends/ai/media/fal-ai/models.ts \
  apps/content-engine/src/services/content-generator/backends/ai/media/fal-ai/pricing.ts \
  apps/content-engine/src/services/content-generator/backends/ai/media/fal-ai/queue-types.ts \
  apps/content-engine/src/services/content-generator/backends/ai/pipeline/generate-post.ts \
  apps/content-engine/src/services/processors/adhoc/index.ts \
  apps/content-engine/src/services/processors/revision/index.ts \
  apps/content-engine/src/services/processors/index.ts \
  apps/content-engine/src/services/processors/media-job-poller \
  apps/content-engine/src/services/post-resume.ts \
  apps/content-engine/src/worker.ts \
  apps/content-engine/tests/integration/post-helpers-phase5.test.ts \
  apps/content-engine/tests/integration/video-flow-end-to-end.test.ts \
  apps/content-engine/tests/integration/stale-job-recovery.test.ts \
  apps/content-engine/tests/unit/content-generator/backends/ai/media/fal-ai/queue-api.test.ts \
  apps/content-engine/tests/unit/content-generator/backends/ai/media/fal-ai/pricing.test.ts \
  apps/content-engine/tests/unit/content-generator/backends/ai/media/fal-ai/fal-ai-media-generator.test.ts \
  apps/content-engine/tests/unit/content-generator/backends/ai/pipeline/generate-post.test.ts \
  apps/content-engine/tests/unit/processors/media-job-poller \
  apps/content-engine/tests/unit/post-resume.test.ts \
  docs/superpowers/plans/2026-05-03-content-engine-ai-phase-5.md

rtk git status
rtk git diff --staged --stat
```

## Task 20: STOP for commit approval, then commit

**STOP. Show user staged status + stat. Ask: "Phase 5 complete - REEL/VIDEO posts now route through fal.ai queue API with durable polling + crash-safe resume. Default behavior unchanged. Approve committing as a single phase-5 commit?"**

After explicit user approval:

```
rtk git commit -m "$(cat <<'EOF'
feat(content-engine): wire fal.ai video generation with durable polling and crash-safe resume

Phase 5 of the content-engine AI rollout per ADR 0001 sections 4.3 + 4.4.
REEL/VIDEO posts no longer fail with BACKEND_UNAVAILABLE when MEDIA_BACKEND=fal-ai;
they now go through a non-blocking queue submit + polling state machine.

Schema: + PostStatus.PENDING_MEDIA, + Post.mediaJobId, + Post.generationStep,
+ Post.lastStepAt. New @restropulse/db helpers: findStalePendingMediaPosts,
findAllPendingMediaPosts, setPostMediaJobReference, advanceGenerationStep,
applyMediaJobResultToPost, markPostFailedWithMedia.

FalClient extended with the queue API (submitToQueue, getQueueStatus,
getQueueResult against https://queue.fal.run/<model>). Refactored shared
HTTP plumbing into private fetchJson + authHeaders helpers.

FAL_MODELS gains klingVideo (fal-ai/kling-video/v1.6/standard/text-to-video,
default) and minimaxVideo. Pricing at \$0.30/Kling call, \$0.40/MiniMax call.

FalAIMediaGenerator.generateVideo now:
1. Submits via queue API (cost event written at submission time, surface=video,
   step=video-submit).
2. Inserts a MediaJobRecord with status=RUNNING, providerJobId, attempts=1.
3. Returns immediately with status=RUNNING -- caller treats this as
   pendingMedia.

pollJob is queue-aware: if the stored record is RUNNING, it polls the fal
queue, transitions COMPLETED/FAILED in the store, fetches the final result
URL when COMPLETED.

pipeline/generate-post.ts video branch: returns GeneratedPost with
pendingMedia=true, mediaJobId, generationStep=MEDIA_REQUESTED. The thumbnail
is filled in by the poller when the job completes.

Adhoc + revision processors: detect pendingMedia and write the post with
status=PENDING_MEDIA (instead of PENDING_APPROVAL), storing the mediaJobId.

New media-job-poller IProcessor (default: every 30s, configurable via
CRON_MEDIA_JOB_POLLER):
- Iterates every PENDING_MEDIA post.
- Per post, runs pollMediaJob: reaps stale RUNNING jobs (>10 min) as FAILED,
  otherwise delegates to media.pollJob, then transitions the post on
  COMPLETED (-> PENDING_APPROVAL via applyMediaJobResultToPost) or FAILED
  (-> MISSED_DEADLINE via markPostFailedWithMedia).
- Single-post failures don't stop the loop.

Crash-safe resume: services/post-resume.ts runs once on worker boot when
MEDIA_BACKEND=fal-ai; finds posts with status=PENDING_MEDIA + lastStepAt
older than 5 min and triggers one pollMediaJob per post. Idempotent (matches
the cron path).

Worker.ts registers the poller cron and the resume scan only when
MEDIA_BACKEND=fal-ai. Default MEDIA_BACKEND=placeholder remains untouched.

Tests: 6 new unit test files (queue-api, fal-ai-media-generator video cases,
generate-post phase-5 update, poll-runner, media-job-poller index,
post-resume) + 3 new integration tests using mongodb-memory-server (post
helpers, video flow e2e, stale-job recovery). All prior 362 tests continue
to pass; suite total ~415.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
rtk git status
rtk git log --oneline -8
```

---

## Self-Review

**Spec coverage** (against phase 5 brainstorm):
- PENDING_MEDIA + Post.mediaJobId + generationStep + lastStepAt -> Task 1
- DB helpers for the new state machine -> Tasks 2, 3
- fal.ai queue API client -> Task 5
- Video models + pricing -> Task 4
- FalAIMediaGenerator video submit (queue + RUNNING return) -> Task 7
- pollJob queue-aware -> Task 7
- GeneratedPost.pendingMedia discriminator -> Task 8
- pipeline video branch with checkpoints -> Task 9
- adhoc + revision processors handle pendingMedia -> Task 10
- pollMediaJob runner (state machine + stale reaping) -> Task 11
- media-job-poller IProcessor -> Task 12
- Factory exposes store + media; worker registers poller when MEDIA_BACKEND=fal-ai -> Task 13
- Crash-safe resume on boot -> Task 15
- End-to-end video flow integration test -> Task 16
- Stale-job recovery integration test -> Task 17
- Smoke tests for full chain + placeholder default -> Task 18

**Placeholder scan**: searched plan for "TBD", "implement later", "fill in", "appropriate error handling", "similar to Task". None present. Every code block contains real code.

**Type consistency**:
- `MediaJobRecord` shape unchanged from phase 4 (already had attempts, providerJobId, etc.). Phase 5 just writes new transitions.
- `PollRunnerDeps = { store: IMediaJobStore; media: IMediaGenerator }` consistent across pollMediaJob, processMediaJobs, runPostResumeOnBoot.
- `IProcessor` shape `{ name, cron, run() }` matches the standardized contract.
- `GenerationStep` enum shared across @restropulse/shared, GeneratedPost (in content-generator/types.ts), and the @restropulse/db helpers.
- `getLastAiMediaJobStore` and `getLastAiMediaGenerator` mirror the `getLastAiCurrentAffairsProvider` pattern from phase 3.
- `applyMediaJobResultToPost` writes `videoUrl` for REEL/VIDEO post types (matches the existing Post.videoUrl field) and `mediaUrls` for CAROUSEL.

**Cross-cutting notes**:
- Plain ASCII only.
- `rtk` for shell, NOT for vitest (`npx vitest` directly).
- `import type` for type-only imports.
- ESM `.js` extensions in import paths.
- Do not commit between tasks; final commit at Task 20.
- Default behavior remains placeholder backend; phase 5 only kicks in when MEDIA_BACKEND=fal-ai.
- After modifying packages/shared or packages/db, build the workspace before running content-engine tests.
