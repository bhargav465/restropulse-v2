# RestroPulse - Copilot Instructions

## Self-Update Directive

When any of the following change, update this file to reflect the current state of the project:
- New apps, packages, or services are added
- Environment variables change
- Database schema or collections change
- API routes are added or modified
- New conventions or patterns are established
- Dependencies significantly change

Always keep this file accurate and up to date with the codebase.

---

## Project Overview

RestroPulse is a social media management platform for restaurants. It is a Turborepo monorepo with npm workspaces.

## Monorepo Layout

```
apps/
  web/              React 19 + Vite 6 SPA (port 3000)
  api/              Express 4 REST API (port 3001)
  publisher/        Standalone cron worker (publishing + token refresh)
  content-engine/   Standalone poll worker (content generation)
  db-cli/           Commander CLI for DB operations
packages/
  shared/           @restropulse/shared -- unified TypeScript types
  db/               @restropulse/db -- shared MongoDB connection + helpers
  publishing/       @restropulse/publishing -- Meta API, encryption, publishing/token-refresh crons
  telemetry/        @restropulse/telemetry -- structured logging, tracing, metrics (Azure Monitor)
  tsconfig/         Shared tsconfig presets (base, react, node)
  eslint-config/    Shared ESLint flat config
```

### AI Assistant Config Files

| File | Purpose |
|------|---------|
| `.vscode/mcp.json` | MCP server definitions for VS Code Copilot (JSONC) |
| `.mcp.json` | MCP server definitions for Claude Code CLI + extension (JSON) |
| `.github/copilot-instructions.md` | Project instructions for VS Code Copilot |
| `CLAUDE.md` | Project instructions for Claude Code |

## Key Conventions

### TypeScript
- All code is TypeScript with strict mode enabled
- ESM modules (type: "module" in package.json)
- Target: ES2022
- Import from `@restropulse/shared` for all types -- never duplicate type definitions
- Import `loadAndValidateEnv` from `@restropulse/shared` for startup config validation in services
- Import from `@restropulse/db` for MongoDB operations -- never create separate DB connections
- Import from `@restropulse/publishing` for encryption, Meta API, and publishing/token-refresh crons -- never duplicate these locally

### Naming
- Files: kebab-case (e.g., `publishing-service.ts`)
- Types/Interfaces: PascalCase (e.g., `PostStatus`, `Restaurant`)
- Functions/Variables: camelCase
- Enums: UPPER_SNAKE_CASE values (e.g., `PENDING_APPROVAL`)
- Collections: camelCase (e.g., `contentStrategies`, `strategyCycles`)

### Testing
- Frontend: Vitest + React Testing Library
- Backend: Vitest + mongodb-memory-server + supertest
- Tests go in `tests/` directory within each app
- Unit tests in `tests/unit/`, integration in `tests/integration/`
- Use `setDB()` from `@restropulse/db` for test database injection
- Standard test scripts across app workspaces: `test`, `test:unit`, `test:coverage`

### Error Handling
- API returns `{ success: boolean, data?: T, error?: string }` (ApiResponse type)
- HTTP status codes: 200 (success), 201 (created), 400 (bad request), 401 (unauthorized), 404 (not found), 500 (server error)
- All async route handlers must catch errors and return proper ApiResponse

### No Special Characters
- Do not use special characters like emoji in code, documentation, print statements, or logs
- Use plain text indicators instead

### Logging
- Use `@restropulse/telemetry/server` for all server-side logging -- never use console.log/error/warn
- Use `@restropulse/telemetry/browser` for all client-side telemetry (events, page views, crash reporting)
- Import `createLogger` and create a component-scoped logger: `const log = createLogger('component-name');`
- Use structured fields in the first argument: `log.info({ postId, attempt }, 'Processing post')`
- Never log PII (phone numbers, emails, addresses, tokens, names) -- the privacy layer redacts automatically
- Track business events via `trackEvent()` (server) or `browserEvents.*` (client)
- Server-side: pino JSON to stdout (dev: pino-pretty), exported to Azure Monitor in production
- Client-side: Application Insights JS SDK with offline buffering, session management

