# Restaurant Intelligence — Backend Change Summary (for manual review)

This documents every **backend** change made to add Restaurant Intelligence,
ported from the reference workspace. Branch: `feature/restaurant-intelligence`.
Frontend/UI changes are excluded here (see the commit log for those).

> **Verification status up front (read this first):**
> - **Type-checks clean** across `@restropulse/shared`, `@restropulse/db`, `@restropulse/api`, `@restropulse/intelligence-worker`.
> - **Runtime-verified:** the `intelligence-worker` — its **32 unit tests pass** against `mongodb-memory-server` (alerts/backfill/daily/prune/refresh/sweep).
> - **NOT runtime-verified:** the API routes + services have **not** been exercised against a running MongoDB or the live Google Places / Anthropic APIs. `db-cli setup` (which creates the new collections) has **not** been run. No API service/route unit tests were added yet.

---

## 1. New MongoDB collections (6 + 1 shared)

Declared in the canonical schema `apps/db-cli/src/schemas/collections.ts`
(`db-cli setup`/`validate` create + manage indexes). Names are **camelCase**
to match this repo's convention (the reference used snake_case).

| Collection | Indexes | Purpose |
|---|---|---|
| `intelligenceScans` | `{restaurantId, createdAt:-1}` | Async scan jobs (one per scan request) |
| `intelligenceReports` | `{restaurantId, generatedAt:-1}` | Completed reports; worker prunes to last 12/restaurant |
| `competitorCache` | `{placeId}` unique; `{fetchedAt}` **TTL 7 days** | Google Places (New) results, expire to control cost |
| `intelligenceSnapshots` | `{restaurantId, targetPlaceId, source, date}` unique; `{restaurantId, date:-1}` | Daily snapshots (target×source×day); unique makes the daily job an idempotent upsert |
| `nearbySightings` | `{restaurantId, placeId}` unique; `{restaurantId, firstSeenAt:-1}` | First-seen registry for the New Openings radar |
| `zomatoManualEntries` | `{restaurantId, targetPlaceId, date:-1}` | Merchant-entered Zomato numbers |
| `events` (shared) | `{restaurantId, ts:-1}`; `{name, ts:-1}` | Best-effort analytics signals (worker scan/alert events). Pre-existing concept; formally registered now. |

Getters live in `packages/db/src/intelligence.ts` (`getIntelligence*Collection`,
`getCompetitorCacheCollection`, `getNearbySightingsCollection`,
`getZomatoManualEntriesCollection`, `getEventsCollection`), matching the
existing `users.ts`/`posts.ts` helper pattern. Also: `assertWatchlistSize`,
`insertAnalyticsEvent`, consts `COMPETITOR_CACHE_TTL_SECONDS`,
`MAX_REPORTS_PER_RESTAURANT`, `WATCHLIST_MAX`.

**Watchlist** is NOT a collection — it's stored on the `restaurant.intelligence`
sub-document (see §5).

---

## 2. API services — `apps/api/src/services/intelligence/*` (14 files)

Pure (no I/O, unit-testable): `scoring.ts` (6-pillar RestroScore + threat
scoring), `compare.ts` ("where they beat you" gaps + new-openings), `buckets.ts`,
`themes.ts`, `report-builder.ts`, `scan-status.ts`, `errors.ts`, `prompts.ts`.

External-facing (**degrade gracefully** when their key is absent):
- `places.ts` — **Google Places API (New)** (`places.googleapis.com/v1`). Requires `GOOGLE_MAPS_API_KEY` (server-only); **503 if missing**. Upserts into `competitorCache` with a 7-day TTL.
- `analysis.ts` — **Anthropic** (`@anthropic-ai/sdk`, newly added to `apps/api`). Two forced-tool-use calls: `claude-haiku-4-5` (cuisine classify) + `claude-sonnet-4-6` (competitive analysis). Requires `ANTHROPIC_API_KEY`; **503 if missing**. **Model IDs are current and intentionally cost-optimized** per the INFRASTRUCTURE cost table — do not "upgrade" to Opus (5–10× cost).
- `seo.ts` — plain 5s homepage fetch + H1/meta parse. No secret; degrades gracefully.
- `zomato.ts` — no public API. `ZOMATO_ADAPTER=manual` (default) reads merchant-entered numbers; `stub` returns empty. Live scraping deliberately deferred.
- `snapshots.ts` — daily snapshot capture/series/feedback (the time-series engine).
- `pipeline.ts` — async in-process scan job (`QUEUED → FETCHING_PLACES → ANALYZING → SCORING → COMPLETED/FAILED`), fired fire-and-forget by the route.

---

## 3. Admin API route — `apps/api/src/routes/intelligence.ts`

Mounted at **`/api/intelligence`** in `apps/api/src/server.ts`.
Guarded by `requireAuth` + **`requireRole('OWNER')`** (our `users.role` enum
already has `OWNER` — no remap needed), every operation scoped to
`req.user.restaurantId`.

| Method + path | Purpose | Notes |
|---|---|---|
| POST `/scan` | start async scan | 24h throttle (`force` overrides) |
| GET `/scan/:id` | poll scan status | |
| GET `/reports`, `/reports/latest`, `/reports/:id` | report list / latest / one | |
| GET `/self-metrics` | **STUBBED** — returns an empty-but-valid shape | the reference derived this from its Ordering `cohorts` service, which this app deliberately excludes. No ordering dependency was pulled in. |
| GET/PUT `/watchlist` | competitor watchlist | cap `WATCHLIST_MAX` (5) |
| GET `/snapshots`, `/feedback-changes`, `/compare`, `/new-openings` | time-series reads | |
| POST `/zomato-manual` | merchant Zomato numbers | |
| POST `/snapshots/capture` | on-demand capture | 1/hour rate limit |

