# RestroPulse Infrastructure
<!-- ci-check -->

## Services and Ports

Source of truth for local service ports: `config/ports.json`.

```json
{
   "web": 3000,
   "api": 3001,
   "publisher": 3002,
   "strictInDevelopment": true
}
```

Rules:
- `apps/web` uses `config/ports.json:web` in `vite.config.ts` with `strictPort: true`.
- `apps/api` uses `config/ports.json:api` as default and enforces the same port in development when `strictInDevelopment` is `true`.
- Root port scripts (`ports:check`, `ports:free`) read ports from `config/ports.json` unless explicit CLI ports are provided.

| Service         | Port   | Protocol | Description              |
|-----------------|--------|----------|--------------------------|
| Frontend (web)  | 3000   | HTTP     | Vite dev server          |
| Backend (api)   | 3001   | HTTP     | Express REST API         |
| Publisher        | --     | N/A      | Standalone cron worker   |
| Content Engine   | --     | N/A      | Standalone poll worker   |
| MongoDB Atlas    | 27017  | TCP      | Cloud-hosted database    |
| Firebase Auth    | --     | HTTPS    | Google Identity Platform |
| Meta Graph API   | --     | HTTPS    | v18.0 Instagram/Facebook |

## Environment Variables

### apps/api (.env)

| Variable                         | Required | Default                                          | Purpose                                    |
|----------------------------------|----------|--------------------------------------------------|--------------------------------------------|
| PORT                             | No       | 3001                                             | API server port                            |
| CORS_ORIGIN                      | No       | http://localhost:3000                             | Allowed CORS origin                        |
| NODE_ENV                         | No       | development                                      | Environment mode                           |
| MONGODB_URI                      | Yes      | --                                               | MongoDB Atlas connection string            |
| MONGODB_DB_NAME                  | No       | restropulse                                      | Database name                              |
| JWT_SECRET                       | Yes*     | restropulse-dev-secret-change-in-production      | JWT signing secret                         |
| ENCRYPTION_KEY                   | Yes      | --                                               | 32-byte hex key for AES-256-CBC            |
| INSTAGRAM_APP_ID                 | Yes      | --                                               | Facebook/Meta App ID                       |
| INSTAGRAM_APP_SECRET             | Yes      | --                                               | Facebook/Meta App Secret                   |
| INSTAGRAM_REDIRECT_URI           | No       | http://localhost:3001/api/.../callback            | OAuth redirect URI                         |
| INSTAGRAM_REDIRECT_FRONTEND_URL  | No       | http://localhost:3000                             | Frontend URL for OAuth redirects           |
| BACKEND_URL                      | No       | http://localhost:3001                             | Backend URL for GDPR status links          |
| FIREBASE_SERVICE_ACCOUNT         | Cond.    | --                                               | Firebase service account JSON              |
| FIREBASE_SERVICE_ACCOUNT_PATH    | Cond.    | --                                               | Path to Firebase service account file      |
| FIREBASE_PROJECT_ID              | Cond.    | --                                               | Firebase project ID (limited)              |
| RAZORPAY_KEY_ID                  | No*      | --                                               | Razorpay API key ID                        |
| RAZORPAY_KEY_SECRET              | No*      | --                                               | Razorpay API key secret                    |
| RAZORPAY_WEBHOOK_SECRET          | No*      | --                                               | Razorpay webhook signature secret          |
| FEATURE_TOPUP_CREDITS            | No       | false                                            | Feature flag: enable credit pack topup purchase UI         |
| FEATURE_UPDATES_SECTION          | No       | false                                            | Feature flag: enable Updates (Inputs) section in nav       |
| SECRETS_BACKEND                  | No       | `env`                                            | `env` (process.env) or `azure-kv` (Azure Key Vault)    |
| AZURE_KEY_VAULT_URL              | Cond.    | --                                               | Full Key Vault URL, e.g. `https://restropulse-prod-kv.vault.azure.net`. Required when `SECRETS_BACKEND=azure-kv` |
| AZURE_KEY_VAULT_KEY_PREFIX       | No       | (none)                                           | Optional prefix prepended to all KV secret names (e.g. `dev`, `staging`) |

*JWT_SECRET has a dev default but must be changed in production.
*RAZORPAY_* vars are optional in dev; service throws if called without config.

### Telemetry (all Node.js apps)

