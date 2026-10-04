# ADR 0003: Delivery provider layer (Rapido, Shadowfax, self-delivery)

## 1. Status

**Accepted** -- 2026-10-04, with one amendment from the owner: aggregators are reached through a delivery middleware (uEngage Flash / Pidge / Shipway; choice pending in ADR 0004) rather than direct Rapido/Shadowfax adapters, because Rapido exposes no public API and Shadowfax's public Unified API is the e-commerce product, not hyperlocal Flash. Interface, mock, self and dispatcher proceed now; the middleware adapter starts when a merchant account + API key + webhook secret exist.

## 2. Context

Orders placed on a restaurant's website need a rider. The owner wants Rapido and Shadowfax (and later Porter, ONDC logistics and similar) "behind a clean provider interface". No API documentation is in hand for either; online, Rapido has no public merchant API and Shadowfax publishes only its e-commerce Unified API, so the first real adapter targets a delivery middleware that already carries both. Aggregator APIs are asynchronous (webhooks for rider assignment and status), rate-limited, occasionally unavailable, and charge for waiting time at pickup. The API must never block an HTTP request on an aggregator call, and a provider outage must degrade to a manual fallback rather than lose the order.

Existing patterns to reuse: the Razorpay webhook (raw body + HMAC verification + status-rank idempotency in `routes/subscriptions.ts`), the publisher cron worker (retry with attempt counts), the ordering status machine (`services/ordering/status.ts`, imported from the Vercel line).

## 3. Decision

### 3.1 Package and interface

New workspace package `packages/delivery` (`@restropulse/delivery`), types in `@restropulse/shared` (`packages/shared/src/delivery.ts`).

```ts
export interface DeliveryProvider {
  readonly id: DeliveryProviderId;            // 'mock' | 'self' | 'middleware' | 'shadowfax' | 'rapido'
  quote(req: QuoteRequest): Promise<DeliveryQuote | NotServiceable>;
  createShipment(input: CreateShipmentInput): Promise<Shipment>;   // idempotent on input.idempotencyKey
  cancelShipment(externalId: string, reason: string): Promise<void>;
  track(externalId: string): Promise<ShipmentStatusSnapshot>;
  verifyWebhook(headers: Record<string, string>, rawBody: Buffer): boolean;
  parseWebhook(body: unknown): ShipmentEvent[];                    // canonical events only
}
```

Canonical shipment states: `QUOTED -> BOOKED -> RIDER_ASSIGNED -> PICKED_UP -> IN_TRANSIT -> DELIVERED`, terminal `CANCELLED`, `FAILED` (RTO / undeliverable). Every adapter maps its vendor statuses to these; nothing outside the adapter sees vendor strings.

Order <-> shipment coupling: `PICKED_UP` moves the order to `OUT_FOR_DELIVERY`; `DELIVERED` moves it to `COMPLETED`; `FAILED` raises a merchant nudge and leaves the order at `READY` for re-dispatch. The order status machine stays the single source of truth for order state; shipments carry their own state.

### 3.2 Dispatcher

`apps/api/src/services/delivery/dispatcher.ts` is pure orchestration, exercised through the outbox:

1. Trigger: order transition to `READY` (default; per-restaurant setting may choose `PREPARING`) for `orderType = 'delivery'`.
2. Enqueue `delivery_jobs { type: 'dispatch', orderId, attempts: 0, nextRunAt: now }`. The HTTP request returns immediately.
3. Worker (`apps/dispatch-worker`, publisher pattern, cron every 15s) claims the job atomically (`findOneAndUpdate` with `status: 'queued' -> 'running'`), asks each enabled provider for a quote in parallel with a 5s timeout, selects by `deliverySettings.strategy` (`cheapest | fastest | preferred[]`), calls `createShipment` with `idempotencyKey = orderId:attempt`.
4. On vendor failure: next provider; if all fail, fall back to `self` (merchant assigns a rider manually) and emit a nudge. Job retries with exponential backoff (max 5) only for transient errors; permanent errors (unserviceable address) end the job and nudge.
5. Persist `shipments` and set `order.shipmentId`.

### 3.3 Webhooks

`POST /api/webhooks/delivery/:provider` mounted with `express.raw`, before `express.json`, exactly like the Razorpay webhook. Flow: `verifyWebhook` -> `parseWebhook` -> insert into `webhook_events` with unique `{ provider, eventId }` (duplicate => 200 and stop) -> apply events in order with status-rank guard (never move a shipment backwards) -> update order via the status machine. Webhook handlers never call vendors; follow-up actions go through `delivery_jobs`.

### 3.4 Adapters

| Adapter | Purpose | Scope now |
|---|---|---|
| `mock` | Deterministic scripted timeline for tests, demo mode and the storefront tracking page | Yes |
| `self` | Merchant marks `RIDER_ASSIGNED/PICKED_UP/DELIVERED` manually from the Orders feed | Yes |
| `middleware` | The chosen delivery middleware (ADR 0004); exposes Rapido, Shadowfax and others as `shipment.carrier` | When merchant account + API key + webhook secret exist |
| `shadowfax`, `rapido` | Direct adapters | Later, only if direct partner docs arrive; same interface |

Vendor credentials live in Key Vault as `{env}-delivery-middleware-api-key` and `{env}-delivery-middleware-webhook-secret` (renamed to the vendor once ADR 0004 picks it) and are declared in `packages/secrets/src/manifest.ts` under `dispatch-worker` and `api`.

### 3.5 Customer delivery fee is separate from provider cost

The provider quote is what we pay; what the customer pays comes from the restaurant's own fee rules (`services/delivery/fee-rules.ts`, zone x time x order value, see `docs/LAUNCH_ARCHITECTURE.md` B5). Both are stored on the shipment so margin per order is visible. Dispatch strategy (`cheapest | fastest | preferred`) decides the provider; fee rules decide the price. They never read each other except through the `pass_through` charge kind.

## 4. Alternatives considered

- **Call the aggregator inline from the order-status route.** Simplest, but a 5-10 s vendor timeout blocks the merchant's UI, and a vendor outage fails the status change. Rejected.
- **One generic "logistics aggregator of aggregators" SaaS (e.g. a third-party dispatch API).** Fewer adapters to write, but adds margin per order and a fourth vendor; can be added later as just another `DeliveryProvider`. Deferred.
- **ONDC logistics network.** Strategically interesting for India, but the onboarding and buyer-app certification effort is weeks of human work. Out of scope; fits the interface when it comes.

## 5. Consequences

- Positive: aggregator outages never block the merchant; adding a provider is one adapter file plus pricing; tests run entirely on `mock`; the storefront tracking page works in demo mode.
- Negative: a new worker process in `startup.sh` and both deploy workflows; two new collections and an outbox to monitor (dead-letter alert required); quote fan-out costs one API call per enabled provider per order.
- Decided by owner (2026-10-04): dispatch at `READY` with per-restaurant override to `PREPARING`; customer fee fully configurable per restaurant (Section 3.5). Open: which middleware (ADR 0004).
