# Launch alerts

`launch-alerts.bicep` creates the alerts RestroPulse needs before Launch 1. Nothing here is deployed by CI. Someone with access to the Azure subscription deploys it once per environment.

| Alert | Fires when | Severity |
|---|---|---|
| `publish-dead-letters` | More than 3 posts failed to publish for good in 1 hour | 2 |
| `meta-reauth` | A restaurant's Meta token was rejected (its publishing is paused) | 3 |
| `publisher-stalled` | No `publishing-job` run finished in 20 minutes | 1 |
| `cron-failures` | Background jobs threw more than 5 times in 1 hour | 2 |
| `api-5xx` | More than 20 API 5xx responses in 15 minutes | 2 |
| `ai-daily-spend` | AI spend over the last 24 hours is above `dailyAiSpendThresholdUsd` (default $25) | 2 |
| `api-ready-failing` | `GET /health/ready` fails from 2 of 3 regions | 1 |

## Before you deploy

1. Deploy the code from the PR that added this folder first. The alerts read `customEvents`, which only fill once `trackEvent()` emits OpenTelemetry log records (before that change, events only went to stdout).
2. Check data is arriving: in Application Insights → Logs, run
   `customEvents | where name == "cron.job.completed" | take 5`.
   If it's empty after the deploy, `APPLICATIONINSIGHTS_CONNECTION_STRING` isn't reaching the workers.
3. Pick the action group (who gets emailed or texted). The subscription already has a smart-detection action group; you can use it or create one for on-call.

## Deploy

```bash
az bicep build --file infra/alerts/launch-alerts.bicep   # compile check

az deployment group create \
  --resource-group restropulse-prod-rg \
  --template-file infra/alerts/launch-alerts.bicep \
  --parameters appInsightsName=<component name> \
               actionGroupName=<action group name> \
               apiBaseUrl=https://<api host> \
               environmentName=prod
```

For staging, use the staging API URL and `environmentName=staging`.

## Health endpoints

- `/health`: liveness. Answers while the Node process is up. Use this as the App Service **health check path**, so a database outage doesn't recycle the app.
- `/health/ready`: readiness. Pings MongoDB with a 2-second timeout and returns 503 if it fails. Used by `scripts/smoke-test.sh` after every deploy and by the availability test above.
