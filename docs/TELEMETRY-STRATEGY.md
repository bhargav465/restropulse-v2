# RestroPulse Telemetry Strategy

Final architecture document for logging, tracing, and metrics across the
RestroPulse monorepo. Targeting Azure Monitor (Application Insights +
Log Analytics workspace) as the single observability backend.

---

## Table of Contents

1. [Design Principles](#design-principles)
2. [Signal Classification](#signal-classification)
3. [Architecture Overview](#architecture-overview)
4. [Package Design](#package-design)
5. [Server-Side Implementation](#server-side-implementation)
6. [Client-Side Implementation](#client-side-implementation)
7. [Privacy Layer](#privacy-layer)
8. [Cross-Component Correlation](#cross-component-correlation)
9. [Dashboard Strategy](#dashboard-strategy)
10. [AI Usage Tracking](#ai-usage-tracking)
11. [Cost Optimization](#cost-optimization)
12. [Environment Variables](#environment-variables)
13. [Integration Map](#integration-map)
14. [Test Impact](#test-impact)
15. [Implementation Phases](#implementation-phases)

---

## Design Principles

1. **Privacy first** -- PII is never logged. Sanitization is automatic, not
   opt-in. Phone numbers, tokens, emails, and addresses are masked or hashed
   before any log line is emitted.

2. **Client-side visibility is the priority** -- This is a new mobile-first PWA.
   Most crashes, slow interactions, and user-facing failures happen in the
   browser on unreliable mobile networks. Client telemetry is not optional.

3. **Exact counts where it matters** -- Business events (logins, posts created,
   posts published, subscriptions, payments) and errors are never sampled.
   Only distributed traces are sampled to control cost.

4. **Minimum code, maximum SDK reuse** -- Use `@azure/monitor-opentelemetry`
   (server) and `@microsoft/applicationinsights-web` (browser). These are
   Microsoft's official, maintained SDKs that handle auto-instrumentation,
   offline buffering, session management, and export. Do not reinvent.

5. **Correlate everything** -- A single `operation_id` flows from browser click
   through API request through worker job. Azure Monitor's Application Map
   visualizes this automatically.

6. **Graceful degradation** -- If `APPLICATIONINSIGHTS_CONNECTION_STRING` is not
   set, telemetry is disabled. The app runs normally. Structured logging via
   pino still works to stdout.

---

## Signal Classification

Not all signals are equal. This table defines what is sampled vs. always
collected, and which dashboard each signal feeds.

| Signal | Sampled? | Volume | Dashboard | Example |
|--------|----------|--------|-----------|---------|
| **Business events** (customEvents) | Never | Low (~100/day) | Usage | `post.created`, `auth.login`, `subscription.activated` |
| **Payment events** (customEvents) | Never | Low (~10/day) | Usage + Reliability | `payment.completed`, `webhook.received`, `credit.purchased` |
| **Exceptions** (exceptions) | Never | Low | Reliability | JS crash, unhandled rejection, API 500 |
| **HTTP request traces** (requests) | Yes (10% prod) | High (~10K/day) | Performance | `GET /api/posts`, `POST /api/auth/firebase` |
| **Dependency calls** (dependencies) | Yes (10% prod) | High | Performance | MongoDB queries, Meta API calls, Razorpay API |
| **Custom metrics** (customMetrics) | Pre-aggregated | N/A | All three | `publish.duration_ms`, `http.request.duration_ms` |
| **Client page views** (pageViews) | Never | Low (~500/day) | Usage | View transitions (DASHBOARD, STUDIO, etc.) |
| **Client performance** (customMetrics) | Never | Low | Performance | LCP, FID, CLS, INP |
| **AI usage metrics** (customMetrics) | Never | Low | AI Cost | `ai.tokens.input`, `ai.cost.usd` |
| **Structured logs** (traces in Azure) | Level-gated | Medium | Reliability | pino JSON logs forwarded to Azure |

**Key rule**: `customEvents` and `exceptions` bypass trace sampling. They always
arrive. This guarantees exact counts for business metrics and full error
visibility.

---

## Architecture Overview

```
+---------------------------+         +----------------------------+
|   Browser (PWA)           |         |   Azure Monitor            |
|                           |         |   (Application Insights)   |
|   @microsoft/             |  HTTPS  |                            |
|   applicationinsights-web +-------->+  Tables:                   |
|                           |         |    requests                |
|   - Crash reports (100%)  |         |    dependencies            |
|   - Page views (100%)     |         |    exceptions              |
|   - Custom events (100%)  |         |    customEvents            |
|   - Web Vitals (100%)     |         |    customMetrics           |
|   - Fetch traces (10%)    |         |    traces (= logs)         |
|   - Session management    |         |    pageViews               |
|   - Offline buffering     |         |    browserTimings          |
+----------+----------------+         +-------------+--------------+
           |                                        |
           | traceparent header                     | KQL queries
           | (W3C Trace Context)                    |
           v                                        v
+----------+----------------+         +-------------+--------------+
|   API Server (Express)    |         |   Azure Workbooks          |
|                           |         |   (Dashboards)             |
|   @azure/monitor-         |  HTTPS  |                            |
|   opentelemetry           +-------->+  1. Usage Dashboard        |
|                           |         |  2. Reliability Dashboard  |
|   - Auto: Express spans   |         |  3. AI Cost Dashboard      |
|   - Auto: MongoDB spans   |         +----------------------------+
|   - Auto: HTTP out spans  |
|   - pino structured logs  |
|   - Custom events (100%)  |
|   - Custom metrics        |
+----------+----------------+
           |
           | traceparent in DB docs
           | (for async correlation)
           v
+----------+----------------+     +--------------------+
|   Publisher Worker         |     |  Content Engine     |
|                           |     |                     |
|   Same OTel setup         |     |  Same OTel setup    |
|   - Cron job spans        |     |  - Cron job spans   |
|   - Publishing metrics    |     |  - Generation metrics|
|   - Meta API dependency   |     |  - AI metrics (future)|
+---------------------------+     +---------------------+
```

---

## Package Design

### Single package: `packages/telemetry` (`@restropulse/telemetry`)

Two subpath exports keep browser and Node.js code separate at import time,
but share privacy logic and type definitions.

```
packages/telemetry/
  package.json
  tsconfig.json
  src/
    index.ts                      # Barrel for shared exports (types, privacy)
    types.ts                      # TelemetryConfig, LogLevel, EventName constants
    privacy.ts                    # PII sanitizer (isomorphic, works in both envs)

    server/
      index.ts                    # Server barrel export
      sdk.ts                      # Azure Monitor OTel distro init
      logger.ts                   # pino wrapper with trace correlation + privacy
      middleware.ts               # Express request logging + error handler
      cron.ts                     # tracedCronJob() wrapper
      events.ts                   # Server-side trackEvent/trackMetric helpers
      ai-tracker.ts               # AI usage tracking (schema ready)

    browser/
      index.ts                    # Browser barrel export
      sdk.ts                      # Application Insights JS SDK init
      error-boundary.ts           # React ErrorBoundary with App Insights reporting
      events.ts                   # Client-side trackEvent/trackPageView helpers
```

### package.json exports

```json
{
  "name": "@restropulse/telemetry",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./server": {
      "import": "./dist/server/index.js",
      "types": "./dist/server/index.d.ts"
    },
    "./browser": {
      "import": "./dist/browser/index.js",
      "types": "./dist/browser/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "clean": "rimraf dist",
    "type-check": "tsc --noEmit"
  }
}
```

### Dependencies

**Server subpath** (`dependencies`):
- `@azure/monitor-opentelemetry` -- Azure's OTel distro (bundles trace, metric,
  log exporters + auto-instrumentations for Express, MongoDB, HTTP)
- `@opentelemetry/api` -- Manual span/metric/event APIs
- `pino` -- Structured JSON logger
- `pino-pretty` -- Dev-only human-readable output

**Browser subpath** (`dependencies`):
- `@microsoft/applicationinsights-web` -- Full browser SDK (crash reporting,
  page views, fetch instrumentation, session management, offline buffering)
- `@microsoft/applicationinsights-clickanalytics-js` -- Click analytics +
  Core Web Vitals plugin

**Shared** (no additional deps):
- Privacy module is pure TypeScript, zero dependencies

**Why not `@opentelemetry/sdk-trace-web`?** The Application Insights JS SDK
is purpose-built for Azure Monitor. It handles:
- Offline buffering with IndexedDB (critical for mobile PWA)
- Automatic session management (anonymous)
- sendBeacon on page unload
- Built-in sampling that excludes exceptions and custom events
- Direct integration with Azure Monitor schemas (no OTLP translation)

Using the generic OTel web SDK would require building all of the above manually,
violating the "minimum implementation" principle.

---

## Server-Side Implementation

### SDK Initialization (`server/sdk.ts`)

Must be called before any other imports in each app entrypoint. Uses the Azure
Monitor OpenTelemetry distro which auto-instruments:
- **Express** -- HTTP request spans with route, method, status
- **MongoDB driver v6** -- Query spans with collection, operation
- **Outbound HTTP/HTTPS** (axios) -- Dependency spans for Meta API, Razorpay
- **pino logs** -- Bridged to Azure Monitor `traces` table (when configured)

```typescript
import { useAzureMonitor, shutdownAzureMonitor } from '@azure/monitor-opentelemetry';
import { TelemetryConfig } from '../types.js';

export function initServerTelemetry(config: TelemetryConfig): void {
  if (!config.connectionString) {
    // No Azure connection -- telemetry disabled, pino still logs to stdout
    return;
  }

  useAzureMonitor({
    azureMonitorExporterOptions: {
      connectionString: config.connectionString,
    },
    samplingRatio: config.samplingRatio,  // 1.0 dev, 0.1 prod
    instrumentationOptions: {
      http: { enabled: true },
      azureSdk: { enabled: false },      // Not using Azure SDK elsewhere
      mongoDb: { enabled: true },
      // Express auto-detected
    },
    resource: {
      attributes: {
        'service.name': `restropulse-${config.serviceName}`,
        'service.version': config.serviceVersion || '1.0.0',
        'deployment.environment': config.environment,
      },
    },
  });
}

export async function shutdownServerTelemetry(): Promise<void> {
  await shutdownAzureMonitor();
}
```

**Sampling note**: `samplingRatio: 0.1` applies to distributed traces only.
Custom events sent via `trackEvent()` are not subject to this ratio. Azure
Monitor's SDK handles this distinction internally.

### Structured Logger (`server/logger.ts`)

Wraps pino. Every log line automatically includes:
- `component` field (replaces `[Publishing Cron]` prefix pattern)
- `traceId` and `spanId` from active OTel context (for log-trace correlation)
- All fields passed through `sanitize()` before emission

```typescript
import pino from 'pino';
import { trace, context } from '@opentelemetry/api';
import { sanitize } from '../privacy.js';

let rootLogger: pino.Logger;

export function initLogger(config: { serviceName: string; environment: string; logLevel: string }): void {
  const transport = config.environment === 'development'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined;

  rootLogger = pino({
    level: config.logLevel,
    transport,
    formatters: {
      log(obj: Record<string, unknown>) {
        // Inject trace context
        const span = trace.getSpan(context.active());
        if (span) {
          const ctx = span.spanContext();
          obj.traceId = ctx.traceId;
          obj.spanId = ctx.spanId;
        }
        return sanitize(obj);
      },
    },
    // Redact at the pino level as defense-in-depth
    redact: {
      paths: ['phone', 'email', 'accessToken', 'password', 'otp',
              '*.phone', '*.email', '*.accessToken', '*.password', '*.otp'],
      censor: '[REDACTED]',
    },
  });
}

export function createLogger(component: string): pino.Logger {
  if (!rootLogger) {
    // Fallback if initLogger was not called (e.g., in tests)
    rootLogger = pino({ level: 'silent' });
  }
  return rootLogger.child({ component });
}
```

**Migration pattern** for existing console.log calls:

```typescript
// BEFORE:
console.log(`[Publishing Cron] Processing post ${postId} (attempt ${attempt}/${max})`);

// AFTER:
const log = createLogger('publishing-cron');
log.info({ postId, attempt, maxAttempts: max }, 'Processing post for publishing');
```

### Express Middleware (`server/middleware.ts`)

Replaces the manual request logging middleware in `apps/api/src/server.ts:98-101`
and enhances the error handler at lines 128-135.

```typescript
import { Request, Response, NextFunction } from 'express';
import { createLogger } from './logger.js';
import { trackEvent } from './events.js';

const log = createLogger('http');

export function requestLoggingMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - start;
      const level = res.statusCode >= 500 ? 'error'
                   : res.statusCode >= 400 ? 'warn'
                   : 'info';

      log[level]({
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: duration,
        // Safe context -- never log full user object
        userId: req.user?.userId,
        restaurantId: req.user?.restaurantId,
      }, `${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    });

    next();
  };
}

export function errorHandlerMiddleware() {
  return (err: Error, req: Request, res: Response, _next: NextFunction) => {
    log.error({
      err,
      method: req.method,
      path: req.path,
      userId: req.user?.userId,
      restaurantId: req.user?.restaurantId,
    }, 'Unhandled request error');

    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  };
}
```

### Cron Job Wrapper (`server/cron.ts`)

Creates a span per cron invocation and logs start/end/failure. Works with
both `node-cron` scheduled jobs and one-off async operations.

```typescript
import { trace, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { createLogger } from './logger.js';

const tracer = trace.getTracer('restropulse-cron');

export async function tracedCronJob<T>(
  jobName: string,
  fn: () => Promise<T>,
): Promise<T> {
  const log = createLogger(jobName);

  return tracer.startActiveSpan(jobName, { kind: SpanKind.INTERNAL }, async (span) => {
    log.info('Job started');
    const start = Date.now();

    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      log.info({ durationMs: Date.now() - start }, 'Job completed');
      return result;
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
      span.recordException(error as Error);
      log.error({ err: error, durationMs: Date.now() - start }, 'Job failed');
      throw error;
    } finally {
      span.end();
    }
  });
}
```

### Server-Side Event Tracking (`server/events.ts`)

Wrapper around the Azure Monitor TelemetryClient for custom events and metrics.
These bypass trace sampling and are always collected.

```typescript
import { metrics } from '@opentelemetry/api';
import * as appInsights from 'applicationinsights';

// Business event tracking (always collected, never sampled)
export function trackEvent(name: string, properties?: Record<string, string>): void {
  const client = appInsights.defaultClient;
  if (client) {
    client.trackEvent({ name, properties });
  }
}

// Metric recording (pre-aggregated, never sampled)
const meter = metrics.getMeter('restropulse');

export const serverMetrics = {
  publishDuration: meter.createHistogram('publish.duration_ms', {
    description: 'Time to publish a single post',
    unit: 'ms',
  }),
  publishAttempts: meter.createCounter('publish.attempts', {
    description: 'Total publish attempts',
  }),
  tokenRefreshes: meter.createCounter('token.refreshes', {
    description: 'Token refresh operations',
  }),
  cronJobDuration: meter.createHistogram('cron.job.duration_ms', {
    description: 'Cron job execution time',
    unit: 'ms',
  }),
};
```

---

## Client-Side Implementation

### SDK Initialization (`browser/sdk.ts`)

Initializes Application Insights in `apps/web/index.tsx` before React mounts.

```typescript
import { ApplicationInsights } from '@microsoft/applicationinsights-web';
import { ClickAnalyticsPlugin } from '@microsoft/applicationinsights-clickanalytics-js';
import type { BrowserTelemetryConfig } from '../types.js';

let appInsights: ApplicationInsights | null = null;

export function initBrowserTelemetry(config: BrowserTelemetryConfig): ApplicationInsights | null {
  if (!config.connectionString) {
    return null;  // Telemetry disabled -- app works normally
  }

  const clickPlugin = new ClickAnalyticsPlugin();
  const clickPluginConfig = {
    autoCapture: true,
    dataTags: { useDefaultContentNameOrId: true },
  };

  appInsights = new ApplicationInsights({
    config: {
      connectionString: config.connectionString,
      enableAutoRouteTracking: false,  // We track ViewState manually
      enableCorsCorrelation: true,     // Adds traceparent to fetch calls
      correlationHeaderDomains: [new URL(config.apiBaseUrl).hostname],
      disableCookiesUsage: true,       // Privacy: no tracking cookies
      enableSessionStorageBuffer: true, // Offline buffering
      samplingPercentage: config.samplingPercentage,  // Trace sampling
      // Exceptions and custom events are ALWAYS sent regardless of sampling
      maxBatchSizeInBytes: 100000,     // 100KB batch limit (mobile-friendly)
      maxBatchInterval: 15000,         // Flush every 15s (balance freshness vs battery)
      disablePageUnloadEvents: [],     // Use sendBeacon on unload
      extensions: [clickPlugin],
      extensionConfig: {
        [clickPlugin.identifier]: clickPluginConfig,
      },
    },
  });

  appInsights.loadAppInsights();

  // Set anonymous context -- no user ID, no authenticated ID
  // Only cloud role for service identification
  appInsights.addTelemetryInitializer((envelope) => {
    if (envelope.tags) {
      envelope.tags['ai.cloud.role'] = 'restropulse-web';
    }
    // Strip any accidentally captured PII from URLs
    if (envelope.baseData) {
      if (envelope.baseData.uri) {
        envelope.baseData.uri = stripPIIFromUrl(envelope.baseData.uri);
      }
      if (envelope.baseData.refUri) {
        envelope.baseData.refUri = stripPIIFromUrl(envelope.baseData.refUri);
      }
    }
    return true;
  });

  return appInsights;
}

function stripPIIFromUrl(url: string): string {
  try {
    const parsed = new URL(url, window.location.origin);
    // Remove query params that might contain PII
    ['phone', 'email', 'token', 'code', 'state', 'otp'].forEach(param => {
      if (parsed.searchParams.has(param)) {
        parsed.searchParams.set(param, '[REDACTED]');
      }
    });
    return parsed.toString();
  } catch {
    return url;
  }
}

export function getAppInsights(): ApplicationInsights | null {
  return appInsights;
}
```

### React ErrorBoundary Enhancement (`browser/error-boundary.ts`)

Extends the existing `ErrorBoundary` component to report crashes to App Insights.

```typescript
import { getAppInsights } from './sdk.js';

// Called from ErrorBoundary.componentDidCatch
export function reportError(error: Error, errorInfo: { componentStack?: string }): void {
  const ai = getAppInsights();
  if (ai) {
    ai.trackException({
      exception: error,
      properties: {
        componentStack: errorInfo.componentStack || '',
        viewState: getCurrentViewState(),  // Which view was active
        online: String(navigator.onLine),
        screenWidth: String(window.screen.width),
      },
      severityLevel: 3,  // Error
    });
    ai.flush();  // Immediately flush crash data
  }
}

function getCurrentViewState(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get('view') || 'unknown';
}
```

### Client Event Tracking (`browser/events.ts`)

Thin helpers that standardize event names and properties across the frontend.

```typescript
import { getAppInsights } from './sdk.js';

// --- Page/View Tracking ---

export function trackPageView(viewState: string): void {
  const ai = getAppInsights();
  if (ai) {
    ai.trackPageView({ name: viewState });
  }
}

// --- Business Events (never sampled) ---

export function trackEvent(name: string, properties?: Record<string, string>): void {
  const ai = getAppInsights();
  if (ai) {
    ai.trackEvent({ name, properties });
  }
}

// --- Performance Metrics ---

export function trackMetric(name: string, value: number, properties?: Record<string, string>): void {
  const ai = getAppInsights();
  if (ai) {
    ai.trackMetric({ name, average: value }, properties);
  }
}

// --- Predefined Event Helpers ---

export const browserEvents = {
  login(method: 'firebase' | 'fallback') {
    trackEvent('auth.login', { method });
  },
  onboardingStep(step: number, completed: boolean) {
    trackEvent('onboarding.step', { step: String(step), completed: String(completed) });
  },
  postCreated(postType: string) {
    trackEvent('post.created', { postType });
  },
  instagramConnected() {
    trackEvent('instagram.connected');
  },
  subscriptionStarted(plan: string, cycle: string) {
    trackEvent('subscription.started', { plan, cycle });
  },
  paymentCompleted(type: 'subscription' | 'credit_pack', amount: string) {
    trackEvent('payment.completed', { type, amount });
  },
  networkError(path: string, statusCode: string) {
    trackEvent('network.error', { path, statusCode });
  },
};
```

### Integration into `apps/web/index.tsx`

```typescript
import './index.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { initBrowserTelemetry } from '@restropulse/telemetry/browser';
import App from './App';

// Initialize telemetry before React mounts
initBrowserTelemetry({
  connectionString: import.meta.env.VITE_APPINSIGHTS_CONNECTION_STRING || '',
  apiBaseUrl: import.meta.env.VITE_API_URL || 'http://localhost:3001/api',
  samplingPercentage: Number(import.meta.env.VITE_TELEMETRY_SAMPLE_RATE) || 100,
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

### Integration into `apps/web/components/ErrorBoundary.tsx`

```typescript
// In componentDidCatch:
public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    reportError(error, { componentStack: errorInfo.componentStack || '' });
}
```

### Integration into `apps/web/App.tsx`

```typescript
// Track view transitions in navigateTo:
import { trackPageView, browserEvents } from '@restropulse/telemetry/browser';

const navigateTo = (view: ViewState) => {
    setCurrentView(view);
    trackPageView(view);
    window.history.pushState({ view }, '', `?view=${view.toLowerCase()}`);
};

// Track login success:
const onLoginSuccess = async (response: { ... }) => {
    browserEvents.login('firebase');  // or 'fallback'
    // ... rest of login flow
};
```

### Mobile PWA Considerations

The Application Insights JS SDK handles the following mobile-first concerns
out of the box:

| Concern | How App Insights Handles It |
|---------|---------------------------|
| **Offline buffering** | `enableSessionStorageBuffer: true` -- queues events in sessionStorage when offline, flushes on reconnect |
| **Page unload** | Uses `sendBeacon()` API to flush remaining events when user closes tab/app |
| **Battery awareness** | `maxBatchInterval: 15000` (15s) reduces network calls vs. real-time flush |
| **Bandwidth** | `maxBatchSizeInBytes: 100000` (100KB) caps payload size per batch |
| **Session management** | Auto-generates anonymous session ID, stored in sessionStorage (dies with tab) |
| **Retry on failure** | Built-in exponential backoff with jitter for failed sends |
| **No cookies** | `disableCookiesUsage: true` -- respects privacy, uses sessionStorage only |

No custom code needed for any of these.

---

## Privacy Layer

### `privacy.ts` (Isomorphic -- works in browser and Node.js)

```typescript
const PHONE_PATTERN = /(\+?\d{1,4})\d{4,}(\d{2})/g;
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const TOKEN_PATTERN = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
const BEARER_PATTERN = /Bearer\s+\S+/gi;

// Fields that must never appear in logs
const SENSITIVE_FIELDS = new Set([
  'phone', 'email', 'address', 'accessToken', 'refreshToken',
  'password', 'otp', 'secret', 'encryptionKey', 'firebaseUid',
  'lat', 'lng', 'mapUrl',
]);

export function maskPhone(phone: string): string {
  if (phone.length < 6) return '***';
  return phone.slice(0, -4).replace(/\d/g, '*') + phone.slice(-2);
  // +91******42
}

export function sanitize(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_FIELDS.has(key.toLowerCase())) {
      result[key] = '[REDACTED]';
      continue;
    }

    if (typeof value === 'string') {
      result[key] = value
        .replace(PHONE_PATTERN, '$1****$2')
        .replace(EMAIL_PATTERN, '[EMAIL]')
        .replace(TOKEN_PATTERN, '[TOKEN]')
        .replace(BEARER_PATTERN, 'Bearer [REDACTED]');
    } else if (typeof value === 'object' && value !== null && !(value instanceof Error)) {
      result[key] = sanitize(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  return result;
}
```

### Critical Fix: OTP Logging

**File**: `apps/api/src/routes/auth.ts:120`
**Current**: `console.log(\`[OTP] ${phone}: ${otp}\`);`
**After**: `log.debug({ phoneHash: hashForCorrelation(phone) }, 'OTP generated');`

The `hashForCorrelation` function produces a consistent one-way hash for
debugging (can correlate multiple OTP attempts for the same number) without
exposing the actual phone number.

### What Is Safe to Log

| Field | Safe? | Why |
|-------|-------|-----|
| `userId` | Yes | Internal opaque ID, not PII by itself |
| `restaurantId` | Yes | Internal opaque ID |
| `postId` | Yes | Content ID |
| `postType` (IMAGE, REEL, etc.) | Yes | Enum value |
| `platform` (INSTAGRAM, FACEBOOK) | Yes | Enum value |
| `statusCode` (HTTP) | Yes | Numeric |
| `route` (/api/posts) | Yes | API path |
| `phone` | NEVER | PII -- always redact |
| `email` | NEVER | PII -- always redact |
| `name` (user/restaurant) | NEVER | PII -- always redact |
| `address`, `lat`, `lng` | NEVER | PII -- location data |
| `accessToken` | NEVER | Security credential |
| `otp` | NEVER | Security credential |
| `firebaseUid` | NEVER | Linkable to identity |

---

## Cross-Component Correlation

### Synchronous Flow (Browser -> API)

The Application Insights JS SDK automatically adds the W3C `traceparent`
header to fetch requests (when `enableCorsCorrelation: true` and the target
domain is in `correlationHeaderDomains`). The Azure Monitor OTel distro on
the API server automatically reads this header and creates a child span.

No custom code needed. Works out of the box.

### Asynchronous Flow (API -> Worker)

When the API creates or updates a document that a worker will later process
(e.g., scheduling a post), the current `traceId` is stored on the document:

```typescript
// In API route handler (e.g., POST /api/posts/:id/publish):
import { trace, context } from '@opentelemetry/api';

const span = trace.getSpan(context.active());
const traceId = span?.spanContext().traceId;

await updatePost(postId, {
  status: 'SCHEDULED',
  _telemetry: { traceId, scheduledBy: req.user?.userId },
});
```

When the publisher worker picks up the post:

```typescript
// In publishing-cron.ts:
const post = await findPostById(postId);

tracer.startActiveSpan('publish-post', {
  kind: SpanKind.INTERNAL,
  links: post._telemetry?.traceId
    ? [{ context: { traceId: post._telemetry.traceId, spanId: '0000000000000000', traceFlags: 1 } }]
    : [],
}, async (span) => {
  // ... publish logic
});
```

Azure Monitor's "End-to-end transaction" view follows these links, showing:
`Browser click -> API request -> Worker job -> Meta API call`

### Session Correlation

The browser session ID is sent via `X-Session-Id` header (added by the fetch
wrapper in `api.ts`). The API logs this as a custom dimension. This allows
querying: "Show me all API requests from the session where this crash happened."

```typescript
// In apps/web/api.ts fetchAPI function:
headers: {
  'Authorization': `Bearer ${token}`,
  'X-Session-Id': sessionStorage.getItem('ai_session') || '',
}
```

---

## Dashboard Strategy

All dashboards use Azure Workbooks querying the Log Analytics workspace via KQL.

### Dashboard 1: Usage

Purpose: Understand product adoption, feature usage, user journeys.

| Widget | KQL Source Table | Signal |
|--------|-----------------|--------|
| Daily active sessions | `pageViews | summarize dcount(session_Id) by bin(timestamp, 1d)` | Page views |
| Registered users (cumulative) | `customEvents | where name == 'auth.login' | summarize dcount(session_Id) by bin(timestamp, 1d)` | Custom event |
| Onboarding funnel | `customEvents | where name == 'onboarding.step' | summarize dcount(session_Id) by tostring(customDimensions.step)` | Custom event |
| Feature usage breakdown | `pageViews | summarize count() by name` | Page views |
| Posts created by type | `customEvents | where name == 'post.created' | summarize count() by tostring(customDimensions.postType)` | Custom event |
| Posts published by platform | `customEvents | where name == 'post.published' | summarize count() by tostring(customDimensions.platform)` | Custom event |
| Instagram connections | `customEvents | where name == 'instagram.connected' | summarize count() by bin(timestamp, 1d)` | Custom event |
| Subscription activations | `customEvents | where name == 'subscription.activated' | summarize count() by tostring(customDimensions.plan)` | Custom event |
| Payment completions | `customEvents | where name == 'payment.completed' | summarize count() by tostring(customDimensions.type)` | Custom event |

All of these use `customEvents` or `pageViews` which are **never sampled**.
Counts are exact.

### Dashboard 2: Reliability, Performance, and Failures

Purpose: Understand system health, latency, error rates, client-side crashes.

| Widget | KQL Source | Signal |
|--------|-----------|--------|
| API error rate (5xx) | `requests | summarize countif(success == false) / count() by bin(timestamp, 5m)` | Auto-collected |
| API latency P50/P95/P99 | `requests | summarize percentiles(duration, 50, 95, 99) by name` | Auto-collected |
| Client crash count | `exceptions | where client_Type == 'Browser' | summarize count() by bin(timestamp, 1h)` | Always collected |
| Top crash reasons | `exceptions | where client_Type == 'Browser' | summarize count() by problemId | top 10 by count_` | Always collected |
| MongoDB slow queries | `dependencies | where type == 'mongodb' and duration > 500 | project name, duration, data` | Sampled (extrapolated) |
| Meta API error rate | `dependencies | where target contains 'graph.facebook.com' | summarize countif(success == false) / count()` | Sampled |
| Publishing success rate | `customEvents | where name == 'post.published' or name == 'post.publish_failed' | summarize ...` | Always collected |
| Cron job duration | `customMetrics | where name == 'cron.job.duration_ms' | summarize avg(value) by customDimensions.job_name` | Pre-aggregated |
| Core Web Vitals (LCP/CLS/INP) | `customMetrics | where name in ('lcp', 'cls', 'inp') | summarize percentile(value, 75)` | Always collected |
| Razorpay webhook latency | `requests | where name contains 'webhook' | summarize percentiles(duration, 50, 95)` | Auto-collected |

### Dashboard 3: AI Cost

Purpose: Track AI API usage and costs when content generation is integrated.

| Widget | KQL Source | Signal |
|--------|-----------|--------|
| Daily AI spend | `customMetrics | where name == 'ai.cost.usd' | summarize sum(value) by bin(timestamp, 1d)` | Always collected |
| Token usage by model | `customMetrics | where name == 'ai.tokens.total' | summarize sum(value) by customDimensions.model` | Always collected |
| AI request latency | `customMetrics | where name == 'ai.request.duration_ms' | summarize avg(value), p95=percentile(value, 95)` | Always collected |
| AI error rate | `customEvents | where name == 'ai.request.error' | summarize count() by customDimensions.error_type` | Always collected |
| Cost per post type | `customMetrics | where name == 'ai.cost.usd' | summarize sum(value) by customDimensions.postType` | Always collected |

These widgets show "No data" until AI is integrated. The schema is ready.

---

## AI Usage Tracking

### `server/ai-tracker.ts`

A tracking interface ready for when content generation integrates an AI API
(OpenAI, Claude, etc.). Currently a no-op that defines the contract.

```typescript
import { metrics } from '@opentelemetry/api';
import { trackEvent } from './events.js';

const meter = metrics.getMeter('restropulse-ai');

const aiMetrics = {
  requestDuration: meter.createHistogram('ai.request.duration_ms', { unit: 'ms' }),
  tokensInput: meter.createCounter('ai.tokens.input'),
  tokensOutput: meter.createCounter('ai.tokens.output'),
  costUsd: meter.createCounter('ai.cost.usd'),
};

export interface AIUsage {
  model: string;          // e.g., 'gpt-4o', 'claude-sonnet-4-5'
  operation: string;      // e.g., 'generate-caption', 'generate-strategy'
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
  postType?: string;
  restaurantId?: string;
}

export function trackAIUsage(usage: AIUsage): void {
  const labels = { model: usage.model, operation: usage.operation };

  aiMetrics.requestDuration.record(usage.durationMs, labels);
  aiMetrics.tokensInput.add(usage.inputTokens, labels);
  aiMetrics.tokensOutput.add(usage.outputTokens, labels);
  aiMetrics.costUsd.add(usage.costUsd, labels);

  // Also as a custom event for exact-count queries
  trackEvent('ai.request.completed', {
    model: usage.model,
    operation: usage.operation,
    inputTokens: String(usage.inputTokens),
    outputTokens: String(usage.outputTokens),
    costUsd: String(usage.costUsd),
    durationMs: String(usage.durationMs),
    postType: usage.postType || '',
  });
}
```

**Integration point**: When `apps/content-engine/src/services/content-generator.ts`
is updated to call an AI API, each call wraps with:

```typescript
const start = Date.now();
const result = await aiClient.generate(...);
trackAIUsage({
  model: 'gpt-4o',
  operation: 'generate-caption',
  inputTokens: result.usage.input_tokens,
  outputTokens: result.usage.output_tokens,
  costUsd: calculateCost(result.usage),
  durationMs: Date.now() - start,
  postType: post.type,
  restaurantId: post.restaurantId,
});
```

---

## Cost Optimization

### Azure Monitor Free Tier

Azure Monitor offers **5 GB/month free ingestion** with 31-day retention.
At early scale (pre-launch, beta users), RestroPulse will likely stay within
this free tier.

### Cost Control Levers

| Lever | How | When to Use |
|-------|-----|-------------|
| **Trace sampling** | `samplingRatio: 0.1` in server SDK config | Always in production |
| **Client sampling** | `samplingPercentage: 10` in App Insights config | When client traffic exceeds ~1K sessions/day |
| **Daily cap** | Set in Azure portal (Monitor > Usage and estimated costs) | Safety net, always set |
| **Log level gating** | `LOG_LEVEL=info` in production (pino skips debug serialization entirely) | Always in production |
| **Basic Logs tier** | Move verbose tables to Basic Logs (60% cheaper, 8-day retention) | When ingestion cost exceeds free tier |
| **Workspace transforms** | KQL transforms at ingestion time to drop/aggregate fields | For high-cardinality data |
| **Custom events discipline** | Only fire events on meaningful state changes, not on every render | Design-time decision |

### What NOT to log (cost and noise reduction)

- Health check requests (`GET /health`) -- exclude in middleware
- Static asset requests (`/content/*`) -- exclude in middleware
- Successful DB reads for list endpoints -- auto-instrumented traces handle this
- Every console.log that just says "starting..." -- replace with single startup event

### Estimated Monthly Cost at Scale

| Users/day | Traces (10%) | Events | Metrics | Logs | Total Ingestion | Cost |
|-----------|-------------|--------|---------|------|-----------------|------|
| 10 (beta) | ~50 MB | ~5 MB | ~1 MB | ~20 MB | ~76 MB | Free |
| 100 | ~200 MB | ~50 MB | ~5 MB | ~100 MB | ~355 MB | Free |
| 1,000 | ~1 GB | ~200 MB | ~20 MB | ~500 MB | ~1.7 GB | Free |
| 10,000 | ~5 GB | ~1 GB | ~100 MB | ~2 GB | ~8.1 GB | ~$7/mo |

These estimates assume 10% trace sampling, info-level logs, and disciplined
custom event usage. Azure Monitor's per-GB pricing is ~$2.30/GB beyond free tier.

---

## Environment Variables

### Server-Side (all Node.js apps)

Add to each app's `.env` and `loadAndValidateEnv` schema:

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | No | (none) | Azure Monitor connection. Telemetry disabled if absent. |
| `LOG_LEVEL` | No | `info` (prod), `debug` (dev) | pino log level |
| `OTEL_TRACES_SAMPLER_ARG` | No | `1.0` (dev), `0.1` (prod) | Trace sampling ratio |

### Client-Side (apps/web)

Add to `apps/web/.env`:

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `VITE_APPINSIGHTS_CONNECTION_STRING` | No | (none) | App Insights browser SDK. Telemetry disabled if absent. |
| `VITE_TELEMETRY_SAMPLE_RATE` | No | `100` | Trace sampling percentage (1-100) |

### turbo.json Update

Add `APPLICATIONINSIGHTS_CONNECTION_STRING` to `globalEnv` so Turborepo
passes it to all apps:

```json
"globalEnv": [
  "NODE_ENV",
  "MONGODB_URI",
  "MONGODB_DB_NAME",
  "APPLICATIONINSIGHTS_CONNECTION_STRING"
]
```

---

## Integration Map

Complete file-by-file migration plan. 303 `console.*` calls across 39 files.

### Phase 1: Foundation (packages/telemetry)

Create the entire package. No other files change yet.

| File | Action |
|------|--------|
| `packages/telemetry/package.json` | Create with dependencies |
| `packages/telemetry/tsconfig.json` | Create extending node.json |
| `packages/telemetry/src/types.ts` | Config types, event name constants |
| `packages/telemetry/src/privacy.ts` | PII sanitizer (maskPhone, sanitize, hashForCorrelation) |
| `packages/telemetry/src/index.ts` | Re-export types + privacy |
| `packages/telemetry/src/server/sdk.ts` | Azure Monitor distro init |
| `packages/telemetry/src/server/logger.ts` | pino wrapper |
| `packages/telemetry/src/server/middleware.ts` | Express request log + error handler |
| `packages/telemetry/src/server/cron.ts` | tracedCronJob wrapper |
| `packages/telemetry/src/server/events.ts` | trackEvent, trackMetric, serverMetrics |
| `packages/telemetry/src/server/ai-tracker.ts` | AIUsage interface + trackAIUsage |
| `packages/telemetry/src/server/index.ts` | Server barrel export |
| `packages/telemetry/src/browser/sdk.ts` | App Insights init |
| `packages/telemetry/src/browser/error-boundary.ts` | reportError helper |
| `packages/telemetry/src/browser/events.ts` | trackPageView, trackEvent, browserEvents |
| `packages/telemetry/src/browser/index.ts` | Browser barrel export |

### Phase 2: API Server (apps/api) -- 6 + ~60 console calls

| File | console.* | Action |
|------|-----------|--------|
| `apps/api/src/instrument.ts` | -- | **Create**: initServerTelemetry + initLogger, imported first in server.ts |
| `apps/api/src/server.ts` | 6 | Replace request logger middleware (line 98-101), error handler (128-135), startup banner, shutdown logs |
| `apps/api/src/routes/auth.ts` | 1 | **CRITICAL**: Remove phone+OTP logging (line 120). Replace with hashed phone debug log |
| `apps/api/src/routes/integrations.ts` | 41 | Replace all `[DEBUG]` and `[OAuth]` prefixed logs with `createLogger('integrations')` |
| `apps/api/src/routes/posts.ts` | 13 | Replace with `createLogger('routes/posts')` |
| `apps/api/src/routes/subscriptions.ts` | 3 | Replace with `createLogger('routes/subscriptions')`. Add `trackEvent('payment.*')` for webhooks |
| `apps/api/src/routes/coupons.ts` | 1 | Replace with `createLogger('routes/coupons')` |
| `apps/api/src/services/firebase-admin.ts` | 8 | Replace with `createLogger('firebase-admin')` |
| `apps/api/package.json` | -- | Add `"@restropulse/telemetry": "*"` to dependencies |

### Phase 3: Shared Packages (packages/db, packages/publishing) -- ~110 console calls

| File | console.* | Action |
|------|-----------|--------|
| `packages/db/src/connection.ts` | 2 | Replace with `createLogger('db')` |
| `packages/db/package.json` | -- | Add `"@restropulse/telemetry": "*"` |
| `packages/publishing/src/publishing-cron.ts` | 19 | Replace with `createLogger('publishing-cron')`. Wrap `runPublishingJob` in `tracedCronJob`. Add `trackEvent('post.published')` and `trackEvent('post.publish_failed')` |
| `packages/publishing/src/publishing-service.ts` | 29 | Replace with `createLogger('publishing-service')`. Add `serverMetrics.publishDuration` recording |
| `packages/publishing/src/meta-api.ts` | 44 | Replace with `createLogger('meta-api')`. Structured fields: step, tokenStatus, pageCount |
| `packages/publishing/src/token-refresh-cron.ts` | 14 | Replace with `createLogger('token-refresh')`. Wrap in `tracedCronJob`. Add `trackEvent('token.refreshed')` |
| `packages/publishing/package.json` | -- | Add `"@restropulse/telemetry": "*"` |

### Phase 4: Worker Apps (apps/publisher, apps/content-engine) -- ~16 console calls

| File | console.* | Action |
|------|-----------|--------|
| `apps/publisher/src/instrument.ts` | -- | **Create**: same pattern as API |
| `apps/publisher/src/worker.ts` | 5 | Replace with `createLogger('publisher')` |
| `apps/publisher/package.json` | -- | Add `"@restropulse/telemetry": "*"` |
| `apps/content-engine/src/instrument.ts` | -- | **Create**: same pattern as API |
| `apps/content-engine/src/worker.ts` | 11 | Replace with `createLogger('content-engine')`. Wrap `runContentJob` in `tracedCronJob` |
| `apps/content-engine/src/services/adhoc-processor.ts` | 3 | Replace with `createLogger('adhoc-processor')` |
| `apps/content-engine/src/services/strategy-processor.ts` | 6 | Replace with `createLogger('strategy-processor')` |
| `apps/content-engine/src/services/content-generator.ts` | 2 | Replace with `createLogger('content-generator')`. This is where `trackAIUsage` will be called when AI is integrated |
| `apps/content-engine/src/services/asset-server.ts` | 1 | Replace with `createLogger('asset-server')` |
| `apps/content-engine/package.json` | -- | Add `"@restropulse/telemetry": "*"` |

### Phase 5: Frontend (apps/web) -- ~27 console calls

| File | console.* | Action |
|------|-----------|--------|
| `apps/web/index.tsx` | 0 | Add `initBrowserTelemetry()` call before React mount |
| `apps/web/App.tsx` | 3 | Add `trackPageView` in `navigateTo`. Add `browserEvents.login` in login handlers. Replace console.error |
| `apps/web/firebase.ts` | 6 | Replace with conditional debug logging (only in dev, via `console.debug` gated by env flag) |
| `apps/web/components/ErrorBoundary.tsx` | 1 | Add `reportError()` call in `componentDidCatch` |
| `apps/web/components/Login.tsx` | 5 | Replace error logging. Add `browserEvents.login` on success |
| `apps/web/components/ContentStudio.tsx` | 5 | Replace error logging. Add `browserEvents.postCreated` |
| `apps/web/components/ProfileSheet.tsx` | 8 | Replace error logging. Add `browserEvents.instagramConnected`, `browserEvents.subscriptionStarted` |
| `apps/web/components/Dashboard.tsx` | 1 | Replace error logging |
| `apps/web/components/Inputs.tsx` | 2 | Replace error logging |
| `apps/web/components/Strategy.tsx` | 1 | Replace error logging |
| `apps/web/components/AdhocPostModal.tsx` | 1 | Replace error logging |
| `apps/web/components/InstagramCallback.tsx` | 1 | Replace error logging |
| `apps/web/api.ts` | 0 | Add `X-Session-Id` header to fetchAPI. Add `browserEvents.networkError` on fetch failure |
| `apps/web/package.json` | -- | Add `"@restropulse/telemetry": "*"` |

### Phase 6: Documentation + Config

| File | Action |
|------|--------|
| `docs/INFRASTRUCTURE.md` | Add telemetry env vars for all apps |
| `docs/ARCHITECTURE.md` | Add telemetry layer to system diagram and package list |
| `turbo.json` | Add `APPLICATIONINSIGHTS_CONNECTION_STRING` to globalEnv |
| `.github/copilot-instructions.md` | Add `packages/telemetry` to monorepo layout, add logging conventions |
| `CLAUDE.md` | Update package list |

### Phase 7: Skip (db-cli)

`apps/db-cli` has 32 console calls across 5 files. These are CLI output
(progress bars via `ora`, colored output via `chalk`). CLI tools should NOT
send telemetry. Leave these as-is.

---

## Test Impact

### Backend Tests (`apps/api/tests/setup.ts`)

Current test setup mocks `console.error` and `console.warn` with `vi.fn()`.
After migration to pino, tests need updated mocking:

```typescript
// In tests/setup.ts, add:
vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }),
  initServerTelemetry: vi.fn(),
  shutdownServerTelemetry: vi.fn(),
  trackEvent: vi.fn(),
  serverMetrics: {
    publishDuration: { record: vi.fn() },
    publishAttempts: { add: vi.fn() },
    tokenRefreshes: { add: vi.fn() },
    cronJobDuration: { record: vi.fn() },
  },
  requestLoggingMiddleware: () => (_req, _res, next) => next(),
  errorHandlerMiddleware: () => (err, _req, res, _next) => {
    res.status(500).json({ success: false, error: 'Internal server error' });
  },
  tracedCronJob: async (_name, fn) => fn(),
}));
```

### Frontend Tests (`apps/web/tests/setup.ts`)

```typescript
// Mock browser telemetry
vi.mock('@restropulse/telemetry/browser', () => ({
  initBrowserTelemetry: vi.fn(),
  getAppInsights: vi.fn().mockReturnValue(null),
  reportError: vi.fn(),
  trackPageView: vi.fn(),
  trackEvent: vi.fn(),
  trackMetric: vi.fn(),
  browserEvents: {
    login: vi.fn(),
    onboardingStep: vi.fn(),
    postCreated: vi.fn(),
    instagramConnected: vi.fn(),
    subscriptionStarted: vi.fn(),
    paymentCompleted: vi.fn(),
    networkError: vi.fn(),
  },
}));
```

### Test Logger

For tests that need to assert on log output, export a test utility:

```typescript
// From @restropulse/telemetry/server
export function createTestLogger(): pino.Logger {
  return pino({ level: 'silent' });
}
```

---

## Implementation Phases

| Phase | Scope | Files Changed | Estimated Effort |
|-------|-------|---------------|------------------|
| **1** | Create `packages/telemetry` (all source files, build it) | ~16 new files | Foundation |
| **2** | Integrate into `apps/api` (instrument.ts, server.ts, all routes, firebase-admin) | ~10 files | Bulk migration |
| **3** | Integrate into `packages/db` + `packages/publishing` (110 console calls) | ~6 files | Bulk migration |
| **4** | Integrate into `apps/publisher` + `apps/content-engine` (16 console calls) | ~8 files | Smaller migration |
| **5** | Integrate into `apps/web` (browser SDK, ErrorBoundary, all components) | ~14 files | Client-side setup |
| **6** | Update docs, turbo.json, test setups | ~8 files | Config + docs |

### Phase Dependency Chain

```
Phase 1 (package) --> Phase 2 (api) -------> Phase 3 (shared packages)
                  \-> Phase 5 (frontend)         |
                                                 v
                                          Phase 4 (workers)
                                                 |
                                                 v
                                          Phase 6 (docs + config)
```

Phases 2 and 5 can run in parallel after Phase 1.
Phase 3 depends on Phase 2 (validates the pattern works).
Phase 4 depends on Phase 3 (publishing package must be migrated first).
Phase 6 is last.
