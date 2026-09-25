# Environment Classification Summary

Source: `reports/env/inventory.json`  
Generated inventory timestamp: `2026-08-09T07:15:57.021Z`

## Canonical active keys grouped by owner/component

### api (9)
- `BACKEND_URL` (required)
- `CORS_ORIGIN`
- `FEATURE_DELETE_ACCOUNT`
- `FEATURE_WEB_THEME`
- `FIREBASE_SERVICE_ACCOUNT_KEY`
- `FRONTEND_URL` (required)
- `GOOGLE_MAPS_API_KEY`
- `JWT_SECRET` (required)
- `RAZORPAY_WEBHOOK_SECRET`

### content-engine (6)
- `ASSET_SERVER_PORT`
- `CONTENT_GENERATOR_BACKEND`
- `GOOGLE_CALENDAR_API_KEY`
- `MEDIA_BACKEND`
- `PERPLEXITY_API_KEY`
- `REPLICATE_API_TOKEN`

### db-cli (1)
- `CONTENT_BASE_URL`

### intelligence-worker (2)
- `CRON_INTELLIGENCE`
- `CRON_INTELLIGENCE_DAILY`

### root/scripts (2)
- `NGROK_AUTH_TOKEN`
- `NGROK_DOMAIN`

### shared (14)
- `ANTHROPIC_API_KEY`
- `APPLICATIONINSIGHTS_CONNECTION_STRING`
- `ASSET_SERVER_BASE_URL`
- `ENCRYPTION_KEY` (required)
- `INSTAGRAM_APP_ID` (required)
- `INSTAGRAM_APP_SECRET` (required)
- `INSTAGRAM_REDIRECT_URI`
- `LOG_LEVEL`
- `MONGODB_DB_NAME`
- `MONGODB_URI` (required)
- `NODE_ENV`
- `PORT`
- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`

### tests (1)
- `INSTAGRAM_TEST_ACCESS_TOKEN`

### web (11)
- `VITE_API_URL` (required)
- `VITE_APPINSIGHTS_CONNECTION_STRING`
- `VITE_APP_URL` (required)
- `VITE_FIREBASE_API_KEY` (required)
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_AUTH_DOMAIN` (required)
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_PROJECT_ID` (required)
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_GOOGLE_MAPS_API_KEY`
- `VITE_TELEMETRY_SAMPLE_RATE`

## Stale declared keys (2)
- `VITE_INSTAGRAM_APP_ID`
- `VITE_INSTAGRAM_REDIRECT_URI`

## Orphan keys (used but undeclared) with interpretation (31)

### Deploy metadata, likely injected at deploy/runtime
- `APP_ARTIFACT_SHA256`, `APP_DEPLOYED_AT`, `APP_DEPLOY_RUN_ID`, `APP_GIT_SHA`
- Interpretation: runtime/build metadata read by API server, but not declared in tracked env example files.

### Azure Key Vault wiring
- `AZURE_KEY_VAULT_KEY_PREFIX`, `AZURE_KEY_VAULT_URL`, `SECRETS_BACKEND`
- Interpretation: secrets backend selection and Key Vault location are referenced in secrets bootstrap paths.

### Cron schedule and processing toggles
- `CRON_CURRENT_AFFAIRS_REFRESH`, `CRON_CYCLE_SYNC`, `CRON_DEADLINES`, `CRON_MEDIA_JOB_POLLER`, `CRON_PENDING_CYCLES`, `CRON_PENDING_POSTS`, `CRON_PUBLISHER`, `CRON_REVISIONS`, `CRON_ROLLING_WINDOW`, `INTELLIGENCE_DAILY_ENABLED`, `ROLLING_WINDOW_MINS`
- Interpretation: scheduler controls are referenced by workers/services or schema optional config but are not declared.

### Product/feature/behavior flags
- `CURRENT_AFFAIRS_V1_ENABLED`, `CURRENT_AFFAIRS_V2_ENABLED`, `ENABLED_PLATFORMS`, `FEATURE_TOPUP_CREDITS`, `FEATURE_UPDATES_SECTION`, `MIN_SCHEDULE_AHEAD_MINS`, `POST_APPROVAL_BUFFER_MINS`, `ZOMATO_ADAPTER`
- Interpretation: API/content behavior flags and operational knobs are read in runtime code but missing from declarations.

### Firebase and credentials mapping
- `FIREBASE_PROJECT_ID`, `GOOGLE_APPLICATION_CREDENTIALS`
- Interpretation: Firebase bootstrap uses these names in code/tests; declarations currently only cover adjacent variants.

### Frontend undeclared build keys
- `VITE_DEMO_MODE`, `VITE_RAZORPAY_KEY_ID`
- Interpretation: web build reads these keys, but they are not present in tracked web env declarations.

## Workflow-only keys (10)
- `AZURE_CLIENT_ID`
- `AZURE_RESOURCE_GROUP`
- `AZURE_SUBSCRIPTION_ID`
- `AZURE_SWA_NAME`
- `AZURE_TENANT_ID`
- `AZURE_WEBAPP_NAME_PROD`
- `PRODUCTION_API_URL`
- `PRODUCTION_WEB_URL`
- `STAGING_API_URL`
- `STAGING_WEB_URL`

Interpretation: these appear only in GitHub workflow files and are not runtime app env keys.

## Suggested cleanup actions

### Safe now
1. Remove stale web declaration keys from tracked examples after confirming Instagram client-side flow is fully deprecated:
   - `VITE_INSTAGRAM_APP_ID`
   - `VITE_INSTAGRAM_REDIRECT_URI`
2. Keep workflow-only keys out of app env examples/manifests and document them as CI/CD-only.

### Needs validation before delete
1. For every orphan key, decide one of:
   - add to canonical declarations (if intended runtime config), or
   - remove code/schema references (if obsolete).
2. Prioritize validation for:
   - `SECRETS_BACKEND`, `AZURE_KEY_VAULT_URL`, `AZURE_KEY_VAULT_KEY_PREFIX` (secrets loading path)
   - cron keys and schedule flags (worker behavior impact)
   - `VITE_DEMO_MODE`, `VITE_RAZORPAY_KEY_ID` (frontend build-time behavior)
   - `FIREBASE_PROJECT_ID`, `GOOGLE_APPLICATION_CREDENTIALS` (auth/bootstrap behavior)
