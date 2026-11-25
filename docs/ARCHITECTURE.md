# RestroPulse Architecture

## System Overview

RestroPulse is a social media management platform for restaurants, organized as a **Turborepo monorepo** with npm workspaces. It automates content creation, scheduling, and publishing to Instagram and Facebook via the Meta Graph API.

## Monorepo Structure

```
restropulse/
  apps/
    web/          @restropulse/web          React SPA (Vite)
    api/          @restropulse/api          Express REST API
    publisher/    @restropulse/publisher    Cron worker -- publishing + token refresh
    content-engine/ @restropulse/content-engine  Worker -- content generation
    db-cli/       @restropulse/db-cli       CLI for DB seed/migration
  packages/
    shared/       @restropulse/shared       Unified TypeScript types
    db/           @restropulse/db           Shared MongoDB connection + helpers
    publishing/   @restropulse/publishing   Meta API, encryption, publishing/token-refresh crons
    tsconfig/     @restropulse/tsconfig     Shared tsconfig presets
    eslint-config/ @restropulse/eslint-config Shared ESLint flat config
```

## Application Architecture Diagram

```
                              +-------------------+
                              |   Firebase Auth   |
                              |  (Phone OTP Auth) |
                              +--------+----------+
                                       |
                            ID Token   | Verify
                                       v
+--------------------+  REST API  +--------------------+
|   Frontend (Web)   |---------->|   Backend (API)     |
|   React + Vite     |<----------|   Express           |
|   Port 3000        |  JSON     |   Port 3001         |
+--------------------+           +---+-----+-------+---+
                                     |     |       |
                         Reads/Writes|     |       | Reads/Writes
                                     v     |       v
                              +------+-----+--+ +--+-------------+
                              |   MongoDB     | | Meta Graph API |
                              |   Atlas       | | v18.0          |
                              |   restropulse | | (Instagram/FB) |
                              +---+-----+-----+ +----------------+
                                  |     |
                   Reads/Writes   |     |  Reads/Writes
                    +-------------+     +-------------+
                    |                                  |
          +---------v----------+          +------------v---------+
          | Publisher Worker   |          | Content Engine Worker |
          | Cron: Publish posts|          | Cron: Generate content|
          | Cron: Refresh tokens|         | Process strategy cycles|
          +--------------------+          +------------------------+
```

## Applications

### apps/web -- Frontend SPA

- **Framework**: React 19 + TypeScript + Vite 6
- **Styling**: Tailwind CSS (CDN)
- **Auth**: Firebase Authentication (phone OTP)
- **Port**: 3000

**Pages** (state-based routing via `ViewState`):

| View         | Component          | Purpose                         |
|--------------|--------------------|---------------------------------|
| LOGIN        | Login.tsx          | Phone OTP authentication        |
| ONBOARDING   | Onboarding.tsx     | New user registration (multi-step) |
| DASHBOARD    | Dashboard.tsx      | Restaurant overview              |
| STUDIO       | ContentStudio.tsx  | Content calendar, post management|
| INPUTS       | Inputs.tsx         | Offers, chef specials, menu      |
| STRATEGY     | Strategy.tsx       | Content strategy configuration   |

**Overlay components** (not ViewState-routed):

| Component          | Purpose                                              |
|--------------------|------------------------------------------------------|
| ProfileSheet.tsx   | Account settings bottom sheet (subscription, billing, Instagram, profile, logout) |
| AdhocPostModal.tsx | Create new post modal (triggered from header or empty state) |

**Auth Flow**:
1. User enters phone number; Firebase sends OTP via RecaptchaVerifier
2. User submits OTP; Firebase confirms; frontend obtains Firebase ID token
3. Frontend sends ID token to `POST /api/auth/firebase`
4. Backend verifies via Firebase Admin SDK, returns JWT pair
5. Frontend stores `rp_token` (15min) and `rp_refresh_token` (7d) in localStorage
6. If user has no `restaurantId`, frontend routes to ONBOARDING view

