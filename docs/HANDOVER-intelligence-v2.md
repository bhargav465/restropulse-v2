# HANDOVER — Intelligence v2: Two-Bucket Dashboard (Briefs 06–09)

_Last updated: 2026-07-13. Shipped to `feat/monorepo-import` (tip `add066f`) and deploying to gh-pages `/admin-v2/`._

Third handover in the Intelligence series (after `HANDOVER-rest-intelligence.md`
= v1, and `HANDOVER-briefs-04-05.md`). This covers the v2 upgrade: v1's
RestroScore band + 5 sub-tabs becomes a **two-bucket dashboard** — My Restaurant
and Competition — backed by a **daily-snapshot time series**. Everything is
**additive on v1**: no v1 type, route, component, or test was removed.

Specs live outside the repo at `~/Desktop/Restropulse/intelligence-v2-briefs/`
(BRIEF-06…09 + README).

---

## 1. TL;DR

- **My Restaurant** bucket — daily trends (Google + Zomato rating/reviews/photos,
  SEO), MTD / specific-date / overall filters, a "what changed" feedback feed
  with fixed-taxonomy **theme hashtags**.
- **Competition** bucket — a **max-5 watchlist**, day/month **compare** matrix,
  **"Where They Beat You"** (deterministic gaps + v1 AI lines), and a **New
  Openings** radar (5 km).
- Data backbone: one `DailySnapshot` row per **target × source × day**, written
  idempotently by the worker's daily job; the UI reads server-aggregated series.
- Zomato has no public API → v2 ships a **manual/stub adapter** (merchant pastes
  numbers; demo uses fixtures). All Zomato UI renders only when data exists.

Gates at ship: type-check 14/14, build 11/11, **web 641** (+39), **api 958**
(+42), **worker 32** (+10), storefront 34, shared 35, db 25. Zero v1 regressions.

---

## 2. Commit stack (on `feat/intelligence-v2-buckets` → merged to trunk)

17 commits over `66e036d`. Key ones:

| Brief | Commits | Title theme |
|---|---|---|
| 06 | `db48337` | shared+db snapshot/watchlist data model |
| 07 | `39aa7b7` `11f83ae` `a864ce5` `1fac926` | api services → routes → tests → docs |
| 08 | `8688b17` `465fd23` `b103da3` `8e5ad69` `23b6b79` | worker store/tz → daily loop → backfill+CLI → tests → docs |
| 09 | (7 commits) … `add066f` | web bucket UI, client+fixtures, tests, docs |

---

## 3. Brief 06 — data model (`packages/shared`, `packages/db`, `apps/db-cli`)

Appended to `packages/shared/src/intelligence.ts` (v1 untouched):
`SnapshotSource`, `REVIEW_THEMES` (const tuple — a **contract**; UI filters and
prompts both key off it) + `ReviewTheme`, `SnapshotReview`, `DailySnapshot`,
`WATCHLIST_MAX = 5`, `WatchlistEntry`, `NearbyPlaceSighting`, `MetricGap`,
`CompareRow`; plus an optional additive `intelligence?: { watchlist; selfZomatoUrl }`
on `Restaurant`.

Collections (extend `ensureIntelligenceIndexes()` — zero `server.ts` change):
- `intelligence_snapshots` — unique `{restaurantId,targetPlaceId,source,date}`
  (makes the daily job an idempotent upsert) + `{restaurantId,date:-1}`.
- `nearby_sightings` — unique `{restaurantId,placeId}` + `{restaurantId,firstSeenAt:-1}`.

Seed: `packages/db/src/seeds/intelligence-snapshots-demo.ts` — `[SAMPLE]`,
**deterministic (seeded RNG, no `Math.random()`)** so tests assert exact counts.
Script: `seed:intelligence-snapshots`. Validator util `assertWatchlistSize()`
throws at >5.

---

## 4. Brief 07 — API (`apps/api`, appended to the v1 router)

