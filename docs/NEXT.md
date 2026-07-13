# NEXT — Deferred Spec Areas and Their Extension Points

Ordering platform v1 shipped the core loop (menu → cart → checkout → order feed →
fulfilment) and deliberately deferred the areas below. Each subsection names the exact
seam in code where the feature plugs in and the contract it must honour, so the next
engineer starts from a known socket rather than a blank page.

## 1. Payments (Razorpay checkout for orders) — ✅ SHIPPED (Brief 02 / DESIGN-02)

**Status:** Implemented. This section is retained as a pointer; the guidance below
is superseded by what actually shipped.

**What shipped (see DESIGN-02):**
- A dedicated `payments` collection (one doc per order) — NOT extra fields on `Order`.
  Helpers `findPaymentByOrderId` / `findPaymentByProviderOrderId` and indexes
  (`{orderId}` unique, `{restaurantId,createdAt}`, `{providerOrderId}`) live in
  `packages/db/src/ordering.ts`; types in `packages/shared/src/types/payment.ts`.
- `POST /orders` inserts `PENDING_PAYMENT` only when `isRazorpayConfigured()`; the
  legacy auto-confirm stub is kept for key-less dev/demo backends.
- Routes: `POST /api/storefront/:slug/payments/intent`,
  `POST /api/storefront/:slug/payments/verify`, and webhook `POST /api/payments/webhook`
  (raw-body mount sibling to the subscriptions webhook in `server.ts`).
- `OrderStatus` gained `PAYMENT_FAILED`; both status-machine mirrors updated:
  `PENDING_PAYMENT → RECEIVED | PAYMENT_FAILED | CANCELLED`,
  `PAYMENT_FAILED → PENDING_PAYMENT | CANCELLED` (retry re-arms payment).
- `order_placed` / `payment_succeeded` / `payment_failed` are emitted SERVER-side at
  capture (verify/webhook), so the funnel counts paid orders.

## 1a. Refunds (order payments) — NOT built, contract only

**Plugs in at:** a new merchant admin route + the existing payments webhook
(`apps/api/src/routes/payments-webhook.ts`) and the `payments` collection.

**Contract:**
- `POST /api/admin/ordering/orders/:id/refund` `{ amount?: number /* paise */, reason: string }`
  — merchant JWT, role `OWNER`. Full refund when `amount` omitted.
- Calls Razorpay `POST /payments/:paymentId/refund` (add `refundRazorpayPayment` to
  `apps/api/src/services/razorpay.ts`); `paymentId` is `payments.providerPaymentId`.
- Webhook `refund.processed` → payment `captured → refunded`, append
  `events[] { type: 'webhook:refund.processed', source: 'webhook', providerPaymentId }`.
- The order stays in its terminal state (COMPLETED/CANCELLED untouched) — refunds are a
  money concern, not an order-status transition.
- UI: a refund button in the admin order-detail view.

## 2. WhatsApp / Email Automation (order + reservation notifications)

**Plugs in at:** the two write-side chokepoints that already emit events:
`emitOrderingEvent` (`apps/api/src/services/ordering/events.ts`) and the order status
transition handler (`PATCH /orders/:id/status` in
`apps/api/src/routes/admin-ordering.ts`).

**Contract:** every state change already produces a durable row in the `events`
collection: `order_placed`, `order_status_changed` (payload `{ orderId, from, to }`),
`reservation_requested`, `reservation_confirmed`, `reservation_declined`. Build a
poll-based notifier worker (same pattern as `apps/publisher` / `apps/content-engine`:
standalone Node process, cron poll, no Express) that tails `events` by `ts` with a
cursor/checkpoint, maps event name → template, and sends via WhatsApp Business API /
email provider. Alternatively, for synchronous sends, hook directly after
`emitOrderingEvent(...)` calls — but the worker approach keeps the API request path
fast and retryable. Customer contact comes from `order.customerPhone` /
`customers.email`; reservation contact from the reservation document itself.

## 3. Delivery-Dispatch Microservice

**Plugs in at:** `PATCH /api/admin/ordering/orders/:id/status`
(`apps/api/src/routes/admin-ordering.ts`) — the only place order status changes are
written. Emit the dispatch trigger where `emitOrderingEvent({ name:
'order_status_changed', ... })` is called, when `to === 'RECEIVED'` (order confirmed)
or `to === 'READY'` for handoff, and `order.orderType === 'delivery'`.

