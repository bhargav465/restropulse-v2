# RestroPulse Secrets Setup Guide

This document is the single reference for every secret, API key, and credential the RestroPulse workspace needs. It covers both the long-standing services (Firebase, Razorpay, Meta, Azure) and the AI-backend keys added during the content-engine AI rollout (Anthropic, fal.ai, Perplexity, Google Calendar).

For each secret, this guide describes:
- What it is used for and which app(s) need it
- Step-by-step instructions to obtain it
- Format and where to paste it (which `.env` file or Azure App Service setting)
- How to verify it works

## How secrets are managed

All secrets flow through the `@restropulse/secrets` package (`packages/secrets/`).

| Backend | `SECRETS_BACKEND` value | When to use |
|---------|------------------------|-------------|
| Process env (default) | `env` or unset | Local dev, CI unit tests |
| Azure Key Vault | `azure-kv` | Staging + production |

The provider is selected at service startup via `createSecretsProvider(process.env.SECRETS_BACKEND)`. When `azure-kv` is selected, all secrets for that service are fetched in parallel from Key Vault and written into `process.env` before `loadAndValidateEnv()` runs. Application code is unchanged.

## Per-service secret scope

Each service only loads its own secrets. Source of truth: `config/secrets-manifest.ts`.
- `getAppSecretKeys('api')` -- JWT, Instagram, Razorpay, Firebase, MongoDB, ENCRYPTION_KEY
- `getAppSecretKeys('content-engine')` -- Anthropic, Replicate, fal.ai, Google Calendar, Perplexity, MongoDB
- `getAppSecretKeys('publisher')` -- ENCRYPTION_KEY, Instagram, MongoDB
- `getAppSecretKeys('db-cli')` -- MongoDB only

## Azure Key Vault naming convention

`UPPER_SNAKE_CASE` env var -> `lower-kebab-case` KV secret name.

| Env var | KV secret name |
|---|---|
| `MONGODB_URI` | `mongodb-uri` |
| `ENCRYPTION_KEY` | `encryption-key` |
| `JWT_SECRET` | `jwt-secret` |
| `ANTHROPIC_API_KEY` | `anthropic-api-key` |
| `REPLICATE_API_TOKEN` | `replicate-api-token` |
| `INSTAGRAM_APP_SECRET` | `instagram-app-secret` |
| `RAZORPAY_KEY_SECRET` | `razorpay-key-secret` |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | `firebase-service-account-key` |

With `AZURE_KEY_VAULT_KEY_PREFIX=dev`, all names get a `dev-` prefix.

## Adding a new secret

1. Add entry to `config/secrets-manifest.ts`
2. Add key to the relevant app's Zod schema
3. Add key to `tests/integration/.env.integration.example`
4. Add integration test suite under `tests/integration/suites/` if needed
5. Provision in Azure Key Vault using kebab-case name

## .env file layout

Each app that needs secrets has its own `.env` (gitignored). The keys for one app are not shared automatically with another — duplicate values like `MONGODB_URI` and `ENCRYPTION_KEY` get pasted into multiple files.

```
apps/api/.env              # API server -- main secret holder
apps/web/.env              # Vite web app -- VITE_-prefixed (baked into bundle)
apps/publisher/.env        # Publisher worker
apps/content-engine/.env   # Content-engine worker (incl. AI backend keys)
```

The Web app's `.env` requires special care: every `VITE_*` variable is **inlined into the production JS bundle** at build time. Anything sensitive (Firebase Admin keys, Meta App Secret) must NOT use the `VITE_` prefix.

---

## 1. Project-level secrets (shared across apps)

### `MONGODB_URI` and `MONGODB_DB_NAME`

**What:** MongoDB Atlas connection string. Same value in `apps/api/.env`, `apps/publisher/.env`, `apps/content-engine/.env`.

**Steps:**
1. Sign in to **https://cloud.mongodb.com/**.
2. Project → Database → Connect → Drivers.
3. Pick **Node.js**, **6.7 or later**.
4. Copy the connection string. Replace `<password>` with your DB user's password.

