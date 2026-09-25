# ADR 0001: Content-Engine AI Framework + Current-Affairs RAG

> Update (2026-07): the fal.ai media generator has been removed; Replicate is the canonical media backend. References to fal.ai below are historical and describe the original design.

## 1. Status

**Accepted** — 2026-05-03

This ADR is the first formal architecture decision record for the RestroPulse codebase. It is informed by earlier architecture exploration done during initial content-engine design.

## 2. Context

The content-engine (`apps/content-engine`) currently runs a `PlaceholderContentGenerator` — a non-AI, asset-catalog-based implementation of the `IContentGenerator` contract defined in `apps/content-engine/src/services/content-generator/types.ts`. The placeholder selects pre-existing media files from `assets/` and assembles captions from string templates. It exists to validate the surrounding pipeline (cron processors, post lifecycle, validation, publishing) before AI is wired in.

The next phase replaces the placeholder with a production AI-backed generator. The four operations on the contract (`draftCycle`, `reviseCycle`, `generatePost`, `revisePost`) must each:

- Compose multi-step external API calls in a single workflow: current-affairs/trends lookup → caption generation → image or video generation (and optionally user-image editing).
- Generate images and videos from scratch via AI APIs, not select from a static catalog.
- Modify user-provided images via image-to-image / inpainting where the post type calls for it.
- Tolerate long-running operations: video generation takes 30–120 seconds and must not block other content-engine cron processors.
- Track cost per `restaurantId` / `postId` for SaaS billing transparency.
- Route telemetry through the existing `@restropulse/telemetry` → Azure Monitor pipeline.

Two coupled decisions are required:

1. **Framework**: which TypeScript LLM/agent framework (or none) the AI generator is built on.
2. **Current-affairs RAG strategy**: how the generator obtains the time-sensitive context (holidays, sports outcomes, festivals, weather, trending hashtags) that the `currentAffairsHints: string[]` field on each operation already accepts.

This ADR captures both decisions, the implementation patterns required to make the chosen framework succeed (retry, durable polling, cost tracking), the pluggable architecture that preserves future flexibility (alternative providers, V3 brand-voice RAG, second business domain), and the explicit conditions under which to revisit.

## 3. Decision Drivers

The eight drivers below are listed in priority order. The decision in §4 is justified against these drivers, with the heaviest weight given to the P0 drivers.

1. **Time-to-robust-product (P0)** — minimal cognitive load, idiomatic TypeScript, slides into the existing `IContentGenerator` interface without architectural changes.
2. **Cost (P0)** — per-call model selection (Haiku for cheap steps, Sonnet for reasoning), Anthropic prompt caching available, transparent token attribution per `restaurantId` / `postId`.
3. **Model portability (P1)** — swapping Anthropic, OpenAI, and Google must not require rewriting orchestration logic.
4. **Multi-modal orchestration (P1)** — text, image, and video API calls in one workflow, with optional user-image editing.
5. **Long-running operation tolerance (P1)** — video generation (30–120s) must not block other content-engine cron processors.
6. **Telemetry integration (P1)** — must emit OpenTelemetry spans into the existing `@restropulse/telemetry` → Azure Monitor pipeline; no proprietary observability lock-in.
7. **Per-customer cost attribution (P1)** — every LLM, image, and video API call must carry labels for `restaurantId`, `postId`, `cycleId`, `operation`, `model`, and `step`.
8. **Vendor lock-in posture (P2)** — escape hatch must be ≤200 LOC if the framework is abandoned.

## 4. Decision

Two coupled decisions, in scope for the same release:

### 4.1 Framework

**Adopt Vercel AI SDK (`ai` package + `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google` providers) as the LLM and tool-orchestration layer. Build a thin custom orchestrator (~200 LOC) inside `apps/content-engine/src/services/content-generator/ai-generator/` that implements `IContentGenerator` by composing typed async functions:**

```text
searchTrends() -> generateCaption() -> generateMedia() -> assemblePost()
```

No agent state-machine framework is adopted; orchestration stays plain TypeScript with typed Zod-validated boundaries.

