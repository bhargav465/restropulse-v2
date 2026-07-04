# Content-Engine AI - Phase 6: Observability Dashboards + Docs + Cutover Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out the content-engine AI rollout per ADR 0001. Deliverables: two Azure Monitor Workbooks for per-restaurant cost dashboards + per-post audit, comprehensive docs updates (INFRASTRUCTURE.md, ARCHITECTURE.md, new ROLLOUT.md), and CLAUDE.md/copilot-instructions.md updates so future AI assistants understand the AI backend layout. Also includes a small telemetry patch so workbook KQL queries can filter by `restaurantId`/`surface`/`step` (those fields exist on cost events but aren't yet in App Insights `customEvents` properties).

**Architecture impact:** Minimal source change — `trackAIUsage` in `packages/telemetry` and `withCostTracking` in `apps/content-engine` get extended to forward additional label dimensions. Default behavior unchanged either way (the new properties are additive on the event payload).

**Tech Stack:** TypeScript (strict, ESM), Vitest, Azure Monitor Workbook JSON template format, Markdown for docs.

---

## Phase 6 Checkpoints

Single checkpoint, one final commit at the end. Tasks 1-2 are the small telemetry patch; tasks 3-8 are docs + workbooks; task 9 is the commit gate.

---

## File Structure

### New files

```
infra/workbooks/
  cost-by-restaurant.workbook.json    Azure Monitor Workbook: stacked-bar cost per restaurant per month
  per-post-audit.workbook.json        Azure Monitor Workbook: parameterized by postId, timeline of API calls

docs/
  CONTENT_ENGINE_AI_ROLLOUT.md        Feature-flag rollout runbook with per-stage env vars + monitoring

apps/content-engine/tests/unit/content-generator/backends/ai/with-cost-tracking-labels.test.ts
                                       Asserts withCostTracking forwards new labels to trackAIUsage
```

### Modified files

```
packages/telemetry/src/server/ai-tracker.ts                                         + restaurantId / postId / cycleId / surface / step in trackEvent properties
apps/content-engine/src/services/content-generator/backends/ai/with-cost-tracking.ts thread additional labels through to trackAIUsage
apps/content-engine/tests/unit/content-generator/backends/ai/with-cost-tracking.test.ts assert additional labels are forwarded

docs/INFRASTRUCTURE.md                  + Content Engine AI section: env vars, cron schedules, collections, costs
docs/ARCHITECTURE.md                    + AI backend section with text diagram, links to ADR 0001
CLAUDE.md                               + AI backend overview pointing at backends/ai/ subdirs and rollout doc
.github/copilot-instructions.md         same
```

---

# CHECKPOINT - All in one (single commit)

## Task 1: Patch `trackAIUsage` to include richer label dimensions

**Files:**
- Modify: `packages/telemetry/src/server/ai-tracker.ts`

The current `trackEvent` call only forwards `model`, `operation`, `inputTokens`, `outputTokens`, `costUsd`, `durationMs`, `postType`. The cost-by-restaurant workbook needs `restaurantId`/`postId`/`cycleId`/`surface`/`step` to filter and group correctly.

- [ ] **Step 1: Extend `AIUsage` interface and event properties**

Replace the `AIUsage` interface and `trackAIUsage` function body in `packages/telemetry/src/server/ai-tracker.ts` with:

```typescript
export interface AIUsage {
    model: string;
    operation: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    durationMs: number;
    postType?: string;
    restaurantId?: string;
    // Phase 6 -- additional dimensions for per-restaurant cost dashboards
    postId?: string;
    cycleId?: string;
    surface?: string;        // 'llm' | 'image' | 'video' | 'sonar' | 'calendar'
    step?: string;           // e.g. 'caption', 'image', 'video-submit', 'daily', 'trigger'
}

export function trackAIUsage(usage: AIUsage): void {
    const labels = { model: usage.model, operation: usage.operation };

    aiMetrics.requestDuration.record(usage.durationMs, labels);
    aiMetrics.tokensInput.add(usage.inputTokens, labels);
    aiMetrics.tokensOutput.add(usage.outputTokens, labels);
    aiMetrics.costUsd.add(usage.costUsd, labels);

    trackEvent(EventNames.AI_REQUEST_COMPLETED, {
        model: usage.model,
        operation: usage.operation,
        inputTokens: String(usage.inputTokens),
        outputTokens: String(usage.outputTokens),
        costUsd: String(usage.costUsd),
        durationMs: String(usage.durationMs),
        postType: usage.postType ?? '',
        restaurantId: usage.restaurantId ?? '',
        postId: usage.postId ?? '',
        cycleId: usage.cycleId ?? '',
        surface: usage.surface ?? '',
        step: usage.step ?? '',
    });
}
```

- [ ] **Step 2: Build + type-check telemetry**

```
rtk npm run build --workspace=@restropulse/telemetry
rtk npm run type-check --workspace=@restropulse/telemetry
```
Both exit 0.

---

## Task 2: Thread `surface`/`step`/`postId`/`cycleId` through `withCostTracking`

**Files:**
- Modify: `apps/content-engine/src/services/content-generator/backends/ai/with-cost-tracking.ts`
- Modify: `apps/content-engine/tests/unit/content-generator/backends/ai/with-cost-tracking.test.ts`

