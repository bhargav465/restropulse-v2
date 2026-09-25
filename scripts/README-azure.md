# Azure Provisioning - RestroPulse

This document covers provisioning and deployment for RestroPulse on Azure using
`scripts/provision-azure.sh`.

## Current deployment model

The script provisions one shared resource set using a fixed `prod` name segment
for Azure resources. Environment behavior is handled at deployment target level:

- `production` target maps to the main App Service site.
- `staging` target maps to the App Service `staging` slot.
- `both` configures both production and staging slot in one run.

Static Web App uses one resource. Staging for frontend should use Static Web App
preview environments (branch or PR based), not App Service style slots.

## Azure MCP Server

The Azure MCP server (`@azure/mcp`) is configured in `.mcp.json` at the project
root for Azure inspection workflows.

## Prerequisites

| Tool | Minimum version | Install |
|------|-----------------|---------|
| Azure CLI (`az`) | 2.50 | https://aka.ms/installazurecliwindows |
| Active Azure subscription | n/a | https://portal.azure.com |

Log in before running the script:

```bash
az login
az account show
```

Switch subscriptions if needed:

```bash
az account list --output table
az account set --subscription "<name-or-id>"
```

## Running the script

Run from repository root:

```bash
bash scripts/provision-azure.sh
```

Options:

| Flag | Values | Default | Description |
|------|--------|---------|-------------|
| `--env` | `staging`, `production`, `both` | `staging` | Which App Service target(s) to configure |
| `--location` | Any Azure region | `centralindia` | Primary region for RG, App Service, Key Vault, Insights |
| `--prefix` | Any string | `restropulse` | Prefix for all resource names |
| `--subscription` | Subscription name or ID | current account | Override active subscription |
| `--reset` | flag | off | Delete resource group first, then re-provision |

Examples:

```bash
# Configure staging slot only
bash scripts/provision-azure.sh --env staging --location southindia

# Configure production only
bash scripts/provision-azure.sh --env production --location southindia

# Configure both production and staging slot in one run
bash scripts/provision-azure.sh --env both --location southindia

# Full reset and reprovision
bash scripts/provision-azure.sh --env both --location southindia --reset
```

The script is idempotent. Re-running without `--reset` skips existing resource
creation and reapplies relevant configuration.

## Static Web App region fallback

Static Web App is not available in every Azure region. If the requested
`--location` is unsupported for SWA (for example `southindia`), the script
automatically falls back to the nearest supported region (for example
`eastasia`) while keeping the rest of resources in the requested region.

This is expected behavior.

## What gets created

Default names with prefix `restropulse`:

| Resource | Name |
|----------|------|
| Resource Group | `restropulse-prod-rg` |
| Log Analytics Workspace | `restropulse-prod-law` |
| Application Insights | `restropulse-prod-insights` |
| Key Vault | `restropulse-prod-kv` |
| App Service Plan | `restropulse-prod-plan` |
| App Service Web App | `restropulse-prod-api` |
| App Service slot | `staging` |
| Static Web App | `restropulse-prod-web` |

## Reset behavior and Key Vault soft delete

`--reset` deletes the shared resource group and re-provisions. The script asks
for exact RG name confirmation before deletion.

Key Vault uses soft delete. If vault recreation fails due to name reuse, purge
the deleted vault and rerun:

```bash
az keyvault purge --name restropulse-prod-kv --location southindia
```

## WebJobs (publisher and content-engine)

`apps/publisher` and `apps/content-engine` are deployed as continuous WebJobs
under the API App Service.

Deployment paths:

```text
App_Data/jobs/continuous/publisher/run.js
App_Data/jobs/continuous/content-engine/run.js
```

Add `settings.job` in each folder:

```json
{ "is_singleton": true }
```

## After provisioning

### 1. Replace placeholder Key Vault secrets

The script seeds secret placeholders using the canonical `{env}-{kebab}`
naming scheme (lowercase, single shared vault, env in `dev`/`staging`/`prod`):

- `prod-*`
- `staging-*`
- `dev-*` (no App Service target; used only by local `npm run secrets:pull`)

Example updates:

```bash
az keyvault secret set --vault-name restropulse-prod-kv --name prod-mongodb-uri --value "mongodb+srv://..."
az keyvault secret set --vault-name restropulse-prod-kv --name staging-mongodb-uri --value "mongodb+srv://..."
```

Repeat for:

- `jwt-secret`
- `encryption-key`
- `instagram-app-id`
- `instagram-app-secret`
- `razorpay-key-id`
- `razorpay-key-secret`
- `razorpay-webhook-secret`
- `firebase-service-account-key`

### 2. App settings already automated by the script

The script automatically configures:

- Key Vault references for app secrets (separate `prod-*` and `staging-*`)
- Managed identity on production app and staging slot
- Key Vault policies for both identities
- `CORS_ORIGIN` based on created SWA hostname

You still need to set app-specific values like Instagram redirect URLs if they
are not in your CI deployment step.

### 3. Configure GitHub Actions secrets

Add these repository secrets:

| Secret name | Source |
|-------------|--------|
| `AZURE_WEBAPP_NAME` | Script output |
| `AZURE_RESOURCE_GROUP` | Script output |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | Script output |
| `AZURE_SUBSCRIPTION_ID` | Script output |
| `AZURE_WEBAPP_PUBLISH_PROFILE` | Command below |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | Script output |

Get publish profile:

```bash
az webapp deployment list-publishing-profiles \
  --resource-group restropulse-prod-rg \
  --name restropulse-prod-api \
  --xml
```

### 4. Frontend variables

Set frontend build variables (for production or preview pipelines as needed):

```yaml
env:
  VITE_API_URL: https://restropulse-prod-api.azurewebsites.net/api
  VITE_APPINSIGHTS_CONNECTION_STRING: ${{ secrets.APPLICATIONINSIGHTS_CONNECTION_STRING }}
  VITE_TELEMETRY_SAMPLE_RATE: "10"
```

For staging frontend validation, point `VITE_API_URL` to staging slot API:

`https://restropulse-prod-api-staging.azurewebsites.net/api`

## Useful az commands

```bash
# API logs (production app)
az webapp log tail \
  --resource-group restropulse-prod-rg \
  --name restropulse-prod-api

# API logs (staging slot)
az webapp log tail \
  --resource-group restropulse-prod-rg \
  --name restropulse-prod-api \
  --slot staging

# Restart production app
az webapp restart \
  --resource-group restropulse-prod-rg \
  --name restropulse-prod-api

# Restart staging slot
az webapp restart \
  --resource-group restropulse-prod-rg \
  --name restropulse-prod-api \
  --slot staging

# List WebJobs
az webapp webjob continuous list \
  --resource-group restropulse-prod-rg \
  --name restropulse-prod-api

# Check a Key Vault secret
az keyvault secret show \
  --vault-name restropulse-prod-kv \
  --name prod-mongodb-uri \
  --query "value" --output tsv

# App Insights portal URL
az monitor app-insights component show \
  --resource-group restropulse-prod-rg \
  --app restropulse-prod-insights \
  --query "portalUrl" --output tsv
```
