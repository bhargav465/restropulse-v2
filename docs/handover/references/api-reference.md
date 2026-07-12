# RestroPulse API Reference

Read when adding/changing any endpoint or client method. Base: Express on
:3001. All responses `ApiResponse<T> = { success, data?, error? }`. Extracted
from code (`apps/api/src/routes/`) — if this file and the code disagree, the
code wins; fix this file in the same PR.

## 1. Public storefront — `/api/storefront/:slug/*`
`:slug` resolves the restaurant (demo seed: `demo`). No auth unless noted.

| Method | Path | Auth / limits | Notes |
|---|---|---|---|
| GET | `/config` | — | Published content + theme + storeOpen + ordering settings (tax, delivery fee, min order, order types) |
| GET | `/menu` | — | Categories+items; `hidden` excluded; `out_of_stock` → `soldOut: true` |
| POST | `/events` | 60/min/IP | `{name, sessionId, payload?}` → `events` collection. Funnel + cohorts read this. Client events: page_view, menu_view, item_view, add_to_cart, view_cart, begin_checkout, login_prompt, order_placed |
| POST | `/auth/register` | rate-limited | `{name, email, password, phone?}` → customer JWT (role `customer`) |
| POST | `/auth/login` | rate-limited | `{email, password}` → customer JWT |
| GET | `/me` | customer JWT | Public profile (never passwordHash) |
| GET | `/addresses` | customer JWT | |
| POST | `/addresses` | customer JWT | |
| POST | `/orders` | customer JWT + `Idempotency-Key` header | Server re-validates items/prices against menu; computes totals (subtotal, tax, flat delivery fee, discount, total); enforces min order + store open. Razorpay configured → order stays `PENDING_PAYMENT` (pay via `/payments/*`); unconfigured backends keep the `PENDING_PAYMENT → RECEIVED` auto-confirm stub. Duplicate key → same order returned |
| POST | `/payments/intent` | customer JWT, 20/min/IP | `{orderId}` → `ApiResponse<PaymentIntent>` `{providerOrderId, keyId, amount /* paise */, currency:'INR'}`. Amount recomputed server-side from `order.totals.total`; idempotent per order (reuses the Razorpay order, incl. E11000 race). `503` if Razorpay unconfigured, `409` if already paid, re-arms `PAYMENT_FAILED → PENDING_PAYMENT` on retry |
| POST | `/payments/verify` | customer JWT, 20/min/IP | `{orderId, razorpayPaymentId, razorpayOrderId, razorpaySignature}` → `ApiResponse<{order}>`. HMAC-verifies (`verifyPaymentSignature`); valid → payment `captured`, order `PENDING_PAYMENT → RECEIVED`, emits `order_status_changed`/`order_placed`/`payment_succeeded`. Already-captured → 200 replay (webhook race). Tampered signature → 400, no transition |
| GET | `/orders` | customer JWT | Own orders |
| GET | `/orders/:id` | customer JWT | |
| GET | `/orders/:id/track` | customer JWT **or** `?orderNumber=&phone=` | Status + statusHistory; tracking page polls 10s |
| POST | `/reservations` | 10/min/IP | `{date, time, partySize, name, phone}` → status `pending` |

## 2. Admin ordering — `/api/admin/ordering/*` (merchant JWT, role OWNER)

| Method | Path | Notes |
|---|---|---|
| GET / POST | `/menu/categories` | |
| PATCH / DELETE | `/menu/categories/:id` | |
| PUT | `/menu/categories/reorder` | `{ids: []}` |
| GET / POST | `/menu/items` | Variants = absolute price; addons = additive. **`409`** `{error:'An item with this name already exists'}` on duplicate name — `(restaurantId, name)` is a UNIQUE index (Brief 03) |
| PATCH / DELETE | `/menu/items/:id` | PATCH returns **`409`** on a name rename that collides with an existing item |
| PATCH | `/menu/items/:id/availability` | `in_stock \| out_of_stock \| hidden` |
| PUT | `/menu/items/reorder` | |
| POST | `/menu/import` | multipart CSV; per-row error report; upsert key `(restaurantId, name)` now UNIQUE-index-backed — a concurrent-import 11000 race retries the upsert once (resolves as an update) |
| GET | `/orders` | Feed; `?status=` filter |
| PATCH | `/orders/:id/status` | Validated machine: `PENDING_PAYMENT → RECEIVED\|PAYMENT_FAILED`, `PAYMENT_FAILED → PENDING_PAYMENT` (retry), RECEIVED→PREPARING→READY→OUT_FOR_DELIVERY(delivery only)→COMPLETED; CANCELLED. Emits `order_status_changed` |
| PATCH | `/store` | `{open: boolean}` |
| GET | `/reservations` | `?date=` |
| PATCH | `/reservations/:id` | confirm / decline / no_show |
| GET / PUT | `/content/draft` | Full StorefrontContent draft (hero images, videoUrl, announcement, about, hours, contact, social, story timeline, chef bios, gallery, dine-in blocks, reservation slots, theme) |
| POST | `/content/publish` | Draft→published; version history capped 20 |
| POST | `/content/rollback` | Default: previous version |
| GET | `/analytics/summary` | `?from=&to=` → event counts by name (funnel) |
| GET | `/cohorts` | Computed: `drop_off_carts` (cart/checkout events, no order 7d), `non_transacted` (0 orders), `lapsed_30d`. Source: `services/ordering/cohorts.ts` |
| POST | `/campaigns` | `{cohort, channel: whatsapp\|discount, discount?: {percent 1-100, code 3-20 chars, expiryDays 1-90}}` → stored `QUEUED`, emits `campaign_queued`. Delivery worker = `docs/NEXT.md` §9 |