`withCostTracking` already receives `restaurantId`/`postId`/`cycleId`/`operation`/`surface`/`step`/`model` in its `CostTrackingLabels`. It currently only forwards `model`/`operation`/`inputTokens`/`outputTokens`/`costUsd`/`durationMs`/`restaurantId` to `trackAIUsage`. Forward the rest.

- [ ] **Step 1: Update existing test to assert all labels reach trackAIUsage**

In `with-cost-tracking.test.ts`, find the existing test `'forwards the success metric to trackAIUsage'` and extend its assertions:

```typescript
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
  // Phase 6 -- additional dimensions
  expect(usage.postId).toBe('p1');
  expect(usage.cycleId).toBe('c1');
  expect(usage.surface).toBe('llm');
  expect(usage.step).toBe('caption');
});
```

- [ ] **Step 2: Update `withCostTracking` to forward the labels**

In `with-cost-tracking.ts`, change the `trackAIUsage(...)` call to:

```typescript
trackAIUsage({
  model: labels.model,
  operation: labels.operation,
  inputTokens: usage.inputTokens ?? 0,
  outputTokens: usage.outputTokens ?? 0,
  costUsd: usage.costUsd,
  durationMs,
  ...(labels.restaurantId ? { restaurantId: labels.restaurantId } : {}),
  ...(labels.postId ? { postId: labels.postId } : {}),
  ...(labels.cycleId ? { cycleId: labels.cycleId } : {}),
  surface: labels.surface,
  step: labels.step,
});
```

- [ ] **Step 3: Verify**

`cd apps/content-engine && npx vitest run tests/unit/content-generator/backends/ai/with-cost-tracking.test.ts`
Expected: existing 5 tests + 1 extended assertion all green.

`cd apps/content-engine && npx vitest run`
Expected: 56 files / 391+ assertions all green.

---

## Task 3: `infra/workbooks/cost-by-restaurant.workbook.json`

**Files:**
- Create: `infra/workbooks/cost-by-restaurant.workbook.json`

Azure Monitor Workbook template. JSON schema is what Azure Portal exports when you click "Save as Template" on a workbook. Operators import via Azure Portal -> Application Insights -> Workbooks -> "Add" -> "Advanced editor" -> paste this JSON.

- [ ] **Step 1: Create the workbook**

```json
{
  "version": "Notebook/1.0",
  "items": [
    {
      "type": 1,
      "content": {
        "json": "# RestroPulse - AI Cost by Restaurant\n\nStacked-bar of LLM / image / video / sonar costs per restaurant per month. Source: Application Insights `customEvents` table where `name == 'ai.request.completed'`.\n\nUse the time-range parameter at the top to scope the window. Costs are denormalized at write time -- if pricing tables change, historical rows reflect the rate at the time of the call."
      },
      "name": "header"
    },
    {
      "type": 9,
      "content": {
        "version": "KqlParameterItem/1.0",
        "parameters": [
          {
            "id": "tr-param",
            "version": "KqlParameterItem/1.0",
            "name": "TimeRange",
            "label": "Time range",
            "type": 4,
            "isRequired": true,
            "value": { "durationMs": 2592000000 },
            "typeSettings": {
              "selectableValues": [
                { "durationMs": 86400000 },
                { "durationMs": 604800000 },
                { "durationMs": 2592000000 },
                { "durationMs": 7776000000 }
              ]
            }
          }
        ]
      },
      "name": "params"
    },
    {
      "type": 3,
      "content": {
        "version": "KqlItem/1.0",
        "query": "customEvents\n| where timestamp {TimeRange}\n| where name == 'ai.request.completed'\n| extend restaurantId = tostring(customDimensions.restaurantId)\n| extend surface = tostring(customDimensions.surface)\n| extend costUsd = todouble(customDimensions.costUsd)\n| where isnotempty(restaurantId)\n| summarize TotalUsd = round(sum(costUsd), 4) by restaurantId, surface, MonthBin = bin(timestamp, 30d)\n| order by MonthBin desc, TotalUsd desc",
        "size": 0,
        "title": "Per-restaurant monthly cost by surface",
        "queryType": 0,
        "resourceType": "microsoft.insights/components",
        "visualization": "barchart",
        "chartSettings": {
          "xAxis": "restaurantId",
          "yAxis": ["TotalUsd"],
          "group": "surface",
          "createOtherGroup": 0,
          "showLegend": true
        }
      },
      "name": "cost-by-restaurant-stacked"
    },
    {
      "type": 3,
      "content": {
        "version": "KqlItem/1.0",
        "query": "customEvents\n| where timestamp {TimeRange}\n| where name == 'ai.request.completed'\n| extend restaurantId = tostring(customDimensions.restaurantId)\n| extend costUsd = todouble(customDimensions.costUsd)\n| where isnotempty(restaurantId)\n| summarize TotalUsd = round(sum(costUsd), 4), CallCount = count() by restaurantId\n| order by TotalUsd desc",
        "size": 0,
        "title": "Restaurant leaderboard (total cost + call count)",
        "queryType": 0,
        "resourceType": "microsoft.insights/components",
        "visualization": "table"
      },
      "name": "leaderboard"
    },
    {
      "type": 3,
      "content": {
        "version": "KqlItem/1.0",
        "query": "customEvents\n| where timestamp {TimeRange}\n| where name == 'ai.request.completed'\n| extend surface = tostring(customDimensions.surface)\n| extend costUsd = todouble(customDimensions.costUsd)\n| summarize TotalUsd = round(sum(costUsd), 4) by surface, bin(timestamp, 1d)\n| render timechart",
        "size": 0,
        "title": "Platform-wide daily cost by surface",
        "queryType": 0,
        "resourceType": "microsoft.insights/components"
      },
      "name": "platform-trend"
    }
  ],
  "fallbackResourceIds": [],
  "$schema": "https://github.com/Microsoft/Application-Insights-Workbooks/blob/master/schema/workbook.json"
}
```