| Variable                               | Required | Default       | Purpose                                       |
|----------------------------------------|----------|---------------|-----------------------------------------------|
| APPLICATIONINSIGHTS_CONNECTION_STRING  | No       | (none)        | Azure Monitor connection. Telemetry disabled if absent. |
| LOG_LEVEL                              | No       | info          | pino log level (debug, info, warn, error)     |
| OTEL_TRACES_SAMPLER_ARG               | No       | 1.0 (dev)     | Trace sampling ratio (0.1 recommended for prod) |

### apps/web (.env)

| Variable                         | Required | Default                    | Purpose                     |
|----------------------------------|----------|----------------------------|-----------------------------|
| VITE_API_URL                     | Yes*     | (none)                     | Backend API base URL        |
| VITE_APP_URL                     | Yes*     | (none)                     | Frontend public URL; baked into Firebase email verification continueUrl at build time |
| VITE_FIREBASE_API_KEY            | Yes*     | dev placeholder            | Firebase Web API key        |
| VITE_FIREBASE_AUTH_DOMAIN        | Yes*     | dev placeholder            | Firebase auth domain        |
| VITE_FIREBASE_PROJECT_ID         | Yes*     | dev placeholder            | Firebase project ID         |
| VITE_FIREBASE_STORAGE_BUCKET     | Yes*     | placeholder                | Firebase storage bucket     |
| VITE_FIREBASE_MESSAGING_SENDER_ID| Yes*    | placeholder                | Firebase messaging sender ID|
| VITE_FIREBASE_APP_ID             | Yes*     | placeholder                | Firebase app ID             |
| VITE_GOOGLE_MAPS_API_KEY         | No       | (none)                     | Google Maps Places API key  |
| VITE_RAZORPAY_KEY_ID             | No       | (none)                     | Razorpay key for checkout   |
| VITE_APPINSIGHTS_CONNECTION_STRING | No     | (none)                     | App Insights browser SDK    |
| VITE_TELEMETRY_SAMPLE_RATE      | No       | 100                        | Trace sampling % (1-100)    |

*Required for all environments; dev value supplied via .env file, CI value supplied via workflow env block.
**VITE_FIREBASE_* vars are required for production; dev uses fallback values.
**VITE_GOOGLE_MAPS_API_KEY is optional; when absent, the onboarding location step falls back to manual address entry.
**VITE_RAZORPAY_KEY_ID is fetched from the API at checkout time if not set.

### apps/publisher (.env)

| Variable         | Required | Default       | Purpose                          |
|------------------|----------|---------------|----------------------------------|
| NODE_ENV         | No       | development   | Environment mode                 |
| MONGODB_URI      | Yes      | --            | MongoDB connection string        |
| MONGODB_DB_NAME  | No       | restropulse   | Database name                    |
| ENCRYPTION_KEY   | Yes      | --            | Must match API's key             |
| INSTAGRAM_APP_ID | Yes      | --            | For token refresh                |
| INSTAGRAM_APP_SECRET | Yes  | --            | For token refresh                |
| SECRETS_BACKEND      | No   | `env`          | `env` (process.env) or `azure-kv` (Azure Key Vault) |
| AZURE_KEY_VAULT_URL  | Cond.| --            | Full Key Vault URL. Required when `SECRETS_BACKEND=azure-kv` |
| AZURE_KEY_VAULT_KEY_PREFIX | No | (none)      | Optional prefix for KV secret names (e.g. `dev`, `staging`) |

### apps/content-engine (.env)

| Variable         | Required | Default       | Purpose                          |
|------------------|----------|---------------|----------------------------------|
| NODE_ENV         | No       | development   | Environment mode                 |
| MONGODB_URI      | Yes      | --            | MongoDB connection string        |
| MONGODB_DB_NAME  | No       | restropulse   | Database name                    |
| SECRETS_BACKEND  | No       | `env`          | `env` (process.env) or `azure-kv` (Azure Key Vault) |
| AZURE_KEY_VAULT_URL | Cond. | --            | Full Key Vault URL. Required when `SECRETS_BACKEND=azure-kv` |
| AZURE_KEY_VAULT_KEY_PREFIX | No | (none)      | Optional prefix for KV secret names (e.g. `dev`, `staging`) |

#### Content Engine AI backend (env additions)

