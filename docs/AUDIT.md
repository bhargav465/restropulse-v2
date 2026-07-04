# AUDIT — baxeltech org (2026-07-04)

## Repos found
GitHub API is unavailable from the build environment; repos were discovered by direct git probing. Accessible:

| Repo | Verdict |
|---|---|
| `baxeltech/restropulse` | Sole code repo. Turborepo monorepo, social-media SaaS for restaurants. Imported (snapshot of `staging`, most mature branch: 333 files ahead of `main`). |
| `bhargav465/restropulse` | Agent-spec CLAUDE.md template only; nothing to import. |
| `bhargav465/restropulse-v2` | Target repo; contained only the Replicate image generator (branch `claude/replicate-api-models-wf3mzn`), relocated to `tools/image-studio/`. |

No ordering/menu/cart code exists in any accessible repo. The ordering platform is greenfield, built on the audited stack.

## Audited stack (adopted, per hard constraint)
- Frontend: React 19 + Vite 6 SPA, TypeScript, Tailwind CSS
- Backend: Express 4 + TypeScript
- DB: MongoDB (driver v6), Atlas-hosted
- Auth: Firebase phone-OTP + JWT (jsonwebtoken), middleware in `apps/api/src/middleware/auth.ts`
- Payments (SaaS billing): Razorpay
- Monorepo: npm workspaces + Turborepo; shared `packages/{shared,db,telemetry,tsconfig,eslint-config,publishing,secrets}`
- CI/CD: GitHub Actions → Azure (OIDC `azure/login`, Key Vault `restropulse-prod-kv`, App Service zip-mount + WebJobs); `feature/azure-zero-secrets` branch has `scripts/provision-azure.sh`
- Tests: Vitest (+ integration suite under `tests/`)

## Reusable for the ordering platform
- `packages/shared` (types), `packages/db` (Mongo connection/helpers), `packages/telemetry` (browser + server events), tsconfig/eslint presets
- API skeleton: server bootstrap, auth middleware, role middleware, async-handler, Razorpay service (payments later)
- Web app patterns: Tailwind config, Layout/ErrorBoundary/ConfirmDialog components, api client shape

## Dead weight left behind
- None removed in import (snapshot kept intact); `test-results/` should be gitignored later.

## Monorepo layout (as imported)
```
apps/            api, web (merchant dashboard), publisher, content-engine, db-cli
packages/        shared, db, telemetry, publishing, secrets, tsconfig, eslint-config
tools/           image-studio (standalone Next 14 app, own lockfile — React 18 conflicts with workspace React 19, so intentionally NOT a workspace)
docs/ infra/ scripts/ config/ templates/ tests/
```

## Resolution for v1 ordering platform
- `apps/web` stays the merchant admin (social SaaS + new ordering admin sections)
- New `apps/storefront` = customer-facing ordering site (React 19 + Vite, react-router)
- Ordering API routes added to `apps/api`; ordering types in `packages/shared`
- ASSUMPTION: marketing/landing page ignored (per owner)
- ASSUMPTION: `staging` branch chosen over `main` as import source (most mature)