---

## Task 4: `infra/workbooks/per-post-audit.workbook.json`

**Files:**
- Create: `infra/workbooks/per-post-audit.workbook.json`

Parameterized by `postId`. Renders the timeline of every API call associated with that post.

- [ ] **Step 1: Create the workbook**

```json
{
  "version": "Notebook/1.0",
  "items": [
    {
      "type": 1,
      "content": {
        "json": "# RestroPulse - Per-Post API Call Audit\n\nDrill into a single post's AI generation chain. Enter a `postId` and see every API call emitted for that post: surface (LLM / image / video / sonar / calendar), step, model, tokens, cost, latency. Source: Application Insights `customEvents` where `name == 'ai.request.completed'`."
      },
      "name": "header"
    },
    {
      "type": 9,
      "content": {
        "version": "KqlParameterItem/1.0",
        "parameters": [
          {
            "id": "tr-param",
            "version": "KqlParameterItem/1.0",
            "name": "TimeRange",
            "label": "Time range",
            "type": 4,
            "isRequired": true,
            "value": { "durationMs": 604800000 },
            "typeSettings": {
              "selectableValues": [
                { "durationMs": 3600000 },
                { "durationMs": 86400000 },
                { "durationMs": 604800000 },
                { "durationMs": 2592000000 }
              ]
            }
          },
          {
            "id": "post-param",
            "version": "KqlParameterItem/1.0",
            "name": "PostId",
            "label": "Post id",
            "type": 1,
            "isRequired": true,
            "value": ""
          }
        ]
      },
      "name": "params"
    },
    {
      "type": 3,
      "content": {
        "version": "KqlItem/1.0",
        "query": "customEvents\n| where timestamp {TimeRange}\n| where name == 'ai.request.completed'\n| extend postId = tostring(customDimensions.postId)\n| where postId == '{PostId}'\n| extend surface = tostring(customDimensions.surface)\n| extend step = tostring(customDimensions.step)\n| extend operation = tostring(customDimensions.operation)\n| extend model = tostring(customDimensions.model)\n| extend inputTokens = toint(customDimensions.inputTokens)\n| extend outputTokens = toint(customDimensions.outputTokens)\n| extend costUsd = round(todouble(customDimensions.costUsd), 6)\n| extend durationMs = toint(customDimensions.durationMs)\n| project timestamp, surface, step, operation, model, inputTokens, outputTokens, costUsd, durationMs\n| order by timestamp asc",
        "size": 0,
        "title": "Call timeline for postId",
        "queryType": 0,
        "resourceType": "microsoft.insights/components",
        "visualization": "table"
      },
      "name": "post-timeline"
    },
    {
      "type": 3,
      "content": {
        "version": "KqlItem/1.0",
        "query": "customEvents\n| where timestamp {TimeRange}\n| where name == 'ai.request.completed'\n| extend postId = tostring(customDimensions.postId)\n| where postId == '{PostId}'\n| extend costUsd = todouble(customDimensions.costUsd)\n| extend surface = tostring(customDimensions.surface)\n| summarize TotalUsd = round(sum(costUsd), 6), Calls = count() by surface\n| order by TotalUsd desc",
        "size": 0,
        "title": "Cost breakdown by surface for this post",
        "queryType": 0,
        "resourceType": "microsoft.insights/components",
        "visualization": "piechart"
      },
      "name": "post-cost-pie"
    },
    {
      "type": 3,
      "content": {
        "version": "KqlItem/1.0",
        "query": "customEvents\n| where timestamp {TimeRange}\n| where name == 'ai.request.completed'\n| extend postId = tostring(customDimensions.postId)\n| where postId == '{PostId}'\n| extend durationMs = toint(customDimensions.durationMs)\n| extend step = tostring(customDimensions.step)\n| project timestamp, step, durationMs\n| render barchart kind=unstacked",
        "size": 0,
        "title": "Latency per step (ms)",
        "queryType": 0,
        "resourceType": "microsoft.insights/components"
      },
      "name": "post-latency"
    }
  ],
  "fallbackResourceIds": [],
  "$schema": "https://github.com/Microsoft/Application-Insights-Workbooks/blob/master/schema/workbook.json"
}
```

---

## Task 5: Update `docs/INFRASTRUCTURE.md`

