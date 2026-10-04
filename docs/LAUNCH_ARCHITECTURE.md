# RestroPulse -- Launch Architecture (two lanes)

*Status: DRAFT for owner review -- 4 Oct 2026. Base: `baxeltech-staging` (snapshot of baxeltech/restropulse staging @ c070aa2). Nothing in this document is implemented yet; it is the plan both lanes build against. Decisions marked **DECISION** need Bhargav's answer before that piece starts.*

---

## 0. Shape of the work

```
                 +----------------------------------------------+
                 | Phase 0 - Launch floor (1 week, both lanes   |
                 | blocked on it)                               |
                 |  CI on PR - realistic coverage gate -        |
                 |  noindex/security headers - Mongo suites run |
                 +---------------+------------------------------+
                                 |
        +------------------------+------------------------+
        v                                                 v
+---------------------------+              +----------------------------------+
| LANE A - Content & Profile |              | LANE B - Restaurant Sites,       |
| (harden what exists)       |              | Ordering & Delivery (build)      |
| A1 image pipeline          |              | B1 import ordering from Vercel   |
| A2 approval-queue UX       |              | B2 tenant + custom domains       |
| A3 video / reels           |              | B3 sites host + SEO              |
| A4 Meta publishing         |              | B4 delivery provider layer       |
| A5 restaurant profile,     |              | B5 payments completion           |
|    landing, grader funnel  |              | B6 CMS (menu/offers/content)     |
+-------------+--------------+              +--------------+-------------------+
              |                                            |
              +---------------- shared seam ---------------+
                     ONE canonical menu model (Section 3)
                     events -> nudges feed for every failure (Section 4)
```

Both lanes are executed by Claude in PR-sized commits with tests; Bhargav reviews, runs the Mongo-backed suites on the Mac, and pushes to `baxeltech/restropulse`.

---

## 1. Phase 0 -- launch floor (blocks both lanes)

| # | Change | Why | Files |
|---|---|---|---|
| P0-1 | `ci.yml` triggers on `pull_request` + `push` to `staging`/`main`; keep `workflow_dispatch` | Today nothing gates a merge | `.github/workflows/ci.yml` |
| P0-2 | Reset `config/coverage-baseline.json` to measured reality (web ~68/60/58) and **ratchet** +2 pts per sprint; new code in both lanes ships >=85% on its own files | Current 94/84/90 gate fails on day one and will be bypassed | `config/coverage-baseline.json`, `scripts/check-coverage.mjs` (add ratchet note) |
| P0-3 | `staticwebapp.config.json`: `X-Robots-Tag: noindex` on staging, security headers (CSP report-only, HSTS, X-Frame-Options, Referrer-Policy) everywhere; deploy asserts noindex present on staging / absent on prod | RP-005 still open; a public grader page is live | `apps/web/public/staticwebapp.config.json`, both deploy workflows |
| P0-4 | API: `helmet`, shared `express-rate-limit` with Mongo store (multi-instance safe), request validation helper (`zod`) applied to every new route in Lane B and to grader/intelligence POSTs | Only grader is limited, and only in memory | `apps/api/src/server.ts`, `apps/api/src/middleware/` |
| P0-5 | Run api/publisher/intelligence-worker/content-engine suites on Mac or CI; fix the 3 `asset-server-range` 404s and `Inputs.test.tsx` locale | ~960 tests unverified in this review | -- |
| P0-6 | Web bundle: route-level `React.lazy` for Intelligence, Grader, Studio | 1 MB single chunk | `apps/web/App.tsx` |

Exit criteria: green CI on a PR, coverage gate passes, staging returns `X-Robots-Tag`, all suites run at least once.

---

## 2. Lane A -- Content Engine & Restaurant Profile

### A1 - Image pipeline (IG-1...IG-7 from the Aug review -- none landed)

Target pipeline (replaces parallel caption||image):

```
input -> caption LLM (Haiku) picks dish FROM pool constrained by concept
      -> hard-check dish in menu (existing)
      -> art-director LLM (Haiku, structured):
            { subject, setting, props[], lighting, mood, occasionCue, negative[] }
      -> renderPrompt(brief) + <=300-char positive style tail        (no "AVOID" tokens)
      -> flux-dev { prompt, aspect_ratio, guidance~3.5, seed, image?, prompt_strength? }
      -> optional vision check (Haiku-vision, 1 retry on score < 3)
      -> assemble / validate (existing content-validator)
```

Order of PRs: (1) IG-4 + IG-5 (prompt cap + img2img params actually sent) -> (2) IG-1 + IG-2 (concept-aware dish choice) -> (3) IG-3 + IG-6 art-director -> (4) IG-7 seed persistence + vision check.
Each PR carries tests asserting prompt content (none exist today) and runs the 10-prompt fixture eval (`apps/content-engine/tests/fixtures/prompt-fidelity/`), scored by Haiku-vision; target >=4/5 after PR 3.

