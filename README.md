# RestroPulse

Social media management platform for restaurants. Automates content creation, scheduling, and publishing to Instagram and Facebook.

Also includes the **online ordering platform (v1)**: a multi-tenant customer storefront (`apps/storefront`, one site per restaurant at `/:slug`), an ordering admin hub inside the merchant dashboard (`apps/web`), and ordering routes in `apps/api`. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#online-ordering-platform-v1) and [docs/NEXT.md](docs/NEXT.md).

## Monorepo Structure

```
apps/
  web/              React 19 + Vite 6 SPA (port 3000) -- merchant dashboard (social SaaS + ordering admin)
  storefront/       React 19 + Vite 6 SPA (port 3003) -- public customer ordering site (/:slug)
  api/              Express 4 REST API (port 3001)
  publisher/        Standalone cron worker -- post publishing + token refresh
  content-engine/   Standalone poll worker -- content generation
  db-cli/           Commander CLI for DB operations (setup, seed, seed-ordering, migrations)
packages/
  shared/           @restropulse/shared -- unified TypeScript types (incl. src/ordering.ts)
  db/               @restropulse/db -- shared MongoDB connection + helpers (incl. ordering collections)
  telemetry/        @restropulse/telemetry -- browser + server logging/events
  publishing/       @restropulse/publishing -- Meta API, encryption, publish/token-refresh crons
  secrets/          @restropulse/secrets -- env / Azure Key Vault secrets providers
  tsconfig/         Shared tsconfig presets (base, react, node)
  eslint-config/    Shared ESLint flat config
tools/
  image-studio/     Next.js 14 Replicate image generator (dish/menu imagery).
                    NOT an npm workspace (React 18 vs workspace React 19) -- own lockfile,
                    run it standalone: cd tools/image-studio && npm install && npm run dev
```

## Quick Start

```bash
# Install all workspace dependencies
npm install

# Install dev tools (mprocs TUI runner + ngrok tunnel) -- one-time setup
npm run setup:dev

# Set up collections and indexes -- one-time per environment
# Creates correct schema including the partial unique index on subscriptions
# required for subscription renewals. Must run BEFORE seed.
npm run setup --workspace=@restropulse/db-cli

# Seed the database (subscription plans, sample data) -- one-time per environment
npm run seed --workspace=@restropulse/db-cli

# Seed the online-ordering demo storefront (slug "demo": restaurant, owner,
# demo customer, menu, published site content). Idempotent -- safe to re-run.
npm run seed:ordering --workspace=@restropulse/db-cli

# Verify schema is correct
npm run validate --workspace=@restropulse/db-cli

# Migrations are only needed for EXISTING databases with old schema.
# New environments that run setup first do not need migrations.

# Start all services in a split-pane TUI (web, api, publisher, content-engine, ngrok)
npm run dev

# Start a single app
npm run dev --filter=@restropulse/api
npm run dev --filter=@restropulse/web
npm run dev --workspace=@restropulse/storefront
```

Once running (ports come from `config/ports.json`):

| URL | What |
|---|---|
| http://localhost:3000 | Merchant dashboard (`apps/web`) -- ordering admin lives in the Ordering hub |
| http://localhost:3001/api | REST API (`apps/api`) |
| http://localhost:3003/demo | Demo customer storefront (`apps/storefront`, slug `demo` from `seed:ordering`) |
| http://localhost:3003/:slug | Any other seeded restaurant's storefront |


## Commands

| Command                  | Description                                          |
|--------------------------|------------------------------------------------------|
| npm install              | Install all workspaces                               |
| npm run setup:dev        | Install dev tools: mprocs + ngrok (one-time)         |
| npm run dev              | Kill ports, build packages, launch mprocs TUI        |
| npm run build            | Build all packages and apps                          |
| npm run build:packages   | Build shared packages only                           |
| npm run test             | Run all test suites (turbo test)                     |
| npm run test:unit        | Unit tests: api, web, publisher, content-engine      |
| npm run test:integration | Integration suite (needs MongoDB; see docs/INTEGRATION_TESTING.md) |
| npx turbo test --filter=@restropulse/api | Test a single workspace (same for web/storefront) |
| npm run lint             | Lint all workspaces                                  |
| npm run type-check       | TypeScript type checking                             |
| npm run ngrok            | Start ngrok tunnel for webhook testing               |
| npm run clean            | Remove build artifacts                               |

## Tech Stack

- Frontend: React 19, Vite 6, TypeScript, Tailwind CSS
- Backend: Express 4, TypeScript, MongoDB (driver v6.12)
- Auth: Firebase Phone Auth (OTP) + JWT
- External: Meta Graph API v18.0 (Instagram/Facebook)
- Monorepo: npm workspaces + Turborepo
- CI: GitHub Actions

## Deployment