**The one deliberate deviation from the reference:** `self-metrics` is stubbed (empty
zeros) instead of computing from orders/events/cohorts — per the decision to
not port the Ordering system. The "My Restaurant" overview renders gracefully
on the empty shape.

---

## 4. Worker — `apps/intelligence-worker/` (new standalone app)

Mirrors `apps/publisher` (standalone Node process, `node-cron`, `@restropulse/db`
singleton). **Mongo-only by default** — the rescan seam just enqueues a `QUEUED`
`intelligenceScans` job that the API pipeline runs out of band, so the worker
needs **no** Places/Anthropic keys unless someone wires in-process rescan.

| Cron | Default | Purpose |
|---|---|---|
| `CRON_INTELLIGENCE` | `0 3 * * 1` (Mon 03:00 IST) | Weekly re-scan active restaurants, compute trend deltas + competitor alerts (into `events`), prune reports to last 12 |
| `CRON_INTELLIGENCE_DAILY` | `0 2 * * *` (02:00 IST) | Daily snapshots for self + watchlist across sources; boot backfill of missing days. Kill-switch: `INTELLIGENCE_DAILY_ENABLED` |

Auto-included via the `apps/*` workspace glob. Wired into CI (`ci.yml`) and
deployed on App Service Linux via the shared `startup.sh` process launcher.

---

## 5. Shared types — `packages/shared/src/`

- New file `intelligence.ts` (ported wholesale, re-exported from `index.ts`): `IntelligenceReport`, `IntelligenceScan`, `IntelligenceReportSummary`, `IntelligenceSelfMetrics`, `PillarScore`, `CompetitorProfile`, `CompareRow`, `MetricGap`, `DailySnapshot`, `SnapshotSource`, `SnapshotReview`, `NearbyPlaceSighting`, `WatchlistEntry`, `ReviewTheme`/`REVIEW_THEMES`, `ScanStatus`, `Provenance`, `CompetitionBuckets`, `ActionPlanItem`, consts `WATCHLIST_MAX`, etc.
- `ViewState` union gained `'INTELLIGENCE'`.
- **`Restaurant` interface gained two optional fields** (review these — they add to a core type):
  - `googlePlaceId?: string` — confirmed Places id, set once a scan place is confirmed (currently a `TODO(P2)` on the frontend; nothing writes it yet).
  - `intelligence?: { watchlist?: WatchlistEntry[]; selfZomatoUrl?: string }` — per-restaurant intelligence state.

---

## 6. Env / secrets (all optional; absent keys 503 gracefully)

Added to the `apps/api` Zod schema in `server.ts`:

| Var | Default | Purpose |
|---|---|---|
| `GOOGLE_MAPS_API_KEY` | — (optional) | Google Places (New) for scans. Read by **api** (also declared for content-engine). |
| `ANTHROPIC_API_KEY` | — (optional) | Anthropic analysis. Read by **api** and content-engine. |
| `ZOMATO_ADAPTER` | `manual` | `manual` \| `stub` (plain toggle, not a secret) |

Worker crons: `CRON_INTELLIGENCE`, `CRON_INTELLIGENCE_DAILY`,
`INTELLIGENCE_DAILY_ENABLED`.

> **Done:** `GOOGLE_MAPS_API_KEY` (apps: `api`) and `ANTHROPIC_API_KEY` (apps:
> `content-engine`, `api`) are in `packages/secrets/src/manifest.ts`
> (`SECRETS_MANIFEST`) and documented in `docs/INFRASTRUCTURE.md` / `docs/SECRETS.md`.
> `ZOMATO_ADAPTER` is deliberately **not** in the manifest -- it is a plain
> config toggle, not a KV secret. The KV-reference wiring for the deployed API
> slot lives in `scripts/provision-azure.sh` and `scripts/set-keyvault-secrets.sh`;
> the actual KV secret **values** must still be created per env (operator step).
> The **intelligence-worker needs none** of these keys (Mongo-only enqueue seam).

---

## 7. What is NOT done (remaining backend work)

1. **Runtime verification** — run `db-cli setup` to create the 6+1 collections, start the API, and exercise `/api/intelligence/*` with an OWNER session against a real Mongo (and with the two keys, a real scan). None of this has been done.
2. **API tests** — no unit tests for the pure services (scoring/compare/snapshots) and no route tests (with mocked Places/Anthropic) were added. (The worker has 32 passing tests.)
3. **Secrets manifest + docs** — DONE. `GOOGLE_MAPS_API_KEY` + `ANTHROPIC_API_KEY` are in `SECRETS_MANIFEST` and the provisioning scripts (`provision-azure.sh`, `set-keyvault-secrets.sh`); `ZOMATO_ADAPTER` stays a plain toggle. Remaining operator step: create the `{env}-google-maps-api-key` / `{env}-anthropic-api-key` KV secret **values** and re-run the scripts (needs Azure access).
4. **CI + deploy** — DONE. `intelligence-worker` has a `ci.yml` test job (via `detect-changes`) and is started alongside `api`, `publisher`, and `content-engine` by `startup.sh` on App Service Linux in `deploy-staging.yml` / `deploy-production.yml`.
5. **`self-metrics`** — currently stubbed; wire to a real data source if/when one exists here.
6. **Runtime verification** — still pending (see item 1).

---

## 8. Commits (backend)

- `0f0d9c7` — db collection layer (getters + schema)
- `0d958a5` — API services + admin route + env + shared Restaurant fields + `@anthropic-ai/sdk`
- `6f771f5` — web real client + demo swap (frontend, but flips the data path to this backend)
- `ff34c94` — intelligence-worker + supporting db/telemetry + CI detect-changes + `events` schema