**Onboarding Flow** (new users only):
1. User completes 4-step form: user details, restaurant details, location (Google Maps), account manager selection
2. Frontend sends `POST /api/restaurant` with collected data
3. Backend creates restaurant, links to user, issues fresh JWT tokens with new restaurantId
4. Frontend stores new tokens and navigates to DASHBOARD

**React Effect Patterns** (follow these for all new async `useEffect` code):

*Pattern A — One-shot non-idempotent effect (single-use token consumption):*
Email verification and Instagram OAuth processing consume single-use tokens. These must
not be triggered on page load — email security scanners auto-follow links and would
consume the token before the human clicks. Use a confirmation button; only consume
on user interaction. Guard with a module-level variable (not `useRef`) so the guard
survives React StrictMode's unmount/remount cycle in development.
```ts
let operationAttempted = false;  // module-level, outside component

const handleConfirm = () => {
    if (operationAttempted) return;
    operationAttempted = true;
    // call API that consumes a single-use token
};
```

*Pattern B — Async data fetch with stale-request guard:*
```ts
useEffect(() => {
    let isActive = true;
    fetchData().then(result => {
        if (!isActive) return;
        setState(result);
    });
    return () => { isActive = false; };
}, [dep]);
```

*Pattern C — Event listeners and timers:* Always return a cleanup function. This is
already done correctly throughout the codebase.

**Navigation & History Contract**

The app uses state-based routing (`currentView: ViewState` in `apps/web/App.tsx`), synced to the URL query `?view=<view>`. It does not use react-router. Browser history entries carry a single discriminated `history.state` shape so multiple `popstate` listeners never conflict: `{ level: 'view', view }` for top-level view navigation (pushed by `App.navigateTo`; app's `popstate` handler acts only on these), and `{ level: 'modal', id }` for modals/bottom-sheets with a matching `#<id>` URL hash (pushed by `useHistoryModal` hook; app's `popstate` handler intentionally ignores these, so dismissing via Back button never changes the underlying view). On load/refresh, the top-level view is restored from the `?view=` query (see `readViewFromUrl` in App.tsx). Modals/bottom-sheets must use the `useHistoryModal(id, isOpen, onClose)` hook (`apps/web/hooks/useHistoryModal.ts`) instead of hand-rolled `pushState`/`popstate`; opening a modal sets its open-state true, closing sets it false, and the hook manages the history entry both ways. This model is identical on mobile-web and desktop — only the Layout chrome (bottom nav vs sidebar) differs by viewport via `lg:` breakpoints; the routing/history layer does not branch on platform.

### apps/api -- REST API

- **Framework**: Express 4 + TypeScript
- **Database**: MongoDB (via `@restropulse/db`)
- **Auth**: Firebase Admin SDK + JWT (access/refresh tokens)
- **Port**: 3001

**Route Groups**:

| Prefix                           | Purpose                            |
|----------------------------------|------------------------------------|
| `/api/auth/*`                    | Authentication (Firebase, JWT)     |
| `POST /api/restaurant`           | Create restaurant (onboarding)     |
| `GET /api/restaurant/account-managers` | Account managers by city/zone |
| `/api/restaurant/:id`           | Restaurant CRUD, offers, specials  |
| `/api/posts/*`                   | Post CRUD, publishing, generation  |
| `/api/strategy/*`               | Content strategy and cycles        |
| `/api/integrations/instagram/*` | OAuth, account management, GDPR    |
| `/api/subscriptions/*`          | Plans, current plan, plan requests (subscribe, change-plan, withdraw-request), cancel, reactivate |
| `/api/platform-admin/billing/*` | Plan requests, plan activation, credit grants (ADMIN) |
| `/api/coupons/*`                | Coupon CRUD, validation (admin)    |
| `/api/credit-packs/*`           | Credit pack CRUD (admin)           |
| `/api/invoices/*`               | Invoice listing and detail (read only) |
| `/health`                        | Health check                       |

### apps/publisher -- Publishing Worker

