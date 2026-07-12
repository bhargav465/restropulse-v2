# HANDOVER — Rest Intelligence release (+ Briefs 01–03)

_Last updated: 2026-07-11. Branch `feat/monorepo-import` (demo trunk), mirror on `feat/intelligence-v1`._

This documents the Rest Intelligence module build and the Briefs 01–03 release
that shipped alongside it, so the next engineer can extend, operate, or debug it.

---

## 1. TL;DR — what shipped

A competitor + self-intelligence suite for restaurant owners (inspired by the
Owner.com grader, but continuous, actionable in-product, and honest about data
provenance). Built as 4 stacked PRs, plus Briefs 01–03 which were untangled from
the working tree and committed cleanly. **Deployed** to the demo:
**https://bhargav465.github.io/restropulse-v2/admin-v2/** → **Intelligence** bucket.

Gates at release: **web 584** (baseline ≥550), **storefront 34**, **api 892 (+1 skip)** — all green.

---

## 2. Commit stack (on `feat/monorepo-import`, over base `1ef3428`)

| Commit | Title |
|---|---|
| `3a7eef7` | ci: bump actions/checkout + setup-node to v5 (Node 20 deprecation) |
| `34d202a` | chore(release): lock deps, changelog, ignore stray Next.js artifacts |
| `cdd3583` | feat(db): Brief 03 — MongoDB touchpoint audit + index/upsert hardening |
| `a27eac1` | feat(ordering): Brief 02 — Razorpay storefront payment step |
| `8b3d2cb` | feat(shared): Brief 01 — upstream inventory + shared payment types |
| `3e34ce9` | feat(worker): Intelligence PR4 — weekly refresh worker + alerts |
| `54d4ef4` | feat(web): Intelligence PR3 — tab UI + demo parity |
| `9d7473e` | feat(api): Intelligence PR2 — scan pipeline services + admin routes |
| `83fed67` | feat(shared,db): Intelligence PR1 — data model + [SAMPLE] seed |

Both branches are pushed to `origin` and point at `3a7eef7`.

---

## 3. Rest Intelligence — architecture

Spec docs: `~/Desktop/Restropulse/Rest intelligence/{ARCHITECTURE,CLAUDE,DESIGN,INTEGRATION}.md`.

**Data flow:** admin UI → `POST /api/admin/intelligence/scan` (async job, returns
`{scanId}`) → pipeline runs in-process (30–90 s) writing status to
`intelligence_scans` → UI polls `GET /scan/:id` → report saved to
`intelligence_reports`, rendered across 5 sub-tabs.

### PR1 — data model (`shared` + `db`)
- Types: `packages/shared/src/intelligence.ts` — `IntelligenceScan`,
  `IntelligenceReport`, `CompetitorProfile`, `PillarScore`, `ReportDeltas`, etc.
  (Note: `ReportDeltas` uses ASCII names `ratingDelta`/`reviewsDelta`/`restroScoreDelta`.)
- Collections + indexes: `packages/db/src/intelligence.ts` — `intelligence_scans`
  `{restaurantId,createdAt}`; `intelligence_reports` `{restaurantId,generatedAt}`;
  `competitor_cache` unique `{placeId}` + `{fetchedAt}` TTL 7 days.
- Seed: `packages/db/src/seeds/intelligence-demo.ts` — `[SAMPLE]` report
  ("Demo Kitchen Bengaluru", restroScore 68, 12 competitors, 2 alerts).
  Run: `npm run seed:intelligence --workspace=@restropulse/db-cli`.

### PR2 — api pipeline (`apps/api/src/services/intelligence/`)
- `places.ts` — Google Places API (New): text-search → details → nearby (3 pages,
  7 km), exclusion filters, Haversine, upsert to `competitor_cache` (cache hit skips call).
- `scoring.ts` — **pure, fully unit-tested.** `threatScore`, `sameCuisineThreatScore`,
  and `restroScore` (6-pillar weighted composite: profile 20 / reviews 25 / photos 10 /
  website 15 / competition 20 / momentum 10; grades A≥85 B≥70 C≥55 D≥40 else F).
- `analysis.ts` — two Anthropic calls, **both forced tool-use + JSON schema**
  (`claude-haiku-4-5` cuisine classify, `claude-sonnet-4-6` competitive analysis).
  Compacted rows only; never invents numeric metrics. Prompts in `prompts.ts`.
- `seo.ts` — homepage fetch + profile/SEO checks. `scan-status.ts` — server status
  machine (`QUEUED→FETCHING_PLACES→ANALYZING→SCORING→COMPLETED|FAILED`).
- `report-builder.ts` — assembles the report, `computeDeltas` vs previous.
  `pipeline.ts` — async orchestration. `errors.ts` — `StageError` (503 config / 502 upstream).
- Routes: `apps/api/src/routes/admin/intelligence.ts` — `POST /scan` (409 within 24 h
  unless `force`), `GET /scan/:id`, `GET /reports`, `GET /reports/:id`,
  `GET /reports/latest`, `GET /self-metrics`. Merchant JWT + OWNER.

### PR3 — web UI (`apps/web/components/v2/`)
- `IntelligenceV2.tsx` — RestroScore header band + 5 sub-tabs router.
- `intelligence/` folder: `Overview`, `Competitors`, `Reviews`, `SearchSEO`,
  `YourMetrics`, `ScanFlow`; shared `primitives.tsx` (hand-rolled SVG ScoreDial /
  PillarBar / ThreatBar / sparkline / heatmap), `ThreatRadar.tsx`, `provenance.tsx`,
  `scan-status.ts` (web mirror — must stay identical to the server one), `deep-links.ts`.