**Contract:** publish an `order.confirmed` message containing
`{ orderId, restaurantId, orderNumber, address: OrderAddress, totals: OrderTotals,
customerPhone }` (all shapes in `packages/shared/src/ordering.ts`). v1's `events`
collection can serve as the outbox (worker polls, exactly like §2); a queue (Azure
Service Bus) slots in behind the same emit call later. The dispatch service reports
back by calling the same status route (or a service-token variant) to move
`READY → OUT_FOR_DELIVERY → COMPLETED`; the state machine in
`services/ordering/status.ts` already enforces delivery-only legality of
`OUT_FOR_DELIVERY`.

## 4. Template Gallery (storefront themes)

**Plugs in at:** `storefront_content` versioning —
`apps/api/src/routes/admin-ordering.ts` content routes (`/content/draft`,
`/content/publish`, `/content/rollback`) and the `StorefrontContent` type
(`packages/shared/src/ordering.ts`).

**Contract:** a "template" is just a pre-baked `StorefrontContent` value (hero images,
theme colors via `StorefrontTheme`, section copy). Ship a gallery as a static list of
`StorefrontContent` presets; "apply template" = `PUT /content/draft` with the preset,
then normal publish. The version history (`versions[]`, capped at
`STOREFRONT_VERSION_HISTORY_LIMIT = 20`) already gives free undo via
`POST /content/rollback`, so applying a template is inherently reversible. Renderers:
storefront pages read `published` from `GET /api/storefront/:slug/config`; any new
template section must be optional on `StorefrontContent` so old published docs stay
valid.

## 5. SEO Integrations

**Plugs in at:** `apps/storefront/index.html` + a per-page head manager, and a new
public API surface if server-rendering is needed.

**Contract:** v1 is a client-rendered SPA — crawlable content requires either
(a) react-helmet-style dynamic `<title>`/meta driven by `GET /:slug/config` (restaurant
name, about, contact already available), plus JSON-LD `Restaurant` / `Menu` schema
built from `GET /:slug/menu`; or (b) prerendering/SSR at the edge (Vercel) hitting the
same two public endpoints. Sitemap generation belongs in the API (it knows all slugs
via the unique `restaurants.slug` index): add `GET /sitemap.xml` iterating
`findRestaurantBySlug`'s collection. No auth involved — both source endpoints are
public by design.

## 6. RBAC Beyond OWNER

**Plugs in at:** `requireRole` (`apps/api/src/middleware/require-role.ts`) and the
router-level guard in `apps/api/src/routes/admin-ordering.ts`
(`router.use(requireAuth, requireRole('OWNER'))`).

**Contract:** roles ride in the merchant JWT payload (`role` claim, set at token
generation in `apps/api/src/services/jwt.ts`). To add e.g. `MANAGER` (orders +
reservations, no menu/content edit) or `KITCHEN` (order status only): extend the role
union in `packages/shared` user types, then replace the single router-level
`requireRole('OWNER')` with per-route guards — the admin router is already grouped by
concern (menu / orders / reservations / content / analytics) so guard placement is
mechanical. Customer role (`'customer'`) must remain excluded from all admin routes.

## 7. Loyalty

**Plugs in at:** order completion — the same `order_status_changed` transition seam as
§2 (award points when `to === 'COMPLETED'`), and `customers`
(`packages/db/src/ordering.ts`) for the balance.

**Contract:** add `loyalty: { points: number, tier?: string }` to `Customer`
(`packages/shared/src/ordering.ts`); award in a worker consuming `events` (idempotent
by `orderId`), or inline in the status route. Redemption plugs into
`computeOrderTotals` (`apps/api/src/services/ordering/totals.ts`) — the totals shape
already carries a `discount` field that is 0 in v1, so a redeemed-points discount slots
in without changing the `OrderTotals` contract. Surface balance via the existing
`GET /api/storefront/:slug/me` response.

## 8. AI Post Generation ("Create a new post" in Content Studio)