**Files:**
- Modify: `docs/INFRASTRUCTURE.md`

Add a new section after the existing apps/content-engine env-var block. The Content Engine app already has a stub block with `MONGODB_URI` etc. — append the new AI-backend variables.

- [ ] **Step 1: Find the existing `apps/content-engine (.env)` table**

Locate the section in `docs/INFRASTRUCTURE.md` titled `### apps/content-engine (.env)` (around the existing 3-row table with NODE_ENV / MONGODB_URI / MONGODB_DB_NAME).

- [ ] **Step 2: Append the AI backend env vars**

Add new rows to the existing table OR insert a new subsection right after it. Recommend a new subsection `#### Content Engine AI backend (env additions)` to keep the existing minimal block readable. Content:

```markdown
#### Content Engine AI backend (env additions)

Default behavior unchanged unless `CONTENT_GENERATOR_BACKEND=ai` is set. The AI backend then reads the variables below; missing required keys throw at boot.

| Variable                          | Required when                                          | Default                  | Purpose                                                                      |
|-----------------------------------|--------------------------------------------------------|--------------------------|------------------------------------------------------------------------------|
| `CONTENT_GENERATOR_BACKEND`       | always                                                 | `placeholder`            | Master switch: `placeholder` (asset catalog) or `ai` (Vercel AI SDK chain).  |
| `ANTHROPIC_API_KEY`               | `CONTENT_GENERATOR_BACKEND=ai`                         | --                       | Anthropic API key for Sonnet 4.6 / Haiku 4.5 via `@ai-sdk/anthropic`.        |
| `MEDIA_BACKEND`                   | always                                                 | `placeholder`            | Media generator: `placeholder` (asset catalog) or `fal-ai` (Flux + Kling).   |
| `FAL_API_KEY`                     | `MEDIA_BACKEND=fal-ai`                                 | --                       | fal.ai API key for image (sync) and video (queue API) generation.            |
| `CURRENT_AFFAIRS_V1_ENABLED`      | when AI backend selected                               | `true`                   | Enable Google Calendar holiday hint injection (free).                        |
| `GOOGLE_CALENDAR_API_KEY`         | `CURRENT_AFFAIRS_V1_ENABLED=true`                      | --                       | Google Calendar API key for India public holidays calendar.                  |
| `CURRENT_AFFAIRS_V2_ENABLED`      | when richer hints desired                              | `false`                  | Enable Perplexity Sonar Pro daily refresh + per-post triggers (~\$0.30-1/mo/restaurant). |
| `PERPLEXITY_API_KEY`              | `CURRENT_AFFAIRS_V2_ENABLED=true`                      | --                       | Perplexity Sonar Pro API key.                                                |
| `CRON_CURRENT_AFFAIRS_REFRESH`    | when V1 or V2 enabled                                  | `0 6 * * *`              | Daily refresh at 06:00 IST.                                                  |
| `CRON_MEDIA_JOB_POLLER`           | `MEDIA_BACKEND=fal-ai`                                 | `*/30 * * * * *`         | Every 30 seconds; polls in-flight video jobs against fal queue API.          |

Optional provider-portability keys (no behavior change unless code is changed to switch providers): `OPENAI_API_KEY`, `GOOGLE_API_KEY` -- declared in factory but unused in default chain.

##### Cron schedules added by AI backend

| Schedule                          | Default        | Timezone     | Purpose                                                          |
|-----------------------------------|----------------|--------------|------------------------------------------------------------------|
| `CRON_CURRENT_AFFAIRS_REFRESH`    | `0 6 * * *`    | Asia/Kolkata | Refresh calendar holidays + (if V2) daily Sonar platform answer. |
| `CRON_MEDIA_JOB_POLLER`           | `*/30 * * * * *` | Asia/Kolkata | Poll RUNNING video media jobs against fal.ai queue.              |

##### Collections added by AI backend

| Collection              | Purpose                                                                                                        |
|-------------------------|----------------------------------------------------------------------------------------------------------------|
| `costEvents`            | One row per AI/external API call (LLM, image, video, Sonar, calendar). Powers per-restaurant cost dashboards.  |
| `currentAffairsCache`   | 24h-TTL cache of calendar holidays and daily Sonar platform refresh.                                           |
| `mediaJobs`             | One row per media generation job. Image jobs land COMPLETED immediately; video jobs cycle PENDING -> RUNNING -> COMPLETED/FAILED via the poller. |

##### Cost expectations (per active restaurant per month)

Estimates for 30 posts/month with V1 calendar enabled and V2 Sonar disabled:

| Component       | Cost                  | Notes                                                                  |
|-----------------|-----------------------|------------------------------------------------------------------------|
| LLM (captions)  | ~\$0.10-0.30          | Haiku 4.5 per post; Sonnet for cycle planning is amortized across posts. |
| LLM (cycle)     | ~\$0.05-0.10          | Sonnet, ~1-2 calls per cycle.                                          |
| Calendar (V1)   | \$0                   | Free; daily refresh shared across all restaurants.                     |
| Image (fal.ai)  | ~\$0.75               | 30 IMAGE/STORY posts at \$0.025/call.                                  |
| Image carousel  | additional ~\$0.05/CAROUSEL | 3x per CAROUSEL post.                                            |
| Video (fal.ai)  | ~\$0.30 per REEL      | Default: Kling 1.6 standard. MiniMax is \$0.40/clip.                   |

When `CURRENT_AFFAIRS_V2_ENABLED=true`:

| Component         | Cost                       | Notes                                                                |
|-------------------|----------------------------|----------------------------------------------------------------------|
| Sonar daily refresh | ~\$0.10/day platform-wide | One call per day, shared across all restaurants.                     |
| Sonar per-post triggers | ~\$0.30-0.90/restaurant/month | Fires only when post concept matches an allowlist keyword (~20% rate). |
```