## Database

- MongoDB Atlas (driver: mongodb v6.12)
- Database name: `restropulse`
- Collections: users, restaurants, posts, contentStrategies, strategyCycles, accountManagers, subscriptionPlans, subscriptions, coupons, couponRedemptions, creditPurchases, creditPacks, invoices
- Document IDs: Support both ObjectId and custom string IDs (e.g., `r1` for seed data)
- Connection: Always use `@restropulse/db` singleton -- never create separate MongoClient instances

## Authentication

- Firebase Phone Auth (OTP) on the frontend
- Backend verifies Firebase ID tokens via Admin SDK
- Issues JWT access token (15min) + refresh token (7 days)
- Dev fallback: in-memory OTP when Firebase is not configured

## External APIs

- Meta Graph API v18.0 for Instagram/Facebook
- OAuth scopes: instagram_basic, instagram_content_publish, pages_show_list, pages_read_user_content, pages_manage_posts, public_profile
- Tokens encrypted with AES-256-CBC before storage
- Google Maps Places API (optional) for onboarding address autocomplete (`@react-google-maps/api`)
- Razorpay API for subscription billing, one-time credit purchases, coupon offers, and invoices

## Environment

- Each app has its own `.env` file
- Service entrypoints must load and validate env via `loadAndValidateEnv` with a local per-service schema
- See `docs/INFRASTRUCTURE.md` for the full list of environment variables per app
- Critical shared vars: MONGODB_URI, ENCRYPTION_KEY, INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET
- Payment vars (optional in dev): RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET
- Frontend required vars (all environments): `VITE_API_URL` (backend API base URL, no hardcoded fallback), `VITE_APP_URL` (frontend public URL baked into Firebase email verification continueUrl at build time; supplied via .env in dev and via workflow env block in CI)

## Common Commands

```bash
npm install              # Install all workspaces
npm run dev              # Start runtime apps (excludes @restropulse/db-cli)
npm run dev              # Kill occupied ports, build packages, then launch mprocs TUI (all services)
npm run build            # Build all
npm run build:packages   # Build only shared packages (shared, db, publishing, telemetry)
npm run test             # Test all
npm run test:unit        # Run unit tests across workspaces
npm run test:coverage    # Run coverage across workspaces
npm run lint             # Lint all
npm run type-check       # Type-check all
npm run dev --filter=@restropulse/api   # Single app
npm run reset --workspace=@restropulse/db-cli        # Reset DB (prompts for URI + DB name, 10s delay)
npm run setup:dev        # Install dev tools: mprocs (TUI runner) + ngrok (webhook tunnel)
npm run ngrok            # Start ngrok tunnel for local Razorpay webhook testing
```

## MCP Tool-Routing Rules

Three MCP servers provide non-overlapping context layers. Follow these rules
to prevent redundant or conflicting retrieval:

1. **Semantic Search (`semantic-search`)** -- Use ONLY for high-level discovery
   ("where is the feature that handles X?"). Never use it for type lookups or
   reading final file content.
2. **Logic / Navigation (`lsp-*`)** -- Use for jump-to-definition, find
   references, type diagnostics, and refactoring. This is the source of truth
   for TypeScript types and structure.
3. **Knowledge / Memory (`project-memory`)** -- Use for recalling architecture
   decisions, conventions, and user preferences. Never store code snippets or
   type information here.
4. **Filesystem tools** -- Use for reading/writing actual file content. Do not
   use `semantic-search` to read files.

Full setup details: `docs/MCP-SETUP.md`

## CI/CD