- **Runtime**: Standalone Node.js process (no Express)
- **Cron Jobs**:
  - Publishing: `*/5 * * * *` (every 5 minutes) -- publishes due SCHEDULED posts
  - Token refresh: `0 2 * * *` (daily 2:00 AM IST) -- refreshes expiring Instagram tokens

### apps/content-engine -- Content Generation Worker

- **Runtime**: Standalone Node.js process (no Express)
- **Polling**: `*/2 * * * *` (every 2 minutes)
- **Jobs**:
  - Adhoc post processing: generates content for posts with status `PENDING_CONTENT`
  - Strategy cycle processing: generates posts for `APPROVED` cycles
  - Strategy generation: creates strategies for `PENDING_GENERATION` requests

### Content Engine AI backend

When `CONTENT_GENERATOR_BACKEND=ai`, the content-engine swaps the placeholder generator for `AIContentGenerator` -- a thin orchestrator over four pluggable seams. Default chain:

```text
IContentGenerator               (existing public contract)
  AIContentGenerator            (Vercel AI SDK orchestrator)
    ILLMProvider                  AnthropicLLMProvider (Sonnet for cycles, Haiku for posts)
    IMediaGenerator               PlaceholderMediaGenerator (default) | ReplicateMediaGenerator (when MEDIA_BACKEND=replicate)
    ICurrentAffairsProvider       Noop | CalendarOnly (V1) | SonarAugmented(CalendarOnly) (V1+V2)
    IDomainSpecialization         RestaurantSpecialization
```

Each seam is a separately swappable interface. Adding a second domain (salon, fitness) is an `IDomainSpecialization` impl. Adding a new LLM provider is a one-import swap inside `AnthropicLLMProvider`. Adding a new media provider (Runway, etc.) is an `IMediaGenerator` impl.

#### Async media flow (REEL/VIDEO with `MEDIA_BACKEND=replicate`)

```text
adhoc-processor finds PENDING_CONTENT post
  -> AIContentGenerator.generatePost
    -> caption (Anthropic, sync)
    -> media (ReplicateMediaGenerator.generateVideo)
      -> queue submit -> mediaJobs row inserted (status=RUNNING)
      -> returns immediately
  -> processor writes post.status=PENDING_MEDIA + mediaJobId

media-job-poller (every 30s)
  -> finds PENDING_MEDIA posts
  -> per post: live-poll Replicate prediction status, transition COMPLETED -> applyMediaJobResultToPost (status=PENDING_APPROVAL)
                                            FAILED   -> markPostFailedWithMedia (status=MISSED_DEADLINE)
                                            stale > 10min -> reap as FAILED

post-resume scan (worker boot, when MEDIA_BACKEND=replicate)
  -> finds posts with PENDING_MEDIA + lastStepAt > 5min ago
  -> triggers one poll cycle each (idempotent, matches cron path)
```

#### Cost attribution

Every external API call writes one row to `costEvents` (MongoDB) AND emits a `customEvents` row to Application Insights (via `trackAIUsage`), tagged with `restaurantId`, `postId`, `cycleId`, `surface`, `step`, `model`. The two Azure Monitor Workbooks under `infra/workbooks/` consume the App Insights events.

For full rationale (decision drivers, framework selection, RAG strategy, retry profiles, durability semantics), see [ADR 0001 - Content-Engine AI Framework](adr/0001-content-engine-ai-framework.md).

## Secrets Management

**Deployed mechanism (staging + production):** Azure App Service Key Vault
References. Each App Service setting is configured as
`@Microsoft.KeyVault(VaultName=restropulse-prod-kv;SecretName=...)`; the
slot's system-assigned managed identity resolves the reference into a plain
`process.env` value at startup. Application code never talks to Key Vault
directly, and `loadAndValidateEnv(...)` runs unchanged -- it just reads
`process.env` as always. `SECRETS_BACKEND` stays `env` (the default) on
running slots.

**`packages/secrets` (`@restropulse/secrets`) is a manifest-driven fetch
utility**, not the app-boot mechanism. It is used only by:
- `npm run secrets:pull` (`scripts/secrets-pull.mjs`) -- hydrates `dev-*`
  secrets from the shared vault into each app's local `.env` for local
  development (opt-in; `.env` is the local default)