- **SaaS services (api, web, publisher, content-engine)** deploy to **Azure** via the
  existing GitHub Actions workflows (`.github/workflows/deploy-staging.yml`,
  `deploy-production.yml`): OIDC `azure/login`, secrets from Key Vault
  (`SECRETS_BACKEND=azure-kv`), App Service + WebJobs. See `docs/INFRASTRUCTURE.md`.
- **Storefront + API previews** can be deployed via **Vercel**: `apps/storefront` is a
  static Vite build (`npm run build`, output `dist/`) with SPA-fallback rewrites and
  `VITE_API_URL` pointing at the deployed API; the Azure workflows do not yet cover the
  storefront.
- `tools/image-studio` is standalone (own lockfile); deploy separately if needed
  (Vercel-ready Next.js app, requires `REPLICATE_API_TOKEN`).

## Documentation

- [Architecture](docs/ARCHITECTURE.md) -- system overview, data flows, diagrams (incl. ordering platform v1)
- [Next steps](docs/NEXT.md) -- deferred ordering features and their extension points
- [Audit](docs/AUDIT.md) -- org/repo audit that grounded the monorepo import
- [Infrastructure](docs/INFRASTRUCTURE.md) -- env vars, ports, cron schedules
- [Testing](docs/TESTING.md) -- testing frameworks, conventions, templates
- [Meta App Setup](docs/META_APP_SETUP.md) -- Facebook/Instagram app configuration

## Architecture Overview

```
+-------------------------+
|    apps/web             |  React 19 SPA (Vite)
|    Port: 3000           |  Tailwind CSS, Recharts
+-----------+-------------+
            | HTTP/REST
            v
+-------------------------+     +-----------------------------+
| apps/api                |     | apps/publisher              |
| Port: 3001 (Express)   |     | Publishing Cron (5 min)     |
|                         |     | Token Refresh Cron (daily)  |
|  Routes:                |     +-------------+---------------+
|    /api/auth            |                   |
|    /api/restaurant      |                   |
|    /api/posts           |-------------------+
|    /api/strategy        |
|    /api/subscriptions   |
|    /api/coupons         |
|    /api/credit-packs    |
|    /api/invoices        |
|    /api/integrations    |     +-----------------------------+
+-----------+-------------+     | apps/content-engine         |
            |                   | Content Gen Poll (2 min)    |
    +-------+-------+          +-------------+---------------+
    v               v                        |
+---------+   +----------------------+       |
| MongoDB |<--| Meta Graph API v18.0 |       |
| Atlas   |<--| (Instagram + FB)     |-------+
+---------+   +----------------------+
```

### Publishing Flow

```
 Content Studio (Approve)    Publisher Cron (every 5 min)
         |                          |
         v                          v
  Status: SCHEDULED ---------> Check scheduledFor <= now
                                    |
                                    v
                            Publishing Service
                            +---------------+
                            | IMAGE/CAROUSEL |--> IG Container API
                            | REEL/VIDEO     |--> IG Reel Container
                            | STORY          |--> IG Story Container
                            | FACEBOOK       |--> FB Page Photos/Feed
                            +-------+-------+
                                    |
                              Success/Fail
                                    |
                                    v
                           Update post status
                          PUBLISHED / FAILED
```

### Content Generation Flow

```
 User Request or           Content Engine (every 2 min)
 Strategy Approval               |
         |                       v
         v                Poll for pending work
  Status: PENDING_CONTENT  (PENDING_CONTENT, APPROVED, PENDING_GENERATION)
  or APPROVED                    |
                                 v
                         Generate Content
                         (placeholder, future: AI)
                                 |
                                 v
                        Status: PENDING_APPROVAL
```

## License

Private

## Current Status

- [x] MongoDB Atlas database integration
- [x] JWT authentication with session management
- [x] Instagram OAuth with Facebook Login (Graph API v18.0)
- [x] Automated publishing to Instagram (IMAGE, REEL, CAROUSEL, STORY)
- [x] Automated publishing to Facebook (photo, video, multi-photo)
- [x] Publishing cron with rate limiting and retry logic
- [x] Token encryption (AES-256-GCM) and auto-refresh cron
- [x] Content approval workflow (approve/request changes/revert)
- [x] New user onboarding flow (multi-step registration with Google Maps)
- [x] Account manager assignment during onboarding
- [x] Razorpay subscription payments (Starter/Growth/Premium plans)
- [x] Unified credit system with credit packs
- [x] Coupon system with Razorpay Offers integration
- [x] Invoice generation (auto from webhooks + credit purchases)
- [x] Plan limit enforcement middleware
- [x] ADMIN role with role-based access control

## Future Roadmap

- File upload for media (Azure Blob Storage)
- WebSocket for real-time updates
- Service worker for offline support
- Push notifications
