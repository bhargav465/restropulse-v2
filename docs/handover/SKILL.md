---
name: restropulse-engineering
description: Complete engineering handover for RestroPulse v2 — a restaurant platform combining AI social-media content, online ordering, and growth/CRM. Use when building, fixing, extending, or deploying anything in the bhargav465/restropulse-v2 monorepo (admin dashboard, customer storefront, API, workers, demo deploys). Written by the founding engineer for the developers taking over.
---

# RestroPulse v2 — Engineering Handover Skill

Welcome to the team. I built the base of this app; this file gives you everything
you need to work on it safely. Read this file fully once. The `references/`
files are deep dives — read them **when the table at the bottom says to**,
not before. Companion docs live in the repo: `docs/ORCHESTRATOR.md` (history +
why), `docs/ARCHITECTURE.md` (ER diagram, route tables), `docs/NEXT.md`
(where deferred features plug in), `docs/HANDOVER.md` (full reference dump).

---

## 1. What you're working on

RestroPulse is ONE platform for independent restaurants that competitors sell
as three separate products:

1. **Content Engine** — AI social-media marketing (strategy, post generation,
   approval queue, auto-publish to Instagram/Facebook).
2. **Online Ordering** — per-restaurant storefront: menu → cart → checkout →
   live tracking, plus reservations and dine-in. Multi-tenant by URL slug.
3. **Growth / CRM** — funnel analytics, customer cohorts, WhatsApp nudges,
   discount campaigns.
4. Placeholders (planned): **Restaurant Intelligence**, **Website Design**.

Competitive frame: Reelo (reelo.io) owns restaurant retention-marketing but has
no ordering and no AI content. Our wedge is all three in one dashboard.

**Live demos** (static, sample data, any email/password logs in):
- Storefront: https://bhargav465.github.io/restropulse-v2/demo
- Admin v2:   https://bhargav465.github.io/restropulse-v2/admin-v2/
- Admin v1:   https://bhargav465.github.io/restropulse-v2/admin/

---

## 2. Repositories (today)

| Repo | What it is |
|---|---|
| `bhargav465/restropulse-v2` | THE repo. Everything lives here. Work happens on branch `feat/monorepo-import` (merge it — PR link in §7). `gh-pages` branch holds the built demos. |
| `baxeltech/restropulse` | Private upstream the SaaS was imported from. Snapshot only — no live dependency. Azure provisioning scripts on its `feature/azure-zero-secrets` branch. |
| `bhargav465/restropulse` | A CLAUDE.md template. Ignore. |

**Planned split into feature sub-repos (web + mobile per feature) — this is an
approved infra task.** Read `references/infra.md` before starting it; it has
the target repo layout, submodule wiring, migration phases, and the mobile
(React Native/Expo) plan.

---

## 3. The monorepo, in one look

npm workspaces + Turborepo, Node ≥ 18. TypeScript everywhere.

```
apps/web           Merchant admin SPA — React 19, Vite 6, Tailwind.
                   TWO shells: v1 (bottom nav) and v2 (dark sidebar, 4 buckets)
                   selected by env flag VITE_ADMIN_SHELL=v2.
apps/storefront    Customer ordering site — React 19 + react-router,
                   multi-tenant by /:slug (demo restaurant slug = "demo").
apps/api           Express 4. SaaS routes + ordering routes (see §5).
apps/publisher     Cron worker: publishes posts, refreshes Meta tokens.
apps/content-engine Poll worker: AI content generation.
apps/db-cli        CLI. `npm run seed:ordering` seeds the demo restaurant.
packages/shared    ALL TypeScript types. Ordering domain: src/ordering.ts.
packages/db        Mongo connection, collection helpers, indexes, seeds.
packages/telemetry Analytics event emitters (browser + server).
tools/image-studio Next 14 Replicate image generator. Standalone lockfile
                   (React 18 — do NOT add to workspaces).
docs/              AUDIT, ARCHITECTURE, NEXT, ORCHESTRATOR, HANDOVER, handover/
.github/workflows  ci.yml, deploy-staging/production.yml (Azure),
                   deploy-demo-pages.yml (demo bundles → gh-pages branch)
```