### 4.2 Current-Affairs RAG

**Implement V1 (calendar/holiday injection) and V2 (daily Sonar Pro refresh + per-post hyperlocal triggers) in the initial release. Defer V3 (Atlas Vector Search for brand voice) until production evidence justifies it, per the rebuild triggers in §5.3.**

### 4.3 Implementation patterns scoped IN

These four patterns are mandatory implementation scope; the framework choice does not earn its keep without them:

1. **Retry helper** — `withRetry(fn, { maxAttempts, backoff: "exponential", retryOn: [TransientError, RateLimitError] })`. Profiles per surface: LLM (3 attempts, 1s/2s/4s backoff), image gen submission (3 attempts, 5s/10s/20s backoff), video gen submission (5 attempts, 10s/20s/40s/80s/160s backoff). Never retry on 4xx; always retry on 429/502/503/504.
2. **Durable video-generation polling** — new MongoDB `mediaJobs` collection; submission writes a row and returns immediately; new `mediaJobPoller` cron (every 30s) polls RUNNING jobs and resolves them; stale RUNNING jobs (>10 min) reset to PENDING. The `generatePost` worker never blocks for video gen.
3. **Crash-safe partial durability** — idempotent operations keyed on `jobId`; `generationStep` checkpoints on the post (`SEARCHING_TRENDS -> CAPTION_DONE -> MEDIA_REQUESTED -> MEDIA_DONE`); worker startup re-enqueues posts in non-terminal states older than 5 min from the last completed step. Explicitly **not** implementing exactly-once tool execution or time-travel debugging.
4. **Cost tracking + observability** — `withCostTracking(fn, { restaurantId, postId, cycleId, operation, model, step })` wrapper emits OTel metrics (`genai.tokens.input`, `genai.tokens.output`, `genai.cost.usd`, `genai.duration.ms`) and persists denormalized rows to a `cost_events` MongoDB collection. Two Azure Monitor Workbooks ship with the implementation: **Cost-by-restaurant** (stacked bar by API surface per restaurant per month) and **Per-post audit** (drill into any `postId` to see every API call's tokens, cost, and latency).

### 4.4 Image / video generation API

**Primary: `FalAIMediaGenerator` for image (Flux dev / Flux fill for editing) and video (Kling 1.6 / MiniMax) [^fal-ai].** Replicate is documented as the fallback and implemented as an `IMediaGenerator` alternative if fal.ai pricing or availability changes. Runway Gen-3 is deferred to a premium subscription tier and not built in the initial release.

### 4.5 Domain Specialization

**Adopt the `IDomainSpecialization` module described in §6.2. Ship `RestaurantSpecialization` as the only concrete implementation. Do not build registry, A/B prompt-testing, or cross-domain abstractions until a second domain is in flight.**

### 4.6 Rationale

Vercel AI SDK is the most mature TypeScript LLM library, gives provider neutrality at zero cost, has first-class structured output via Zod, supports Anthropic prompt caching natively, and emits OpenTelemetry spans that route into the existing `@restropulse/telemetry` and Azure Monitor pipeline without new infrastructure. The four `IContentGenerator` operations are bounded enough that a custom orchestrator is faster to write than learning an agent DSL, and remains easy to evolve toward Mastra or LangGraph if multi-agent patterns later emerge. Per-customer cost attribution via `withCostTracking` and durable video-generation polling via the `mediaJobs` collection cover the operational gaps that not-using-an-agent-framework leaves, in less than 800 LOC. The `IDomainSpecialization` seam keeps domain knowledge isolated so prompts can iterate without touching orchestration and a future second domain plugs in without core changes. The decision favors time-to-robust-product and cost over framework richness, matching the explicit P0 drivers.

[^fal-ai]: fal.ai documentation: <https://docs.fal.ai/>

## 5. Current-Affairs RAG Strategy

The `currentAffairsHints: string[]` field on each `IContentGenerator` operation accepts time-sensitive context that informs caption tone and thematic angles (festival tie-ins, sports outcomes, weather, regional cuisine trends). This section specifies how those strings are populated.

The strategy is **layered by data freshness vs cost vs value**, with three tiers and an explicit split between current-affairs RAG (real-time, no vector store) and brand-voice RAG (long-lived, vector store). Tiers V1 and V2 ship in the initial release; V3 is documented as a deferred future option with explicit rebuild triggers.

### 5.1 V1 — Calendar / holiday injection (in scope, ships first)

- **Source**: Google Calendar Public Holidays API, India calendar id `en.indian#holiday@group.v.calendar.google.com` [^gcal]
- **Cadence**: daily refresh job at 06:00 IST, cached in MongoDB for 24 hours
- **Injection content**: today's date / weekday / month / India holiday name (when within ±3 days)
- **Cost**: zero incremental
- **Estimated build**: 150–200 LOC, 2–3 days

### 5.2 V2 — Real-time current affairs (in scope, ships in same release as V1)

- **Source**: Perplexity Sonar Pro API as a unified current-affairs and trending-hashtags oracle [^sonar]
- **Cadence (two-tier)**:
  1. **Daily refresh** at 06:00 IST: one Sonar Pro call asking *"What are the major events, sports outcomes, festivals, weather events, and trending topics in India today and tomorrow that a restaurant might want to reference in social media content?"* — cached 24 hours, shared across all restaurants generating posts that day.
  2. **Per-post hyperlocal augmentation**: at `generatePost` time, when the `concept` field matches an allowlist of triggers (sports, festivals, weather, regional cuisine), make a targeted Sonar call for that specific angle.
- **Cost**: ~$0.10/day platform-wide for the daily refresh, plus ~$0.30–0.90/restaurant/month for per-post triggers (assuming a 20% trigger rate on 30 posts/month/restaurant)
- **Estimated build**: 300–500 LOC, 4–5 days

### 5.3 V3 — Brand-voice / restaurant-specific RAG (DEFERRED)

V3 is **not built** in the initial release. Its design and rebuild triggers are documented for the future engineer.

- **Triggers to build V3** (any one is sufficient):
  - Brand-voice complaints appear in ≥10% of revision-feedback `tags` over a rolling 30-day window
  - A multi-restaurant brand customer (≥3 restaurants under one brand) onboards
  - Restaurant retention analytics identify "AI-generated content doesn't sound like us" as a top-3 churn reason
- **What V3 would do**: embed past approved posts per restaurant; retrieve top-K most semantically similar approved posts during caption generation to maintain brand-voice consistency.
- **Primary backing store**: MongoDB Atlas Vector Search [^atlas-vector] (already running Atlas; no new infrastructure; available on the existing M10+ tier).
- **Vector store alternatives (documented but rejected for V3)**:
  - **pgvector** — would require Postgres alongside Mongo; operational overhead not justified
  - **sqlite-vec / LanceDB / hnswlib-node** — embedded options do not scale to multi-instance content-engine
  - **Pinecone** — paid SaaS, redundant with Atlas Vector
  - **Chroma** — workable but smaller community than Atlas Vector
- **Operational complexity V3 introduces** (and why it is deferred):
  - Embedding pipeline lifecycle (when does a post get embedded? on approval? on publish? backfill?)
  - Vector index versioning when prompts evolve
  - Cold-start problem for new restaurants
  - Quality evaluation: how to know whether retrieval is helping vs hurting
  - Cost overhead: embedding API calls plus vector storage plus retrieval queries
- **Estimated V3 build when triggered**: 7–10 days, plus ongoing operational cost.

### 5.4 RAG decision summary

| Tier | Scope | Build now? | Estimated cost / restaurant / month |
|---|---|---|---|
| V1 | Calendar / holiday injection | Yes | $0 |
| V2 | Daily Sonar refresh + per-post hyperlocal triggers | Yes | ~$0.30–1.00 (incl. amortized daily refresh) |
| V3 | Atlas Vector Search for brand voice | No (deferred with explicit triggers) | n/a |

**Vector store decision**: not relevant to V1 or V2 (current affairs has a half-life of hours). Only relevant to V3, where MongoDB Atlas Vector Search is the primary candidate by infrastructure adjacency.

[^gcal]: Google Calendar API — Calendars resource: <https://developers.google.com/calendar/api/v3/reference/calendars>
[^sonar]: Perplexity Sonar API reference: <https://docs.perplexity.ai/api-reference/chat-completions>
[^atlas-vector]: MongoDB Atlas Vector Search documentation: <https://www.mongodb.com/docs/atlas/atlas-vector-search/>

## 6. Pluggable Architecture

Every layer of the AI generator is independently swappable behind an interface. This is the seam at which providers, RAG tiers, and future business domains can be replaced without touching unrelated code.

```text
IContentGenerator (top-level contract; already exists in code today)
  AIContentGenerator (Vercel AI SDK-based concrete implementation, NEW)
    IDomainSpecialization        domain-specific prompts, knowledge, Sonar queries
    ILLMProvider                 abstracted by Vercel AI SDK; one-import swap
    ICurrentAffairsProvider      V1 / V2 / V3 are decorators here
    IMediaGenerator              fal.ai / Replicate / Runway impls swap here
    IMediaJobStore               MongoDB today; could become Redis or Postgres later
```

### 6.1 Decorator pattern for V1 / V2 / V3 plug-ability

```typescript
// V1 alone (degraded mode, used in tests and as a fallback if V2 is offline)
const provider = new CalendarOnlyProvider();

// V1 + V2 (production target for the first release)
const provider = new SonarAugmentedProvider(
  new CalendarOnlyProvider(),
  { dailyRefreshCache, sonarClient }
);

// V1 + V2 + V3 (future, no other code changes)
const provider = new BrandVoiceProvider(
  new SonarAugmentedProvider(
    new CalendarOnlyProvider(),
    { dailyRefreshCache, sonarClient }
  ),
  { atlasVectorClient, embeddingClient }
);
```

Each layer reads the upstream context, contributes its own enrichment, and returns an enriched `CurrentAffairsContext`. Each layer carries its own toggle environment variable (e.g., `CURRENT_AFFAIRS_V2_ENABLED=true`), can be unit-tested in isolation, and can be removed or replaced without touching siblings. The same composition pattern applies to `IMediaGenerator` and `ILLMProvider`.

### 6.2 Domain Specialization Module (`IDomainSpecialization`)

All domain-specific knowledge — *what makes restaurant content sound like restaurant content* — lives in a single dedicated module behind one interface. This is the seam at which the platform becomes multi-domain in the future. The current scope ships only one specialization (`RestaurantSpecialization`); the interface stays small enough that adding the second domain does not force a redesign, but no abstractions for hypothetical second domains are built today.

**Location**: `apps/content-engine/src/services/content-generator/ai-generator/specialization/`

```text
specialization/
  index.ts                      exports IDomainSpecialization + provider DI
  types.ts                      IDomainSpecialization interface
  restaurant/
    index.ts                    RestaurantSpecialization concrete impl
    prompts.ts                  system prompts, task prompts, voice guidelines
    sonar-queries.ts            restaurant-tuned Perplexity Sonar prompt templates
    content-patterns.ts         post archetypes (chef special, behind-the-scenes, etc.)
    visual-direction.ts         food-photography rules, image-prompt fragments
    platform-tactics.ts         Instagram-vs-Facebook playbook for restaurants
    hashtag-strategy.ts         restaurant + cuisine + location hashtag heuristics
    psychology.ts               buyer-psychology hooks (scarcity, social proof, FOMO)
```

**Interface (intentionally small)**:

```typescript
export interface IDomainSpecialization {
  readonly domain: string;                              // "restaurant" | <future>
  readonly version: string;                             // semver, for prompt-evolution tracking

  /** System prompt fragment injected into every LLM call for this domain. */
  getSystemPromptFragment(ctx: SpecializationContext): string;

  /** Task-specific prompt augmentation per IContentGenerator operation. */
  getTaskPrompt(
    operation: "draftCycle" | "reviseCycle" | "generatePost" | "revisePost",
    input: unknown,
    ctx: SpecializationContext,
  ): string;

  /** Sonar query templates for V2 current-affairs RAG, tuned to this domain. */
  getSonarQueries(scope: "daily-platform" | "per-post-trigger", ctx: SpecializationContext): string[];

  /** Image generation prompt fragment (style direction, composition, lighting). */
  getImagePromptFragment(input: ImageGenInput, ctx: SpecializationContext): string;

  /** Hashtag selection strategy. */
  selectHashtags(caption: string, ctx: SpecializationContext): string[];

  /** Validate that generated output respects domain conventions
   *  (e.g., restaurant captions should not over-promise health benefits). */
  validateOutput(output: GeneratedPost | GeneratedCycle, ctx: SpecializationContext): ValidationResult;
}

export interface SpecializationContext {
  restaurantId?: string;
  restaurantName?: string;
  cuisine?: string;          // "South Indian", "Italian", "Multi-cuisine"
  region?: string;           // "Bengaluru", "Mumbai", "NCR"
  brandVoice?: string;       // "playful", "premium", "homestyle"
  dietaryFocus?: string[];   // ["vegetarian", "jain", "vegan"]
  locale?: string;           // "en-IN", "hi-IN"
}
```

**Initial `RestaurantSpecialization` content (the codified marketing playbook)**:

- **Voice and tone**: sensory-first language; specificity wins; avoid hyperbolic health claims (FSSAI exposure); match the restaurant's `brandVoice` field.
- **Content archetypes** (the seven high-performing post patterns for Indian restaurants):
  1. Daily Special / Chef's Pick — featured dish + price + scarcity hook
  2. Behind-the-scenes — kitchen prep, plating, ingredient sourcing
  3. Customer / social proof — review screenshots, repost UGC, occasion celebrations
  4. Festival / event tie-in — Diwali thalis, IPL match-day combos, Friday-night specials
  5. Cuisine education — "what makes a real Hyderabadi biryani" explainer reels
  6. Offer / promo — combo deals, weekday discounts, loyalty rewards (clear CTA + redemption rule)
  7. Origin story / values — chef interviews, sourcing stories, sustainability angles
- **Sonar query templates** — domain-tuned fragments stored in `sonar-queries.ts`; the generic templates from §5 are wrapped with restaurant-specific framing ("…that a restaurant might want to reference…").
- **Image-prompt direction**: warm, golden-hour-style lighting; 45° hero angle for plated dishes; flat-lay for spreads; macro for textures; specify surface (wooden, marble, banana leaf), garnish state, and mood.
- **Platform tactics**: Instagram square (1:1) feed + 9:16 portrait Reels + 5–8 hashtags inline at end of caption; Facebook 4:5 portrait + longer captions + fewer hashtags.
- **Hashtag strategy**: 3-tier mix (broad + cuisine-specific + location-specific); maintain a denylist of banned/shadowbanned tags; refresh trending tags from V2 Sonar daily refresh.
- **Validation rules**: reject FSSAI-violating health claims; warn on captions exceeding platform character limits (Instagram: 2200 total, 125 above-the-fold); warn on missing CTA when post type is `OFFER` or `PROMO`; reject hashtag count outside [3, 15] range.

**Extending to a new domain (future, not now)**: when a second domain is onboarded (e.g., a salon chain, a fitness studio), the path is to add a sibling folder under `specialization/`, implement `IDomainSpecialization`, and wire selection into worker boot via env var or per-restaurant DB field. No changes to `AIContentGenerator`, `ICurrentAffairsProvider`, `IMediaGenerator`, or any cron processor.

**YAGNI guardrail**: no abstractions for cross-domain prompt sharing, domain registry, multi-domain composability, or A/B prompt experimentation are built today. Those are real future possibilities; designing for them now without a second domain in flight would add complexity that pays off only on speculation. The interface above is the smallest seam that protects the future option.

## 7. Tradeoffs

The decision in §4 accepts these tradeoffs intentionally — do not attempt to "fix" them during implementation:

**Intentional commitments:**

- The team maintains ~600–800 LOC of orchestration, durability, and cost-tracking code in lieu of delegating to a framework. This is the cost of provider neutrality.
- No time-travel debugging. When a multi-step workflow fails four steps in, replay starts from the last `generationStep` checkpoint, not from arbitrary state.
- The MongoDB-backed `mediaJobs` store ties durability to MongoDB availability. The entire app already depends on Atlas; this adds no new failure mode.
- Brand-voice consistency relies on prompting alone until V3 ships. Quality may plateau for established restaurants whose customers know the brand voice well — addressed by V3 when triggers in §5.3 fire.
- No built-in agent observability dashboards. The two Azure Monitor Workbooks specified in §4.3 are owned and maintained by the team.

**Realized benefits** (named so the implementer recognizes when they hold):

- Provider portability: model swap is a one-import change.
- Anthropic prompt caching available immediately on Sonnet 4.6 / Haiku 4.5 [^prompt-caching].
- Per-call cost attribution by `restaurantId` / `postId` enables transparent SaaS billing math.
- OpenTelemetry spans flow into the existing Azure Monitor pipeline without new infrastructure.
- Custom orchestrator is small enough (~200 LOC) to rewrite in a week if needed.
- Domain knowledge isolated in `IDomainSpecialization` — restaurant prompts iterate without touching orchestration.

[^prompt-caching]: Anthropic prompt caching documentation: <https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching>

## 8. Revisit Triggers

This ADR should be revisited if **any** of the following occur during or after implementation. If a trigger fires during implementation, escalate before continuing.

1. **Vercel AI SDK license change** — Vercel changes the OSS license of the `ai` package or the `@ai-sdk/*` provider packages (currently MIT — free OSS).
2. **End-of-life or abandonment** — Vercel deprecates or unmaintains the `ai` package (>6 months without a release, or a formal deprecation notice).
3. **Compliance** — a customer requires hosted agent observability with SOC 2 attestation. The mitigation path is **not** to switch SDK; it is to add LangSmith ($39+/user/month) or migrate to a SOC 2-attested agent platform.
4. **Capability gap** — the generator pipeline grows to ≥3 sub-agents, or requires durable execution semantics (resumable workflows from arbitrary state, exactly-once tool execution, time-travel debugging) that custom code becomes infeasible to maintain. In that case, migrate to LangGraph.js or Mastra.
5. **Perplexity Sonar pricing ≥2× current** (currently approximately $1/M input tokens / $1/M output tokens for Sonar; ~$3/M for Sonar Pro) — switch to Brave Search plus custom Claude Haiku summarization.
6. **MongoDB Atlas Vector Search pricing model changes** before V3 ships — re-evaluate against pgvector.
7. **fal.ai outage rate or pricing change** — switch to Replicate using the already-documented fallback implementation.

## 9. Out of Scope

The following are explicitly NOT decided by this ADR and require their own ADRs or specs. Do not build them as part of the current implementation:

- Embedding model choice for V3 (deferred to the V3 ADR).
- Plan-limit / credit-cost economics around AI generation (separate billing decision).
- Image generation safety / NSFW filtering policies (separate ADR).
- Multi-language support beyond English plus Hindi/Hinglish prompts.
- A second `IDomainSpecialization` (salon, fitness, retail) — interface exists; the second implementation is future work.
- Cross-domain prompt sharing, a domain registry, and prompt A/B testing infrastructure — explicit YAGNI; revisit when 2+ domains exist.

## 10. References

- Existing `IContentGenerator` contract: `apps/content-engine/src/services/content-generator/types.ts`
- Existing `PlaceholderContentGenerator`: `apps/content-engine/src/services/content-generator/placeholder-generator.ts`
- Worker boot wiring point: `apps/content-engine/src/worker.ts:114`
- Telemetry package: `packages/telemetry`
- Python reference (LangGraph + LangChain proof-of-concept; not in this repo — ask the original author for access): uses LangGraph `MemorySaver` (in-memory checkpointing only, lost on process restart). The MongoDB-backed `mediaJobs` durability described in §4.3 is a deliberate upgrade over what that proof-of-concept achieved in practice.