Services in `apps/api/src/services/intelligence/`:
- `snapshots.ts` — `captureSnapshot()` (fetch google via `places.ts` / zomato via
  adapter, diff `newReviews` vs latest prior, upsert by unique key, reuse 7-day
  `competitor_cache`); `getSeries()` (day = raw; month = server aggregate:
  rating=last-of-month, newReviews=sum, photos=last, seo=last).
- `zomato.ts` — `ZomatoAdapter` interface + `manualZomatoAdapter` /
  `stubZomatoAdapter`; env `ZOMATO_ADAPTER=manual|stub` (default manual).
- `themes.ts` — `tagReviewThemes()`: ONE batched `claude-haiku-4-5` forced
  tool-use call, validated against `REVIEW_THEMES`, **short-circuits on empty
  input (no model call)**. Reused by the worker.
- `compare.ts` — `buildCompareRows()` with `beatsYou: MetricGap[]` thresholds
  (rating ≥ 0.1, velocity > 1.25×, responseRate ≥ 10 pts, photoCount ≥ 10, per
  source, never zeros-as-data); `getNewOpenings()` (radius/sinceDays filter,
  `fastStarter` when ≥ 30 reviews in ≤ 21 days).

Routes on `/api/admin/intelligence/*` (merchant JWT + OWNER, `{success,data?,error?}`):
`GET/PUT /watchlist` (422 on >5 / unknown placeId / dup), `GET /snapshots`,
`GET /feedback-changes`, `GET /compare`, `GET /new-openings`,
`POST /zomato-manual`, `POST /snapshots/capture` (OWNER, 1/hour).

Client contract frozen here, **implemented in Brief 09**: `getWatchlist`,
`putWatchlist`, `getSnapshots`, `getFeedbackChanges`, `getCompare`,
`getNewOpenings`, `postZomatoManual`, `captureNow`.

---

## 5. Brief 08 — worker (`apps/intelligence-worker`)

- **Daily job** (cron `0 2 * * *`, restaurant-local, default `Asia/Kolkata`):
  self Places+SEO+diff → watchlist (google + zomato when `zomatoUrl`) → ONE
  batched Haiku theme-tag across all tenants → nearby sweep (`nearby_sightings`
  upsert; new placeId ≤ 5 km emits `intelligence.alert.new_competitor` once).
  All writes via `captureSnapshot` (idempotent).
- **Backfill on boot** — fills missing dates in the last 7 days with
  `backfilled: true`; older gaps stay gaps (UI renders them honestly).
- **Weekly job unchanged** except one additive step: fold the week's sightings
  into `ReportDeltas.competitorAlerts` (returns `[]` for v1 tenants → byte-identical).
- **CLI**: `snapshot:run [--date] [--restaurant]`, `sweep:nearby`, `refresh:weekly`
  (`--date` caps at 7 days back). Kill switch `INTELLIGENCE_DAILY_ENABLED`
  (default true; false in test). Additive `placesCalls` telemetry counter.

**Cross-app seam (ASSUMPTION):** `apps/api` isn't importable, so the worker
duplicates only the minimal idempotent-upsert + diff core of `captureSnapshot`
(kept byte-identical so rows interchange); heavy external calls (Places, Haiku,
Zomato) are **injected seams** — default measurers read only importable sources
(`competitor_cache`, `zomato_manual_entries`), and the real Haiku tagger is
injected by callers holding the Anthropic dep (worker default = best-effort no-op,
so the worker stays free of `@anthropic-ai/sdk`). Timezone + `now()` are injected
(no per-tenant TZ field yet → default Kolkata).

---

## 6. Brief 09 — web (`apps/web`)

`IntelligenceV2.tsx` restructured: RestroScore band (unchanged) → `BucketSwitch`
(segmented, session-persisted, `?bucket=` param) → bucket-scoped `PeriodFilter`
(emits `{from,to,granularity}` mapping exactly to the Brief 07 query contract) →
bucket content. **v1 content re-homed, not deleted** (old sub-tab files preserved
and still tested).