Default behavior unchanged unless `CONTENT_GENERATOR_BACKEND=ai` is set. The flag is an "uber" master switch: when set, every AI sub-feature defaults on. All four required keys (`ANTHROPIC_API_KEY`, `FAL_API_KEY`, `GOOGLE_CALENDAR_API_KEY`, `PERPLEXITY_API_KEY`) must be present or the factory throws a single combined error listing every missing key. See `docs/CONTENT_ENGINE_AI_ROLLOUT.md` for the supported rollout path and `docs/SECRETS.md` for how to obtain each key.

| Variable                          | Required when                                          | Default (no AI)  | Default (AI mode) | Purpose                                                                       |
|-----------------------------------|--------------------------------------------------------|------------------|-------------------|-------------------------------------------------------------------------------|
| `CONTENT_GENERATOR_BACKEND`       | always                                                 | `placeholder`    | n/a               | Master switch: `placeholder` (asset catalog) or `ai` (full AI chain).         |
| `ANTHROPIC_API_KEY`               | `CONTENT_GENERATOR_BACKEND=ai`                         | --               | required          | Anthropic API key for Sonnet 4.6 / Haiku 4.5 via `@ai-sdk/anthropic`.         |
| `FAL_API_KEY`                     | AI mode + `MEDIA_BACKEND` not overridden               | --               | required          | fal.ai API key for image (sync) and video (queue API) generation.             |
| `GOOGLE_CALENDAR_API_KEY`         | AI mode + V1 not overridden                            | --               | required          | Google Calendar API key for India public holidays calendar (V1).              |
| `PERPLEXITY_API_KEY`              | AI mode + V2 not overridden                            | --               | required          | Perplexity Sonar Pro API key (V2 daily refresh + per-post triggers).          |
| `MEDIA_BACKEND`                   | optional override                                      | `placeholder`    | `fal-ai`          | Override: set to `placeholder` to skip fal.ai under AI mode.                  |
| `CURRENT_AFFAIRS_V1_ENABLED`      | optional override                                      | `true` (unused)  | `true`            | Override: set to `false` to skip Google Calendar under AI mode.               |
| `CURRENT_AFFAIRS_V2_ENABLED`      | optional override                                      | `false` (unused) | `true`            | Override: set to `false` to skip Sonar Pro under AI mode.                     |
| `CRON_CURRENT_AFFAIRS_REFRESH`    | when V1 or V2 enabled                                  | `0 6 * * *`      | `0 6 * * *`       | Daily refresh at 06:00 IST.                                                   |
| `CRON_MEDIA_JOB_POLLER`           | `MEDIA_BACKEND=fal-ai`                                 | `*/30 * * * * *` | `*/30 * * * * *`  | Every 30 seconds; polls in-flight video jobs against fal queue API.           |

Optional provider-portability keys (no behavior change unless code is changed to switch providers): `OPENAI_API_KEY`, `GOOGLE_API_KEY` -- declared in factory but unused in default chain.

##### Cron schedules added by AI backend

| Schedule                          | Default        | Timezone     | Purpose                                                          |
|-----------------------------------|----------------|--------------|------------------------------------------------------------------|
| `CRON_CURRENT_AFFAIRS_REFRESH`    | `0 6 * * *`    | Asia/Kolkata | Refresh calendar holidays + (if V2) daily Sonar platform answer. |
| `CRON_MEDIA_JOB_POLLER`           | `*/30 * * * * *` | Asia/Kolkata | Poll RUNNING video media jobs against fal.ai queue.              |

##### Collections added by AI backend

| Collection              | Purpose                                                                                                        |
|-------------------------|----------------------------------------------------------------------------------------------------------------|
| `costEvents`            | One row per AI/external API call (LLM, image, video, Sonar, calendar). Powers per-restaurant cost dashboards.  |
| `currentAffairsCache`   | 24h-TTL cache of calendar holidays and daily Sonar platform refresh.                                           |
| `mediaJobs`             | One row per media generation job. Image jobs land COMPLETED immediately; video jobs cycle PENDING -> RUNNING -> COMPLETED/FAILED via the poller. |

##### Cost expectations (per active restaurant per month)

Estimates for 30 posts/month with V1 calendar enabled and V2 Sonar disabled:

| Component       | Cost                  | Notes                                                                  |
|-----------------|-----------------------|------------------------------------------------------------------------|
| LLM (captions)  | ~\$0.10-0.30          | Haiku 4.5 per post; Sonnet for cycle planning is amortized across posts. |
| LLM (cycle)     | ~\$0.05-0.10          | Sonnet, ~1-2 calls per cycle.                                          |
| Calendar (V1)   | \$0                   | Free; daily refresh shared across all restaurants.                     |
| Image (fal.ai)  | ~\$0.75               | 30 IMAGE/STORY posts at \$0.025/call.                                  |
| Image carousel  | additional ~\$0.05/CAROUSEL | 3x per CAROUSEL post.                                            |
| Video (fal.ai)  | ~\$0.30 per REEL      | Default: Kling 1.6 standard. MiniMax is \$0.40/clip.                   |

When `CURRENT_AFFAIRS_V2_ENABLED=true`:

| Component         | Cost                       | Notes                                                                |
|-------------------|----------------------------|----------------------------------------------------------------------|
| Sonar daily refresh | ~\$0.10/day platform-wide | One call per day, shared across all restaurants.                     |
| Sonar per-post triggers | ~\$0.30-0.90/restaurant/month | Fires only when post concept matches an allowlist keyword (~20% rate). |

## Cron Schedules

| Worker          | Schedule          | Timezone      | Description                       |
|-----------------|-------------------|---------------|-----------------------------------|
| Publisher       | */5 * * * *       | Asia/Kolkata  | Publish due scheduled posts       |
| Token Refresh   | 0 2 * * *         | Asia/Kolkata  | Refresh expiring Instagram tokens |
| Content Engine  | */2 * * * *       | Asia/Kolkata  | Process content generation queue  |

## External Service Dependencies

### MongoDB Atlas

- **Database**: `restropulse`
- **Collections**: users, restaurants, posts, contentStrategies, strategyCycles, accountManagers, subscriptionPlans, subscriptions, coupons, couponRedemptions, creditPurchases, creditPacks, invoices
- **Driver**: mongodb v6.12
- **Connection**: Shared singleton via `@restropulse/db`

### Firebase Authentication

- **Provider**: Phone (SMS OTP)
- **Admin SDK**: Used by API to verify ID tokens
- **Client SDK**: Used by frontend for OTP flow
- **Fallback**: In-memory OTP for development when Firebase is not configured

### Meta Graph API v18.0

- **Base URL**: https://graph.facebook.com/v18.0
- **OAuth URL**: https://www.facebook.com/v18.0/dialog/oauth
- **Scopes**: instagram_basic, instagram_content_publish, pages_show_list, pages_read_user_content, pages_manage_posts, public_profile
- **Token Lifetime**: 60 days (long-lived)
- **Refresh Window**: 15 days before expiry (cron), 7 days (on-demand)

### Razorpay

- **API Base**: https://api.razorpay.com/v1
- **Auth**: Basic Auth (key_id:key_secret)
- **Subscriptions API**: Recurring billing for plans (MONTHLY/ANNUAL)
- **Orders API**: One-time payments for credit packs
- **Offers API**: Coupon discount syncing
- **Invoices**: Auto-generated by Razorpay for each subscription charge
- **Webhooks**: HMAC-SHA256 signature verification via `X-Razorpay-Signature` header
- **Webhook events**: subscription.authenticated, subscription.activated, subscription.charged, subscription.pending, subscription.halted, subscription.cancelled

### Google Maps Places API (optional)

- **Package**: `@vis.gl/react-google-maps` (frontend only)
- **Used for**: Address autocomplete during onboarding (location step)
- **API Key**: `VITE_GOOGLE_MAPS_API_KEY` in `apps/web/.env`
- **Fallback**: Manual address text input when API key is not configured
- **Required APIs**: Maps JavaScript API, Places API

## Azure App Service Settings

The API, publisher, and content-engine run on a single Azure App Service
(`restropulse-prod-api`) with staging and production deployment slots.

### Deployment Settings

| Setting | Value | Purpose |
|---------|-------|---------|
| `WEBSITE_RUN_FROM_PACKAGE` | `1` | Mounts the deployed zip as a read-only filesystem, bypassing Oryx build/startup entirely |
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | `false` | Belt-and-suspenders: prevents Oryx from running `npm ci` during deployment |

These settings are required because the monorepo uses `@restropulse/*` workspace
packages that Oryx cannot resolve (it runs `npm ci` without workspace context,
producing a broken `node_modules`).