**Plugs in at:** `POST /api/posts/generate` (`apps/api/src/routes/posts.ts`) and the
client method `postsAPI.generatePost({ brief, tone })` (`apps/web/api.ts`, demo twin in
`apps/web/demo-api.ts`).

**Contract:** the Content Studio generator card (`apps/web/components/GeneratePostCard.tsx`)
sends `{ brief, tone, concept, type }` — `concept`/`type: 'IMAGE'` keep the call working
against today's adhoc-generate route (which creates a `PENDING_CONTENT` stub for the
content-engine), while `brief` + `tone` (`'fun' | 'elegant' | 'spicy'`) are the new
inputs the server does not consume yet. To finish the seam: read `brief`/`tone` in the
route, persist them on the post stub, and thread them into the content-engine prompt
(`generator.generatePost`) so the tone shapes the caption. Response shape stays
`ApiResponse<Post>` — the card only needs the created post back. Demo mode already
models the target UX: ~800 ms latency, then a `PENDING_APPROVAL` post with a
tone-flavoured caption template (hook from brief + body + hashtags incl. `#DemoKitchen`).

## 9. Campaign Delivery (WhatsApp sends for Growth Campaigns)

**Plugs in at:** the `campaigns` collection (`getCampaignsCollection`,
`packages/db/src/connection.ts`) and the `campaign_queued` analytics event emitted by
`POST /api/admin/ordering/campaigns` (`apps/api/src/routes/admin-ordering.ts`).