- [ ] **Step 3: Verify the file still renders cleanly**

`rtk grep "Content Engine AI backend" docs/INFRASTRUCTURE.md` returns one match. No accidental broken Markdown tables.

---

## Task 6: Update `docs/ARCHITECTURE.md`

**Files:**
- Modify: `docs/ARCHITECTURE.md`

Add a new section near the existing content-engine block. The goal: future readers see the AI backend's pluggable architecture at a glance and know to consult ADR 0001 for full rationale.

- [ ] **Step 1: Append a new section**

Find the existing content-engine architecture block in `docs/ARCHITECTURE.md` and add after it:

```markdown
### Content Engine AI backend

When `CONTENT_GENERATOR_BACKEND=ai`, the content-engine swaps the placeholder generator for `AIContentGenerator` -- a thin orchestrator over four pluggable seams. Default chain:

```text
IContentGenerator               (existing public contract)
  AIContentGenerator            (Vercel AI SDK orchestrator)
    ILLMProvider                  AnthropicLLMProvider (Sonnet for cycles, Haiku for posts)
    IMediaGenerator               PlaceholderMediaGenerator (default) | FalAIMediaGenerator (when MEDIA_BACKEND=fal-ai)
    ICurrentAffairsProvider       Noop | CalendarOnly (V1) | SonarAugmented(CalendarOnly) (V1+V2)
    IDomainSpecialization         RestaurantSpecialization
```

Each seam is a separately swappable interface. Adding a second domain (salon, fitness) is an `IDomainSpecialization` impl. Adding a new LLM provider is a one-import swap inside `AnthropicLLMProvider`. Adding a new media provider (Replicate, Runway) is an `IMediaGenerator` impl.

#### Async media flow (REEL/VIDEO with `MEDIA_BACKEND=fal-ai`)

```text
adhoc-processor finds PENDING_CONTENT post
  -> AIContentGenerator.generatePost
    -> caption (Anthropic, sync)
    -> media (FalAIMediaGenerator.generateVideo)
      -> queue submit -> mediaJobs row inserted (status=RUNNING)
      -> returns immediately
  -> processor writes post.status=PENDING_MEDIA + mediaJobId

media-job-poller (every 30s)
  -> finds PENDING_MEDIA posts
  -> per post: live-poll fal queue, transition COMPLETED -> applyMediaJobResultToPost (status=PENDING_APPROVAL)
                                            FAILED   -> markPostFailedWithMedia (status=MISSED_DEADLINE)
                                            stale > 10min -> reap as FAILED

post-resume scan (worker boot, when MEDIA_BACKEND=fal-ai)
  -> finds posts with PENDING_MEDIA + lastStepAt > 5min ago
  -> triggers one poll cycle each (idempotent, matches cron path)
```

#### Cost attribution

Every external API call writes one row to `costEvents` (MongoDB) AND emits a `customEvents` row to Application Insights (via `trackAIUsage`), tagged with `restaurantId`, `postId`, `cycleId`, `surface`, `step`, `model`. The two Azure Monitor Workbooks under `infra/workbooks/` consume the App Insights events.

For full rationale (decision drivers, framework selection, RAG strategy, retry profiles, durability semantics), see [ADR 0001 - Content-Engine AI Framework](adr/0001-content-engine-ai-framework.md).
```

---

## Task 7: Create `docs/CONTENT_ENGINE_AI_ROLLOUT.md`

**Files:**
- Create: `docs/CONTENT_ENGINE_AI_ROLLOUT.md`

A prescriptive rollout runbook. Operators flip flags in a defined order; each stage has env vars to set, smoke commands to verify, and what to monitor before advancing.

- [ ] **Step 1: Create the file**

