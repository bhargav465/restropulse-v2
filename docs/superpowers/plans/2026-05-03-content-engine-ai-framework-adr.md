# Content-Engine AI Framework ADR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author the formal Architecture Decision Record at `docs/adr/0001-content-engine-ai-framework.md` capturing all decisions made during brainstorming, with a complete 9-framework × 11-axis weighted scoring matrix, primary-source citations, and explicit implementation-pattern scope.

**Architecture:** Docs-only PR. Content is largely a transformation of the brainstorm spec at `docs/superpowers/specs/2026-05-03-content-engine-ai-framework-adr-design.md` into ADR format, plus net-new work: citation research, the full scoring matrix with justifications, tiered prose for top-4 frameworks, and dismissal paragraphs for bottom-5 frameworks.

**Tech Stack:** Markdown only. No code. No tests in the traditional sense — verification is checklist-based per section.

---

## Reference Material

**Source spec (authoritative for all decisions):** `docs/superpowers/specs/2026-05-03-content-engine-ai-framework-adr-design.md`

**Existing project conventions:**
- ADRs do not yet exist in this repo — this creates the convention
- Markdown style: GitHub-flavored, plain ASCII (no emoji per `.github/copilot-instructions.md` "No Special Characters" rule)
- File line endings: LF (the repo is mixed but new files should use LF)

**Frameworks to score (canonical doc URLs the engineer must visit and cite — verify each is live before writing):**

| # | Framework | Primary doc URL |
|---|---|---|
| 1 | Vercel AI SDK | `https://ai-sdk.dev/docs` (also `https://sdk.vercel.ai/docs`) |
| 2 | LangGraph.js | `https://langchain-ai.github.io/langgraphjs/` |
| 3 | Mastra | `https://mastra.ai/docs` |
| 4 | Direct `@anthropic-ai/sdk` | `https://docs.anthropic.com/en/api/client-sdks` |
| 5 | Claude Agent SDK | `https://docs.anthropic.com/en/api/agent-sdk/overview` |
| 6 | Claude Managed Agents | `https://docs.anthropic.com/en/docs/claude-code/agents` (or current canonical URL) |
| 7 | OpenAI Agents SDK (JS) | `https://github.com/openai/openai-agents-js` and `https://openai.github.io/openai-agents-js/` |
| 8 | Inngest Agent Kit | `https://www.inngest.com/docs/agent-kit/overview` |
| 9 | CrewAI-JS / AutoGen-JS | Best community port: `https://github.com/openSVM/crewai-ts` and AutoGen JS bindings (no canonical TypeScript port from MS) |

**Other primary sources to cite:**
- Perplexity Sonar API: `https://docs.perplexity.ai/api-reference/chat-completions`
- fal.ai: `https://docs.fal.ai/`
- MongoDB Atlas Vector Search: `https://www.mongodb.com/docs/atlas/atlas-vector-search/`
- Google Calendar Public Holidays: `https://developers.google.com/calendar/api/v3/reference/calendars`
- Anthropic prompt caching: `https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching`

---

## File Structure

**Files to create:**
- `docs/adr/README.md` — index file for the ADR directory (lists all ADRs with one-line summaries)
- `docs/adr/0001-content-engine-ai-framework.md` — the actual ADR (single deliverable file)

**Files to modify:**
- None (docs-only addition)

**Out of scope:**
- No code changes
- No package.json changes
- No CI changes

---

## Task 1: Create directory + ADR index

**Files:**
- Create: `docs/adr/README.md`

- [ ] **Step 1: Create the ADR directory**

```bash
mkdir -p docs/adr
```

- [ ] **Step 2: Create `docs/adr/README.md`**

Write exactly this content to `docs/adr/README.md`:

```markdown
# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for the RestroPulse codebase. ADRs document significant technical choices, the context behind them, the alternatives considered, and the consequences accepted.

## Format

Each ADR is a single markdown file named `NNNN-short-slug.md` where `NNNN` is a zero-padded sequence number. ADRs are immutable once accepted — superseding decisions get a new ADR that references the prior one in its Status block.

## Status values

- **Proposed** — under review, not yet adopted
- **Accepted** — adopted; implementation has begun or is complete
- **Superseded by NNNN** — replaced by a later ADR; do not follow
- **Deprecated** — no longer recommended; predates a replacement that has not yet been written

## Index

| ID | Title | Status |
|---|---|---|
| 0001 | [Content-Engine AI Framework + Current-Affairs RAG](0001-content-engine-ai-framework.md) | Accepted |

## Authoring guidelines

- Use plain ASCII (no emoji, per the project's "No Special Characters" rule)
- Cite primary sources for every claim about an external framework or API
- Keep §7 Decision definitive — do not write "TBD"
- Include §9 Exit Criteria so a future engineer knows when to revisit
```

- [ ] **Step 3: Commit**

```bash
rtk git add docs/adr/README.md
rtk git commit -m "docs(adr): add ADR directory and index README"
```

---

## Task 2: ADR scaffolding + §1 Status + §2 Context

**Files:**
- Create: `docs/adr/0001-content-engine-ai-framework.md`

- [ ] **Step 1: Create the ADR file with header, §1 Status, and §2 Context**

Write exactly this content as the start of `docs/adr/0001-content-engine-ai-framework.md`:

```markdown
# ADR 0001: Content-Engine AI Framework + Current-Affairs RAG

## 1. Status

**Accepted** — 2026-05-03

This ADR is the first formal architecture decision record for the RestroPulse codebase. It is informed by the brainstorm spec at `docs/superpowers/specs/2026-05-03-content-engine-ai-framework-adr-design.md`.

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
```

- [ ] **Step 2: Verify the file is created with correct content**

