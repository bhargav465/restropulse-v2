# DB Touchpoint Matrix (Brief 03 / DESIGN-03)

Every route family (`docs/handover/references/api-reference.md` §1–§3) and both workers,
audited against the real code in `apps/` + `packages/`. Records which MongoDB
collection(s) each touchpoint reads/writes, the index that serves it, and its status.

**The platform is Mongo-first in real mode** — no route is fixture-backed or in-memory.
`/analytics/summary` and `/cohorts` aggregate live from `events`/`orders`/`customers`;
campaigns persist to `campaigns`. Brief 03 closed the remaining index, type, and
bootstrap gaps; every row below is now `ok`.

## Demo mode is out of scope by design

`VITE_DEMO_MODE=true` ships static bundles (`apps/web` / storefront `demo-api.ts` twins +
fixtures) with **zero backend** — it never boots the API and never touches Mongo. Demo
fixtures are therefore NOT counted as gaps. The API also fails fast in real mode: api,
publisher, and content-engine all zod-require `MONGODB_URI` via `loadAndValidateEnv`
before connecting, and `serverSelectionTimeoutMS: 10_000` (`MONGO_CLIENT_OPTIONS`) turns a
bad/unreachable URI into a fast, clear failure instead of a ~30s hang.

## Matrix

| # | Touchpoint | Collection(s) | R/W | Index used | Status |
|---|---|---|---|---|---|
| 1 | SF GET /config | restaurants, storefront_content | R | slug uniq; restaurantId uniq | ok |
| 2 | SF GET /menu | menu_categories, menu_items | R | (restaurantId, sortOrder); (restaurantId, categoryId, sortOrder) | ok |
| 3 | SF POST /events | events | W | insert (fire-and-forget) | ok |
| 4 | SF /auth/register + /login | customers, events | R/W | (restaurantId, email) uniq | ok |
| 5 | SF /me, GET+POST /addresses | customers (addresses EMBEDDED) | R/W | _id | ok — note A |
| 6 | SF POST /orders | orders W; menu_items, customers R | R/W | (restaurantId, idempotencyKey) uniq partial; _id $in | ok |
| 7 | SF GET /orders, /:id, /:id/track | orders | R | (customerId, createdAt); _id | ok |
| 8 | SF /payments/intent + /verify (Brief 02) | payments, orders, events | R/W | payments{orderId} uniq | ok |
| 9 | POST /api/payments/webhook (Brief 02) | payments, orders, events | R/W | payments{providerOrderId} | ok |
| 10 | SF POST /reservations | reservations, events | W | insert | ok |
| 11 | ADM menu categories CRUD/reorder | menu_categories | R/W | (restaurantId, sortOrder) | ok |
| 12 | ADM menu items CRUD/availability/reorder | menu_items | R/W | (restaurantId, name) **UNIQUE** | ok — fixed G1 |
| 13 | ADM POST /menu/import (CSV upsert) | menu_categories, menu_items | W | upsert key (restaurantId, name) UNIQUE; retry-once on 11000 | ok — fixed G1 |
| 14 | ADM GET /orders feed | orders | R | (restaurantId, createdAt) for the unfiltered sort | ok — fixed G4a |
| 15 | ADM PATCH /orders/:id/status | orders, events | R/W | _id + prior-status guard | ok |
| 16 | ADM PATCH /store | restaurants, events | W | _id | ok |
| 17 | ADM reservations list/decide | reservations, events | R/W | (restaurantId, status, date) | ok |
| 18 | ADM content draft/publish/rollback | storefront_content | R/W | restaurantId uniq; versions $slice −20 | ok |
| 19 | ADM GET /analytics/summary | events (live aggregate) | R | (restaurantId, ts) | ok — fixed G4b |
| 20 | ADM GET /cohorts | events, orders, customers (live compute) | R | (restaurantId, name, ts) | ok |
| 21 | ADM POST /campaigns | campaigns, events | W | (restaurantId, createdAt); status TYPE = `CampaignStatus` | ok — fixed G3 |
| 22 | /api/auth (OTP + sessions) | users, otpChallenges (TTL) | R/W | users{phone}, users{firebaseUid sparse} | ok — fixed G4c |
| 23 | /api/restaurant (CRUD, offers, specials, analytics) | restaurants, users, subscriptions, posts | R/W | _id; posts agg (restaurantId) | ok — note B |
| 24 | /api/posts (+generate stub queue) | posts, restaurants, subscriptions | R/W | (restaurantId, status) | ok |
| 25 | /api/strategy (+cycles) | contentStrategies, strategyCycles, subscriptions | R/W | restaurantId uniq; (restaurantId, status) | ok |
| 26 | /api/integrations (IG OAuth) | restaurants, oauthSessions (TTL), dataDeletionAudits | R/W | sessionId uniq | ok |
| 27 | /api/subscriptions (+raw webhook) | subscriptions, subscriptionPlans, coupons, couponRedemptions, creditPurchases, creditPacks, invoices, users | R/W | razorpaySubscriptionId uniq sparse; razorpayOrderId uniq | ok |
| 28 | /api/coupons | coupons, couponRedemptions | R/W | code uniq | ok |
| 29 | /api/credit-packs | creditPacks, creditPurchases | R/W | razorpayOrderId uniq | ok |
| 30 | /api/invoices | invoices | R | (restaurantId, createdAt) | ok |
| 31 | /api/config/features | — (env only) | — | n/a | ok |
| 32 | /api/account (archive/delete) | archivedAccounts + cross-collection purge | W | (restaurantId, archivedAt) | ok |
| 33 | publisher worker (publish cron, token refresh) | posts, restaurants | R/W | status/scheduledFor | ok |
| 34 | content-engine worker (6+ processors) | posts, strategyCycles, contentStrategies, currentAffairsCache, mediaJobs, restaurants | R/W | via db-cli schemas | ok |
| 35 | Index bootstrap on real envs | ordering + intelligence index sets | — | `ensureOrderingIndexes` + `ensureIntelligenceIndexes` in `startServer()` after `connectDB()` | ok — fixed G2 |