Files: `backends/ai/pipeline/generate-post.ts`, `media/replicate/replicate-media-generator.ts`, `specialization/restaurant/visual-direction.ts`, new `pipeline/art-director.ts`, `llm/schemas.ts`.

### A2 - Approval-queue UX (merchant side)

- Review card: **Regenerate image** (same seed = "same look", new seed = "different look"), **Edit caption** inline, **Schedule** picker, **Reject with reason** -> feeds `revise-post.ts`.
- Publish failures surface on the card with the classified reason (A4) and in the nudges feed.
- Bulk approve for a cycle.
- API: `POST /api/posts/:id/regenerate-media { keepSeed }`, `PATCH /api/posts/:id { caption, scheduledFor }` (verify existing), `POST /api/posts/:id/reject { reason }`.
- Store `seed`, `promptBrief` on the post's media record so regenerate is deterministic.

Files: `apps/web/components/ContentStudio.tsx` (split: `ReviewCard.tsx`, `ScheduleSheet.tsx`), `apps/api/src/routes/posts.ts`, `packages/shared` post types.

### A3 - Video / Reels

- `media-job-poller`: hard timeout per job (Kling > 20 min -> FAILED), exponential poll backoff, dead-letter after N attempts.
- `PENDING_MEDIA` posts older than timeout -> auto-fallback to IMAGE post with a notice, or FAILED with nudge (**DECISION A3-1:** fallback or fail?).
- `download-assets.mjs`: degrade when `ffmpeg` missing (skip video step, log) instead of failing the run.
- Cost: per-restaurant monthly video cap in `RestaurantOrderingSettings`-style config; refuse with a clear message beyond cap.

### A4 - Meta publishing reliability

- Classify Graph API errors into `retryable | permanent | reauth` in `publish-result.ts`; retry only retryable with backoff; `reauth` raises a nudge "Reconnect Instagram" and pauses the schedule.
- `token-refresh-cron`: verify it covers Page + IG tokens, alert on refresh failure 7 days before expiry.
- Dead-letter collection `publish_failures` + App Insights custom event; smoke test publishes to a sandbox IG account on staging deploy (**human:** Meta App Review out of dev mode, sandbox account).

### A5 - Restaurant profile, landing, grader funnel

- **Profile / Inputs:** email-verify UI honours backend `devEmail` bypass; form state persisted to `sessionStorage` on reload; fix `menuLastUpdated` test; migrate `restaurant.menu` reads to the canonical menu model (Section 3) behind an adapter so the content engine keeps working unchanged.
- **Landing (`Landing.tsx`):** grader as a top-level entry in header + hero CTA; `?view=grader` deep link; OG tags; noindex on staging only.
- **Grader hardening:** api tests (scan, unlock, rate limit), server-side gating of locked fields (today partly client blur), lead notification (email to Bhargav on `grader_leads` insert via publisher-pattern worker or App Insights alert), `track.*` events replace placeholders.

---

## 3. Shared seam -- ONE menu model

Today there are two menus and they will diverge the day Lane B lands:

| | Where | Used by |
|---|---|---|
| `restaurant.menu: MenuItem[]` (embedded) | `packages/shared/src/index.ts`, Inputs screen | content engine dish resolution, grader |
| `menu_categories` + `menu_items` (collections, variants/addons/availability) | Vercel line `packages/shared/src/ordering.ts` | storefront, orders, CSV import |

**Decision (proposed): `menu_items` is canonical.** `restaurant.menu` becomes a read-only projection maintained by a small `menu-projection.ts` service (recomputed on any `menu_items` write) so the content engine and grader need **no code change**. Inputs screen's menu editor is replaced by the imported `MenuManager` (Lane B6). One migration script in `db-cli` copies existing embedded menus into `menu_items` once.

This is the single ordering dependency Lane A has on Lane B; it lands in B1 week 1 so A5 can consume it.

---

## 4. Lane B -- Restaurant Sites, Ordering & Delivery

### B1 - Import ordering from the Vercel line (week 1)

Port, do not rewrite. Source `origin/feat/vercel-deploy` -> base `baxeltech-staging`:

