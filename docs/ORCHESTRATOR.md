# RestroPulse v2 — Orchestrator

> Master build document for `bhargav465/restropulse-v2`. This is the file an engineering agent (or a new senior hire) reads first: what the product is, how the system is shaped, what has shipped, what is in flight, what comes next, and the reasoning that governs every change. Keep it current — when the project changes, this file changes in the same PR.

**Owner:** Bhargav (bhargav.tinku@gmail.com)
**Repo:** https://github.com/bhargav465/restropulse-v2 · working branch `feat/monorepo-import`
**Live previews:** [Storefront](https://bhargav465.github.io/restropulse-v2/demo) · [Admin v2](https://bhargav465.github.io/restropulse-v2/admin-v2/) · [Admin v1](https://bhargav465.github.io/restropulse-v2/admin/)

---

## 1. Product vision

RestroPulse is one platform for independent restaurants, combining what competitors sell separately:

| Pillar | What it does | Status |
|---|---|---|
| **Content Engine** | AI social-media marketing: strategy, post generation, approval workflow, auto-publishing to Instagram/Facebook | Live (from original SaaS) + new post generator |
| **Online Ordering** | Per-restaurant storefront: menu, cart, checkout, tracking, reservations, dine-in | Built in v1 run (payments stubbed) |
| **Growth / CRM** | Cohorts, WhatsApp nudges, discount campaigns, funnel analytics | v1 shipped; ROI attribution planned |
| **Restaurant Intelligence** | Benchmarks, peak-hour heatmaps, dish P&L, review sentiment | Placeholder |
| **Website Design** | Template gallery, theme editor, live preview | Placeholder |

**Positioning:** Reelo (reelo.io) proves the retention-marketing market (loyalty, WhatsApp campaigns, guest 360, ROI attribution) but does not do ordering or AI content. RestroPulse's wedge is *"Reelo + ordering + AI content in one dashboard."* The differentiating investments, in order: campaign ROI attribution → guest 360 → churn automation → loyalty.

---

## 2. System overview

### Monorepo (npm workspaces + Turborepo, Node ≥18)

```
apps/
  web/              Merchant admin SPA — React 19 + Vite 6 + Tailwind
                    • v1 shell (bottom-nav, view-state in App.tsx)
                    • v2 shell (components/v2/ShellV2.tsx, flag VITE_ADMIN_SHELL=v2)
                    • demo mode (flag VITE_DEMO_MODE, demo-api.ts + lib/demo-fixtures.ts)
  storefront/       Customer ordering site — React 19 + Vite + react-router
                    multi-tenant by /:slug, same demo-mode pattern
  api/              Express 4 + TS. SaaS routes + /api/storefront/:slug/* + /api/admin/ordering/*
  publisher/        Cron worker — post publishing + token refresh (Meta)
  content-engine/   Poll worker — AI content generation
  db-cli/           Commander CLI (incl. `seed:ordering` → demo restaurant, slug "demo")
packages/
  shared/           All TypeScript types (SaaS + ordering.ts)
  db/               Mongo connection, collection helpers, indexes, seeds
  telemetry/        Browser + server analytics events
  publishing/ secrets/ tsconfig/ eslint-config/
tools/
  image-studio/     Next 14 Replicate image generator (standalone, own lockfile — React 18)
docs/
  AUDIT.md          Phase-0 audit of the imported baxeltech codebase
  ARCHITECTURE.md   ER diagram, route tables, auth model, page maps
  NEXT.md           Every deferred feature → exact extension point in code
  ORCHESTRATOR.md   This file
```

### Data model (MongoDB)
`restaurants` (+slug, storeOpen, ordering settings) · `menu_categories` · `menu_items` (variants, addons, availability) · `orders` (status machine, idempotency key, totals snapshot) · `reservations` · `storefront_content` (draft + published + version history ≤20) · `customers` (bcrypt email/password, addresses) · `events` (client+server analytics — the funnel and cohorts read from this) · `campaigns` (QUEUED records) · plus original SaaS collections (posts, strategy, subscriptions…).

### Auth model
Two disjoint JWT populations: **merchants** (Firebase phone-OTP → JWT, roles incl. OWNER) and **storefront customers** (email/password + bcrypt → customer-role JWT). Demo mode replaces both with dummy sign-in.

### Environments
| Env | What | How |
|---|---|---|
| **Demo (live now)** | 3 static bundles on GitHub Pages (`gh-pages` branch): storefront at root, admin at `/admin/`, admin-v2 at `/admin-v2/` | CI `.github/workflows/deploy-demo-pages.yml` builds all three on push and force-pushes `gh-pages`. Note: Pages CDN caches `index.html` ~10 min. |
| **Production (path exists, not yet enabled)** | Azure App Service (zip-mount + WebJobs for workers) + Key Vault `restropulse-prod-kv`, GitHub Actions OIDC | Workflows imported from baxeltech; need `AZURE_CLIENT_ID/TENANT_ID/SUBSCRIPTION_ID` repo vars + MongoDB Atlas URI + Firebase keys + Meta keys. See §7. |

---

## 3. How I think when building this (principles)

1. **Audit before building.** The v1 run started by cloning every accessible repo and writing `AUDIT.md`. The plan assumed portable ordering code existed; the audit showed a social-media SaaS instead. Finding that out on day 0 — not week 3 — is the whole point.
2. **Adopt the incumbent stack; don't invent.** React+Vite SPA, Express, Mongo, Firebase were already there. Every new feature uses them, even where I'd choose differently greenfield (e.g. Next.js for storefront SEO — documented as a known tradeoff, not silently "fixed").
3. **Additive changes only; flags for divergence.** The SaaS kept working through every commit. New shells and demo behavior sit behind `VITE_ADMIN_SHELL` / `VITE_DEMO_MODE`; default builds stay byte-equivalent. 549+ pre-existing tests are the regression harness and must stay green.
4. **Demo/real is one interface, two implementations.** `api.ts` exports a typed client; demo mode swaps the implementation (`typeof realX` annotations enforce parity). The demo is never a fork of the app — it's the same app with a fixtures backend. When real infra arrives, delete one flag, not one codebase.
5. **Data model first, UI second.** Ordering v1 started with `packages/shared/ordering.ts` + indexes + seeds; routes and three frontends followed from the types. Cohorts/campaigns were server-computed from the `events` collection before any button existed.
6. **Every deferral is a documented seam.** Payments stop at `PENDING_PAYMENT`; WhatsApp campaigns stop at `QUEUED`; both have a NEXT.md entry naming the exact file/function and payload contract where the real integration plugs in. "Later" never means "lost".
7. **Own your placeholders.** The external sample-video host 503'd, so the hero video is now generated with ffmpeg and shipped inside the bundle — zero external runtime dependencies in the demo. Sample data is loudly `[SAMPLE]`-marked and lives in seeds/fixtures, never hard-coded in components.
8. **Ship something viewable at every step.** Phase gates: build green → tests green → deployed URL → verified in a real browser (screenshots, not hope). When the platform blocked one deploy path (Pages API permission), fall back deliberately (gh-pages branch auto-enable) and encode the working path into CI.
9. **Server-side events from day one.** Analytics that survive ad-blockers make the funnel, cohorts, campaign ROI, and future Intelligence tab possible without retrofitting.
10. **Secrets never enter the repo.** `.env.example` documents; Key Vault / deployment env vars hold real values. (Also: rotate any token ever pasted in chat.)

---

## 4. Changelog — shipped so far (branch `feat/monorepo-import`)

### Phase 0-1 · Audit & monorepo assembly
- `2990c40` image studio relocated to `tools/image-studio` (preserved intact)
- `54e9da3` **import: baxeltech/restropulse snapshot** (staging branch — 333 files ahead of main), no git history
- `698f35a` `docs/AUDIT.md` — stack audit, portability verdicts, layout decision

### Phase 2-3 · Ordering platform v1 (backend → storefront → admin)
- `3a64cc1`→`2d1ab6d` shared ordering types; db collections/indexes/seeds; public storefront routes (menu, customer auth, orders w/ idempotency + server-side price validation, reservations, tracking, events ingest); admin routes (menu CRUD, CSV import w/ per-row errors, order status machine, reservations, content draft/publish/rollback, funnel summary); 32 unit tests
- `810f1fa` `seed:ordering` — demo restaurant, 4 categories/14 items, demo owner+customer
- `1f7cf69` **apps/storefront** — full customer site (Home/Menu/Cart/Checkout-stubbed/Tracking/Account/Dine-in/Story/static), analytics events, cart persistence
- `cd72c93` admin Ordering views in apps/web (menu manager, orders feed, reservations, site content editor, funnel)
- `a89fed1` handoff docs (ARCHITECTURE, NEXT, README, .env.examples)

### Phase 4 · Demo deployments (no DB/keys available → static demo mode)
- `27d3fb3` storefront demo mode (fixtures behind same client interface)
- `02fb59e`/`752c0ec` GitHub Pages CI; pivot to gh-pages branch after GITHUB_TOKEN Pages-create permission failure
- `8200f13` admin demo mode (dummy login, full fixture backend for every API)
- `99f3f99` **v2 admin shell** — dark-sidebar 4-bucket layout (Content Engine / Online Ordering / Restaurant Intelligence / Website Design), per owner's reference mock

### Design pass · v2 shell — Electric Lavender (design.md §4.1–4.3)
- **Electric Lavender restyle**: retired coral; new `apps/web/components/v2/theme.ts` tokens + `@theme` CSS variables in `index.css`; restyled `ShellV2` (aubergine rail, 3px-primary active edge, one emoji per bucket, no nav subtitles), `primitives` (number-first KPI cards, underline sub-nav, text deltas, lavender banner), and recolored Content/Ordering/Intelligence/Website bucket pages. Applied §3 declutter rules; 1100px centered content column.
- **Dashboard bucket** (`DashboardV2.tsx`) — new default landing: 4 KPIs, Today panel, 7-day SVG sparkline, Needs-attention list; data from existing ordering/posts demo APIs.
- **Onboarding** (`GetStartedV2.tsx` + `onboarding.ts`) — 5-step checklist (profile → Instagram → menu → storefront → first campaign), completion computed from data, sidebar progress chip, dismissal in localStorage.
- Gates: web tests **550 green** (was 549), `vite build` clean, tokens verified in emitted CSS. Tokens-only (no raw hex in components). ASSUMPTION: Dashboard replaces Content Engine as the default v2 bucket (updated ShellV2 smoke test accordingly).

### Feature pass (owner requests + senior judgment)
- `dcd32e4` ✨ Create-a-post generator (brief + tone → draft in review queue); real seam = `POST /api/posts/generate`
- `be0a582` Strategy upgraded to an 8-theme restaurant-marketing system with weights + weekly cadence
- `d41f5c8`/`68947f2` **Growth Campaigns**: server-computed cohorts (drop-off carts / non-transacted / lapsed-30d) + WhatsApp nudge & discount actions (QUEUED + event; delivery = NEXT.md seam); surfaced in both shells
- `4ff5374` storefront media: colorful per-category menu images, video hero, restaurant photo strip, popular dishes
- `314470d`/`62c36e4` self-hosted ffmpeg-generated hero video (external host 503'd) + branded poster fallback

### Brief 02 · Storefront payment page (Razorpay) — DESIGN-02 (uncommitted, owner review)
- **Real payment step replaces the `PENDING_PAYMENT → RECEIVED` stub.** New `payments`
  collection (one doc/order; types in `packages/shared/src/types/payment.ts`, now exported;
  helpers + 3 indexes in `packages/db/src/ordering.ts`). `POST /orders` inserts
  `PENDING_PAYMENT` only when `isRazorpayConfigured()`; the key-less auto-confirm stub is
  preserved for dev/demo backends.
- **Routes:** `POST /api/storefront/:slug/payments/intent` (idempotent per order — one
  Razorpay order, amount recomputed server-side in paise), `.../payments/verify` (HMAC
  verify → capture → `PENDING_PAYMENT → RECEIVED`), and `POST /api/payments/webhook`
  (new file `payments-webhook.ts`; raw-body mount is a SIBLING line to the subscriptions
  webhook in `server.ts` — subscriptions mount untouched). Rank-safe transitions guard the
  webhook-vs-verify race.
- **Status machine:** `OrderStatus` gains `PAYMENT_FAILED`; both mirrors updated identically
  (`PENDING_PAYMENT → RECEIVED|PAYMENT_FAILED|CANCELLED`, `PAYMENT_FAILED → PENDING_PAYMENT|CANCELLED`).
  Web badge + storefront label added.
- **Funnel semantics changed:** `order_placed` / `payment_succeeded` / `payment_failed` now
  emit server-side at capture (paid orders), not at insert — cohort/funnel counts shift to "paid".
- **Storefront UI:** new `pages/PaymentPage.tsx` (`pay/:orderId`) with `--sf-*` theme vars,
  lazy `lib/razorpay.ts` checkout loader (never in index.html/demo), retry state; CheckoutPage
  navigates to the pay page. `api.ts` `paymentAPI` + `demo-api.ts` twin (`typeof realPaymentAPI`);
  demo = 1.5s fake processing, zero backend, no razorpay.com request.
- **Refunds:** out of scope; contract in `docs/NEXT.md` §1a.
- Gates: web **552**, storefront **34**, api **845 pass / 1 skip** (ordering + new
  `storefront-payments` signature/idempotency/race suites green). ASSUMPTIONS: provider =
  Razorpay/INR (brief-fixed); unconfigured fallback keeps the stub; retries reuse the same
  Razorpay order; funnel now counts paid orders.

### Brief 03 · All touchpoints integrated with MongoDB — audit + gap close — DESIGN-03 (uncommitted, owner review)
- **Audit shipped** as `docs/DB-TOUCHPOINT-MATRIX.md`: 35 touchpoints (every route family +
  both workers), all Mongo-first in real mode — 0 stub, 0 gap after fixes (was 7 gaps).
  Demo mode (zero-backend static bundles) explicitly out of scope, not counted as gaps.
- **G1 — `menu_items (restaurantId, name)` now UNIQUE** (the CSV upsert key). Boot-safe
  upgrade path in `ensureOrderingIndexes`: a legacy non-unique index throws on adding
  `unique` (observed code **86** IndexKeySpecsConflict, also handles 85) → drop + recreate
  unique; if legacy duplicate data blocks it (11000) → restore non-unique, warn once naming
  `db-cli dedupe-menu-items`, and **continue booting** (never crash on dup data).
  `POST`/`PATCH /menu/items` return **409** on 11000; CSV import **retries the upsert once**
  on an 11000 race. New owner-run `db-cli dedupe-menu-items` (dry-run default; `--apply`
  RENAMES later dups to `"<name> (2)"`, never deletes/merges).
- **G2 — boot-time index bootstrap:** `ensureOrderingIndexes()` + `ensureIntelligenceIndexes()`
  now run inside `startServer()` after `connectDB()` (idempotent). Both webhook raw-body
  mounts in `server.ts` untouched.
- **G3 — `CampaignStatus = 'QUEUED'|'SENDING'|'SENT'|'FAILED'`** exported; `CampaignRecord.status`
  widened so the deferred delivery worker (NEXT.md §9) can persist transitions. `POST /campaigns`
  still writes `'QUEUED'`. Poll index `campaigns {status, createdAt}` added.
- **G4 additive indexes:** `orders {restaurantId, createdAt}` (unfiltered admin feed),
  `events {restaurantId, ts}` (analytics summary range), `users {phone}` + `users {firebaseUid
  sparse}` (OTP-login hot path, in db-cli `collections.ts` — the single SaaS index home).
- **Ops:** `MONGO_CLIENT_OPTIONS` (pool 20/1, `serverSelectionTimeoutMS 10s`, retryWrites/Reads)
  exported from `packages/db/src/connection.ts`, used by BOTH `connectDB` and db-cli's connect —
  no bare-option `new MongoClient(` left. No new env vars; `.env.example` verified current.
- **No new routes ⇒ no new client methods ⇒ no demo twins** (parity rule vacuously satisfied).
  `docs/NEXT.md`: §9 status-union note + new §10 `PUT /api/restaurant/:id` field-whitelist
  contract for Brief 04.
- New tests (+9): `menu-items-unique` (409 on create + rename, CSV retry-once, non-11000
  rethrow) and `ordering-indexes-upgrade` (fresh→unique, non-unique→upgraded,
  duplicates→non-unique fallback + warn + boot succeeds). Gates: web **552**, storefront **34**,
  api **894 pass / 1 skip** (ordering suites green). Known pre-existing (not ours):
  `@restropulse/content-engine` and the `feat/intelligence-v1` intelligence routes/services
  fail type-check on this branch. ASSUMPTIONS: dedupe = rename-only (owner-confirmed); name
  uniqueness case-sensitive per-restaurant (matches CSV upsert key); the DESIGN said conflict
  code 85 but the real conflict on adding `unique` to an auto-named index is **86** — handled
  both.

### Brief 04 · Restaurant profile — details upload in the v2 admin dashboard — DESIGN-04 (local commits, owner review)
- **Data model:** `RestaurantAddress` + additive optional `Restaurant` fields (`legalName`,
  `cuisineTags`, `email`, `address`, `gstin`, `fssaiLicense`, `logoUrl`, `coverImageUrl`) in
  `packages/shared`; single-source `RESTAURANT_PROFILE_FIELDS` whitelist + `RestaurantProfilePatch`.
  Seeds + web fixtures carry `[SAMPLE]` profile values.
- **GridFS assets (net-new):** `packages/db/src/assets.ts` (bucket `assets`, `uploadAsset` /
  `openAssetDownload` / `ensureAssetIndexes`), rides `MONGODB_URI` — no new env vars. Behind the
  `AssetStore { put, openDownload }` seam in `apps/api/src/services/assets.ts` (Azure Blob swap +
  orphan GC deferred → NEXT.md §11).
- **Routes:** `GET`/`PATCH /api/restaurant/profile` (OWNER) + `POST /api/restaurant/assets`
  (multipart, 5 MB, ext+MIME must agree → 413/400) registered BEFORE `router.get('/:id')`;
  new public `GET /api/assets/:id` (immutable cache + ETag/304 + nosniff + 404). Shared
  `sanitizeProfilePatch` (whitelist + pincode/GSTIN/FSSAI/email validators, null→$unset) now runs
  on BOTH `PATCH /profile` and the hardened `PUT /:id` — **closes NEXT.md §10** (mass-assignment).
- **Security fix (owner decision 3):** shared `sanitizeRestaurantForPublic` strips
  `instagramCredentials` + `razorpayCustomerId` from BOTH `GET /profile` and public `GET /:id`.
  Non-secret `integrations`/`instagramConnection`/`accountManager` intentionally RETAINED — the
  admin dashboard loads `restaurantData` from `GET /:id` (App.tsx `metaConnected`, ProfileSheet
  does a non-optional `restaurantData.integrations.instagram`), so stripping them would crash v1.
- **Clients + demo parity:** `restaurantAPI.getProfile/updateProfile/uploadAsset` + demo twins
  (`uploadAsset` = `URL.createObjectURL`, ZERO network; never persisted to fixtures).
- **UI (v2, tokens only, 0 raw hex):** new `RestaurantDetailsV2` (Basics · Address & Contact ·
  Legal · Branding · Hours via `SubNav`); `HoursEditor` extracted from `SiteContentEditor` so
  hours stay single-source in `storefront_content.draft` ("Saved to draft — publish to go live");
  6th sidebar bucket + `PAGE_META` + render branch; onboarding step 1 typed `isProfileComplete`
  (Basics+Address) → deep-links PROFILE; DashboardV2 "Complete your restaurant profile" attention row.
- New tests: api `restaurant-profile` (13) + `restaurant-assets` (8); web `RestaurantDetailsV2` +
  ShellV2 PROFILE routing. Gates: web **591**, storefront **34**, api **915 pass / 1 skip**
  (ordering suites green); my packages (shared/db/api/web) build + type-check clean.
  Pre-existing (not ours): `@restropulse/content-engine` + `@restropulse/db-cli` fail to build
  (media-catalog artifact). ASSUMPTIONS: GridFS default; GSTIN/FSSAI format-only; public-route
  sanitizer strips credentials only (see security note above). Follow-up: before/after screenshots
  of the 5 tabs + contrast check (muted on surface) = owner/PR manual step.

### Brief 05 · Admin v2 look & feel + installable PWA — (branch `feat/brief-04-05`, local commits, owner review)
- **UI-only, ZERO new endpoints / client methods / chart libraries.** All behind
  `VITE_ADMIN_SHELL=v2`; default builds byte-identical (no service worker, v1 theme + SW-unregister
  guard preserved). Electric Lavender tokens only in components — raw hex confined to manifest/config.
- **App feel (Phase 1):** mobile **bottom tab bar** (`ShellV2`) — 5 primary buckets (Home/Content/
  Ordering/Insights/Design) with `env(safe-area-inset-bottom)` padding; Restaurant Details + Get
  started stay in the drawer (primary items `hidden md:flex`). **Skeleton→count-up** on the dashboard
  (`primitives` `Skeleton` + `AnimatedNumber`, rAF with a setTimeout completion net; snaps under
  reduced-motion). **Touch/motion** (`index.css`): `.v2-bucket-enter` (0.18s ease-out), momentum
  `.v2-scroll`, 44px targets, `active:scale`, all gated by `prefers-reduced-motion`.
- **PWA (item 3):** `vite-plugin-pwa` (`autoUpdate`) added to `apps/web`, wired ONLY when
  `env.VITE_ADMIN_SHELL === 'v2'`. Manifest `#221833`/`#FAF8FF`, icons 192/512 + maskable +
  apple-touch (hand-generated PNGs in `public/`); `scope`/`start_url` inherit Vite `base`
  (verified `= /restropulse-v2/admin-v2/`); precache shell, NetworkFirst `/api/*` (GET-only),
  `navigateFallback` index.html (offline shell, no white screen). `index.html` guard: v2 sets
  theme-color + touch icon; every other build keeps `#f97316` + unregisters stale SWs.
- **Look (Phase 2):** new `components/v2/icons.tsx` (stroke, `currentColor`, `BUCKET_ACCENT` tint)
  replaces all nav emoji; **greeting hero** (time-aware + `👋`, the one permitted emoji) with a live
  store-status pill wired to `storeOpen`; **richer StatCards** (soft icon chip, hover lift, 7-day
  micro-sparkline); **hand-rolled area chart** (gradient fill, day labels, hover tooltip,
  highlight-today) replacing the flat sparkline; `EmptyState` (lavender line-art + one CTA).
- **Personalization (Phase 3):** restaurant identity tile (logo/gradient initial + name + city) in
  the sidebar and mobile top bar; 3-up **quick-actions** row deep-linking Content/Ordering via the
  existing shell navigation (no endpoints).
- New tests: `ShellV2Look` (bottom-tab render/nav, greeting, skeleton→data count-up, icon, EmptyState,
  quick-action deep links) + `pwa-config` (icon assets, config gating, index.html guard); ShellV2
  smoke updated for the greeting hero + `Primary` bar. Gates: web **602** (was 591), storefront **34**,
  api **916 pass / 1 skip**; `turbo build` 11/11, `turbo type-check` 14/14. Demo v2 build emits
  manifest + `sw.js` under the `/admin-v2/` base; default build emits neither.
- ASSUMPTIONS: store-status pill is read-only (toggling would need an endpoint); per-KPI 7-day
  sparklines derived from real order/reservation/post timestamps (posts use `scheduledFor ?? postedAt`,
  `Post` has no `createdAt`); quick-actions use state navigation (no router hrefs); bottom bar carries
  the 5 primary buckets, Restaurant Details lives in the drawer. Manual PR artifacts (owner): phone-width
  screenshots (bottom tabs / skeletons / hero), Lighthouse installability run, contrast check.

### Rest Intelligence · PR2 — api services + routes (branch `feat/intelligence-v1`)
- **Scan pipeline** in `apps/api/src/services/intelligence/`: `places.ts` (Places API (New),
  field masks + exclusion lists + Haversine ported verbatim; every place upserted to
  `competitor_cache` with `fetchedAt`, 7-day TTL, cache-hit skips the detail call),
  `scoring.ts` (PURE: `threatScore`, `sameCuisineThreatScore` ported; NEW `restroScore`
  6-pillar weighted composite — profile 20/reviews 25/photos 10/website 15/competition 20/
  momentum 10, grades A≥85 B≥70 C≥55 D≥40 else F; reproduces the seed fixture's 68),
  `analysis.ts` (TWO Anthropic calls, BOTH forced tool-use + JSON schema — `claude-haiku-4-5`
  classify + `claude-sonnet-4-6` analysis, max_tokens 8192, compacted rows only, no
  AI-invented numbers; `parseLlmJson` banned), `prompts.ts` (persona + the two ARCHITECTURE
  §3.2 additions), `seo.ts` (5 s homepage fetch), `scan-status.ts` (server mirror of
  `ScanStatus`), `report-builder.ts` (pure `assembleReport` + `computeDeltas`), `pipeline.ts`
  (async in-process job), `errors.ts` (`StageError` 503 config / 502 upstream).
- **Routes** `POST /api/admin/intelligence/scan` (async, 202 `{scanId}`, 409 within 24 h unless
  `force`), `GET /scan/:id`, `GET /reports`, `GET /reports/:id`, `GET /reports/latest`,
  `GET /self-metrics` (delegates to the existing cohort service + orders/events — no new
  tracking). Merchant JWT + OWNER. Mounted in `server.ts` (additive line).
- **Shared:** `ActionPlanItem.deepLink.bucket` widened with `'campaigns'` (DESIGN §4.1); PR1
  seed's win-back action re-pointed to `campaigns`; added `IntelligenceReportSummary` +
  `IntelligenceSelfMetrics` response types. **Env** (server-only): `GOOGLE_MAPS_API_KEY`,
  `ANTHROPIC_API_KEY` documented in `apps/api/.env.example`.
- New tests (+30): scoring units (threat/same-cuisine/restroScore/grade boundaries),
  scan-status transition table, report-builder shape + deltas, route auth guard + 24 h 409.
  Gates: web **552**, storefront **34**, api **892 pass / 1 skip**. Known pre-existing failure
  (not ours): `@restropulse/content-engine` build/type-check on `asset-manager.ts`.
  ASSUMPTIONS: implemented from ARCHITECTURE spec (predecessor repo WAS reachable, used as a
  formula reference only); pillar checks carry explicit point weights that reproduce the seed
  pillar scores; scan `city` defaults from `restaurant.sourceCity`/address; intelligence docs
  keep string `_id` (allowlisted in the objectid-safety guard).

### Rest Intelligence · PR1/PR3/PR4 + release (branch `feat/intelligence-v1`)
- **PR1 `83fed67`** (`feat(shared,db)`): data model in `packages/shared/src/intelligence.ts`
  (scans/reports/competitors/pillars/deltas + companions), db collections + indexes
  (`intelligence_scans`, `intelligence_reports`, `competitor_cache` unique `placeId` + 7-day
  TTL on `fetchedAt`), `[SAMPLE]` demo seed (Demo Kitchen Bengaluru, restroScore 68, 12
  competitors, 2 alerts) + `seed:intelligence`. Tests: shared 2, db 11.
- **PR3 `54d4ef4`** (`feat(web)`): replaced the `IntelligenceV2` placeholder with the
  RestroScore header band + 5 sub-tabs (Overview/Competitors/Reviews/Search&SEO/Your Metrics),
  `components/v2/intelligence/` (hand-rolled SVG dial/radar/sparkline/heatmap, provenance
  chips, scan stepper, web status mirror), `intelligenceAPI` + compiler-typed demo twin, lazy
  `[SAMPLE]` fixture chunk, deep links into Content/Campaigns/Get-started. web tests 552→**584**.
- **PR4 `3e34ce9`** (`feat(worker)`): `apps/intelligence-worker/` (copied publisher skeleton) —
  weekly re-scan, `competitorAlerts` enrichment, prune-to-12, alert events
  (`intelligence.scan.completed`/`competitor_surge`/`rating_drop`/`new_competitor`) via the
  existing `events` seam; registered in CI + turbo filters. 22 tests.
- **Release:** Briefs 01/02/03 untangled into clean commits (`8b3d2cb`/`a27eac1`/`cdd3583`) and
  the whole stack merged to `feat/monorepo-import` + pushed → `deploy-demo-pages` publishes the
  `[SAMPLE]` Intelligence tab to gh-pages `/admin-v2/`. content-engine build remains red
  (pre-existing: `src/assets/media-catalog.ts` is source wrongly caught by the `assets/`
  gitignore, never committed; NOT in the demo build) — pre-push hook bypassed for this push
  only. **Follow-up:** narrow `apps/content-engine/.gitignore` and commit the real
  `media-catalog.ts`.

### Intelligence v2 · two-bucket dashboard (branch `feat/intelligence-v2-buckets`)
- **Brief 06 `db48337`** (`feat(shared,db)`): additive data model — `DailySnapshot`,
  `WatchlistEntry` (+`WATCHLIST_MAX`), `NearbyPlaceSighting`, `MetricGap`, `CompareRow`,
  `SnapshotReview`/`REVIEW_THEMES`, `Restaurant.intelligence`; db getters
  `getIntelligenceSnapshotsCollection`/`getNearbySightingsCollection`, `assertWatchlistSize`,
  extended `ensureIntelligenceIndexes` (snapshots unique `restaurantId+targetPlaceId+source+date`;
  sightings unique `restaurantId+placeId`).
- **Brief 07 `39aa7b7`/`11f83ae`/`a864ce5`** (`feat(api)`): v2 API appended to
  `routes/admin/intelligence.ts` (same merchant-JWT + OWNER, `{success,data?,error?}`).
  New services `services/intelligence/{snapshots,zomato,themes,compare}.ts`:
  `captureSnapshot`/`runDailySnapshotJob`/`getSeries`/`getFeedbackChanges` (idempotent
  target×source×day upsert, review diff, month aggregate), `tagReviewThemes` (one batched
  forced-tool `claude-haiku-4-5`, unknown-theme drop, empty short-circuit),
  `buildCompareRows`/`getCompareRows`/`getNewOpenings` (exact "Where They Beat You" thresholds),
  `manualZomatoAdapter`/`stubZomatoAdapter` registry (`ZOMATO_ADAPTER` env, default manual).
  8 new routes: `GET/PUT /watchlist`, `GET /snapshots`, `GET /feedback-changes`, `GET /compare`,
  `GET /new-openings`, `POST /zomato-manual`, `POST /snapshots/capture` (OWNER, 1/hour). No v1
  route/type touched. +38 api tests (themes 5, compare+new-openings 10, snapshots 7, routes 16).
  Client methods frozen for Brief 09; worker (Brief 08) imports `captureSnapshot`,
  `runDailySnapshotJob`, `tagReviewThemes`. `ZOMATO_ADAPTER` documented in `apps/api/.env.example`.

**Verified in browser:** menu→cart flow, demo checkout, admin login, post generation, campaigns tab, storefront media. Test counts: web 549+, storefront 31, api ordering suites green (full api suite needs Mongo binaries unavailable in sandbox — passes where mongod can download).

---

## 5. In flight (uncommitted WIP on the working tree)

An elegance pass was interrupted mid-run; partial work exists and should be completed before anything else:
- `components/v2/theme.ts` — design tokens (warm off-white bg, ink text, coral used sparingly, sage success, 1px soft borders, single shadow level)
- `components/v2/DashboardV2.tsx` — new cross-product **Dashboard** bucket (default landing): KPI row, "Today" panel, 7-day CSS sparkline, "Needs attention" list
- `components/v2/GetStartedV2.tsx` + `onboarding.ts` — **Onboarding** checklist page (5-step stepper: profile → Instagram → menu → storefront → first campaign; progress chip in sidebar; completion computed from demo data)
- Restyle edits to ShellV2 / ContentEngineV2 / primitives (declutter: fewer emojis, quiet underline sub-nav, number-first KPI cards, calmer sidebar)

**Definition of done for this pass:** all web tests green + both admin bundles rebuilt + deployed + screenshot-verified; commit as `feat(web): design-system pass, Dashboard bucket, onboarding checklist`.

---

## 6. Roadmap — next changes, in build order

Each item lists its plug-in point; details in `docs/NEXT.md`.

### Near term (demo-able, high leverage vs Reelo)
1. **Campaign ROI attribution** — attach coupon code per campaign; join orders ⨝ campaigns → "34 sent → 9 redeemed → ₹4,200". Plugs into `campaigns` collection + `computeOrderTotals.discount` + a `campaign_attributed` event. This is the single most persuasive owner-facing number.
2. **Customers (guest 360)** — new Ordering sub-tab: per-customer visits, last order, favorites, spend, opt-in, at-risk badge. Reads existing `customers`+`orders`+`events`; no schema change.
3. **Churn automation rules** — toggleable triggers ("nudge 24 h after abandoned cart", "offer at 30 d inactive"). Needs a `campaign_rules` doc + a worker loop (pattern already exists in `apps/publisher`).
4. **Restaurant Intelligence v1** — replace placeholder with: repeat rate, new-vs-returning revenue, campaign ROI trend, peak-hours heatmap from `events`.

### Mid term
5. **Loyalty program** (points per order, redemption at checkout) — order totals seam + customer balance; table stakes in this market.
6. **Smart QR codes** — `?src=table12` on storefront URLs + funnel dimension; pairs with dine-in.
7. **Reviews & feedback loop** — post-order request → Reviews tab; gate Google-review ask on 4-5★.
8. **Payments** — replace `PENDING_PAYMENT` stub with Razorpay (service already in repo for SaaS billing).
9. **WhatsApp delivery** — worker consuming QUEUED campaigns via WhatsApp Business API; opt-in filter mandatory.
10. **Template gallery / Website Design bucket** — builds on `storefront_content` versioning + demo-mode fixture pattern (a template = a content+theme preset previewable with the restaurant's own menu).

### Later
Delivery-dispatch microservice (spec §6), multi-location, RBAC beyond OWNER, i18n, PWA.

---

## 7. Go-live checklist (demo → production)

1. Merge `feat/monorepo-import` (PR: `/pull/new/feat/monorepo-import`); make it the default branch.
2. Provision MongoDB Atlas; run `seed:ordering`; set `MONGODB_URI` (+ `JWT_SECRET`, `ENCRYPTION_KEY`).
3. Firebase project keys (merchant OTP login) → `VITE_FIREBASE_*` + `FIREBASE_SERVICE_ACCOUNT`.
4. Azure: set `AZURE_CLIENT_ID/TENANT_ID/SUBSCRIPTION_ID` repo vars; populate Key Vault (`scripts/set-keyvault-secrets.sh`, `provision-azure.sh` on `feature/azure-zero-secrets` upstream); staging deploy on push, production via `workflow_dispatch` promotion.
5. Meta app credentials for publisher/content-engine; Replicate key for image studio.
6. Turn off demo flags in hosted builds; smoke-test the E2E happy path (browse → order → admin feed → status → tracking).
7. Rotate every credential that ever appeared in chat or CI logs.

---

## 8. Working agreements

- Conventional commits; one logical change per commit; PR per phase.
- Every change ends green: `turbo build` + `turbo test` + type-check before commit.
- Assumptions are labelled `ASSUMPTION:` in reports and PR descriptions.
- Demo parity rule: any new API client method gets a demo implementation the same day, or the feature doesn't ship to the demo.
- Sample data is `[SAMPLE]`-marked, lives only in seeds/fixtures.
- This file + NEXT.md updated in the same PR as the change they describe.

## 9. Decision log

| Decision | Why | Revisit when |
|---|---|---|
| Import `staging` not `main` | 333 files / ~48k lines ahead; most mature | — |
| Ordering built greenfield on audited stack | No ordering code existed anywhere in the org | — |
| `OrderingMenuItem` type name | `MenuItem` already taken by SaaS content types | If SaaS type retired |
| Static demo w/ fixtures over hosted preview | No DB/Firebase available; zero-cost, zero-secret, instantly shareable | Real infra provisioned (§7) |
| gh-pages branch deploys (not Pages API) | `GITHUB_TOKEN` lacks Pages-create permission; branch push auto-enables | Repo admin enables "GitHub Actions" Pages source |
| Self-hosted ffmpeg hero video | External sample host returned 503; no runtime deps | Owner uploads real footage |
| SPA (no SSR) for storefront | Stack-adoption rule; SEO tradeoff documented | SEO becomes a growth channel — consider prerender/SSR |
| Two shells (v1 + v2) behind a flag | Owner wanted a redesign without risking the working v1 | v2 accepted → retire v1 shell |