```markdown
# Content Engine AI - Rollout Runbook

This runbook describes the staged rollout of the AI content generator behind feature flags. Each stage is independently rollback-able by flipping its flag back to default. The placeholder backend remains a permanent operational fallback -- it is not a temporary toggle.

## Pre-flight

Before any flag is flipped:

1. Application Insights connection string is configured for the content-engine deployment slot (workbooks won't populate otherwise).
2. The two workbooks (`cost-by-restaurant`, `per-post-audit`) are imported into the Azure Portal under the App Insights resource. See `infra/workbooks/` for the JSON templates.
3. Cost ceilings are agreed with billing: dashboards exist but alerts are operator's call.
4. Every required API key for the target stage is provisioned (see stage env vars below). Missing keys cause the worker to throw at boot rather than silently degrade.

## Stages

Stages are additive. Each stage subsumes the previous stage's flags.

### Stage 0: Default (placeholder, no AI)

```
CONTENT_GENERATOR_BACKEND=placeholder   # default
MEDIA_BACKEND=placeholder               # default
```

Behavior: the existing asset-catalog generator runs. No external AI calls. Zero cost. This is what production runs today and what every rollback target should be.

### Stage 1: AI captions + cycles + V1 calendar (LLM only, no fal.ai)

Flip these env vars on the staging deployment first; observe for 24 hours; then promote to production.

```
CONTENT_GENERATOR_BACKEND=ai
ANTHROPIC_API_KEY=<key>
GOOGLE_CALENDAR_API_KEY=<key>
# CURRENT_AFFAIRS_V1_ENABLED=true is the default
```

**What happens:** Anthropic Sonnet/Haiku produces real cycles + captions. Calendar V1 auto-injects "Today is..." and nearby India holiday hints. Media still comes from the asset catalog (post.thumbnail / videoUrl point at the local asset server).

**Smoke check at boot:**
```bash
cd apps/content-engine && CONTENT_GENERATOR_BACKEND=ai ANTHROPIC_API_KEY=<key> GOOGLE_CALENDAR_API_KEY=<key> npx tsx --eval "import('./src/services/content-generator/factory.js').then(m => { m.createContentGenerator('ai'); console.log('currentAffairs:', m.getLastAiCurrentAffairsProvider()?.name); })"
# expected: currentAffairs: calendar-only
```

**Monitor:**
- `cost-by-restaurant` workbook (LLM surface only). Validate per-restaurant LLM cost is within expected band (~\$0.10-0.30/restaurant/month).
- Application Insights traces -> filter `customDimensions.operation in ('draftCycle','generatePost')`. Watch for spikes in `durationMs`.
- The content-engine worker logs: look for `AIContentGenerator instantiated` at boot.

**Rollback:** unset `CONTENT_GENERATOR_BACKEND` (or set to `placeholder`). No data cleanup needed.

### Stage 2: AI image generation (fal.ai for IMAGE/STORY/CAROUSEL)

```
CONTENT_GENERATOR_BACKEND=ai
ANTHROPIC_API_KEY=<key>
GOOGLE_CALENDAR_API_KEY=<key>
MEDIA_BACKEND=fal-ai
FAL_API_KEY=<key>
```

**What happens:** IMAGE / STORY / CAROUSEL posts route through fal.ai Flux dev (text-to-image) or Flux dev image-to-image (when `baseImageUrl` is supplied). CAROUSEL fans out to 3 parallel calls. REEL/VIDEO posts will fail with `BACKEND_UNAVAILABLE` until Stage 3.

**Smoke check at boot:**
```bash
... MEDIA_BACKEND=fal-ai FAL_API_KEY=<key> npx tsx --eval "import('./src/services/content-generator/factory.js').then(m => { m.createContentGenerator('ai'); console.log('store:', m.getLastAiMediaJobStore() ? 'set' : 'null', 'media:', m.getLastAiMediaGenerator()?.name); })"
# expected: store: set media: fal-ai
```

**Monitor:**
- `cost-by-restaurant` workbook (image surface). 30 IMAGE posts/month/restaurant at \$0.025/call ~ \$0.75/month.
- Inspect `mediaJobs` collection: every IMAGE post now writes one row. CAROUSEL writes 3.
- `per-post-audit` workbook -> spot-check a few postIds end-to-end.

**Caveat:** REEL/VIDEO posts created during Stage 2 will fail with `BACKEND_UNAVAILABLE`. Either pause REEL/VIDEO scheduling at the application layer, or jump straight to Stage 3.

**Rollback:** set `MEDIA_BACKEND=placeholder`. No data cleanup needed; existing `mediaJobs` rows are harmless.

### Stage 3: AI video generation (fal.ai queue + poller)

Same env vars as Stage 2. The poller cron and post-resume scan auto-register because `MEDIA_BACKEND=fal-ai` is set; no extra flag needed.

**What happens:** REEL / VIDEO posts now submit to fal.ai's queue API (default model: Kling 1.6 standard). Posts move to `PENDING_MEDIA` while the queue runs. The `media-job-poller` cron (every 30s) advances them to `PENDING_APPROVAL` when fal.ai completes. Stale jobs (>10 min) are reaped as `MISSED_DEADLINE` with diagnostic on `publishError`.

**Smoke check:**
- Boot the worker. Logs should include `media-job-poller processor registered`.
- Submit a test REEL post; observe in DB: `status=PENDING_MEDIA`, `mediaJobId=...` set within seconds. Up to 2 minutes later: `status=PENDING_APPROVAL`, `videoUrl` populated.

**Monitor:**
- `cost-by-restaurant` workbook (video surface). \$0.30/clip default.
- `mediaJobs` collection: count of `RUNNING` jobs (steady-state should hover near 0). Sustained `RUNNING` count > 10 indicates fal.ai queue backlog or polling misconfiguration.
- Worker logs: `media-job-poller tick { count: N }` should appear every 30s.

**Open item -- web UI:** the new `PENDING_MEDIA` PostStatus needs a label/spinner in the studio UI. The web team must update `apps/web` separately. Until then, the studio will likely render PENDING_MEDIA posts with a blank or unknown-status badge for the duration the video is in flight (up to 2 minutes typical, 10 minutes worst-case).

**Rollback:** set `MEDIA_BACKEND=placeholder`. Posts already in `PENDING_MEDIA` with a fal job in flight will be reaped as stale within 10 minutes; operators can manually advance them by running a post-resume scan or manually applying the latest fal queue result.

### Stage 4 (optional): Sonar Pro current-affairs

```
... all Stage 3 vars ...
CURRENT_AFFAIRS_V2_ENABLED=true
PERPLEXITY_API_KEY=<key>
```

**What happens:** `current-affairs-refresh` cron (06:00 IST daily) now fires one Perplexity Sonar Pro call asking for India-wide trending topics. The response is cached in `currentAffairsCache` and shared across all restaurants. Per-post Sonar calls fire when the post concept matches the trigger keyword allowlist (sports/festivals/weather/celebrations).

**Cost:** ~\$0.10/day platform-wide for the daily refresh + ~\$0.30-0.90/restaurant/month for per-post triggers (assuming ~20% trigger rate on 30 posts/month).

**Monitor:**
- `cost-by-restaurant` workbook (sonar surface).
- `currentAffairsCache` collection should contain a `sonar-daily:YYYY-MM-DD` entry within 24h.

**Rollback:** unset `CURRENT_AFFAIRS_V2_ENABLED` or set to `false`.

## Per-stage observations checklist

After each promotion to production:

- [ ] cost-by-restaurant workbook shows the new surface
- [ ] worker logs include the expected boot lines (factory + processors)
- [ ] no spikes in worker error logs over the next 60 minutes
- [ ] no spikes in cost beyond the expected envelope

## Emergency rollback

To stop all AI behavior immediately:

```
CONTENT_GENERATOR_BACKEND=placeholder
```

This forces every operation back to the asset-catalog generator. Any in-flight `mediaJobs` rows can be left as-is; the poller no longer registers and the rows become inert.

## Reference

- ADR 0001: docs/adr/0001-content-engine-ai-framework.md (full rationale, decision drivers, alternatives)
- Plans: docs/superpowers/plans/2026-05-03-content-engine-ai-phase-{1..6}.md (per-phase implementation breakdown)
- Workbooks: infra/workbooks/cost-by-restaurant.workbook.json, per-post-audit.workbook.json
```