| Import | Notes |
|---|---|
| `packages/shared/src/ordering.ts` | add `Shipment`, `DeliveryQuote`, `RestaurantDomain`, `Offer` types |
| `packages/db` indexes + seeds (`ordering-demo.ts`) | reuse `packages/secrets` for config |
| `apps/api/src/routes/storefront.ts`, `admin-ordering.ts`, `services/ordering/*` | rebase on Azure-line `server.ts`, `instrument.ts`, `helmet`, zod validation; reuse `services/razorpay.ts` |
| `apps/storefront` | rename to `apps/sites` (it becomes the per-restaurant website, not just a store) |
| `apps/web/components/ordering/*` | mount in the v1 shell as buckets Website - Menu - Orders - Delivery (flagged `VITE_ORDERING=true`) |
| `apps/db-cli/seed-ordering.ts` | keep `[SAMPLE]` marking |
| 5 ordering test suites | must stay green |

Not imported: `apps/superadmin` (separate decision), Vercel deploy config.

### B2 - Tenant resolution & custom domains (day one)

```
request -> Host header -> restaurant_domains{hostname -> restaurantId, status:'active'}
                      +-> fallback: /r/:slug  (always works; used for preview & QA)
```

Collection `restaurant_domains`: `{ hostname, restaurantId, status: 'pending_dns'|'verifying'|'active'|'failed', verifyToken, cnameTarget, sslStatus, createdAt, verifiedAt }`. Unique index on `hostname`.

Owner flow in admin: "Add your domain" -> we show `CNAME www -> sites.restropulse.in` + TXT verify record -> poll DNS -> on success call the SSL provider -> `active`. Every restaurant also always gets `<slug>.restropulse.in` (wildcard) as the default/preview URL.

**DECISION B2-1 -- SSL/edge provider for arbitrary customer domains.** See `docs/adr/0002-custom-domains-edge.md`. Recommendation: **Cloudflare for SaaS (Custom Hostnames)** in front of an Azure App Service running `apps/sites`. Azure SWA caps custom domains (2 free / 5 standard) so it cannot host N restaurants; Front Door works but is costlier and slower to automate.

### B3 - Sites host & SEO

`apps/sites` = the imported React storefront **served by a thin Express host** (not static SWA) so each response gets tenant-specific `<head>`:
- `<title>`, meta description, OG/Twitter tags, canonical
- JSON-LD `Restaurant` + `Menu` + `OpeningHoursSpecification`
- `/sitemap.xml`, `/robots.txt` per tenant
- Pre-rendered first paint of the hero + menu (string-rendered on server, hydrated on client) -- enough for Google and WhatsApp/IG link previews. Full SSR framework migration is **out of scope** (**DECISION B3-1:** confirm).

Deploy: new App Service `restropulse-sites` (+ staging slot), same slot-swap promotion as the API. Cache: menu/content responses `s-maxage=60` at Cloudflare, purged on publish.

### B4 - Delivery provider layer

New package `packages/delivery`:

```ts
interface DeliveryProvider {
  readonly id: 'mock' | 'self' | 'shadowfax' | 'rapido';
  quote(req: QuoteRequest): Promise<DeliveryQuote>;          // price, ETA, serviceable?
  createShipment(order: Order, quote: DeliveryQuote): Promise<Shipment>;
  cancelShipment(shipmentId: string, reason: string): Promise<void>;
  track(shipmentId: string): Promise<ShipmentStatus>;
  verifyWebhook(headers, rawBody): boolean;
  parseWebhook(body): ShipmentEvent[];                        // -> canonical statuses
}
```

Canonical shipment states: `QUOTED -> BOOKED -> RIDER_ASSIGNED -> PICKED_UP -> IN_TRANSIT -> DELIVERED | CANCELLED | FAILED(RTO)`. Mapping to order status: `PICKED_UP -> OUT_FOR_DELIVERY`, `DELIVERED -> COMPLETED`.

Dispatcher (`apps/api/src/services/delivery/dispatcher.ts`), triggered by order transition (**DECISION B4-1:** at `PREPARING` or at `READY`? Aggregators bill waiting time):
1. quotes from enabled providers (per-restaurant `deliverySettings.providers[]`, `strategy: 'cheapest'|'fastest'|'preferred'`)
2. `createShipment` on the winner; on failure try next provider; on all-fail -> `self` adapter + nudge "assign a rider"
3. persist `shipments` doc; order gets `shipmentId`

Reliability: outbox collection `delivery_jobs { type, payload, attempts, nextRunAt, status }` processed by a new worker `apps/dispatch-worker` (copy of the publisher pattern) -- the API never calls an aggregator inline. Webhooks at `POST /api/webhooks/delivery/:provider` with signature verify + idempotency (`provider+eventId` unique index) + raw-body parsing like the Razorpay webhook. Tracking page reads `shipments.events`.

Adapters: `mock` (deterministic timeline for tests/demo), `self` (merchant marks states manually), `shadowfax`, `rapido`. **Hard dependency:** Shadowfax + Rapido API docs, sandbox creds and webhook IP/secret info from Bhargav before the real adapters start; the interface, mock, self and dispatcher do not wait for them.