**Format:** `mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`

**Save:**
```
MONGODB_URI=mongodb+srv://...
MONGODB_DB_NAME=restropulse
```

**Test:** start any app (`npm run dev --filter=@restropulse/api`); the boot log should print `Connected to MongoDB`.

---

### `ENCRYPTION_KEY`

**What:** 32-byte hex key used for AES-256-CBC encryption of Instagram access tokens before persisting them in MongoDB. Must be **identical** across `apps/api`, `apps/publisher`, `apps/content-engine` — the publisher decrypts tokens the API encrypted.

**Steps (generate a fresh key):**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Format:** 64-character hex string.

**Save:** copy the same value to all three .env files:
```
ENCRYPTION_KEY=a3f5e9...64-hex-chars-total
```

**Test:** the API will fail to start with a clear error if `ENCRYPTION_KEY` is missing or wrong-length. There is no separate test command — boot is the test.

**Production:** generate ONCE per environment. Never commit. Never rotate without coordinating across all three apps simultaneously.

---

### `JWT_SECRET`

**What:** signs the access + refresh tokens issued by the API auth flow. **`apps/api/.env` only.**

**Steps:**
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"
```

**Format:** any string with high entropy. Recommended ≥ 64 chars base64.

**Save:**
```
JWT_SECRET=longBase64StringHere==
```

**Production:** the dev fallback `restropulse-dev-secret-change-in-production` MUST be replaced. Operators rotating the secret invalidate every existing session token.

---

### `APPLICATIONINSIGHTS_CONNECTION_STRING`

**What:** Azure Monitor connection string for server-side telemetry (cost-by-restaurant + per-post audit workbooks). Telemetry is silently disabled when this is absent — apps still run. Used by `apps/api`, `apps/publisher`, `apps/content-engine`.

**Steps:**
1. Azure Portal → resource group `restropulse-prod-rg` → Application Insights resource.
2. Overview blade → **Connection String** → copy.

**Format:** `InstrumentationKey=xxxx-xxxx;IngestionEndpoint=https://...;LiveEndpoint=https://...`

**Save (server apps):**
```
APPLICATIONINSIGHTS_CONNECTION_STRING=InstrumentationKey=...;IngestionEndpoint=https://...
```

**Save (web app, separate variable):**
```
VITE_APPINSIGHTS_CONNECTION_STRING=InstrumentationKey=...;IngestionEndpoint=https://...
```

(Yes — same value goes to two different env names, one prefixed with `VITE_` for the browser SDK.)

**Test:** start the worker and create one post. Within 1-2 minutes, the Azure Portal "Logs" blade should show `customEvents` rows when querying `customEvents | take 10`.

---

## 2. Authentication — Firebase

Firebase serves two roles:
- **Web client SDK** (`apps/web/.env`, all `VITE_FIREBASE_*` vars): handles phone OTP UI flow.
- **Server Admin SDK** (`apps/api/.env`, `FIREBASE_SERVICE_ACCOUNT*` vars): verifies the ID tokens the web app sends.

Both come from the same Firebase project.

### Set up the Firebase project

1. Sign in to **https://console.firebase.google.com/**.
2. **Add project**: name `restropulse-dev` (or `restropulse-prod`). Disable Google Analytics if you don't need it.
3. Once created: **Build → Authentication → Get started**. Sign-in method tab → **Phone** → Enable. Add your test phone numbers under "Phone numbers for testing" (free OTP delivery to whitelisted numbers; production uses real SMS).

### Web client keys (`apps/web/.env`)

1. Project Overview → click the **gear icon** → **Project settings** → **General** tab.
2. Scroll to **Your apps** → **Add app** → **Web (</> icon)**.
3. Register app: nickname `restropulse-web`. **Do not** check "Set up Firebase Hosting".
4. Firebase shows a `firebaseConfig` object. Copy each value:

```
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=restropulse-dev.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=restropulse-dev
VITE_FIREBASE_STORAGE_BUCKET=restropulse-dev.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=1234567890
VITE_FIREBASE_APP_ID=1:1234567890:web:abc123def456
```

