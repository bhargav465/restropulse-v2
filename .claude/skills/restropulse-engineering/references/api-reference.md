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
| POST | `/orders` | customer JWT + `Idempotency-Key` header | Server re-validates items/prices against menu; computes totals (subtotal, tax, flat delivery fee, discount, total); enforces min order + store open; `PENDING_PAYMENT → RECEIVED` (payment stub); duplicate key → same order returned |
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
| GET / POST | `/menu/items` | Variants = absolute price; addons = additive |
| PATCH / DELETE | `/menu/items/:id` | |
| PATCH | `/menu/items/:id/availability` | `in_stock \| out_of_stock \| hidden` |
| PUT | `/menu/items/reorder` | |
| POST | `/menu/import` | multipart CSV; per-row error report; upsert key `(restaurantId, name)` |
| GET | `/orders` | Feed; `?status=` filter |
| PATCH | `/orders/:id/status` | Validated machine: RECEIVED→PREPARING→READY→OUT_FOR_DELIVERY(delivery only)→COMPLETED; CANCELLED. Emits `order_status_changed` |
| PATCH | `/store` | `{open: boolean}` |
| GET | `/reservations` | `?date=` |
| PATCH | `/reservations/:id` | confirm / decline / no_show |
| GET / PUT | `/content/draft` | Full StorefrontContent draft (hero images, videoUrl, announcement, about, hours, contact, social, story timeline, chef bios, gallery, dine-in blocks, reservation slots, theme) |
| POST | `/content/publish` | Draft→published; version history capped 20 |
| POST | `/content/rollback` | Default: previous version |
| GET | `/analytics/summary` | `?from=&to=` → event counts by name (funnel) |
| GET | `/cohorts` | Computed: `drop_off_carts` (cart/checkout events, no order 7d), `non_transacted` (0 orders), `lapsed_30d`. Source: `services/ordering/cohorts.ts` |
| POST | `/campaigns` | `{cohort, channel: whatsapp\|discount, discount?: {percent 1-100, code 3-20 chars, expiryDays 1-90}}` → stored `QUEUED`, emits `campaign_queued`. Delivery worker = `docs/NEXT.md` §9 |

## 3. SaaS routes (pre-existing — do not break)

| Mount | Contents |
|---|---|
| `/api/auth` | Merchant Firebase-OTP verification → JWT; session |
| `/api/restaurant` | Profile CRUD, `getAnalytics` (dashboard numbers) |
| `/api/posts` | Content studio: list/approve/reject/schedule; **POST `/api/posts/generate`** — used by the ✨ generator (client sends `{brief, tone, concept, type}`); brief/tone consumption seam = `docs/NEXT.md` §8 |
| `/api/strategy` | Strategy cycles + themes (8-theme fixture system) |
| `/api/integrations` | Instagram OAuth (redirect + callback), status |
| `/api/subscriptions` | Plans; Razorpay webhook at `/api/subscriptions/webhook` (raw body — mounted BEFORE json parser; keep it that way) |
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
| Razorpay | subscriptions (live), ordering payments (planned seam) | Webhook signature-verified |
| Replicate | tools/image-studio | Dish/hero image generation |
| WhatsApp Business Cloud | planned | Campaign delivery worker (NEXT.md §9); opt-in filter mandatory |
| Google Maps Places | web onboarding autocomplete | `VITE_GOOGLE_MAPS_API_KEY` |