---

## Task 8: Update `CLAUDE.md` and `.github/copilot-instructions.md`

**Files:**
- Modify: `CLAUDE.md`
- Modify: `.github/copilot-instructions.md`

These instruction files tell future AI assistants where things live. Add a brief AI backend overview pointing at the directory and the rollout runbook.

- [ ] **Step 1: Append to `CLAUDE.md`**

Add a new section at the bottom (or right before any RTK trailing block):

```markdown
## Content Engine AI Backend

The content-engine has two pluggable backends behind a feature flag:

- `CONTENT_GENERATOR_BACKEND=placeholder` (default, production): asset catalog at `apps/content-engine/src/services/content-generator/backends/placeholder/`
- `CONTENT_GENERATOR_BACKEND=ai`: AI orchestration at `apps/content-engine/src/services/content-generator/backends/ai/`

The AI backend composes four pluggable seams (`ILLMProvider`, `IMediaGenerator`, `ICurrentAffairsProvider`, `IDomainSpecialization`) with the chain selected by env vars. See `docs/CONTENT_ENGINE_AI_ROLLOUT.md` for the staged rollout (placeholder -> AI captions -> AI image -> AI video -> Sonar) and `docs/adr/0001-content-engine-ai-framework.md` for design rationale.

Per-call cost events flow into both `costEvents` (MongoDB) and Application Insights `customEvents` (queryable from the workbooks at `infra/workbooks/`).

When changing AI-backend code:
- Tests use mocked external APIs (`vi.mock('ai', ...)` for Vercel AI SDK; mocked `fetch` for fal.ai/Sonar/Calendar). Do not introduce real network calls.
- The `CostEvent` type lives in `@restropulse/shared`; the `MediaJobRecord` type lives there too. Don't duplicate types in app-local files.
- Adding a new external API surface (e.g. a new media provider): also add per-call pricing in the relevant `pricing.ts` so cost dashboards stay accurate.
```

- [ ] **Step 2: Append the same content to `.github/copilot-instructions.md`**

Symmetric block. Both files share project-instruction conventions for AI assistants.

- [ ] **Step 3: Verify markdown still renders**

`rtk grep "Content Engine AI Backend" CLAUDE.md .github/copilot-instructions.md`
Expected: one match per file.

---

## Task 9: Final verification + stage + commit gate

- [ ] **Step 1: Build packages that changed**

```
rtk npm run build --workspace=@restropulse/telemetry
```
Exit 0.

- [ ] **Step 2: Full content-engine suite**

`cd apps/content-engine && npx vitest run`
Expected: 56 files / 391+ assertions, all green. (Task 2 added 5 assertions to an existing test, not a new file.)

