# NEXT — Deferred Spec Areas and Their Extension Points

Ordering platform v1 shipped the core loop (menu → cart → checkout → order feed →
fulfilment) and deliberately deferred the areas below. Each subsection names the exact
seam in code where the feature plugs in and the contract it must honour, so the next
engineer starts from a known socket rather than a blank page.

## 1. Payments (Razorpay checkout for orders)

**Plugs in at:** `apps/api/src/routes/storefront.ts` → `POST /orders` handler, and
`apps/api/src/services/razorpay.ts` (already has `createRazorpayOrder`,
`verifyPaymentSignature`, `verifyWebhookSignature` from SaaS billing).

**Contract:** Orders are already created with a `PENDING_PAYMENT` status stub: v1
writes `statusHistory: [PENDING_PAYMENT, RECEIVED]` in one insert (auto-confirm).
To integrate payments:

1. Stop auto-confirming — insert the order with `status: 'PENDING_PAYMENT'` only.
2. Call `createRazorpayOrder(amountPaise, currency, receipt)` with
   `order.totals.total` (convert to paise) and return `{ order, razorpayOrderId, keyId }`
   to the storefront; open Razorpay checkout on `CheckoutPage.tsx`.
3. On payment webhook/callback, verify the signature (`verifyPaymentSignature`) and
   transition `PENDING_PAYMENT → RECEIVED` through the state machine
   (`canTransitionOrderStatus` in `apps/api/src/services/ordering/status.ts`) — it
   already models `PENDING_PAYMENT → RECEIVED | CANCELLED`.
4. The idempotency plumbing (`Idempotency-Key` header + partial unique index on
   `orders.{restaurantId,idempotencyKey}`) already prevents double-submits and must be
   preserved across the payment redirect.

Money fields: `OrderTotals` (`packages/shared/src/ordering.ts`) is the single money
shape — add `paymentId` / `razorpayOrderId` fields to `Order` rather than a new
collection.

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