**Counts: 35 ok · 0 stub · 0 gap.** (Was 7 gap rows: G1×2, G2, G3, G4a/b/c.)

**Note A** — the brief's "addresses" collection is intentionally embedded as
`customers.addresses[]`; no separate collection. **Note B** — `PUT /api/restaurant/:id`
passes `req.body` straight to `$set` (mass-assignment); profile fields persist correctly
so it is not a Mongo gap, but the field-whitelist hardening is deferred to Brief 04
(`docs/NEXT.md` §10).

## Gap → fix log

| Gap | What it was | How it was closed | Where |
|---|---|---|---|
| G1 | `menu_items (restaurantId, name)` NOT unique → duplicate item names; concurrent CSV imports create dupes | Index upgraded to `unique: true` with a boot-safe drop-and-recreate upgrade path (never crashes on legacy dup data — falls back to non-unique + warns, naming `db-cli dedupe-menu-items`). `POST`/`PATCH /menu/items` return **409** on 11000; CSV upsert **retries once** on 11000. New owner-run `db-cli dedupe-menu-items` (dry-run default; `--apply` RENAMES later dups to `"<name> (2)"`, never deletes) | `packages/db/src/ordering.ts`, `apps/api/src/routes/admin-ordering.ts`, `apps/db-cli/src/commands/dedupe-menu-items.ts` |
| G2 | ordering/intelligence indexes created ONLY by db-cli seed commands, never at API startup | `ensureOrderingIndexes()` + `ensureIntelligenceIndexes()` called inside `startServer()` after `connectDB()` (idempotent). Webhook raw-body mounts untouched | `apps/api/src/server.ts` |
| G3 | campaign delivery status frozen at type `'QUEUED'` — transitions not persistable | `CampaignStatus = 'QUEUED' \| 'SENDING' \| 'SENT' \| 'FAILED'`; `CampaignRecord.status` widened. `POST /campaigns` still writes `'QUEUED'`. Poll index `campaigns {status, createdAt}` added for the deferred worker (NEXT.md §9) | `packages/shared/src/ordering.ts`, `packages/db/src/ordering.ts` |
| G4a | unfiltered admin orders feed sort uncovered | `orders { restaurantId: 1, createdAt: -1 }` | `packages/db/src/ordering.ts` |
| G4b | `/analytics/summary` range match on (restaurantId, ts) uncovered | `events { restaurantId: 1, ts: -1 }` | `packages/db/src/ordering.ts` |
| G4c | OTP-login `findUserByPhone` / `findUserByFirebaseUid` unindexed | `users { phone: 1 }`, `users { firebaseUid: 1, sparse: true }` (SaaS index home) | `apps/db-cli/src/schemas/collections.ts` |

## Ops

- **Pooling/retry in one place:** `MONGO_CLIENT_OPTIONS` (`packages/db/src/connection.ts`)
  — `{ maxPoolSize: 20, minPoolSize: 1, serverSelectionTimeoutMS: 10_000, retryWrites,
  retryReads }` — used by both `connectDB` (api/publisher/content-engine) and the db-cli
  connection helper (`apps/db-cli/src/config/database.ts`). No other `new MongoClient(`
  call site with bare options remains.
- **No new env vars.** Pool options are code-level constants; `.env.example` (root +
  per-app) already documents `MONGODB_URI` / `MONGODB_DB_NAME` and both webhook secrets.

## Expected-collections checklist (brief item 2)

All exist with helpers; SaaS seeds via db-cli (`seedData.ts`), ordering demo via
`seed-ordering`, intelligence demo via `seed-intelligence` — all `[SAMPLE]`-marked.

restaurants · users (merchants) · customers · addresses (embedded) · menu_categories ·
menu_items · orders · events · reservations · storefront_content (draft + published +
versions ≤20) · campaigns · posts · strategyCycles · subscriptions · invoices · coupons ·
payments (Brief 02). No new collections in Brief 03.