```bash
rtk read docs/adr/0001-content-engine-ai-framework.md
```

Expected: file shows §1 and §2 exactly as above, with no placeholders.

- [ ] **Step 3: Commit**

```bash
rtk git add docs/adr/0001-content-engine-ai-framework.md
rtk git commit -m "docs(adr-0001): add status and context sections"
```

---

## Task 3: §3 Decision Drivers

**Files:**
- Modify: `docs/adr/0001-content-engine-ai-framework.md` (append §3)

- [ ] **Step 1: Append §3 Decision Drivers**

Append exactly this content to `docs/adr/0001-content-engine-ai-framework.md`:

```markdown

## 3. Decision Drivers

The eight drivers below are listed in priority order. Each option in §4 is scored on how well it serves these drivers, weighted by the priority of the drivers it touches.

1. **Time-to-robust-product (P0)** — minimal cognitive load, idiomatic TypeScript, slides into the existing `IContentGenerator` interface without architectural changes.
2. **Cost (P0)** — per-call model selection (Haiku for cheap steps, Sonnet for reasoning), Anthropic prompt caching available, transparent token attribution per `restaurantId` / `postId`.
3. **Model portability (P1)** — swapping Anthropic, OpenAI, and Google must not require rewriting orchestration logic.
4. **Multi-modal orchestration (P1)** — text, image, and video API calls in one workflow, with optional user-image editing.
5. **Long-running operation tolerance (P1)** — video generation (30–120s) must not block other content-engine cron processors.
6. **Telemetry integration (P1)** — must emit OpenTelemetry spans into the existing `@restropulse/telemetry` → Azure Monitor pipeline; no proprietary observability lock-in.
7. **Per-customer cost attribution (P1)** — every LLM, image, and video API call must carry labels for `restaurantId`, `postId`, `cycleId`, `operation`, `model`, and `step`.
8. **Vendor lock-in posture (P2)** — escape hatch must be ≤200 LOC if the framework is abandoned.
```

- [ ] **Step 2: Verify no placeholders, no emoji, no broken markdown**

```bash
rtk grep "TBD\|TODO\|FIXME\|XXX\|\\?\\?\\?" docs/adr/0001-content-engine-ai-framework.md
```

Expected: zero matches.

- [ ] **Step 3: Commit**

```bash
rtk git add docs/adr/0001-content-engine-ai-framework.md
rtk git commit -m "docs(adr-0001): add decision drivers section"
```

---

## Task 4: §4 Considered Options — Citation research

**Files:**
- (No file changes yet — this task is research; output goes into a scratch note for use in Tasks 5–7)

- [ ] **Step 1: Visit each framework's primary doc URL and capture three pieces of evidence per framework**

For each of the 9 frameworks, visit the URL listed in the Reference Material section above and capture:

1. **Maturity signal**: latest release date, version, GitHub star count (approximate, OK to round)
2. **TypeScript-native?**: yes (TS-first), partial (Python-port), or no (no first-class TS support)
3. **One distinctive feature** that informs scoring on the 11 axes

Save findings into a scratch buffer (do not commit). Example format:

```
1. Vercel AI SDK
   - URL verified: https://ai-sdk.dev/docs (live)
   - Version: 4.x (released 2025-01)
   - GitHub stars: ~10k+
   - TS-native: yes (TS-first)
   - Distinctive: generateObject() with Zod for typed structured output

2. LangGraph.js
   - URL verified: https://langchain-ai.github.io/langgraphjs/ (live)
   - Version: 0.2.x
   - GitHub stars: ~1k+ (vs. Python sibling's ~10k+)
   - TS-native: partial (Python port)
   - Distinctive: state-graph DSL with first-class checkpointing

... (repeat for all 9)
```

- [ ] **Step 2: Verify Perplexity, fal.ai, Atlas Vector Search URLs are live**

These three appear in §5 and §6 — confirm the URLs in the Reference Material section resolve:

```
- https://docs.perplexity.ai/api-reference/chat-completions
- https://docs.fal.ai/
- https://www.mongodb.com/docs/atlas/atlas-vector-search/
- https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
- https://developers.google.com/calendar/api/v3/reference/calendars
```

If any 404s or has moved, capture the corrected canonical URL.

- [ ] **Step 3: No commit (research only)**

This task produces no file changes — it builds the citation knowledge needed for Tasks 5–7.

---

## Task 5: §4 Considered Options — Scoring matrix

**Files:**
- Modify: `docs/adr/0001-content-engine-ai-framework.md` (append §4 intro + scoring matrix table)

- [ ] **Step 1: Append §4 introduction and scoring rubric**

Append exactly this content:

```markdown

## 4. Considered Options

Nine candidate frameworks were evaluated against the eleven axes from the brainstorm plan. The full weighted matrix appears below. Detailed prose for the top-four contenders follows in §4.1 (each gets approximately 100–200 words). The bottom-five each receive a single-paragraph dismissal in §4.2 citing the dominant disqualifier.

### Scoring rubric

Each cell receives an integer score 1–5:

- **1**: absent or broken
- **2**: present but significantly worse than the median candidate
- **3**: workable with engineering effort
- **4**: better than the median candidate
- **5**: best-in-class

The eleven axes carry the weights specified in the original ADR plan:

| Axis | Weight |
|---|---|
| TypeScript-native DX | 1.0 |
| Feature fit (`draftCycle` / `reviseCycle` / `generatePost` / `revisePost`) | 2.0 |
| Current-affairs RAG integration | 1.0 |
| LLM portability | 1.0 |
| Cost trajectory | 1.5 |
| Vendor lock-in | 1.0 |
| Maintenance burden | 1.0 |
| Community activity | 1.0 |
| Observability hooks | 1.0 |
| Streaming support | 1.0 |
| Testability | 1.0 |

Total maximum weighted score per framework: 5 × (1+2+1+1+1.5+1+1+1+1+1+1) = **62.5**.
```