These `VITE_*` values are NOT secrets in the traditional sense — they're inlined into the JS bundle. The actual security boundary is the Firebase project's authorized domains list (Authentication → Settings → Authorized domains).

### Server Admin SDK keys (`apps/api/.env`)

1. Project settings → **Service accounts** tab → **Generate new private key**.
2. Confirm; a JSON file downloads (e.g., `restropulse-dev-firebase-adminsdk-xxxxx.json`).
3. Two ways to use it:

**Option A — paste JSON directly (recommended for dev):**
```
FIREBASE_SERVICE_ACCOUNT={"type":"service_account","project_id":"restropulse-dev",...}
```
The entire JSON on one line. Use a tool like `cat key.json | tr -d '\n'` to flatten.

**Option B — file path:**
```
FIREBASE_SERVICE_ACCOUNT_PATH=/absolute/path/to/restropulse-dev-firebase-adminsdk-xxxxx.json
```
Useful when you want the JSON file gitignored under a known location.

**For Azure App Service production:** use Option A with the JSON pasted into a single App Service setting. Wrap the value in quotes if Azure CLI mangles it.

**Test:** start the API + web; log in with a test phone number. The console should not show "Firebase Admin SDK init failed".

---

## 3. Meta / Instagram — `INSTAGRAM_APP_ID` + `INSTAGRAM_APP_SECRET`

**What:** Facebook App credentials used to OAuth into restaurants' Instagram Business accounts and publish posts via Meta Graph API v18.0. Required for `apps/api` (OAuth flow) and `apps/publisher` (token refresh).

**Steps:**
1. Sign in to **https://developers.facebook.com/**.
2. **My Apps → Create App**. Use case: **Other** → **Business**. Name: `RestroPulse` (dev/prod).
3. Once created: left nav → **App Settings → Basic**. Note **App ID** and click "Show" to reveal **App Secret**.
4. Add the products you need: **Facebook Login**, **Instagram Graph API**.
5. Configure Facebook Login → Settings → **Valid OAuth Redirect URIs**: add `http://localhost:3001/api/integrations/instagram/callback` (dev) and the prod equivalent.
6. Add the OAuth scopes: in **App Review → Permissions and Features**, request: `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_user_content`, `pages_manage_posts`, `public_profile`. (Dev mode allows test users without App Review approval.)

**Format:** `INSTAGRAM_APP_ID` is numeric (e.g., `1234567890123456`); `INSTAGRAM_APP_SECRET` is 32 hex chars.

**Save (api + publisher .env files):**
```
INSTAGRAM_APP_ID=1234567890123456
INSTAGRAM_APP_SECRET=abc123def456abc123def456abc123de
INSTAGRAM_REDIRECT_URI=http://localhost:3001/api/integrations/instagram/callback
INSTAGRAM_REDIRECT_FRONTEND_URL=http://localhost:3000
```

**Test:** in the web app, click "Connect Instagram" — completes the OAuth dance and stores an encrypted long-lived token in the `restaurants` collection.

---

## 4. Razorpay — `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` + `RAZORPAY_WEBHOOK_SECRET`

**What:** subscription billing, one-time credit purchases, coupon offers, invoice generation. Optional in dev (the service throws clearly when called without config); required in prod.

**Steps:**
1. Sign in to **https://dashboard.razorpay.com/**.
2. **Account & Settings → API Keys**.
3. Switch to **Test Mode** for dev. Click **Generate Test Key**. A modal shows `Key Id` and `Key Secret` — copy both. The secret is shown ONCE.
4. For Webhook: **Account & Settings → Webhooks → Add new webhook**. URL: your ngrok tunnel URL + `/api/subscriptions/webhook` (use `npm run ngrok` to get a tunnel). Select events: `subscription.authenticated`, `subscription.activated`, `subscription.charged`, `subscription.pending`, `subscription.halted`, `subscription.cancelled`. Razorpay generates a signing secret — copy it.