- **CI workflow** (`ci.yml`): Runs on PRs to `main`/`staging`. Uses path-based change detection to skip irrelevant jobs. `ci-complete` is the single required status check.
- **Staging deploy** (`deploy-staging.yml`): Auto-deploys on push to `staging`. Builds once, deploys artifacts to Azure (SWA for web, App Service for API + WebJobs).
- **Production deploy** (`deploy-production.yml`): Manual `workflow_dispatch` with a staging tag. Requires environment approval.
- **Coverage gate**: PRs enforce coverage thresholds from `config/coverage-baseline.json` (85% lines/branches/functions for web, api, content-engine). Publisher is excluded.
- **Branching model**: Feature branches -> PR to `staging` -> PR to `main` (production promotion).
- **No MongoDB service container in CI**: All tests use `mongodb-memory-server` in-process.
- **OIDC auth**: Deploy jobs use Workload Identity Federation (no publish profiles or SWA API tokens stored as secrets). `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` are GitHub environment variables.
- When adding a new app/service, add path filters in `.github/actions/detect-changes/action.yml` and a test job in `ci.yml`.

## Architecture Docs

- `docs/ARCHITECTURE.md` -- System overview, data flows, component diagram
- `docs/INFRASTRUCTURE.md` -- Env vars, ports, cron schedules, external services, CI/CD pipeline
- `docs/TESTING.md` -- Testing stack, conventions, examples
- `docs/MCP-SETUP.md` -- MCP server configuration, tool-routing rules, troubleshooting

## Content Engine AI Backend

The content-engine has two pluggable backends behind a feature flag:

- `CONTENT_GENERATOR_BACKEND=placeholder` (default, production): asset catalog at `apps/content-engine/src/services/content-generator/backends/placeholder/`
- `CONTENT_GENERATOR_BACKEND=ai`: AI orchestration at `apps/content-engine/src/services/content-generator/backends/ai/`

The AI backend composes four pluggable seams (`ILLMProvider`, `IMediaGenerator`, `ICurrentAffairsProvider`, `IDomainSpecialization`). `CONTENT_GENERATOR_BACKEND=ai` is an "uber" master flag -- when set, all four sub-features default-on (Anthropic + fal.ai + V1 calendar + V2 Sonar) and all four required keys must be present. The factory throws a single combined error listing every missing key. Sub-flag overrides (`MEDIA_BACKEND=placeholder`, `CURRENT_AFFAIRS_V1_ENABLED=false`, `CURRENT_AFFAIRS_V2_ENABLED=false`) exist for debug/staged rollout but are advanced operator opt-outs, not the supported normal mode.

See `docs/CONTENT_ENGINE_AI_ROLLOUT.md` for the rollout runbook, `docs/SECRETS.md` for how to obtain the four required keys, and `docs/adr/0001-content-engine-ai-framework.md` for design rationale.

Per-call cost events flow into both `costEvents` (MongoDB) and Application Insights `customEvents` (queryable from the workbooks at `infra/workbooks/`).

When changing AI-backend code:
- Tests use mocked external APIs (`vi.mock('ai', ...)` for Vercel AI SDK; mocked `fetch` for fal.ai/Sonar/Calendar). Do not introduce real network calls.
- The `CostEvent` type lives in `@restropulse/shared`; the `MediaJobRecord` type lives there too. Don't duplicate types in app-local files.
- Adding a new external API surface (e.g. a new media provider): also add per-call pricing in the relevant `pricing.ts` so cost dashboards stay accurate.

## Secrets Management

All secrets flow through `@restropulse/secrets` (`packages/secrets/`). Key conventions when working on this codebase:
- Never read secrets directly from `process.env` in new code -- add them to the app's Zod schema and `config/secrets-manifest.ts`
- Per-service scoping: each app only hydrates its own keys via `getAppSecretKeys(appName)`. The manifest is the authoritative list of which app owns which secret
- `SECRETS_BACKEND=azure-kv` enables Key Vault at startup; application code (Zod schemas, `process.env` reads) is unchanged
- Integration tests (`tests/integration/`): use `requireSecrets(suiteName, keys)` which throws on any missing secret -- no skip mechanism. Tests are manual-trigger only via `workflow_dispatch`
- Key Vault naming: `MY_API_KEY` -> `my-api-key` (kebab-case). With `AZURE_KEY_VAULT_KEY_PREFIX=dev`: `dev-my-api-key`
- See `docs/INTEGRATION_TESTING.md` for how to run and add integration tests
