# Integration Testing

Integration tests exercise real external APIs using real credentials. They live in `tests/integration/` and run separately from the unit test suites under `apps/*/tests/`.

## Running locally

```bash
# 1. Copy the template and fill in real secrets
cp tests/integration/.env.integration.example tests/integration/.env.integration

# 2. Run all integration suites
npm run test:integration
```

Missing secrets cause a hard failure with a clear error message listing which keys are absent and pointing to `.env.integration.example`.

## Triggering in CI

Integration tests are NOT part of the PR-blocking CI gate and are never triggered by a build or deploy. Run explicitly via:

```
GitHub Actions -> Integration Tests -> Run workflow -> select environment (dev/staging/prod)
```

Secrets are injected from the GitHub environment named `integration-{env}`. See `.github/workflows/test-integration.yml`.

Set up the GitHub environments (Settings -> Environments):
- `integration-dev`
- `integration-staging`
- `integration-prod` (add required reviewers to prevent accidental production runs)

Each environment needs all secrets from the suite registry below.

## Missing secrets = hard failure

`requireSecrets(suiteName, keys)` throws immediately if any required key is absent. There is no ignore/skip mechanism. The operator triggering the run is responsible for provisioning all secrets before doing so.

## Adding a new integration suite

1. Create `tests/integration/suites/<category>/<name>.test.ts`
2. Call `requireSecrets('<suite-id>', ['KEY1', 'KEY2'])` at the module top level
3. Use `describe('Suite name', () => { ... })` -- no `skipIf`
4. Add required keys to `tests/integration/.env.integration.example`
5. Add secrets to `integration-dev`, `integration-staging`, `integration-prod` GitHub environments

## Suite registry

| Suite ID | File | Required secrets |
|---|---|---|
| `mongodb` | `database/mongodb.test.ts` | MONGODB_URI, MONGODB_DB_NAME |
| `auth-encryption` | `auth/encryption.test.ts` | ENCRYPTION_KEY |
| `auth-jwt` | `auth/jwt.test.ts` | JWT_SECRET |
| `meta-instagram` | `meta/instagram-api.test.ts` | INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET, INSTAGRAM_TEST_ACCESS_TOKEN |
| `anthropic` | `ai/anthropic.test.ts` | ANTHROPIC_API_KEY |
| `replicate-image` | `ai/replicate.test.ts` | REPLICATE_API_TOKEN |
| `google-calendar` | `ai/google-calendar.test.ts` | GOOGLE_CALENDAR_API_KEY |
| `perplexity` | `ai/perplexity.test.ts` | PERPLEXITY_API_KEY |
| `razorpay` | `payments/razorpay.test.ts` | RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET |
| `publishing-encryption` | `publishing/token-encryption.test.ts` | ENCRYPTION_KEY |