- The web `config.json` generator run by the deploy workflows -- fetches
  `{env}-web-*` / `{env}-firebase-*` secrets and writes a same-origin
  `config.json` sidecar for the zero-secret web bundle

```
ISecretsProvider
  EnvSecretsProvider            (default -- reads process.env)
  AzureKeyVaultSecretsProvider  (Azure Key Vault via DefaultAzureCredential)
    wrapped by CachedSecretsProvider (in-memory cache, avoids repeated KV API calls)
```

`AzureKeyVaultSecretsProvider` + `SECRETS_BACKEND=azure-kv` (in-app
hydrate-on-boot via `createSecretsProvider('azure-kv')` +
`hydrateEnvFromProvider(...)`) exists as a capability in the codebase but is
not set on the deployed slots -- do not describe it as the production
mechanism.

**Naming convention:** single shared vault (`restropulse-prod-kv`); secret
names use the canonical `{env}-{kebab}` scheme (lowercase, env in `dev`,
`staging`, `prod`), e.g. `prod-mongodb-uri`, `dev-jwt-secret`.

**Per-service scoping:** `packages/secrets/src/manifest.ts`
(`SECRETS_MANIFEST`) is the single source of truth. Each secret declares
`apps[]`. `getAppSecretKeys(app)` returns only that app's keys -- no service
fetches a secret it does not own.

### apps/db-cli -- Database CLI

- **Framework**: Commander + chalk + ora
- **Purpose**: Seed data, run migrations, database operations

## Shared Packages

### packages/shared

Single source of truth for all TypeScript types, enums, and interfaces used across the monorepo. Key exports: `User`, `Restaurant`, `Post`, `ContentStrategy`, `StrategyCycle`, `AccountManager`, `SubscriptionPlan`, `Subscription`, `Coupon`, `Invoice`, `CreditPack`, and all status/type enums. Also exports the `POST_TYPE_CREDIT_COSTS` constant and the `EntitlementState` type (trial/subscription feature-access snapshot).

### packages/db

Shared MongoDB connection layer with collection helpers:

| Module                  | Exports                                     |
|-------------------------|---------------------------------------------|
| connection.ts           | `connectDB()`, `disconnectDB()`, `getDB()`, `setDB()`, collection getters |
| posts.ts                | `findPostById()`, `findAllPosts()`, `createPost()`, `updatePost()` |
| restaurants.ts          | `findRestaurantById()`, `createRestaurant()`, `updateRestaurant()` |
| strategy.ts             | `getContentStrategiesCollection()`, `getStrategyCyclesCollection()` |
| users.ts                | `findUserByPhone()`, `findUserByFirebaseUid()` |
| account-managers.ts     | `getAccountManagersByCity()`, `getAccountManagersByCityAndZone()` |
| subscription-plans.ts   | `findCurrentPlans()`, `findPlanBySlug()`, `findPlanById()`, `createPlan()`, `versionPlan()` |
| subscriptions.ts        | `findActiveSubscription()`, `findSubscriptionsWithPendingPlan()`, `createSubscription()`, `updateSubscription()`, `deductCredits()`, `addCredits()` |
| coupons.ts              | `findCouponByCode()`, `createCoupon()`, `updateCoupon()`, `createCouponRedemption()` |
| credit-packs.ts         | `findActiveCreditPacks()`, `findCreditPackById()`, `createCreditPack()`, `updateCreditPack()` |
| invoices.ts             | `createInvoice()`, `findInvoicesByRestaurant()`, `findInvoiceById()`, `updateInvoice()` |

`setDB()` enables test injection with `mongodb-memory-server`.

### packages/publishing

Shared publishing layer used by both `apps/api` and `apps/publisher`. Key exports:

| Module                | Exports                                                              |
|-----------------------|----------------------------------------------------------------------|
| encryption.ts         | `encrypt()`, `decrypt()`, `generateEncryptionKey()`                 |
| instagram-api.ts      | `generateOAuthUrl()`, `handleOAuthCallback()`, `refreshAccessToken()`, `validateToken()`, `getInstagramProfile()`, `isInstagramConfigured()`, `prepareCredentialsForStorage()`, `validateStateToken()` |
| publishing-service.ts | `publishPost()`                                                      |
| publishing-cron.ts    | `startPublishingCron()`, `triggerManualPublish()`, `getRecentPublishAttempts()`, `runPublishingJob()` |
| token-refresh-cron.ts | `startTokenRefreshCron()`, `triggerManualRefresh()`, `checkAndRefreshTokenIfNeeded()`, `getRecentRefreshAttempts()` |

## Data Flows

### Post Publishing Flow

```
1. User creates/approves post (API) --> status: SCHEDULED
2. Publisher cron runs every 5 min
3. Finds posts where scheduledFor <= now AND status = SCHEDULED
4. Atomically sets status = PUBLISHING
5. Decrypts Instagram token (AES-256-CBC)
6. Uploads media to Facebook CDN (image: /photos, video: direct URL)
7. Creates IG media container via Meta Graph API
8. For video: polls container status every 5s (max 5 min)
9. Publishes container via /media_publish
10. Updates post status: PUBLISHED or FAILED (max 3 attempts)
```

### Meta Graph API OAuth Flow

```
1. Frontend redirects to Facebook OAuth dialog
2. User authorizes RestroPulse app
3. Facebook redirects to /api/integrations/instagram/callback with code
4. Backend exchanges code for short-lived token
5. Exchanges short-lived for long-lived token (60 days)
6. Discovers Facebook Pages via /me/accounts
7. Finds IG Business Account per page
8. Stores encrypted page access token in restaurant document
9. Token refresh cron renews tokens 15 days before expiry
```

### Content Generation Flow

```
1. User requests content (API /posts/generate or approves strategy cycle)
2. Post/cycle stored with status PENDING_CONTENT or APPROVED
3. Content engine polls every 2 min
4. Finds pending work, generates content (placeholder; future: AI)
5. Updates post with caption, thumbnail, media URLs
6. Advances status to PENDING_APPROVAL
7. User reviews and approves --> status: SCHEDULED
```

### Subscription & Billing Flow

Billing is manual: there is no payment gateway. The owner requests a plan in the app,
payment is arranged directly with RestroPulse outside the app, and a platform admin
(role `ADMIN`) switches the plan on.

#### Subscription document lifecycle

Every restaurant has exactly **one** subscription document in MongoDB. The collection
enforces a unique index on `restaurantId`. The document is created during onboarding and
transitions through the following statuses:

```
Onboarding (POST /api/restaurant)
    |
    v
 NONE  <-- no active plan; onboarding grants a no-card free trial (trialEndsAt = now + settings.trialDays)
    |
    | POST /api/subscriptions/subscribe  (owner request: pendingPlanSnapshot + planRequestedAt, optional coupon)
    |   - POST /api/subscriptions/withdraw-request drops the request
    |
    | POST /api/platform-admin/billing/restaurants/:restaurantId/activate  (admin, 1-36 months)
    v
 ACTIVE  <-- plan switched on for currentPeriodStart..currentPeriodEnd
    |
    +---> cancelAtPeriodEnd=true  <-- POST /api/subscriptions/cancel; undone by POST /reactivate
    |
    +---> period over             <-- entitlement ends MANUAL_BILLING_GRACE_DAYS (3) after
    |                                 currentPeriodEnd unless an admin renews; the owner can request again
    |
    +---> CANCELLED               <-- cancel with no paid period set
```

Because only one document exists per restaurant, plan requests and activations always
**update** the existing document (via `updateSubscription`). `CREATED`, `AUTHENTICATED`,
`PAST_DUE` and `HALTED` remain in the `SubscriptionStatus` type for older documents but
nothing sets them now.

#### Requesting and activating a plan