**Format:** `Key Id` is `rzp_test_*` (test) or `rzp_live_*` (prod); `Key Secret` is 24-32 chars; `Webhook Secret` is operator-set (e.g., a 32-char random string).

**Save (apps/api/.env):**
```
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxx
RAZORPAY_KEY_SECRET=YourSecretFromRazorpayDashboard
RAZORPAY_WEBHOOK_SECRET=YourWebhookSigningSecret
```

**Save (apps/web/.env, for the checkout SDK):**
```
VITE_RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxx
```
(Web only needs the public Key ID; the Key Secret stays server-side.)

**Test:** create a test subscription via the API. Razorpay's dashboard → "Subscriptions" tab should list it.

---

## 5. Google Maps Places API — `VITE_GOOGLE_MAPS_API_KEY`

**What:** address autocomplete during the onboarding location step. Optional — the form falls back to manual address entry when absent.

**Steps:**
1. Sign in to **https://console.cloud.google.com/**.
2. Pick your project (`restropulse-dev`). If you don't have one, create it.
3. Left nav → **APIs & Services → Library**. Enable both **Maps JavaScript API** and **Places API**.
4. **APIs & Services → Credentials → Create Credentials → API Key**.
5. **Edit API key** → "API restrictions" → restrict to `Maps JavaScript API` and `Places API`. "Application restrictions" → "HTTP referrers" → add `http://localhost:3000/*` and your prod web domain.

**Format:** `AIzaSy...` (39 chars).

**Save (apps/web/.env):**
```
VITE_GOOGLE_MAPS_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

**Test:** open the onboarding wizard's location step; you should get autocomplete suggestions while typing an address.

---

## 6. Web app deployment URLs — `VITE_API_URL` + `VITE_APP_URL`

**What:** baked into the JS bundle at build time.
- `VITE_API_URL`: where the SPA calls the backend (e.g., `http://localhost:3001/api` in dev, `https://restropulse-prod-api.azurewebsites.net/api` in prod)
- `VITE_APP_URL`: the SPA's own public URL (used as the `continueUrl` in Firebase email-verification links, baked at build time)

**Save (apps/web/.env):**
```
VITE_API_URL=http://localhost:3001/api
VITE_APP_URL=http://localhost:3000
```

**Production:** set in the GitHub Actions workflow `env:` block or App Service build settings — these need to match the deployment domain at build time.

---

## 7. Content Engine AI backend (master-flag mode)

These are the four required keys when `CONTENT_GENERATOR_BACKEND=ai` is set. Every key is documented in detail below; see `docs/CONTENT_ENGINE_AI_ROLLOUT.md` for the rollout runbook and per-stage cost expectations.

All four go into `apps/content-engine/.env`.

### `ANTHROPIC_API_KEY` — Anthropic Claude

**Used for:** cycle planning (Sonnet 4.6) + caption generation (Haiku 4.5) via `@ai-sdk/anthropic`.