- [ ] **Step 2: Score each of the 9 frameworks honestly using the rubric, then append the matrix table**

For each framework, assign a 1–5 score per axis and write a one-line justification in a footnote. **Do not** make scores up to favor a particular winner — the design's recommendation (Vercel AI SDK) was reached during brainstorming on the same evidence; score honestly and the math will reflect it.

The expected ordering after scoring (from highest to lowest weighted total, based on the brainstorm analysis):

1. Vercel AI SDK (~52–55)
2. Mastra (~46–50)
3. LangGraph.js (~44–48)
4. Direct `@anthropic-ai/sdk` (~42–46)
5. Inngest Agent Kit (~36–40)
6. Claude Agent SDK (~34–38)
7. OpenAI Agents SDK (~32–36)
8. Claude Managed Agents (~28–32)
9. CrewAI-JS / AutoGen-JS ports (~22–28)

If your scoring produces a materially different ordering (top-2 swap, or anything non-Vercel-AI-SDK in #1), stop and re-read the brainstorm spec — the rubric should produce roughly the order above. If you still disagree after re-reading, document your dissent in §7 Decision and surface it to the human reviewer rather than fudging scores.

Append the matrix in this exact structural form (fill in your justified scores; **example shown for one framework only — replicate the structure for all nine**):

```markdown
### Scoring matrix

| Framework | TS DX (1.0) | Feature fit (2.0) | RAG (1.0) | Portability (1.0) | Cost (1.5) | Lock-in (1.0) | Maintenance (1.0) | Community (1.0) | Observability (1.0) | Streaming (1.0) | Testability (1.0) | **Weighted Total** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Vercel AI SDK [^vercel] | 5 | 4 | 4 | 5 | 5 | 5 | 4 | 5 | 4 | 5 | 5 | **(compute)** |
| LangGraph.js [^langgraph] | 3 | 5 | 4 | 5 | 4 | 4 | 3 | 4 | 5 | 4 | 4 | **(compute)** |
| Mastra [^mastra] | 5 | 5 | 4 | 5 | 4 | 4 | 3 | 3 | 5 | 4 | 4 | **(compute)** |
| Direct `@anthropic-ai/sdk` [^anthropic-sdk] | 5 | 3 | 3 | 1 | 5 | 1 | 4 | 5 | 3 | 5 | 5 | **(compute)** |
| Claude Agent SDK [^claude-agent] | 4 | 4 | 3 | 1 | 4 | 1 | 3 | 3 | 4 | 4 | 4 | **(compute)** |
| Claude Managed Agents [^claude-managed] | 3 | 4 | 3 | 1 | 2 | 1 | 4 | 2 | 4 | 3 | 3 | **(compute)** |
| OpenAI Agents SDK (JS) [^openai-agents] | 4 | 4 | 3 | 2 | 3 | 2 | 3 | 4 | 4 | 4 | 4 | **(compute)** |
| Inngest Agent Kit [^inngest] | 4 | 4 | 3 | 4 | 3 | 2 | 4 | 3 | 4 | 4 | 4 | **(compute)** |
| CrewAI-JS / AutoGen-JS ports [^autogen-js] | 3 | 3 | 2 | 3 | 3 | 3 | 2 | 2 | 2 | 2 | 3 | **(compute)** |

[^vercel]: Vercel AI SDK official documentation: <https://ai-sdk.dev/docs> (mirror at <https://sdk.vercel.ai/docs>)
[^langgraph]: LangGraph.js official documentation: <https://langchain-ai.github.io/langgraphjs/>
[^mastra]: Mastra official documentation: <https://mastra.ai/docs>
[^anthropic-sdk]: Anthropic Claude SDK reference: <https://docs.anthropic.com/en/api/client-sdks>
[^claude-agent]: Claude Agent SDK overview: <https://docs.anthropic.com/en/api/agent-sdk/overview>
[^claude-managed]: Claude Managed Agents documentation: <https://docs.anthropic.com/en/docs/claude-code/agents>
[^openai-agents]: OpenAI Agents SDK (JS) repository and docs: <https://github.com/openai/openai-agents-js> and <https://openai.github.io/openai-agents-js/>
[^inngest]: Inngest Agent Kit documentation: <https://www.inngest.com/docs/agent-kit/overview>
[^autogen-js]: AutoGen JavaScript bindings (community): <https://github.com/microsoft/autogen> (Python primary; JS bindings are best-effort community ports)
```

- [ ] **Step 3: Compute weighted totals manually and replace `**(compute)**` placeholders**

For each row, compute: `(TS DX × 1.0) + (Feature fit × 2.0) + (RAG × 1.0) + (Portability × 1.0) + (Cost × 1.5) + (Lock-in × 1.0) + (Maintenance × 1.0) + (Community × 1.0) + (Observability × 1.0) + (Streaming × 1.0) + (Testability × 1.0)`.

Replace each `**(compute)**` cell with the computed total to one decimal place.

Sanity check: the highest total should land on Vercel AI SDK if the rubric was applied consistently; if not, re-read the brainstorm spec and re-evaluate before continuing.

- [ ] **Step 4: Verify no placeholders remain**

```bash
rtk grep "compute\|TBD\|TODO" docs/adr/0001-content-engine-ai-framework.md
```

Expected: zero matches.

- [ ] **Step 5: Commit**

```bash
rtk git add docs/adr/0001-content-engine-ai-framework.md
rtk git commit -m "docs(adr-0001): add §4 considered options and full scoring matrix"
```

---

## Task 6: §4.1 — Top-4 framework prose

**Files:**
- Modify: `docs/adr/0001-content-engine-ai-framework.md` (append §4.1)

- [ ] **Step 1: Append §4.1 with detailed prose for the top-4 frameworks**

Append exactly this content (each paragraph 100–200 words; do not exceed 200):

```markdown

### 4.1 Top-four contenders (detailed treatment)

#### 4.1.1 Vercel AI SDK

Vercel AI SDK is the most mature TypeScript LLM library, providing a uniform API surface (`generateText`, `generateObject`, `streamText`) over Anthropic, OpenAI, Google, and a dozen other providers via thin `@ai-sdk/<provider>` packages. `generateObject` paired with Zod schemas gives typed, validated structured output without bespoke JSON-schema construction; tool-calling is a first-class concept (`tools` parameter on every call). Anthropic prompt caching is supported via provider options. The SDK emits OpenTelemetry spans natively when `experimental_telemetry: { isEnabled: true }` is set, which routes directly into the existing `@restropulse/telemetry` pipeline. The library is MIT-licensed OSS published at `npm:ai`; no Vercel-hosted services are required and no telemetry phones home to Vercel. The trade-off is the absence of an opinionated agent state-machine — orchestrators are written as plain typed async functions. For the four bounded `IContentGenerator` operations that is an asset, not a liability: control flow remains debuggable as ordinary TypeScript without learning a graph DSL.

#### 4.1.2 LangGraph.js

LangGraph.js is the TypeScript port of LangChain's LangGraph state-machine framework. It models agent workflows as a graph of nodes and edges with first-class checkpointing (memory, SQLite, or Postgres back-ends), human-in-the-loop primitives, and time-travel debugging. Production usage is broad — LinkedIn, Klarna, Replit, and Uber publicly cite it. The trade-offs are real: the TypeScript port lags the Python original in features and idiom (the public examples often read as Python translated to TS), the state-graph mental model is heavier than four bounded operations require, and durable execution at scale typically routes engineers toward LangGraph Platform (paid hosted runtime) or LangSmith (paid observability). For our content-engine, the agent surface is too small to exploit graph semantics; we would adopt LangGraph principally for its checkpointing, which we replicate in ~150 LOC of MongoDB-backed job tracking.

#### 4.1.3 Mastra

Mastra is a TypeScript-first agent framework built on top of Vercel AI SDK, with opinionated primitives for agents, tools, workflows, memory, and evaluations. It is the most ergonomic agent framework in TypeScript today and offers durable workflow execution suitable for long-running video generation. The maturity caveat is real: Mastra reached v1 in 2025, the API still evolves between minor releases, and the community is roughly an order of magnitude smaller than LangChain's. Because Mastra is layered on Vercel AI SDK, the escape hatch is straightforward — disable Mastra's agent abstractions and call the underlying SDK directly. We would adopt Mastra if the agent shape grew sub-agents or self-correcting loops, but at four bounded operations the overhead does not pay back.

#### 4.1.4 Direct `@anthropic-ai/sdk`

The official Anthropic Node.js SDK provides the deepest Claude-specific feature surface: native tool use, prompt caching with the longest TTL among Claude APIs, extended thinking, citations, fine-grained streaming control, and access to all Anthropic-only model parameters. Cost discipline is strongest here because every cost-relevant primitive is directly accessible. The disqualifier on this ADR's drivers is portability: switching to OpenAI or Google requires rewriting both the orchestrator and every prompt template. Given the explicit P1 driver "model portability," locking the codebase to Anthropic on day one is not acceptable. The Direct SDK remains the right tool when Anthropic is the only provider in scope, which is not the case here.
```

- [ ] **Step 2: Verify section length and absence of placeholders**

```bash
rtk grep "TBD\|TODO\|FIXME\|XXX" docs/adr/0001-content-engine-ai-framework.md
```

Expected: zero matches.

- [ ] **Step 3: Commit**

```bash
rtk git add docs/adr/0001-content-engine-ai-framework.md
rtk git commit -m "docs(adr-0001): add detailed prose for top-4 framework contenders"
```

---

## Task 7: §4.2 — Bottom-5 framework dismissals

**Files:**
- Modify: `docs/adr/0001-content-engine-ai-framework.md` (append §4.2)

- [ ] **Step 1: Append §4.2 with one-paragraph dismissals for the bottom-5**

Append exactly this content:

```markdown

### 4.2 Other candidates (one-paragraph dismissals)

#### 4.2.1 Claude Agent SDK

Anthropic's official agent SDK provides clean primitives for tool-using agents on Claude. The dominant disqualifier is portability: it is Claude-only by design. Adopting it would couple every prompt and orchestration decision to a single provider, directly conflicting with the P1 model-portability driver. Useful for Claude-only products; not useful for a SaaS that may need to mix providers based on cost, latency, or capability.

#### 4.2.2 Claude Managed Agents

Hosted, server-side Claude agents managed by Anthropic. Strong observability and zero-infrastructure for the consumer, but inverts our cost and lock-in posture: pricing is opaque relative to direct API calls, and migrating away requires rewriting every workflow. Telemetry routes through Anthropic's hosted dashboard rather than our Azure Monitor pipeline, violating the telemetry-integration driver. Appropriate for organizations that want to outsource agent runtime entirely; not a fit when an Azure-hosted content-engine already exists.

#### 4.2.3 OpenAI Agents SDK (JS)

OpenAI's TypeScript agents library is well-documented and ergonomic for GPT-4o and o-series models. Documentation, examples, and tool-use ergonomics are tuned for OpenAI. Anthropic models work but as second-class citizens; prompt caching, extended thinking, and streaming idioms differ. Choosing the OpenAI Agents SDK as the orchestration layer biases prompt-engineering effort toward OpenAI and away from Anthropic, working against cost-optimization on Claude Haiku 4.5 and Sonnet 4.6. Dismissed for the same reason the Direct Anthropic SDK is dismissed: it favors one provider when the design requires neutrality.

#### 4.2.4 Inngest Agent Kit

Inngest's agent kit pairs an LLM-and-tools abstraction with Inngest's durable workflow runtime. The durability story is genuinely strong — exactly the surface that makes 30–120 second video-generation polling tractable. The disqualifier is the runtime dependency: adopting Agent Kit as the orchestration layer also commits the content-engine to running on Inngest's worker model, either self-hosted or via Inngest Cloud. The content-engine already runs as a node-cron worker with MongoDB-backed durability that we own, and we only need partial durability (resume-from-last-checkpoint), not exactly-once tool execution. Adopting Inngest for that subset would replace tooling we control with tooling we do not.

#### 4.2.5 CrewAI-JS / AutoGen-JS ports

Both frameworks are mature in their original Python implementations. The TypeScript ports are community-maintained, lag the Python feature surface, and have neither the mindshare nor the contributor base of LangGraph.js or Mastra. AutoGen does not ship a first-party TypeScript runtime; CrewAI's TS ports are best-effort. For a production codebase with maintenance lifetimes measured in years, depending on a community port that may stall is a poor risk profile. Dismissed on community-activity and maintenance-burden grounds.
```

- [ ] **Step 2: Commit**

```bash
rtk git add docs/adr/0001-content-engine-ai-framework.md
rtk git commit -m "docs(adr-0001): add dismissal paragraphs for bottom-5 frameworks"
```

---

## Task 8: §5 Current-Affairs RAG Sub-Decision

**Files:**
- Modify: `docs/adr/0001-content-engine-ai-framework.md` (append §5)

- [ ] **Step 1: Append §5 — lifted from §4 of the spec, expanded with citations**

Append exactly this content:

```markdown

## 5. Current-Affairs RAG Sub-Decision

The `currentAffairsHints: string[]` field on each `IContentGenerator` operation accepts time-sensitive context that informs caption tone and thematic angles (festival tie-ins, sports outcomes, weather, regional cuisine trends). This sub-decision selects how those strings are populated.

The right framing is **layered by data freshness vs cost vs value**, with three tiers and an explicit split between current-affairs RAG (real-time, no vector store) and brand-voice RAG (long-lived, vector store). Tiers V1 and V2 ship in the initial release; V3 is documented as a deferred future option with explicit rebuild triggers.

### V1 — Calendar / holiday injection (in scope, ships first)

- **Source**: Google Calendar Public Holidays API, India calendar id `en.indian#holiday@group.v.calendar.google.com` [^gcal]
- **Cadence**: daily refresh job at 06:00 IST, cached in MongoDB for 24 hours
- **Injection content**: today's date / weekday / month / India holiday name (when within ±3 days)
- **Cost**: zero incremental
- **Estimated build**: 150–200 LOC, 2–3 days

### V2 — Real-time current affairs (in scope, ships in same release as V1)

- **Source**: Perplexity Sonar Pro API as a unified current-affairs and trending-hashtags oracle [^sonar]
- **Cadence (two-tier)**:
  1. **Daily refresh** at 06:00 IST: one Sonar Pro call asking *"What are the major events, sports outcomes, festivals, weather events, and trending topics in India today and tomorrow that a restaurant might want to reference in social media content?"* — cached 24 hours, shared across all restaurants generating posts that day.
  2. **Per-post hyperlocal augmentation**: at `generatePost` time, when the `concept` field matches an allowlist of triggers (sports, festivals, weather, regional cuisine), make a targeted Sonar call for that specific angle.
- **Cost**: ~$0.10/day platform-wide for the daily refresh, plus ~$0.30–0.90/restaurant/month for per-post triggers (assuming a 20% trigger rate on 30 posts/month/restaurant)
- **Estimated build**: 300–500 LOC, 4–5 days

### V3 — Brand-voice / restaurant-specific RAG (DEFERRED)

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

### Rejected V2 candidates (documented for future reference)

The plan listed several candidates besides Perplexity Sonar. Each is dismissed below with the dominant reason:

- **Brave Search** — cheap raw search results but requires a downstream summarization step that Sonar bundles for free. Listed as the V2 fallback if Sonar pricing changes.
- **NewsAPI** — production tier ~$449/month; US-news-heavy; weak India coverage.
- **Google News RSS** — free but no language/region filtering; aggregation overhead.
- **SerpAPI** — $130+/month; raw search results only.
- **X / Twitter API v2** — Basic tier $200/month with restrictive call limits; API access has been unreliable since 2023.
- **Reddit JSON** — free; India-specific signal for restaurant content is weak.
- **Indian regional feeds (Times of India, NDTV RSS)** — free but aggregation overhead and uneven language coverage.

### RAG decision summary

| Tier | Scope | Build now? | Estimated cost / restaurant / month |
|---|---|---|---|
| V1 | Calendar / holiday injection | Yes | $0 |
| V2 | Daily Sonar refresh + per-post hyperlocal triggers | Yes | ~$0.30–1.00 |
| V3 | Atlas Vector Search for brand voice | No (deferred with explicit triggers) | n/a |

**Vector store decision**: not relevant to V1 or V2 (current affairs has a half-life of hours). Only relevant to V3, where MongoDB Atlas Vector Search is the primary candidate by infrastructure adjacency.

[^gcal]: Google Calendar API — Calendars resource: <https://developers.google.com/calendar/api/v3/reference/calendars>
[^sonar]: Perplexity Sonar API reference: <https://docs.perplexity.ai/api-reference/chat-completions>
[^atlas-vector]: MongoDB Atlas Vector Search documentation: <https://www.mongodb.com/docs/atlas/atlas-vector-search/>
```

- [ ] **Step 2: Commit**

```bash
rtk git add docs/adr/0001-content-engine-ai-framework.md
rtk git commit -m "docs(adr-0001): add §5 current-affairs RAG sub-decision (V1+V2 in scope, V3 deferred)"
```

---

## Task 9: §6 Pluggable Architecture (incl. IDomainSpecialization)

**Files:**
- Modify: `docs/adr/0001-content-engine-ai-framework.md` (append §6)

- [ ] **Step 1: Append §6**

Append exactly this content:

```markdown

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
```

- [ ] **Step 2: Verify long code blocks render correctly (no broken fences)**

```bash
rtk grep "^\\\`\\\`\\\`" docs/adr/0001-content-engine-ai-framework.md | wc -l
```

Expected: even number (every opening fence has a matching close).

- [ ] **Step 3: Commit**

```bash
rtk git add docs/adr/0001-content-engine-ai-framework.md
rtk git commit -m "docs(adr-0001): add §6 pluggable architecture incl. IDomainSpecialization"
```

---

## Task 10: §7 Decision (definitive)

**Files:**
- Modify: `docs/adr/0001-content-engine-ai-framework.md` (append §7)

- [ ] **Step 1: Append §7**

Append exactly this content:

```markdown

## 7. Decision

Two coupled decisions, in scope for the same release:

### 7.1 Framework

**Adopt Vercel AI SDK (`ai` package + `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google` providers) as the LLM and tool-orchestration layer. Build a thin custom orchestrator (~200 LOC) inside `apps/content-engine/src/services/content-generator/ai-generator/` that implements `IContentGenerator` by composing typed async functions:**

```text
searchTrends() -> generateCaption() -> generateMedia() -> assemblePost()
```

No agent state-machine framework is adopted; orchestration stays plain TypeScript with typed Zod-validated boundaries.

### 7.2 Current-Affairs RAG

**Implement V1 (calendar/holiday injection) and V2 (daily Sonar Pro refresh + per-post hyperlocal triggers) in the initial release. Defer V3 (Atlas Vector Search for brand voice) until production evidence justifies it, per the rebuild triggers in §5.**

### 7.3 Implementation patterns scoped IN

These four patterns are mandatory implementation scope; the framework choice does not earn its keep without them:

1. **Retry helper** — `withRetry(fn, { maxAttempts, backoff: "exponential", retryOn: [TransientError, RateLimitError] })`. Profiles per surface: LLM (3 attempts, 1s/2s/4s backoff), image gen submission (3 attempts, 5s/10s/20s backoff), video gen submission (5 attempts, 10s/20s/40s/80s/160s backoff). Never retry on 4xx; always retry on 429/502/503/504.
2. **Durable video-generation polling** — new MongoDB `mediaJobs` collection; submission writes a row and returns immediately; new `mediaJobPoller` cron (every 30s) polls RUNNING jobs and resolves them; stale RUNNING jobs (>10 min) reset to PENDING. The `generatePost` worker never blocks for video gen.
3. **Crash-safe partial durability** — idempotent operations keyed on `jobId`; `generationStep` checkpoints on the post (`SEARCHING_TRENDS -> CAPTION_DONE -> MEDIA_REQUESTED -> MEDIA_DONE`); worker startup re-enqueues posts in non-terminal states older than 5 min from the last completed step. Explicitly **not** implementing exactly-once tool execution or time-travel debugging.
4. **Cost tracking + observability** — `withCostTracking(fn, { restaurantId, postId, cycleId, operation, model, step })` wrapper emits OTel metrics (`genai.tokens.input`, `genai.tokens.output`, `genai.cost.usd`, `genai.duration.ms`) and persists denormalized rows to a `cost_events` MongoDB collection. Two Azure Monitor Workbooks ship with the implementation: **Cost-by-restaurant** (stacked bar by API surface per restaurant per month) and **Per-post audit** (drill into any `postId` to see every API call's tokens, cost, and latency).

### 7.4 Image / video generation API

**Primary: `FalAIMediaGenerator` for image (Flux dev / Flux fill for editing) and video (Kling 1.6 / MiniMax) [^fal-ai].** Replicate is documented as the fallback and implemented as an `IMediaGenerator` alternative if fal.ai pricing or availability changes. Runway Gen-3 is deferred to a premium subscription tier and not built in the initial release.

### 7.5 Domain Specialization

**Adopt the `IDomainSpecialization` module described in §6.2. Ship `RestaurantSpecialization` as the only concrete implementation. Do not build registry, A/B prompt-testing, or cross-domain abstractions until a second domain is in flight.**

### 7.6 Rationale (one paragraph)

Vercel AI SDK is the most mature TypeScript LLM library, gives provider neutrality at zero cost, has first-class structured output via Zod, supports Anthropic prompt caching natively, and emits OpenTelemetry spans that route into the existing `@restropulse/telemetry` and Azure Monitor pipeline without new infrastructure. The four `IContentGenerator` operations are bounded enough that a custom orchestrator is faster to write than learning an agent DSL, and remains easy to evolve toward Mastra or LangGraph if multi-agent patterns later emerge. Per-customer cost attribution via `withCostTracking` and durable video-generation polling via the `mediaJobs` collection cover the operational gaps that not-using-an-agent-framework leaves, in less than 800 LOC. The `IDomainSpecialization` seam keeps domain knowledge isolated so prompts can iterate without touching orchestration and a future second domain plugs in without core changes. The decision favors time-to-robust-product and cost over framework richness, matching the explicit P0 drivers.

[^fal-ai]: fal.ai documentation: <https://docs.fal.ai/>
```

- [ ] **Step 2: Verify §7 is definitive — search for any TBD or hedge words**

```bash
rtk grep "TBD\|TODO\|maybe\|possibly\|likely" docs/adr/0001-content-engine-ai-framework.md
```

Expected: zero matches (or only in §3/§4 prose where "likely" is descriptive of trade-offs, not the decision).

- [ ] **Step 3: Commit**

```bash
rtk git add docs/adr/0001-content-engine-ai-framework.md
rtk git commit -m "docs(adr-0001): add definitive §7 decision (framework + RAG + patterns + media + specialization)"
```

---

## Task 11: §8 Consequences

**Files:**
- Modify: `docs/adr/0001-content-engine-ai-framework.md` (append §8)

- [ ] **Step 1: Append §8**

Append exactly this content:

```markdown

## 8. Consequences

### 8.1 Positive

- Provider portability preserved — model swap is a one-import change.
- Smallest cognitive load for engineers familiar with TypeScript; no new DSL.
- Anthropic prompt caching available immediately on Claude Sonnet 4.6 / Haiku 4.5 [^prompt-caching].
- Per-call cost attribution by `restaurantId` / `postId` enables transparent SaaS billing math.
- OpenTelemetry spans flow into the existing Azure Monitor pipeline without new infrastructure.
- V1 + V2 RAG ships in approximately 6–8 days of engineering work; total RAG cost is under ~$1/restaurant/month at MVP scale.
- Custom orchestrator is small enough (~200 LOC) to rewrite in a week if needed.
- Pluggable architecture means V3, alternative providers, and framework migration are future options, not rewrites.
- Domain knowledge isolated in `IDomainSpecialization` — restaurant content quality improves via prompt iteration without touching orchestration; future domains (salon, fitness, retail) plug in without core changes.

### 8.2 Negative

- The team commits to maintaining ~600–800 LOC of orchestration, durability, and cost-tracking code in lieu of delegating to a framework.
- No time-travel debugging — when a multi-step workflow fails four steps in, replay starts from the last checkpoint, not from arbitrary state.
- The MongoDB-backed `mediaJobs` store ties durability to MongoDB availability (acceptable; the entire app already depends on Atlas).
- Brand-voice consistency relies on prompting alone until V3 ships — quality may plateau for established restaurants whose customers know the brand voice well.
- No built-in agent observability dashboards — the team relies on Azure Monitor Workbooks built against custom metrics. Workbooks are scoped IN per §7.3 but are owned and maintained by the team.

### 8.3 Neutral

- Image / video generation primary is fal.ai with Replicate as the documented fallback path; cost monitoring per §7.3 will surface drift if pricing changes.
- Embedding model choice for V3 is deferred to the V3 ADR.

[^prompt-caching]: Anthropic prompt caching documentation: <https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching>
```

- [ ] **Step 2: Commit**

```bash
rtk git add docs/adr/0001-content-engine-ai-framework.md
rtk git commit -m "docs(adr-0001): add §8 consequences (positive, negative, neutral)"
```

---

## Task 12: §9 Exit Criteria + §10 Out of Scope + §11 References

**Files:**
- Modify: `docs/adr/0001-content-engine-ai-framework.md` (append §9, §10, §11)

- [ ] **Step 1: Append §9, §10, §11**

Append exactly this content:

```markdown

## 9. Exit Criteria

This ADR should be revisited if **any** of the following occur:

1. **Vercel AI SDK license change** — Vercel changes the OSS license of the `ai` package or the `@ai-sdk/*` provider packages (currently MIT — free OSS).
2. **End-of-life or abandonment** — Vercel deprecates or unmaintains the `ai` package (>6 months without a release, or a formal deprecation notice).
3. **Compliance** — a customer requires hosted agent observability with SOC 2 attestation. The mitigation path is **not** to switch SDK; it is to add LangSmith ($39+/user/month) or migrate to a SOC 2-attested agent platform.
4. **Capability gap** — the generator pipeline grows to ≥3 sub-agents, or requires durable execution semantics (resumable workflows from arbitrary state, exactly-once tool execution, time-travel debugging) that custom code becomes infeasible to maintain. In that case, migrate to LangGraph.js or Mastra.
5. **Perplexity Sonar pricing ≥2× current** (currently approximately $1/M input tokens / $1/M output tokens for Sonar; ~$3/M for Sonar Pro) — switch to Brave Search plus custom Claude Haiku summarization.
6. **MongoDB Atlas Vector Search pricing model changes** before V3 ships — re-evaluate against pgvector.
7. **fal.ai outage rate or pricing change** — switch to Replicate using the already-documented fallback implementation.

## 10. Out of Scope

The following are explicitly NOT decided by this ADR and require their own ADRs or specs:

- Embedding model choice for V3 (deferred to the V3 ADR).
- Plan-limit / credit-cost economics around AI generation (separate billing decision).
- Image generation safety / NSFW filtering policies (separate ADR).
- Multi-language support beyond English plus Hindi/Hinglish prompts.
- A second `IDomainSpecialization` (salon, fitness, retail) — interface exists; the second implementation is future work.
- Cross-domain prompt sharing, a domain registry, and prompt A/B testing infrastructure — explicit YAGNI; revisit when 2+ domains exist.

## 11. References

- Brainstorm spec: `docs/superpowers/specs/2026-05-03-content-engine-ai-framework-adr-design.md`
- Existing `IContentGenerator` contract: `apps/content-engine/src/services/content-generator/types.ts`
- Existing `PlaceholderContentGenerator`: `apps/content-engine/src/services/content-generator/placeholder-generator.ts`
- Worker boot wiring point: `apps/content-engine/src/worker.ts:114`
- Telemetry package: `packages/telemetry`
- Python reference (LangGraph + LangChain proof-of-concept): `D:\Work\restx-experimental\restx-experimental` — uses LangGraph `MemorySaver` (in-memory checkpointing only, lost on process restart).
```

- [ ] **Step 2: Commit**

```bash
rtk git add docs/adr/0001-content-engine-ai-framework.md
rtk git commit -m "docs(adr-0001): add §9 exit criteria, §10 out of scope, §11 references"
```

---

## Task 13: Final review and ADR index update

**Files:**
- Modify: `docs/adr/0001-content-engine-ai-framework.md` (final consistency pass)
- Verify: `docs/adr/README.md` already lists ADR 0001 (done in Task 1)

- [ ] **Step 1: Verify no placeholders remain anywhere in the file**

```bash
rtk grep "TBD\|TODO\|FIXME\|XXX\|\\?\\?\\?\|<<<\|>>>" docs/adr/0001-content-engine-ai-framework.md
```

Expected: zero matches.

- [ ] **Step 2: Verify no emoji or non-ASCII special characters**

```bash
rtk grep -P "[^\\x00-\\x7F]" docs/adr/0001-content-engine-ai-framework.md
```

Expected: zero matches (the project's "No Special Characters" rule).

- [ ] **Step 3: Verify all footnote references resolve**

```bash
rtk grep "\\[\\^[a-z-]*\\]" docs/adr/0001-content-engine-ai-framework.md
```

Every footnote reference (`[^name]`) should appear at least twice — once as a citation, once as a definition.

- [ ] **Step 4: Verify scoring matrix totals are computed (no `(compute)` left)**

```bash
rtk grep "compute" docs/adr/0001-content-engine-ai-framework.md
```

Expected: zero matches.

- [ ] **Step 5: Verify the file structure (correct section ordering, no duplicate sections)**

Read the entire file and confirm sections appear in this order:

```
## 1. Status
## 2. Context
## 3. Decision Drivers
## 4. Considered Options
### 4.1 Top-four contenders (detailed treatment)
### 4.2 Other candidates (one-paragraph dismissals)
## 5. Current-Affairs RAG Sub-Decision
## 6. Pluggable Architecture
### 6.1 Decorator pattern for V1 / V2 / V3 plug-ability
### 6.2 Domain Specialization Module (IDomainSpecialization)
## 7. Decision
## 8. Consequences
## 9. Exit Criteria
## 10. Out of Scope
## 11. References
```

```bash
rtk grep "^## \|^### " docs/adr/0001-content-engine-ai-framework.md
```

Compare output line-by-line against the expected list above.

- [ ] **Step 6: Verify the ADR index is up to date**

```bash
rtk read docs/adr/README.md
```

Expected: contains the row for ADR 0001 with status "Accepted" (set in Task 1).

- [ ] **Step 7: If all checks pass, no commit needed (review only). If any check failed, fix inline and commit:**

```bash
rtk git add docs/adr/0001-content-engine-ai-framework.md
rtk git commit -m "docs(adr-0001): final review fixes"
```

---

## Task 14: Open the PR

**Files:**
- None (PR creation only)

- [ ] **Step 1: Push the branch**

```bash
rtk git push -u origin feature/content-engine
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "docs(adr-0001): content-engine AI framework + current-affairs RAG" --body "$(cat <<'EOF'
## Summary

- Adds the first formal ADR to the codebase: `docs/adr/0001-content-engine-ai-framework.md`
- Decision: Vercel AI SDK + thin custom orchestrator (provider-neutral, OpenTelemetry-native)
- RAG: V1 (calendar) + V2 (Perplexity Sonar daily refresh + per-post triggers); V3 (Atlas Vector Search for brand voice) deferred with explicit rebuild triggers
- Implementation patterns scoped IN: retry helper, durable mediaJobs polling, crash-safe partial durability, cost tracking, two Azure Monitor Workbooks
- Pluggable architecture incl. `IDomainSpecialization` for future-domain extensibility (only `RestaurantSpecialization` shipped in initial scope)
- Brainstorm spec at `docs/superpowers/specs/2026-05-03-content-engine-ai-framework-adr-design.md` is the upstream design source

## Test plan

- [ ] Reviewer reads §7 Decision and confirms it is definitive (no "TBD")
- [ ] Reviewer spot-checks 3 of 9 framework citations resolve to live docs
- [ ] Reviewer confirms scoring matrix top-3 ordering matches the prose recommendation
- [ ] Reviewer verifies §6.2 IDomainSpecialization interface satisfies the "single seam for future domain extension" requirement
- [ ] Reviewer confirms exit criteria in §9 are concrete and trigger-based, not date-based
EOF
)"
```

- [ ] **Step 3: Return the PR URL to the human reviewer.**

---

## Self-review checklist (run after writing this plan, before handing to executor)

- [x] **Spec coverage**: every section of the spec at `docs/superpowers/specs/2026-05-03-content-engine-ai-framework-adr-design.md` maps to a task above. The 11-axis scoring matrix is in Task 5; the V1/V2/V3 RAG strategy is in Task 8; `IDomainSpecialization` is in Task 9; the implementation patterns (retry, durable polling, cost tracking) are in Task 10 §7.3.
- [x] **Placeholder scan**: no "TBD", "TODO", "implement later" appear in any task; the only intentionally-deferred content is the engineer's scoring values in Task 5 (rubric and ordering hints provided so the engineer can score honestly).
- [x] **Type consistency**: interface names (`IContentGenerator`, `IDomainSpecialization`, `ICurrentAffairsProvider`, `IMediaGenerator`, `IMediaJobStore`, `ILLMProvider`) are spelled identically across all tasks.
- [x] **No code in PR**: every task is markdown only; the only `.md` files are `docs/adr/README.md` and `docs/adr/0001-content-engine-ai-framework.md`.