### B5 - Payments completion

- Reuse `services/razorpay.ts`; add `payment.captured` / `payment.failed` handling for storefront orders to the existing webhook route (today only `/payments/verify` confirms) so a closed browser tab still confirms the order.
- Refund on merchant cancel after capture (`refunds` via Razorpay API, idempotent on orderId).
- Delivery fee from the chosen quote added to `OrderTotals` server-side (**DECISION B5-1:** pass-through fee or restaurant-absorbed/flat?).

### B6 - CMS

Already exists after B1: menu CRUD + CSV import, content draft/publish/rollback (<=20 versions), hours, theme. Add: `offers` (title, discount rule, validity, banner image -> also feeds content engine as `activeOffers`), static pages, gallery. Admin buckets: Website (content + domain + theme), Menu, Orders, Delivery (providers, strategy, live shipments).

---

## 5. Data model additions (summary)

| Collection | New/Changed | Key fields |
|---|---|---|
| `menu_items`, `menu_categories` | imported, **canonical** | + `offerIds[]` |
| `restaurants` | changed | `menu` becomes projection; `deliverySettings`, `siteSettings` |
| `restaurant_domains` | new | hostname (unique), status, verifyToken, sslStatus |
| `shipments` | new | orderId, provider, externalId, status, events[], quote, cost |
| `delivery_jobs` | new | outbox; `nextRunAt` index |
| `webhook_events` | new | `provider+eventId` unique (delivery + razorpay share it) |
| `offers` | new | restaurantId, rule, validity |
| `publish_failures` | new (Lane A) | postId, classification, raw error |

---

## 6. Deployment & CI additions

- New Azure: App Service `restropulse-sites` (staging slot + prod), App Service/WebJob `dispatch-worker`, Key Vault secrets `shadowfax-*`, `rapido-*`, `cloudflare-*`; wildcard DNS `*.restropulse.in` -> Cloudflare; Cloudflare for SaaS fallback origin -> sites App Service.
- CI: `sites` and `dispatch-worker` jobs in `ci.yml` and both deploy workflows; smoke test hits `/r/demo` and one custom host via `Host:` header.
- Alerts (App Insights): publish failure rate, dispatch dead-letters, webhook signature failures, Replicate/Anthropic daily spend.

---

## 7. Milestones

| Wk | Lane A | Lane B |
|---|---|---|
| 0 | Phase 0 (shared) | Phase 0 (shared) |
| 1 | A1 PR1-2 (IG-4/5, IG-1/2) | B1 import + Section 3 menu canonicalisation + migration |
| 2 | A1 PR3 art-director + fixture eval | B2 tenant resolution, `/r/:slug`, `restaurant_domains`, admin "Add domain" |
| 3 | A2 approval-queue UX | B3 `apps/sites` host + SEO head + sitemap; Cloudflare for SaaS wiring |
| 4 | A4 Meta reliability + A3 video | B4 interface + mock + self + dispatcher + dispatch-worker + webhooks |
| 5 | A5 profile/landing/grader | B4 Shadowfax adapter (needs docs) - B5 payments completion |
| 6 | eval + hardening + docs | B4 Rapido adapter - B6 offers/CMS additions |
| 7 | -- staging soak, E2E happy path, production promotion -- | |

Review cadence: one PR per row cell, each with tests, `ASSUMPTION:` labels, and conventional-commit messages. Mongo-backed suites run on the Mac before merge.

---

## 8. Decisions needed from Bhargav before the relevant piece starts

| ID | Question | My recommendation |
|---|---|---|
| B2-1 | Edge/SSL provider for arbitrary custom domains | Cloudflare for SaaS (ADR) |
| B3-1 | Prerender head + hero only (no SSR framework) | Yes |
| B4-1 | Dispatch at `PREPARING` or `READY` | `READY` default, per-restaurant override |
| B4-2 | Provide Shadowfax + Rapido API docs, sandbox creds, webhook secrets | -- (hard dependency) |
| B5-1 | Delivery fee pass-through vs absorbed/flat | Pass-through from quote, merchant can set flat override |
| A3-1 | Video timeout -> fallback to image post or FAIL | Fallback with notice |
| Section 3 | `menu_items` canonical, `restaurant.menu` projected | Yes |
| -- | `apps/superadmin` import now or later | Later |
| -- | Target launch date | -- |

## 9. Human-only items (cannot be done by Claude)

Meta App Review + sandbox IG account - Razorpay live KYC + webhook secret - Cloudflare account + `restropulse.in` DNS - Azure resource creation + Key Vault secrets - Shadowfax/Rapido partner agreements and credentials - key rotation from Aug - go/no-go and rollback ownership.