- **My Restaurant** (`components/v2/intelligence/my-restaurant/`): `Overview`
  (v1 + ops strip), `DailyTrends` (hand-rolled SVG series; null days render as
  **gaps not zeros**; `backfilled` = hollow markers; Zomato section only with
  data else "Add your Zomato numbers" → `ZomatoManualModal`), `FeedbackChanges`
  (day-grouped feed, `REVIEW_THEMES` chip filter, negative-7-day-trend alert),
  `SearchSEO` (v1 moved).
- **Competition** (`components/v2/intelligence/competition/`): `Watchlist`
  (5-cap client + server-422 surfacing), `Compare` (matrix, Google/Zomato/Both
  toggle, overlaid trend), `WhereTheyBeatYou` (deterministic `computed` gaps
  first, then v1 `ai-inferred` lines, sorted by severity, ThreatRadar on top),
  `NewOpenings` (sinceDays 30/60/90, fastStarter, add-to-watchlist).
- Client: 8 `intelligenceAPI` methods + compiler-typed `demo-api.ts` twins;
  lazy `[SAMPLE]` fixtures (`lib/demo-fixtures-intelligence-v2.ts`). Demo:
  `captureNow` 1.5 s, `putWatchlist` 5-cap local, `postZomatoManual` mutates
  in-memory state so the Zomato series appears live in-session.
- **Charting (ASSUMPTION):** hand-rolled token-native SVG, no chart lib.
- Deep links wired: FeedbackChanges "Reply now" + rating/response gaps →
  Get-started; New Openings "Draft a response post" + photo gaps → Content
  Engine; velocity gaps → Campaigns.

---

## 7. How to run

```bash
npm run seed:intelligence-snapshots --workspace=@restropulse/db-cli
npm run dev
# demo-only — both buckets from fixtures, zero backend
cd apps/web && VITE_DEMO_MODE=true VITE_ADMIN_SHELL=v2 npx vite dev
# worker jobs
npm run snapshot:run --workspace=@restropulse/intelligence-worker
npm run snapshot:run --workspace=@restropulse/intelligence-worker -- --date=2026-07-12
npm run sweep:nearby --workspace=@restropulse/intelligence-worker
# gates (run per-package if turbo is flaky in your env)
npx turbo build --filter=!@restropulse/db-cli && npx turbo type-check
npx turbo test --filter=@restropulse/web --filter=@restropulse/api --filter=@restropulse/intelligence-worker --filter=@restropulse/storefront
```

---

## 8. Deferred (seams in `docs/NEXT.md`)

The frozen `CompareRow` / `toDayPoint` shapes don't yet carry a few fields, so
these are intentionally omitted (each is an additive shape extension):
- **response-rate** — DailyTrends computed chip + a Compare response-rate column.
- **competitor review text** — Compare row-expand shows counts, not review cards;
  self star-mix / avg-length chips deferred.
- **`backfilled`** hollow markers show on fixtures only (live `toDayPoint` doesn't
  emit the flag yet).

A natural "Brief 10" is: widen `CompareRow`/series with `responseRate` +
recent-review text, emit `backfilled` from the live series, then light up the
omitted UI (all UI already tokenized to accept them).

---

## 9. Notes for the next engineer

- **Additive contract is load-bearing** — `REVIEW_THEMES` and the snapshot unique
  key are contracts shared by db/api/worker/web. Never let the model invent themes;
  never break the unique key (it's what makes the daily job idempotent).
- **Two status/taxonomy mirrors** — `REVIEW_THEMES` (shared) drives both prompts
  and UI chips; keep them keyed off the shared const.
- **Worker external calls are injected** — to add a real Zomato scraper or wire
  the real Haiku tagger in the worker, implement the adapter/tagger seam; don't
  add heavy deps to the worker default path.
- **Deterministic seeds** — the demo seed uses a seeded RNG; keep it deterministic
  so the fixture tests stay assertable.
- **Gate flakiness** — full-concurrency `turbo test` was flaky in the build
  environment; run per-package (`cd apps/<x> && npx vitest run`) to disambiguate a
  real failure from parallel-load noise.