**Contract:** v1 records intent only. Each queued send is a `CampaignRecord`
(`packages/shared/src/ordering.ts`): `{ restaurantId, cohortId, kind: 'whatsapp_nudge' |
'discount_offer', discount?, audienceCount, status: 'QUEUED', createdAt }`. Build a
poll-based delivery worker (same pattern as §2 — standalone Node process tailing either
the `campaigns` collection by `status: 'QUEUED'` or the `events` outbox): resolve the
cohort membership at send time via `computeCohorts`
(`apps/api/src/services/ordering/cohorts.ts` — pure, unit-tested), map cohort + kind to
a WhatsApp Business API template (discount fields fill template variables), send, then
advance the doc `QUEUED → SENDING → SENT/FAILED` with per-recipient results.
Compliance is a hard requirement the UI already promises ("Messages go only to opted-in
customers"): add an `optIn: boolean` (default false) to `Customer` and filter cohort
membership on it before sending. Cohort definitions: drop-off = `add_to_cart`/
`begin_checkout` sessions with no `order_placed` in 7 days; non-transacted = customers
with 0 orders; lapsed = latest order older than 30 days.

**Update (Brief 03 / DESIGN-03):** the `CampaignStatus` union
(`'QUEUED' | 'SENDING' | 'SENT' | 'FAILED'`) and `CampaignRecord.status` widening
already shipped, so the worker can persist its transitions without a shared-types
change. A poll index `campaigns { status: 1, createdAt: 1 }` is also live
(`ensureOrderingIndexes`) for the oldest-first `status: 'QUEUED'` scan. `POST /campaigns`
still writes `'QUEUED'` only — no delivery code shipped in Brief 03.

## 10. `PUT /api/restaurant/:id` field whitelist (Brief 04) — ✅ SHIPPED (Brief 04 / DESIGN-04)

**Status:** Implemented. `PUT /:id` and the new `PATCH /api/restaurant/profile` both run
the SAME `sanitizeProfilePatch` server-side whitelist, sourced from the single
`RESTAURANT_PROFILE_FIELDS` constant in `packages/shared`. Blocked keys (`slug`,
`instagramCredentials`, `razorpayCustomerId`, `integrations`, `ordering`, …) are silently
dropped + warn-logged and can no longer be mass-assigned. Additionally, the public
`GET /api/restaurant/:id` and `GET /profile` share a `sanitizeRestaurantForPublic` helper
that strips server-internal credential fields (`instagramCredentials`, `razorpayCustomerId`)
from every response. The original guidance below is retained for context.

**Plugs in at:** `apps/api/src/routes/restaurant.ts` (`PUT /:id`), which today passes
`req.body` straight into a `$set` (mass-assignment). Profile fields DO persist, so this
is a hardening item, not a Mongo gap — but a merchant JWT could currently overwrite
sensitive fields (`slug`, `instagramCredentials`, `razorpayCustomerId`, `integrations`,
`ordering`) on its own restaurant.

**Contract (implement alongside Brief 04's profile UI):** the route accepts ONLY the
owner-editable profile fields —
`{ name, cuisine, description, phone, website, priceRange, location, operatingHours,
serviceOptions, activeOffers, chefSpecials }` — and rejects/ignores everything else.
Explicitly NOT settable via this route: `slug`, `instagramCredentials`,
`razorpayCustomerId`, `integrations`, `ordering`. Whitelist server-side (pick allowed
keys before `$set`); do not rely on the client to omit them.

## 11. Asset storage — Azure Blob swap + orphan-asset GC (Brief 04 seam)

**Plugs in at:** `apps/api/src/services/assets.ts` — the `AssetStore { put, openDownload }`
interface. Brief 04 ships GridFS as the sole implementation (`packages/db/src/assets.ts`,
bucket `assets`), riding the existing `MONGODB_URI` for zero new infra. Routes
(`POST /api/restaurant/assets`, `GET /api/assets/:id`) talk ONLY to `assetStore`, never to
GridFS directly.

**Contract (Azure Blob):** add one `AzureBlobAssetStore` class implementing the same
`AssetStore` interface (container + connection string via new env vars documented in
`.env.example`), and select it from an `ASSET_STORE=gridfs|azure-blob` flag in
`assets.ts`. The public URL shape stays `/api/assets/:id` — the serve route resolves the
id through `assetStore.openDownload`, so the storefront/admin never see the backend
change. `metadata: { restaurantId, kind }` is already attached at upload time, so a blob
impl can key objects by `restaurantId/<id>`.

**Contract (orphan-asset GC — deferred, harmless):** replacing a logo/cover writes a NEW
write-once id and PATCHes `logoUrl`/`coverImageUrl`; the previous asset is left in the
bucket (not deleted). A GC pass (worker or cron, same pattern as the other poll workers)
can enumerate `assets.files` and delete any id not referenced by a `restaurants`
`logoUrl`/`coverImageUrl` or a `storefront_content` `theme.logoUrl`. Safe to defer:
orphaned images are unreferenced and immutable, so they only cost storage.

## Intelligence v2 — computed fields not exposed by the frozen BRIEF-07 shapes (Brief 09)

**Status:** UI ships against the frozen BRIEF-07 response shapes. Three DailyTrends/Compare
adornments named in BRIEF-09 need data the frozen shapes do not carry; each is deferred with
its exact seam below (no route was changed by Brief 09 — client-only slice).

**Response-rate on trends + the Compare matrix.** `SnapshotSeriesPoint` (services/intelligence/
`snapshots.ts` `toDayPoint`) and the `CompareRow.google|zomato` projection (services/intelligence/
`compare.ts` `projectSource`) both omit `responseRate`, though `DailySnapshot.responseRate` exists.
So `DailyTrends` computed chips render rating-velocity / net-new-reviews / latest-rating (all
`computed`) but not response rate, and `Compare.tsx` shows Rating/Reviews/New/Photos but no
response-rate column. **Contract:** add `responseRate?: number` to `toDayPoint`'s output and to
`projectSource` (both server-side, additive), then the web `SnapshotSeriesPoint` (already has the
optional field pattern) and `CompareRow` pick it up; `Compare.tsx` adds a 5th column and `DailyTrends`
a `Response rate` chip — no client refetch shape change.

**Competitor review text on Compare row-expand + star-mix / avg-review-length chips.**
`CompareRow.*.newReviews` is a COUNT, and `feedback-changes` is self-only, so a competitor row
expands to "N new reviews this period" rather than the review cards + theme chips BRIEF-09 sketches;
likewise `DailyTrends` cannot compute star-mix / avg-review-length for self without review-level rows
in the series. **Contract:** either (a) a new `GET /compare/:placeId/reviews?from&to` returning
`FeedbackReview[]` for a watchlisted target, consumed by `Compare.tsx`'s expand block, or (b) widen
the self series to optionally embed `newReviews: SnapshotReview[]` behind a `?withReviews=1` flag for
`DailyTrends` star-mix. Both are additive server routes; the web components already have the render
seams (`CompareView` expand, `DailyTrends` "Computed metrics" card).