- Client: `intelligenceAPI` in `apps/web/api.ts` + compiler-typed twin in `demo-api.ts`
  (fake 3-poll scan completion). Fixture: `apps/web/lib/demo-fixtures-intelligence.ts`
  (lazy-loaded chunk). Deep links wire to Content Engine / Campaigns / Get-started.

### PR4 — worker (`apps/intelligence-worker/`)
- Copied the `apps/publisher` skeleton. Weekly loop: re-scan → enrich
  `competitorAlerts` → prune to 12 reports → emit events
  (`intelligence.scan.completed`, `.alert.competitor_surge`, `.alert.rating_drop`,
  `.alert.new_competitor`) via the existing `events` seam. Registered in CI + turbo.
- **Cross-app seam:** `apps/api` isn't an importable package, so the worker enqueues
  an `intelligence_scans` job (default `RescanFn`) rather than importing the pipeline.
  Promoting the pipeline to a shared `@restropulse/intelligence` package is logged in
  `docs/NEXT.md`.

---

## 4. Briefs 01–03 (shipped in this release)

- **Brief 01** (`8b3d2cb`) — upstream inventory: nothing to import (v2 was ahead of
  `baxeltech/restropulse`); added shared payment types. Docs: `docs/UPSTREAM-INVENTORY.md`.
- **Brief 02** (`a27eac1`) — storefront Razorpay payment step: `payments` collection,
  `POST /payments/intent` + `/verify` + `POST /api/payments/webhook` (raw-body mount,
  subscriptions webhook untouched), new `PAYMENT_FAILED` order status (both mirrors),
  demo twin. Refunds deferred → `docs/NEXT.md`.
- **Brief 03** (`cdd3583`) — MongoDB touchpoint audit (`docs/DB-TOUCHPOINT-MATRIX.md`):
  35 touchpoints, 0 fixture-backed in real mode; closed 7 gaps — unique
  `menu_items {restaurantId,name}` + 409 + `dedupe-menu-items` db-cli command,
  boot-time `ensureOrderingIndexes()`/`ensureIntelligenceIndexes()`, `CampaignStatus`
  union, 4 index adds, single `MONGO_CLIENT_OPTIONS` source.

---

## 5. How to run

```bash
# dev (web :3000, api :3001)
npm run dev

# demo-only — no Mongo, full Intelligence tab from fixtures
cd apps/web && VITE_DEMO_MODE=true VITE_ADMIN_SHELL=v2 npx vite dev

# seed the demo intelligence report (real mode)
npm run seed:intelligence --workspace=@restropulse/db-cli

# gates (run before every commit)
npx turbo build --filter=!@restropulse/db-cli
npx turbo type-check
npx turbo test --filter=@restropulse/web --filter=@restropulse/storefront --filter=@restropulse/api
```

**Real-data path** (when going beyond the demo): set server-side only, in `apps/api/.env`:
`GOOGLE_MAPS_API_KEY` (Places API (New) enabled) and `ANTHROPIC_API_KEY`. Then run one
live scan (`POST /api/admin/intelligence/scan` with a real name + city) end-to-end before
any production promotion. Nothing key-shaped ever goes in the web bundle or fixtures.

---

## 6. Open follow-ups (non-blocking)

1. **content-engine CI is RED (pre-existing).** `apps/content-engine/src/assets/media-catalog.ts`
   is real source code wrongly caught by the broad `assets/` rule in
   `apps/content-engine/.gitignore` — never committed, and `download-assets.mjs` doesn't
   generate it. NOT in the demo build (`deploy-demo-pages` builds only shared/telemetry +
   storefront/web), so the demo is unaffected, but it reddens CI + the pre-push hook.
   **This release was pushed with `--no-verify` because of it.**
   Fix: narrow the gitignore to only downloaded binaries, commit the owner's local
   `media-catalog.ts`, verify content-engine green, then drop `--no-verify`.
2. **Worker re-scan seam** — enqueue-based today; promote the api pipeline to a shared
   package for in-process re-scan (`docs/NEXT.md`).
3. **Deep-link params** — action-plan buttons navigate to the right bucket but don't yet
   prefill the target flow (content brief / cohort id passed but not consumed).
4. **Refunds** (Brief 02) — out of scope; contract in `docs/NEXT.md`.

---

## 7. Remaining briefs (not yet built)

- **Brief 04** — Restaurant profile dashboard (merchant uploads details; GridFS assets).
  Depends on Brief 03 collections (done). See `briefs/04-restaurant-profile-dashboard.md`.
- **Brief 05** — Admin v2 look & feel + installable PWA (bottom tabs, skeletons, PWA,
  icons, hero header). UI-only, no endpoints. See `briefs/05-admin-v2-look-and-feel.md`.

---

## 8. Gotchas / conventions

- **db collections are flat** (`packages/db/src/*.ts`), not in a `collections/` subdir —
  the intelligence spec said otherwise; the repo convention won.
- **Two status machines must stay identical:** server `apps/api/.../intelligence/scan-status.ts`
  and web `apps/web/components/v2/intelligence/scan-status.ts` (same rule as order status).
- **Demo parity is compiler-enforced:** `demo-api.ts` twins are typed `typeof realX`.
- **api tests need Mongo:** run via `turbo test --filter=@restropulse/api` (or from
  `apps/api/`), not `vitest` at repo root — the api vitest config spins up mongodb-memory-server.
- **Design tokens only** in web (`theme.ts`: TOKENS/GRADIENT/intensity()/SERIES); no raw hex,
  no coral, no emoji in data surfaces.
- **The Bash safety classifier blocks `git push`** in this environment — pushes were run
  manually by the owner.