- [ ] **Step 3: Monorepo type-check**

`rtk npm run type-check`
Expected: exit 0.

- [ ] **Step 4: Validate workbook JSON parses**

```
node --eval "JSON.parse(require('fs').readFileSync('infra/workbooks/cost-by-restaurant.workbook.json','utf8')); JSON.parse(require('fs').readFileSync('infra/workbooks/per-post-audit.workbook.json','utf8')); console.log('workbooks parse OK')"
```
Expected: `workbooks parse OK`

- [ ] **Step 5: Stage everything**

```
rtk git add \
  packages/telemetry/src/server/ai-tracker.ts \
  apps/content-engine/src/services/content-generator/backends/ai/with-cost-tracking.ts \
  apps/content-engine/tests/unit/content-generator/backends/ai/with-cost-tracking.test.ts \
  infra/workbooks \
  docs/INFRASTRUCTURE.md \
  docs/ARCHITECTURE.md \
  docs/CONTENT_ENGINE_AI_ROLLOUT.md \
  CLAUDE.md \
  .github/copilot-instructions.md \
  docs/superpowers/plans/2026-05-03-content-engine-ai-phase-6.md
rtk git status
rtk git diff --staged --stat
```

- [ ] **Step 6: STOP for commit approval**

Show user staged status + stat. Ask: **"Phase 6 complete -- workbooks + docs + rollout runbook + small telemetry patch. Approve committing as the final phase commit?"**

After explicit approval:

```
rtk git commit -m "$(cat <<'EOF'
docs(content-engine): observability dashboards + rollout runbook + AI backend docs

Phase 6 of the content-engine AI rollout per ADR 0001. Closes the project.

Adds infra/workbooks/:
- cost-by-restaurant.workbook.json -- Azure Monitor Workbook with stacked-bar
  cost per restaurant per month grouped by surface (LLM/image/video/sonar),
  restaurant leaderboard, platform-wide daily cost timechart.
- per-post-audit.workbook.json -- parameterized by postId. Renders the call
  timeline (surface, step, model, tokens, cost, latency), cost pie by surface,
  and a per-step latency bar chart.

Operators import via Azure Portal -> Application Insights -> Workbooks ->
Advanced editor.

Adds docs/CONTENT_ENGINE_AI_ROLLOUT.md -- prescriptive 4-stage rollout
runbook (placeholder -> AI captions/V1 -> AI image -> AI video -> optional
V2 Sonar) with per-stage env vars, smoke checks, monitoring guidance, and
rollback steps. Documents the open item that apps/web needs a label for the
new PENDING_MEDIA PostStatus.

Updates docs/INFRASTRUCTURE.md with a new "Content Engine AI backend"
subsection: 10 new env vars, 2 new cron schedules, 3 new collections,
per-restaurant cost expectations.

Updates docs/ARCHITECTURE.md with an "AI backend" section: pluggable seam
diagram, async media flow ASCII, post-resume description, and links to ADR
0001 + per-phase plans.

Adds AI-backend overview blocks to CLAUDE.md and
.github/copilot-instructions.md so future AI assistants know where the
backends live and which env vars gate behavior.

Small source patch: trackAIUsage in @restropulse/telemetry now forwards
restaurantId/postId/cycleId/surface/step in customEvents properties so the
cost-by-restaurant and per-post-audit workbook KQL queries can filter
correctly. withCostTracking in apps/content-engine threads these through.
Backward compatible (all new properties are additive).

All 391 prior tests pass; 5 assertions added to with-cost-tracking.test.ts
to assert the new label-forwarding behavior.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
rtk git status
rtk git log --oneline -8
```

---

## Self-Review

**Spec coverage** (against phase 6 brainstorm):
- Two Azure Monitor Workbook JSON files under infra/workbooks/ -> Tasks 3, 4
- INFRASTRUCTURE.md env vars + cron + collections + costs -> Task 5
- ARCHITECTURE.md AI backend section -> Task 6
- Feature-flag rollout runbook -> Task 7
- CLAUDE.md + copilot-instructions.md updates -> Task 8
- Small telemetry patch needed for the workbooks to filter by restaurantId -> Task 1, 2

**Placeholder scan**: searched plan for "TBD", "implement later", "fill in", "appropriate error handling", "similar to Task". None present. Workbook JSON is valid Application Insights template format; KQL queries use the actual customEvents schema written by trackAIUsage.

**Type consistency**:
- `AIUsage` interface gains 4 optional fields (postId, cycleId, surface, step). All existing callers continue to compile because new fields are optional.
- `withCostTracking` already has these in its `CostTrackingLabels` (set in phase 1) -- only the forwarding step is new.
- Workbook KQL queries reference customDimensions field names that exactly match the property keys in the trackEvent call.

**Cross-cutting notes**:
- Plain ASCII only.
- `rtk` for shell, NOT for vitest (`npx vitest` directly).
- After modifying packages/telemetry, run `rtk npm run build --workspace=@restropulse/telemetry` before content-engine tests pick up the new behavior at runtime (the test mocks `@restropulse/telemetry/server` so this only matters for actual production builds, but it's good hygiene).
- One commit at the end.
- Default behavior unchanged.