**Data (MongoDB):** `restaurants` (slug, storeOpen, ordering settings),
`menu_categories`, `menu_items` (variants/addons/availability), `orders`
(status machine + idempotency key), `reservations`, `storefront_content`
(draft + published + ≤20 version history), `customers` (bcrypt, addresses),
`events` (ALL analytics — funnel, cohorts, future intelligence read this),
`campaigns` (QUEUED sends), plus the original SaaS collections (posts,
strategy, subscriptions…).

**Auth:** two separate JWT populations — merchants (Firebase phone-OTP) and
storefront customers (email/password + bcrypt). Demo mode fakes both.

---

## 4. The five rules that keep you safe

These are not suggestions. Every incident-free commit so far followed them.

1. **Additive only.** The SaaS features and the v1 shell must keep working.
   New behavior goes behind flags (`VITE_DEMO_MODE`, `VITE_ADMIN_SHELL`).
   Default builds stay behavior-identical.
2. **Demo parity.** Both frontends ship a demo mode: `api.ts` exports typed
   clients; `demo-api.ts` provides a fixtures-backed implementation typed as
   `typeof realX` (compiler enforces parity). Any new client method gets its
   demo twin the same day, or the feature doesn't ship.
3. **Data model first.** Types in `packages/shared` → indexes/seeds in
   `packages/db` → routes in `apps/api` → client methods → UI. Never start
   from the UI.
4. **Sample data is `[SAMPLE]`-marked** and lives only in
   `packages/db/src/seeds/` and each app's `lib/demo-fixtures.ts`. Never
   hard-code content in components. Never commit secrets — `.env.example`
   documents every variable.
5. **Gates before every commit:**
   ```bash
   npx turbo build --filter=!@restropulse/db-cli
   npx turbo type-check
   npx turbo test --filter=@restropulse/web --filter=@restropulse/storefront --filter=@restropulse/api
   ```
   Baselines you must not go below: web 549 tests, storefront 31, api ordering
   suites green. Conventional commits (`feat(web): …`, `fix(api): …`).
   Label uncertainty `ASSUMPTION:` in your PR description; ask the owner when
   a product decision is ambiguous instead of guessing.

Known sandbox quirk: the full api test suite needs mongod binaries
(mongodb-memory-server); in environments that can't download them, 8
pre-existing SaaS test files skip/fail — that's environmental, not you.
The three ordering suites must always pass.

---

## 5. API surface (memorize the shape, look up the detail)

Base: Express on :3001. All responses `{ success, data?, error? }`.
Full tables with auth/params: `references/api-reference.md`.

- **Public storefront** `/api/storefront/:slug/*` — config, menu, events
  (rate-limited analytics ingest), auth/register, auth/login, me, addresses,
  orders (idempotency-key header, server-side price validation, payment
  stubbed at PENDING_PAYMENT→RECEIVED), orders/:id/track, reservations.
- **Admin ordering** `/api/admin/ordering/*` (merchant JWT + OWNER) — menu
  categories/items CRUD + reorder + availability, CSV import with per-row
  errors, orders feed + validated status transitions, store toggle,
  reservations, content draft/publish/rollback, analytics/summary, cohorts,
  campaigns.
- **SaaS (pre-existing)** — /api/auth, /api/restaurant, /api/posts (incl.
  `POST /api/posts/generate` used by the ✨ post generator), /api/strategy,
  /api/integrations, /api/subscriptions (+ Razorpay webhook), /api/coupons,
  /api/credit-packs, /api/invoices, /api/config, /api/account.

Order status machine: `RECEIVED → PREPARING → READY → OUT_FOR_DELIVERY
(delivery only) → COMPLETED`, plus `CANCELLED`. Server: 
`apps/api/src/services/ordering/status.ts`; client mirror:
`apps/web/components/ordering/order-status.ts`. Change both or neither.

---

## 6. Day-one setup

```bash
git clone https://github.com/bhargav465/restropulse-v2 && cd restropulse-v2
git checkout feat/monorepo-import
npm install
# real data (optional): set MONGODB_URI in apps/api/.env, then:
npm run seed:ordering --workspace=@restropulse/db-cli
npm run dev     # web :3000 · api :3001 · storefront :3003 (/demo)
```
No Mongo? Run the demo builds instead — they need nothing:
```bash
cd apps/storefront && VITE_DEMO_MODE=true npx vite dev
cd apps/web && VITE_DEMO_MODE=true VITE_ADMIN_SHELL=v2 npx vite dev
```

