// RestroPulse launch alerts (Launch 1).
//
// Log-search alerts on the Application Insights component plus an availability
// test on the API's /health/ready. Deploy once per environment, into the
// resource group that holds the App Insights component:
//
//   az deployment group create \
//     --resource-group restropulse-prod-rg \
//     --template-file infra/alerts/launch-alerts.bicep \
//     --parameters appInsightsName=<component> actionGroupName=<action group> \
//                  apiBaseUrl=https://<api host> environmentName=prod
//
// Every query reads customEvents written by trackEvent() (never sampled) or
// uses sum(itemCount) on sampled tables, so thresholds are real counts.
// See infra/alerts/README.md.

@description('Name of the existing Application Insights component.')
param appInsightsName string

@description('Name of the existing action group that receives alerts (email/SMS).')
param actionGroupName string

@description('Public base URL of the API, no trailing slash (e.g. https://api.restropulse.in).')
param apiBaseUrl string

@description('Short environment name used in alert names: staging or prod.')
@allowed([
  'staging'
  'prod'
])
param environmentName string

param location string = resourceGroup().location

@description('Daily AI spend (USD, Anthropic + Replicate + Sonar) that raises an alert.')
param dailyAiSpendThresholdUsd int = 25

@description('Posts dead-lettered in one hour that raise an alert.')
param deadLetterThreshold int = 3

resource appInsights 'Microsoft.Insights/components@2020-02-02' existing = {
  name: appInsightsName
}

resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' existing = {
  name: actionGroupName
}

var prefix = 'restropulse-${environmentName}'

var logAlerts = [
  {
    name: '${prefix}-publish-dead-letters'
    displayName: 'Posts failed to publish for good'
    description: 'More than the threshold of posts were dead-lettered (publishFailures) in the last hour. Check customEvents post.publish_dead_lettered for failureClass and errorCode.'
    severity: 2
    window: 'PT1H'
    frequency: 'PT15M'
    query: 'customEvents | where name == "post.publish_dead_lettered" | summarize n = count()'
    operator: 'GreaterThan'
    threshold: deadLetterThreshold
  }
  {
    name: '${prefix}-meta-reauth'
    displayName: 'A restaurant must reconnect Instagram/Facebook'
    description: 'Meta rejected a restaurant token; its publishing is paused until the merchant reconnects. customDimensions.restaurantId says which.'
    severity: 3
    window: 'PT1H'
    frequency: 'PT1H'
    query: 'customEvents | where name == "integration.meta_reauth_required" | summarize n = count()'
    operator: 'GreaterThan'
    threshold: 0
  }
  {
    name: '${prefix}-publisher-stalled'
    displayName: 'Publisher worker has stopped running'
    description: 'No publishing-job run completed in 20 minutes (it runs every 5). The publisher process is down or stuck.'
    severity: 1
    window: 'PT20M'
    frequency: 'PT10M'
    query: 'customEvents | where name == "cron.job.completed" and tostring(customDimensions.job) == "publishing-job" | summarize n = count()'
    operator: 'LessThan'
    threshold: 1
  }
  {
    name: '${prefix}-cron-failures'
    displayName: 'Background jobs are failing'
    description: 'Cron jobs (publisher, content engine, intelligence) threw more than 5 times in an hour. customDimensions.job says which.'
    severity: 2
    window: 'PT1H'
    frequency: 'PT15M'
    query: 'customEvents | where name == "cron.job.completed" and tostring(customDimensions.status) == "error" | summarize n = count()'
    operator: 'GreaterThan'
    threshold: 5
  }
  {
    name: '${prefix}-api-5xx'
    displayName: 'API is returning server errors'
    description: 'More than 20 HTTP 5xx responses from the API in 15 minutes (sampling-adjusted).'
    severity: 2
    window: 'PT15M'
    frequency: 'PT5M'
    query: 'requests | where cloud_RoleName == "restropulse-api" and toint(resultCode) >= 500 | summarize n = sum(itemCount)'
    operator: 'GreaterThan'
    threshold: 20
  }
  {
    name: '${prefix}-ai-daily-spend'
    displayName: 'AI spend is above the daily budget'
    description: 'Sum of costUsd on ai.request.completed over the last 24 hours is above the threshold. Use the cost-by-restaurant workbook to see who.'
    severity: 2
    window: 'P1D'
    frequency: 'PT1H'
    query: 'customEvents | where name == "ai.request.completed" | summarize n = sum(todouble(customDimensions.costUsd))'
    operator: 'GreaterThan'
    threshold: dailyAiSpendThresholdUsd
  }
]

resource scheduledAlerts 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = [for a in logAlerts: {
  name: a.name
  location: location
  properties: {
    displayName: a.displayName
    description: a.description
    severity: a.severity
    enabled: true
    scopes: [
      appInsights.id
    ]
    evaluationFrequency: a.frequency
    windowSize: a.window
    criteria: {
      allOf: [
        {
          query: a.query
          timeAggregation: 'Total'
          metricMeasureColumn: 'n'
          operator: a.operator
          threshold: a.threshold
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    autoMitigate: true
    actions: {
      actionGroups: [
        actionGroup.id
      ]
    }
  }
}]

// Availability: /health/ready (MongoDB ping) from three regions every 5 min.
resource readinessTest 'Microsoft.Insights/webtests@2022-06-15' = {
  name: '${prefix}-api-ready'
  location: location
  kind: 'standard'
  tags: {
    'hidden-link:${appInsights.id}': 'Resource'
  }
  properties: {
    SyntheticMonitorId: '${prefix}-api-ready'
    Name: '${prefix}-api-ready'
    Description: 'GET /health/ready must return 200 (API up and MongoDB reachable).'
    Enabled: true
    Frequency: 300
    Timeout: 30
    Kind: 'standard'
    RetryEnabled: true
    Locations: [
      { Id: 'apac-sg-sin-azr' }
      { Id: 'apac-hk-hkn-azr' }
      { Id: 'emea-nl-ams-azr' }
    ]
    Request: {
      RequestUrl: '${apiBaseUrl}/health/ready'
      HttpVerb: 'GET'
      ParseDependentRequests: false
    }
    ValidationRules: {
      ExpectedHttpStatusCode: 200
      SSLCheck: true
      SSLCertRemainingLifetimeCheck: 14
    }
  }
}

resource readinessAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${prefix}-api-ready-failing'
  location: 'global'
  properties: {
    description: 'The API readiness check is failing from 2 or more regions: the API is down or cannot reach MongoDB.'
    severity: 1
    enabled: true
    scopes: [
      readinessTest.id
      appInsights.id
    ]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.WebtestLocationAvailabilityCriteria'
      webTestId: readinessTest.id
      componentId: appInsights.id
      failedLocationCount: 2
    }
    autoMitigate: true
    actions: [
      {
        actionGroupId: actionGroup.id
      }
    ]
  }
}

output alertNames array = [for (a, i) in logAlerts: scheduledAlerts[i].name]
output availabilityTest string = readinessTest.name