**Steps:**
1. Go to **https://console.anthropic.com/**.
2. Sign up with email or Google.
3. Navigate to **Settings → API Keys** (direct: https://console.anthropic.com/settings/keys).
4. Click **Create Key**. Name it `restropulse-dev`. Copy the resulting key (starts with `sk-ant-api03-...`) — you can't view it again after closing the dialog.
5. Add **payment method + at least $5 credit**: **Settings → Billing**. Anthropic doesn't have a meaningful free tier; you need to fund the account before any call works.

**Format:** `sk-ant-api03-...` (~108 chars).

**Save:**
```
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxx
```

**Cost expectation:** Sonnet 4.6 is ~$3 input / $15 output per million tokens. Haiku 4.5 is ~$0.80 / $4. At ~30 posts/month/restaurant, expect **$0.20-0.50/month/restaurant**.

**Test:** any unit test mocking the SDK; or set the key locally and run `npm run dev --filter=@restropulse/content-engine` with `CONTENT_GENERATOR_BACKEND=ai` — boot logs should show `AIContentGenerator instantiated`.

---

### `FAL_API_KEY` — fal.ai (image + video)

**Used for:** image generation (Flux dev), image edits (Flux dev image-to-image), video generation (Kling 1.6 standard via queue API).

**Steps:**
1. Go to **https://fal.ai/**.
2. Sign up with GitHub or Google.
3. Navigate to **Dashboard → API Keys** (direct: https://fal.ai/dashboard/keys).
4. Click **Create new key**. Copy the value.
5. Add **payment method**: **Dashboard → Billing**. fal.ai gives **~$1 free credit on signup**, which is enough to test image generation but not video.

**Format:** typically a long random string like `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:yyyyyyyyyyyyyyyyy`.

**Save:**
```
FAL_API_KEY=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:yyyyyyyyyyyyyyyyy
```

**Cost expectation:** Flux dev is $0.025/image; Kling 1.6 video is ~$0.30/clip; MiniMax video is ~$0.40/clip. At ~30 posts/month with 25 images + 5 videos: **~$2.50/month/restaurant**.

**Test (real $0.025 call):**
```bash
curl https://fal.run/fal-ai/flux/dev \
  -H "Authorization: Key $FAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"a paneer tikka platter","image_size":"square_hd","num_images":1}'
```
Expected: JSON with `images: [{url: "https://fal.media/files/..."}]`.

---

### `GOOGLE_CALENDAR_API_KEY` — Google Cloud (India holidays)

**Used for:** V1 current-affairs RAG. Pulls India public holidays from `en.indian#holiday@group.v.calendar.google.com` and injects them as caption hints.

**Steps:**
1. Go to **https://console.cloud.google.com/**.
2. **Create a project** (or pick existing): top-left project picker → **New Project** → name `restropulse-dev`.
3. **Enable the Google Calendar API**: left nav → **APIs & Services → Library** → search "Google Calendar API" → click → **Enable**.
4. **Create credentials**: left nav → **APIs & Services → Credentials → Create Credentials → API key**.
5. **Restrict the key** (recommended): **Edit API key** → "API restrictions" → "Restrict key" → tick **Google Calendar API** only.

**Format:** `AIzaSy...` (39 chars). Same format as the Maps key but a separate key restricted to a different API.

**Save:**
```
GOOGLE_CALENDAR_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

**Cost expectation:** **$0** — Calendar API has a free tier of 1M requests/day. Content-engine makes ~2 calls/day per worker.

**Test:**
```bash
curl "https://www.googleapis.com/calendar/v3/calendars/en.indian%23holiday%40group.v.calendar.google.com/events?key=$GOOGLE_CALENDAR_API_KEY&timeMin=2026-05-01T00:00:00Z&timeMax=2026-06-01T00:00:00Z&singleEvents=true"
```
Expected: JSON with `items: [{summary: "Eid al-Fitr", ...}, ...]`.

---

### `PERPLEXITY_API_KEY` — Perplexity Sonar Pro

**Used for:** V2 current-affairs RAG. Daily platform-wide refresh + per-post hyperlocal triggers gated by an allowlist.

**Steps:**
1. Go to **https://www.perplexity.ai/settings/api** (sign in / sign up first).
2. Click **+ Generate** to mint a key.
3. **Add a payment method** in the same Settings → API page. Perplexity has **no free tier for API access** — minimum $5 deposit before any call works.

**Format:** `pplx-...`.

**Save:**
```
PERPLEXITY_API_KEY=pplx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**Cost expectation:** Sonar Pro is ~$3/$15 per million tokens. Daily refresh ≈ $0.30/month platform-wide. Per-post triggers (~20% trigger rate) ≈ $0.30-0.90/month/restaurant.

**Test:**
```bash
curl https://api.perplexity.ai/chat/completions \
  -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"sonar-pro","messages":[{"role":"user","content":"What is happening in Bengaluru today?"}]}'
```
Expected: JSON with `choices: [{message: {content: "..."}}]`.

---

## 8. Azure (deployment)

Azure resources sit in resource group **`restropulse-prod-rg`** and serve both staging and production via deployment slots.

### App Service settings (per slot)

Operators set **all** the secrets above as App Service settings in the Azure Portal — `App Services → restropulse-prod-api → Configuration → Application settings`. Each setting must be marked **slot-sticky** ("Deployment slot setting" checkbox) so staging and production stay isolated.

The full required-settings list mirrors the local `.env` files but with environment-appropriate values:

| Setting key                                | Slot scope            | Notes                                                              |
|--------------------------------------------|-----------------------|--------------------------------------------------------------------|
| `MONGODB_URI`                              | per-slot              | Different databases for staging vs production.                     |
| `MONGODB_DB_NAME`                          | per-slot              | `restropulse-staging` vs `restropulse-prod`.                       |
| `ENCRYPTION_KEY`                           | per-slot              | Generated once per environment; never reuse across env.            |
| `JWT_SECRET`                               | per-slot              | Same per-environment rule.                                         |
| `INSTAGRAM_APP_ID` / `_SECRET`             | per-slot              | One Meta app per environment is recommended.                       |
| `RAZORPAY_KEY_ID` / `_SECRET` / `_WEBHOOK` | per-slot              | Test keys for staging; live keys for production.                   |
| `FIREBASE_SERVICE_ACCOUNT`                 | per-slot              | JSON pasted as a single string.                                    |
| `APPLICATIONINSIGHTS_CONNECTION_STRING`    | per-slot              | One App Insights resource per slot or shared.                      |
| `CONTENT_GENERATOR_BACKEND`                | per-slot              | `placeholder` until promoted; `ai` once rolled out.                |
| `ANTHROPIC_API_KEY`                        | per-slot              | Required when `CONTENT_GENERATOR_BACKEND=ai`.                      |
| `FAL_API_KEY`                              | per-slot              | Required when `CONTENT_GENERATOR_BACKEND=ai`.                      |
| `GOOGLE_CALENDAR_API_KEY`                  | per-slot              | Required when `CONTENT_GENERATOR_BACKEND=ai`.                      |
| `PERPLEXITY_API_KEY`                       | per-slot              | Required when `CONTENT_GENERATOR_BACKEND=ai`.                      |

### Optional: Key Vault references (operator-side)

If you want secrets stored in Key Vault rather than directly in App Service settings:
1. Create a Key Vault under `restropulse-prod-rg`.
2. Grant the App Service's managed identity `Key Vault Secrets User` role on the vault.
3. In App Service settings, set the value to `@Microsoft.KeyVault(SecretUri=https://<vault-name>.vault.azure.net/secrets/<secret-name>/)`.

Application code stays unchanged — Azure resolves the reference at runtime. For code-level Key Vault integration via `@restropulse/secrets`, set `SECRETS_BACKEND=azure-kv` (see the top of this document).

### Static Web App (for `apps/web`)

The web app is deployed via **Azure Static Web Apps**: `restropulse-prod-web`. Build-time env vars (`VITE_*`) come from the GitHub Actions deploy workflow's `env:` block, NOT from the SWA configuration.

To rotate a `VITE_FIREBASE_*` value, update the workflow `env:` block, push to `staging`, redeploy.

---

## 9. GitHub Actions (CI/CD)

### OIDC (Workload Identity Federation)

CI/CD does **not** use long-lived Azure credentials. Instead, GitHub Actions authenticates via OIDC.

**Setup (one-time per environment):**
1. Azure Portal → **Microsoft Entra ID → App Registrations → New registration**: name `restropulse-github-actions`. Note the **Application (client) ID**.
2. **Certificates & secrets** tab → **Federated credentials** → **Add credential**:
   - Scenario: GitHub Actions deploying Azure resources.
   - Repo: `baxeltech/restropulse`.
   - Entity type: **Environment**.
   - Environment: `staging` (repeat for `production`).
3. Grant the service principal:
   - `Contributor` on `restropulse-prod-rg` (App Service deploys)
   - `Static Web Apps Contributor` on `restropulse-prod-web`

### GitHub environment variables (NOT secrets)

Each GitHub environment (`staging`, `production`) has these **environment variables** (Settings → Environments → variables):

| Variable                | Value                                               |
|-------------------------|-----------------------------------------------------|
| `AZURE_CLIENT_ID`       | App Registration's Application (client) ID         |
| `AZURE_TENANT_ID`       | Entra tenant ID                                     |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID                               |
| `AZURE_WEBAPP_NAME_PROD`| `restropulse-prod-api` (same name; slot differs)    |
| `AZURE_RESOURCE_GROUP`  | `restropulse-prod-rg`                               |
| `AZURE_SWA_NAME`        | `restropulse-prod-web`                              |
| `STAGING_API_URL` / `PRODUCTION_API_URL` | smoke-test target URLs               |
| `STAGING_WEB_URL` / `PRODUCTION_WEB_URL` | smoke-test target URLs               |

These are **variables, not secrets** — they are not sensitive (the OIDC trust relationship is what controls access). No long-lived credentials are stored in GitHub.

### Other GitHub secrets (for non-Azure integrations)

Most pipelines do not need these. Add only if a specific workflow references them.

---

## 10. Quick checklist for a new dev environment

In order, get every secret you need locally:

### Required to run anything
- [ ] MongoDB Atlas connection string → `apps/api/.env`, `apps/publisher/.env`, `apps/content-engine/.env`
- [ ] Generate `ENCRYPTION_KEY` → same value to all 3 .env files
- [ ] Generate `JWT_SECRET` → `apps/api/.env`

### Required for auth
- [ ] Firebase project + enable Phone auth + add test phone numbers
- [ ] `VITE_FIREBASE_*` (6 vars) → `apps/web/.env`
- [ ] `FIREBASE_SERVICE_ACCOUNT` JSON → `apps/api/.env`

### Required for posting
- [ ] Meta App + Facebook Login + Instagram Graph API + OAuth scopes
- [ ] `INSTAGRAM_APP_ID` + `INSTAGRAM_APP_SECRET` → `apps/api/.env`, `apps/publisher/.env`
- [ ] `INSTAGRAM_REDIRECT_URI` + `INSTAGRAM_REDIRECT_FRONTEND_URL` → `apps/api/.env`

### Required for billing (optional in dev)
- [ ] Razorpay test keys → `apps/api/.env` + `VITE_RAZORPAY_KEY_ID` to `apps/web/.env`
- [ ] Razorpay webhook → ngrok tunnel + `RAZORPAY_WEBHOOK_SECRET`

### Optional
- [ ] Google Maps API key (autocomplete fallback if absent) → `VITE_GOOGLE_MAPS_API_KEY` in `apps/web/.env`
- [ ] Application Insights connection string → all 3 server .env files + `VITE_APPINSIGHTS_CONNECTION_STRING` in `apps/web/.env`

### Required only when flipping the AI master flag
- [ ] `ANTHROPIC_API_KEY` → `apps/content-engine/.env`
- [ ] `FAL_API_KEY` → `apps/content-engine/.env`
- [ ] `GOOGLE_CALENDAR_API_KEY` → `apps/content-engine/.env`
- [ ] `PERPLEXITY_API_KEY` → `apps/content-engine/.env`
- [ ] Set `CONTENT_GENERATOR_BACKEND=ai` in `apps/content-engine/.env`

---

## 11. Security notes

- **Never commit `.env` files**: every `apps/*/.env` is gitignored. The repo's `.gitignore` enforces this; do not bypass.
- **`VITE_*` is public**: anything prefixed `VITE_` is baked into the browser bundle. Do not put server-only secrets there.
- **Rotate on suspicion**: if any key leaks (committed by accident, shared in chat, etc.) — rotate it via the provider dashboard immediately. The local `.env` is the easiest mitigation; production rotation requires App Service config update + worker redeploy.
- **Separate dev/staging/prod credentials**: Anthropic, Perplexity, fal.ai, Razorpay, Meta — every external service should have separate keys per environment so a leaked dev key can't impact production cost or data.
- **Azure App Service settings are NOT versioned**: changes are immediate and don't go through PR review. Treat them as production deploys.