## 2b. Admin intelligence — `/api/admin/intelligence/*` (merchant JWT, role OWNER)

Restaurant Intelligence v1 (PR2). All responses `{success, data?, error?}`. Documents
keep their string `_id` (matching `@restropulse/shared` types + the PR1 `[SAMPLE]` seed).

| Method | Path | Notes |
|---|---|---|
| POST | `/scan` | `{name?, city?, force?}` — defaults from restaurant profile (`name`, `sourceCity`/address). 409 if a non-failed scan ran < 24 h ago unless `force:true`. Returns `202 {scanId}`; runs the pipeline as an async in-process job (fire-and-forget, status written to the scan doc). Status machine: `QUEUED → FETCHING_PLACES → ANALYZING → SCORING → COMPLETED\|FAILED` (`services/intelligence/scan-status.ts`) |
| GET | `/scan/:id` | Poll; returns the `IntelligenceScan` (with `reportId` once COMPLETED, `error` if FAILED) |
| GET | `/reports` | Last 12 `IntelligenceReportSummary` (id, restroScore, generatedAt, deltas) |
| GET | `/reports/latest` | Full latest `IntelligenceReport` or `null` |
| GET | `/reports/:id` | Full `IntelligenceReport` |
| GET | `/self-metrics` | `IntelligenceSelfMetrics` — repeat rate, new-vs-returning revenue, AOV, 7×24 peak-hours matrix, growth cohorts. Computed from existing `events`/`orders` via `services/ordering/cohorts.ts` — no new event tracking |

Pipeline services (`apps/api/src/services/intelligence/`): `places.ts` (Places API (New),
7-day `competitor_cache`), `analysis.ts` (Anthropic tool-use — `claude-haiku-4-5` classify +
`claude-sonnet-4-6` analysis, forced tool choice, compacted rows only), `scoring.ts` (pure:
threat, same-cuisine, restroScore 6-pillar composite), `seo.ts` (5 s homepage fetch),
`report-builder.ts`, `pipeline.ts`. Env (server-only): `GOOGLE_MAPS_API_KEY`, `ANTHROPIC_API_KEY`.

## 3. SaaS routes (pre-existing — do not break)

| Mount | Contents |
|---|---|
| `/api/auth` | Merchant Firebase-OTP verification → JWT; session |
| `/api/restaurant` | Profile CRUD, `getAnalytics` (dashboard numbers) |
| `/api/posts` | Content studio: list/approve/reject/schedule; **POST `/api/posts/generate`** — used by the ✨ generator (client sends `{brief, tone, concept, type}`); brief/tone consumption seam = `docs/NEXT.md` §8 |
| `/api/strategy` | Strategy cycles + themes (8-theme fixture system) |
| `/api/integrations` | Instagram OAuth (redirect + callback), status |
| `/api/subscriptions` | Plans; Razorpay webhook at `/api/subscriptions/webhook` (raw body — mounted BEFORE json parser; keep it that way) |
| `/api/payments` | Ordering-payments Razorpay webhook at `/api/payments/webhook` (raw body — mounted BEFORE json parser, on a SIBLING line next to the subscriptions raw mount). Handles `payment.captured` (order → RECEIVED) / `payment.failed` (order → PAYMENT_FAILED); unknown provider orders (e.g. subscription payments) → 200 ignore. Rank-safe; never regresses a captured payment |
| `/api/coupons` `/api/credit-packs` `/api/invoices` `/api/config` `/api/account` | Billing + account management |

## 4. Client layers (parity is a hard rule)

- `apps/storefront/api.ts` and `apps/web/api.ts` export typed clients.
- Demo mode (`VITE_DEMO_MODE=true`) swaps to `demo-api.ts` implementations
  typed as `typeof realX` — the compiler enforces interface parity.
- Any new server route ⇒ same-day: real client method + demo twin + fixture
  data. No exceptions; the live demos depend on it.
- Status machine mirror: `apps/api/src/services/ordering/status.ts` ⇄
  `apps/web/components/ordering/order-status.ts` — change both or neither.

## 5. External APIs

| Service | Used by | Notes |
|---|---|---|
| Meta Graph v18 | publisher worker, integrations | Instagram/Facebook publishing; token refresh cron |
| Firebase Identity | apps/web login, api middleware | Merchant phone-OTP |
| Razorpay | subscriptions (live), ordering payments (live — DESIGN-02) | Two signature-verified webhooks: `/api/subscriptions/webhook` + `/api/payments/webhook` (shared `RAZORPAY_WEBHOOK_SECRET`) |
| Replicate | tools/image-studio | Dish/hero image generation |
| WhatsApp Business Cloud | planned | Campaign delivery worker (NEXT.md §9); opt-in filter mandatory |
| Google Maps Places | web onboarding autocomplete | `VITE_GOOGLE_MAPS_API_KEY` |