Demo deploys are automatic: push to `feat/monorepo-import` → CI builds three
bundles → force-pushes `gh-pages`. GitHub Pages CDN caches `index.html` for
~10 minutes — don't panic when you don't see your change instantly.

---

## 7. Execution order (what to build, in order)

0. **Merge the branch**: https://github.com/bhargav465/restropulse-v2/pull/new/feat/monorepo-import,
   set it as default.
1. **Design pass** (a previous attempt was lost uncommitted — rebuild it):
   design-token restyle + Dashboard bucket (default landing) + Onboarding
   checklist, as new files `apps/web/components/v2/{theme.ts, DashboardV2.tsx,
   GetStartedV2.tsx, onboarding.ts}`. Follow `references/design.md` — the
   palette is now Electric Lavender; build directly on the new tokens.
2. **Campaign ROI attribution** — coupon code per campaign, join
   orders⨝campaigns, show "34 sent → 9 redeemed → ₹4,200" per campaign.
3. **Customers (guest 360)** sub-tab — visits, last order, favorites, spend,
   opt-in, at-risk badge. All from existing collections.
4. **Churn automation rules** — `campaign_rules` + worker loop (copy the
   `apps/publisher` pattern).
5. **Intelligence v1** — repeat rate, new-vs-returning revenue, ROI trend,
   peak-hours heatmap, all from `events`.
6. **Sub-repo split + mobile apps** — the approved infra restructure. Do NOT
   attempt before reading `references/infra.md`.
7. Then: loyalty → QR source tracking → reviews → real payments (Razorpay) →
   WhatsApp delivery worker → template gallery. Seams for every one of these
   are documented in `docs/NEXT.md`.

**Go-live** (demo → production, when owner supplies credentials): merge →
Atlas + seed → Firebase/Meta/Razorpay keys into Key Vault → `AZURE_*` repo
vars → staging deploy on push → E2E happy path → workflow_dispatch production
promotion → rotate every credential that ever appeared in a chat or log.

---

## 8. Where things are (quick index)

| Need | File |
|---|---|
| Order totals math | `apps/api/src/services/ordering/totals.ts` |
| Cohort computation | `apps/api/src/services/ordering/cohorts.ts` |
| CSV import parser | `apps/api/src/services/ordering/menu-csv.ts` |
| All ordering types | `packages/shared/src/ordering.ts` |
| Canonical sample data | `packages/db/src/seeds/ordering-demo.ts` |
| v2 shell + buckets | `apps/web/components/v2/` |
| Post generator card | `apps/web/components/GeneratePostCard.tsx` |
| Campaigns UI | `apps/web/components/ordering/Campaigns.tsx` |
| Demo fixtures (admin / storefront) | `apps/web/lib/demo-fixtures.ts` / `apps/storefront/lib/demo-fixtures.ts` |
| Demo Pages CI | `.github/workflows/deploy-demo-pages.yml` |
| Azure CI | `.github/workflows/deploy-{staging,production}.yml` |

---

## 9. References — read these WHEN

| File | Read it when… |
|---|---|
| `references/design.md` | Touching ANY UI. Contains the current design base, the NEW Electric Lavender palette tokens (replacing coral), migration steps, and the declutter rules from owner feedback. |
| `references/infra.md` | Deploying anything, adding CI, provisioning Azure, or starting the sub-repo split / mobile apps. Contains environments, secrets inventory, the per-feature repo plan (web + mobile), and its migration phases. |
| `references/api-reference.md` | Adding/changing any endpoint or client method. Full route tables (method, path, auth, body), external API list, and the client-layer parity rules. |
| `references/skill-creator.md` | Creating a new skill/agent contract for AI-assisted work on this repo, or updating THIS skill. Contains the agent contract template and skill-authoring rules (~500-line limit, references pattern). |

If this file and a reference disagree, the reference wins for its domain —
then fix the disagreement in the same PR.