```
1. Onboarding creates subscription document: status=NONE, credits=0, trialEndsAt=now+settings.trialDays (no-card free trial granting full feature access)
2. Owner picks a plan on the frontend
3. POST /api/subscriptions/subscribe { planSlug, couponCode? }
   a. Validates the plan slug and the coupon (if provided)
   b. Rejects with 409 if a live paid plan exists (use change-plan instead)
   c. Stores the request: pendingPlanId, pendingPlanSnapshot, planRequestedAt, couponCode
   (an owner on a plan uses POST /api/subscriptions/change-plan { planSlug } instead; coupons do not carry over)
4. RestroPulse arranges payment with the restaurant directly
5. Admin: GET /api/platform-admin/billing/requests lists waiting requests, oldest first
6. Admin: POST /api/platform-admin/billing/restaurants/:restaurantId/activate { planSlug?, months? }
   a. Uses planSlug, else the requested plan, else the current plan (renewal)
   b. Renewing the same plan before its period ends extends from currentPeriodEnd; otherwise starts now
   c. Sets status=ACTIVE, the new period, clears the request and cancelAtPeriodEnd
   d. Applies and records the owner's coupon only if it was for this plan and is still valid
```

Entitlement (`getEntitlement` in `@restropulse/shared`) treats an ACTIVE plan as live
until `currentPeriodEnd` plus `MANUAL_BILLING_GRACE_DAYS`, or while the free trial runs.

#### Credit system

```
6. Post creation checks plan limits via enforcePlanLimits middleware
7. If over weekly limit: deducts from unified credit balance (IMAGE=1, CAROUSEL=3, REEL=5)
8. Credits are added by a platform admin: POST /api/platform-admin/billing/restaurants/:restaurantId/credits { credits }
   (credit packs are a price list only; there is no in-app purchase)
```

### Storefront orders

Orders placed on a restaurant's website are cash only: cash on delivery, pay at the
counter for pickup, pay at the table for dine-in. A placed order goes straight to
`RECEIVED`; there is no online payment, refund or payment webhook.

## Security

- **Token encryption**: AES-256-CBC with per-operation random IV; stored as `iv:ciphertext` in MongoDB
- **JWT**: Access tokens (15min), refresh tokens (7 days), signed with `JWT_SECRET`
- **OAuth CSRF**: Random state tokens with 10-minute expiry
- **Facebook Webhooks**: HMAC-SHA256 signed request verification using App Secret
- **Delivery webhooks**: `/api/webhooks/delivery/:provider`, raw body with per-provider signature verification
- **CORS**: Restricted to configured `FRONTEND_URL` + API origin
- **Role-based access**: ADMIN role required for coupon/credit-pack management and platform billing (`/api/platform-admin/billing`)

## MongoDB Collections

| Collection          | Primary Key Pattern          | Used By              |
|---------------------|------------------------------|----------------------|
| users               | ObjectId or custom string    | API                  |
| restaurants         | ObjectId or custom string    | API, Publisher, Engine|
| posts               | ObjectId or custom string    | API, Publisher, Engine|
| contentStrategies   | ObjectId                     | API, Engine          |
| strategyCycles      | ObjectId                     | API, Engine          |
| accountManagers     | ObjectId                     | API                  |
| subscriptionPlans   | ObjectId                     | API                  |
| subscriptions       | ObjectId                     | API                  |
| coupons             | ObjectId                     | API                  |
| couponRedemptions   | ObjectId                     | API                  |
| creditPurchases     | ObjectId                     | API                  |
| creditPacks         | ObjectId                     | API                  |
| invoices            | ObjectId                     | API                  |

Database name: `restropulse` (configurable via `MONGODB_DB_NAME`)

## MCP Context Stack

The workspace uses three MCP servers as a non-redundant context stack:

- **codebase-rag** -- Semantic search over source and docs (discovery layer)
- **mcp-language-server** -- Type-aware navigation via TSServer, one instance per app/package (logic layer)
- **server-memory** -- Persistent knowledge graph for decisions and conventions (knowledge layer)

See `docs/MCP-SETUP.md` for full configuration, tool-routing rules, and troubleshooting.