### Slot-Sticky Settings

All app settings are **slot-sticky** (marked as "Deployment slot setting" in Azure Portal).
This means settings stay with their respective slot across slot swaps. Staging and
production are completely separate environments with different databases, encryption
keys, secrets, and URLs.

Settings managed by the deploy workflows:

| Setting | Staging Slot | Production Slot |
|---------|-------------|-----------------|
| `NODE_ENV` | `staging` | `production` |
| `WEBSITE_RUN_FROM_PACKAGE` | `1` | `1` |
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | `false` | `false` |

All other settings (MONGODB_URI, ENCRYPTION_KEY, JWT_SECRET, INSTAGRAM_APP_*,
CORS_ORIGIN, APPLICATIONINSIGHTS_CONNECTION_STRING, etc.) are configured directly
on Azure and must also be marked slot-sticky.

### Clean Deployments

The staging deploy uses `az webapp deploy --clean true` to remove stale files
from previous deployments before extracting the new zip.

## Token and Timeout Configuration

| Parameter                  | Value         |
|----------------------------|---------------|
| JWT Access Token Expiry    | 15 minutes    |
| JWT Refresh Token Expiry   | 7 days        |
| OAuth State Token Expiry   | 10 minutes    |
| Instagram Token Lifetime   | 60 days       |
| API Request Timeout        | 30 seconds    |
| Media Upload Timeout       | 60 seconds    |
| Video Poll Interval        | 5 seconds     |
| Video Poll Max Wait        | 5 minutes     |
| Max Publish Attempts       | 3 per post    |
| OTP Expiry (dev)           | 5 minutes     |
| OTP Max Attempts (dev)     | 3 per number  |

## Encryption

- **Algorithm**: AES-256-CBC
- **Key**: `ENCRYPTION_KEY` env variable (64 hex chars = 32 bytes; if plain text, SHA-256 hashed)
- **IV**: 16 random bytes per encryption operation
- **Storage format**: `{iv_hex}:{ciphertext_hex}`
- **Used for**: Instagram access tokens in MongoDB restaurant documents

## Local Development Setup

1. Clone the repository
2. Copy `.env.example` to `.env` in each app that needs one
3. Run `npm install` at the root (installs all workspaces)
4. Start services:
   ```
   npm run dev          # Starts all apps via Turborepo
   npm run dev --filter=@restropulse/api   # API only
   npm run dev --filter=@restropulse/web   # Frontend only
   ```
5. **Set up collections and indexes**: `npm run setup --workspace=@restropulse/db-cli`
   This creates all collections with the correct schema and indexes, including the
   partial unique index on subscriptions (`restaurantId` unique where `endedAt IS NULL`)
   that is required for subscription renewals to work.
6. For database seeding: `npm run seed --workspace=@restropulse/db-cli`
7. Verify schema: `npm run validate --workspace=@restropulse/db-cli`
8. For a fresh empty database: `npm run reset --workspace=@restropulse/db-cli` (prompts for URI + DB name, 10s safety delay)

> **Migrations** (`npm run migrate ...`) are only needed for **existing databases** that
> were created before the correct index definitions were added. They are not required
> for new environments where `setup` is run first.

## Build and Deploy

```bash
npm run build          # Build all packages and apps
npm run type-check     # TypeScript type checking across monorepo
npm run lint           # ESLint across monorepo
npm run test           # Run all test suites
```

Individual app builds produce output in their respective `dist/` directories.

## CI/CD Pipeline

### GitHub Actions Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | PRs to `main`/`staging`, push to `staging` | Parallel type-check, lint, per-service tests with path filtering |
| `deploy-staging.yml` | Push to `staging` | Build, deploy API to staging slot + SWA to staging environment, smoke tests, tag |
| `deploy-production.yml` | Manual (`workflow_dispatch`) | Promote a staging tag to production via slot swap (API) and SWA upload (web) |

### CI Gate (`ci.yml`)

Uses path-based change detection to skip unnecessary jobs. A `ci-complete` aggregator job is the single required status check for branch protection.

| PR changes | Jobs that run |
|---|---|
| Only `docs/**`, `*.md` | detect-changes, ci-complete |
| Only `apps/web/**` | detect-changes, type-check, lint, test-web, ci-complete |
| `packages/**` | ALL jobs (package changes cascade to all services) |

