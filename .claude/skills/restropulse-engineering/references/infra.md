# RestroPulse Infrastructure Reference

Read when: deploying, changing CI, provisioning production, or executing the
sub-repo split / mobile expansion.

---

## 1. Environments (today)

### Demo — live
Three static bundles on GitHub Pages, `gh-pages` branch of
`bhargav465/restropulse-v2`:
`/` storefront (`VITE_DEMO_MODE=true`) · `/admin/` admin v1 (demo) ·
`/admin-v2/` admin v2 (demo + `VITE_ADMIN_SHELL=v2`).
CI: `.github/workflows/deploy-demo-pages.yml` builds all three on push to
`feat/monorepo-import`/`main` and force-pushes `gh-pages`.
Gotchas: Pages CDN caches `index.html` ~10 min; `GITHUB_TOKEN` cannot create
the Pages site via API (that's why we deploy via the `gh-pages` branch, which
auto-enables Pages); each app needs its own `404.html` copy for SPA routing.

### Production — wired, awaiting credentials
Azure App Service (Linux, `WEBSITE_RUN_FROM_PACKAGE` zip-mount): API +
WebJobs (publisher, content-engine). Web assets built with Key-Vault-fetched
env. Auth = GitHub Actions OIDC (`azure/login@v3` with `AZURE_CLIENT_ID/
TENANT_ID/SUBSCRIPTION_ID` repo vars). Secrets in Key Vault
`restropulse-prod-kv` (`STAGING-*` / `PROD-*` names). Flow: push to `staging`
branch → staging deploy; production via `workflow_dispatch` promotion of a
ref. Provisioning scripts: `provision-azure.sh`, `set-keyvault-secrets.sh`
(upstream branch `feature/azure-zero-secrets` of baxeltech/restropulse).
Deploy uses `turbo prune` + workspace-symlink materialization — don't
"simplify" it; zip-mount needs real directories.

**AWS note:** owner mentioned IAM role
`arn:aws:iam::864241680804:role/ottertest-github-deploy`. Target service
unconfirmed. If AWS becomes a deploy target: GitHub OIDC →
`aws-actions/configure-aws-credentials` assuming that role. Never mint
long-lived AWS keys.

### Data & third parties
MongoDB Atlas (`MONGODB_URI`) · Firebase (merchant OTP) · Meta Graph v18
(publishing) · Razorpay (billing; webhook `/api/subscriptions/webhook`) ·
Replicate (image studio) · WhatsApp Business Cloud API (planned).

### Secrets inventory
`MONGODB_URI`, `MONGODB_DB_NAME`, `JWT_SECRET`, `ENCRYPTION_KEY` (32-byte hex),
`FIREBASE_SERVICE_ACCOUNT`, 6× `VITE_FIREBASE_*`, `INSTAGRAM_APP_ID/SECRET`,
`VITE_RAZORPAY_KEY_ID` (+ server secret), `VITE_GOOGLE_MAPS_API_KEY`,
`VITE_APPINSIGHTS_CONNECTION_STRING`, `REPLICATE_API_TOKEN`.
Rules: `.env.example` documents every var; real values only in `.env.local` /
Key Vault / CI env; rotate anything that ever appeared in a chat/log.

---

## 2. APPROVED TASK — split into feature sub-repos, each with web + mobile

Owner decision: every feature becomes its own GitHub repository containing a
**web** version and a **mobile** version (current code is web-only). The
platform repo composes them. Execute as follows.

### 2a. Target repo topology

```
bhargav465/restropulse-platform        ← integration repo (rename of restropulse-v2)
  apps/api, apps/publisher, apps/content-engine, apps/db-cli
  packages/shared, packages/db, packages/telemetry   ← published as npm pkgs
  features/                             ← git submodules, one per feature repo
  .github/workflows                     ← builds & deploys the composition

bhargav465/restropulse-dashboard       ← admin shell + Dashboard/overview bucket
bhargav465/restropulse-content-engine  ← Content Studio, Strategy, Inputs UI
bhargav465/restropulse-ordering       ← storefront + ordering admin views
bhargav465/restropulse-analytics      ← funnel, cohorts, campaigns, Intelligence
bhargav465/restropulse-seo            ← SEO tooling (meta/schema/sitemaps; new)
bhargav465/restropulse-design         ← Website Design bucket / template gallery
```

Every feature repo has the same internal shape:

```
web/       React 19 + Vite package  (exports mountable routes/components)
mobile/    React Native + Expo package (same feature, native UI)
shared/    feature-local types & pure logic used by both targets
package.json (npm workspaces: web, mobile, shared)
.github/workflows/ci.yml (build + test + type-check on PR)
README.md (what the feature is, how to run standalone, contract with platform)
```

### 2b. Wiring rules (read twice)

1. **Composition = git submodules under `features/`** in the platform repo,
   pinned to commit SHAs. Update flow: PR in the feature repo → merge → PR in
   platform bumping the submodule pin. CI in platform runs the full
   integration gates before the pin lands. (`git clone --recurse-submodules`;
   add `submodules: recursive` to every checkout step.)
2. **Cross-feature imports are forbidden.** Features may import ONLY
   `@restropulse/shared`, `@restropulse/telemetry`, and their own code.
   Publish `packages/{shared,db,telemetry}` to GitHub Packages
   (`npm.pkg.github.com`, scope `@restropulse`) with semver; feature repos
   consume pinned versions. The API stays in the platform repo — features
   talk to it over HTTP contracts documented in `references/api-reference.md`.
3. **The shells stay thin.** `restropulse-dashboard` owns the sidebar/nav and
   lazily mounts other features' web packages; each feature exports
   `registerRoutes()` / `<FeatureRoot/>` with no knowledge of its siblings.
4. **Demo parity survives the split**: each feature repo ships its own
   `demo-api.ts` + fixtures so it runs standalone (`npm run dev:web`,
   `npm run dev:mobile`) with zero backend.

### 2c. Mobile (new — nothing exists yet)

- Stack: **React Native + Expo (managed workflow), TypeScript, Expo Router.**
  Reuse `shared/` logic (types, totals math mirrors, status machines) —
  never duplicate business rules between web/ and mobile/.
- Two end products composed from the feature repos' `mobile/` packages:
  **RestroPulse Owner** (dashboard/content/analytics/ordering-admin) and
  **RestroPulse Order** (customer storefront; also evaluate PWA first —
  the storefront is already mobile-first, a wrapped PWA may be v1).
- Design: same Electric Lavender tokens (`references/design.md` §2); the
  dark sidebar becomes a bottom tab bar; platform conventions win over
  pixel parity.
- Auth: merchants Firebase OTP (native SDK), customers email/password JWT —
  same endpoints, no API changes required.
- Distribution: Expo EAS builds; store accounts are an owner action-item.

### 2d. Migration phases (do them in this order, each independently green)

| Phase | Work | Exit criteria |
|---|---|---|
| 0 | Merge `feat/monorepo-import`; make it default | PR merged, demos still deploy |
| 1 | Publish `shared`/`db`/`telemetry` to GitHub Packages with semver + CI | Platform builds against published versions |
| 2 | Extract **ordering** (biggest, best-tested) into `restropulse-ordering` as the pilot: move `apps/storefront` + `apps/web/components/ordering` into `web/`, wire submodule, keep git history via `git filter-repo` | Platform integration build green; demos unchanged |
| 3 | Extract dashboard, content-engine, analytics the same way | Same |
| 4 | Scaffold `mobile/` in ordering (customer app or PWA decision) + dashboard (owner app) | Expo dev build runs against demo fixtures |
| 5 | New `restropulse-seo` + `restropulse-design` repos start empty with the standard shape | CI green on scaffold |

**Senior warning (on the record):** submodule sprawl is real — pins go stale,
juniors commit in detached HEAD, and cross-cutting changes need N PRs. The
discipline that makes it work: pin bumps only via PR, `--recurse-submodules`
everywhere, no cross-feature imports ever, and one integration CI that a
human watches. If velocity drops after Phase 3, the fallback (owner-approved
to propose) is Turborepo workspace-per-feature in one repo with CODEOWNERS —
same boundaries, less git ceremony.

---

## 3. CI/CD after the split

- Feature repos: PR CI = lint + type-check + test + build (web & mobile).
- Platform: submodule-pin PRs trigger full integration (turbo build all,
  E2E happy path, demo bundle build); merge → demo deploy (gh-pages) and,
  when enabled, Azure staging. Production stays `workflow_dispatch`.
- Mobile: EAS build on tag; internal distribution first.
- Secrets stay ONLY in the platform repo / Key Vault; feature repos get
  none (their demo modes need none — that's by design).