Coverage is enforced on PRs via `config/coverage-baseline.json` (85% minimum for lines/branches/functions for web, api, and content-engine). Publisher is excluded — its src/ is a thin process entry point with no testable business logic.

### Azure Deployment Targets

| Service | Azure Resource | Staging deploy | Production deploy | Cost |
|---------|---------------|----------------|-------------------|------|
| `apps/web` | Static Web Apps (`restropulse-prod-web`) | Upload to `staging` SWA environment | Upload artifact to production SWA environment | Free tier |
| `apps/api` | App Service (`restropulse-prod-api`) | Deploy bundle to `staging` slot | Slot swap: staging -> production | ~$13/month |
| `apps/publisher` | Continuous WebJob on same App Service | Bundled with API deploy | Promoted via slot swap | $0 extra |
| `apps/content-engine` | Continuous WebJob on same App Service | Bundled with API deploy | Promoted via slot swap | $0 extra |

Publisher and content-engine run as continuous WebJobs under `App_Data/jobs/continuous/<name>/` on the same App Service as the API.

There is no separate staging Azure resource group. All resources share `restropulse-prod-rg`. Staging isolation is achieved via:
- App Service: the `staging` deployment slot (`restropulse-prod-api-staging.azurewebsites.net`) with slot-sticky settings (separate DB, secrets, NODE_ENV)
- SWA: the `staging` preview environment (`victorious-plant-04bc9e400-staging.6.azurestaticapps.net`)

### Promotion Flow

```
merge to staging branch
    -> deploy-staging.yml
        -> API bundle deployed to App Service staging slot
        -> SWA build uploaded to SWA staging environment
        -> smoke tests against staging URLs
        -> git tag: staging/YYYY-MM-DD-HHmmss

manual: trigger deploy-production.yml with staging tag
    -> requires production environment approval
    -> API: az webapp deployment slot swap (staging -> production, zero-downtime)
    -> SWA: rebuild from same tag, upload to SWA production environment
    -> smoke tests against production URLs
    -> git tag: production/YYYY-MM-DD-HHmmss
```

The slot swap for the API is atomic and zero-downtime. The old production slot becomes the new staging slot, enabling instant rollback by swapping back.

SWA does not support slot swaps. Production SWA is a rebuild from the pinned staging tag -- identical code, deterministic output via locked dependencies.

### Branching Model

- Feature branches -> PR to `staging` -> auto-deploy to staging slot/environment
- `staging` -> PR to `main` -> manual promote to production via `workflow_dispatch`

### GitHub Environments

Authentication uses OIDC (Workload Identity Federation) -- no long-lived credentials stored as secrets.

| Environment | Protection | Variables (not secrets) |
|-------------|-----------|-------------------------|
| `staging` | None (auto-deploy) | `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_WEBAPP_NAME_PROD`, `AZURE_RESOURCE_GROUP`, `STAGING_API_URL`, `STAGING_WEB_URL`, `AZURE_SWA_NAME` |
| `production` | Required reviewer(s) | `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_WEBAPP_NAME_PROD`, `AZURE_RESOURCE_GROUP`, `PRODUCTION_API_URL`, `PRODUCTION_WEB_URL`, `AZURE_SWA_NAME` |

Both environments share the same `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, and `AZURE_WEBAPP_NAME_PROD` values -- there is one App Registration and one App Service. The workflows use `slot-name: staging` to target the staging slot; the production deploy uses `az webapp deployment slot swap` rather than a separate app name.

To set up OIDC:
1. Create an App Registration in Entra ID (Azure AD) -- `restropulse-github-actions` (appId: `6dc51c23-5945-4610-b75d-ec027c0cb296`)
2. Add a federated credential for each environment: entity type "Environment", repo `baxeltech/restropulse`, environment `staging` / `production`
3. Grant the service principal `Contributor` on `restropulse-prod-rg` and `Static Web Apps Contributor` on `restropulse-prod-web`
4. Set environment variables in each GitHub environment (already configured -- see table above)

### Rollback

**API**: re-trigger `deploy-production.yml` with the previous `production/*` tag. The previous production build is still in the staging slot (it was swapped there), so the slot swap completes instantly with no rebuild.

**SWA**: re-trigger `deploy-production.yml` with a previous `staging/*` or `production/*` tag. Turbo cache ensures a near-instant rebuild.
