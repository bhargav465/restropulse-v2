/**
 * Application Insights browser SDK initialization.
 *
 * Handles:
 *   - Crash/exception tracking (window.onerror, unhandledrejection)
 *   - Page view tracking (manual via trackPageView)
 *   - Fetch dependency tracking with W3C traceparent correlation
 *   - Anonymous session management (sessionStorage, no cookies)
 *   - Offline buffering with sessionStorage
 *   - sendBeacon on page unload
 *   - Click analytics and Core Web Vitals
 *
 * Privacy:
 *   - disableCookiesUsage: true (no tracking cookies)
 *   - PII stripped from URLs via telemetry initializer
 *   - No user ID or authenticated ID set
 */

import { ApplicationInsights } from '@microsoft/applicationinsights-web';
import { ClickAnalyticsPlugin } from '@microsoft/applicationinsights-clickanalytics-js';
import { stripPIIFromUrl } from '../privacy.js';
import type { BrowserTelemetryConfig } from '../types.js';

let appInsights: ApplicationInsights | null = null;

export function initBrowserTelemetry(config: BrowserTelemetryConfig): ApplicationInsights | null {
    if (!config.connectionString) {
        return null;
    }

    const clickPlugin = new ClickAnalyticsPlugin();
    const clickPluginConfig = {
        autoCapture: true,
        dataTags: { useDefaultContentNameOrId: true },
    };

    appInsights = new ApplicationInsights({
        config: {
            connectionString: config.connectionString,

            // We track ViewState transitions manually, not URL changes
            enableAutoRouteTracking: false,

            // Correlation: adds traceparent header to fetch calls to our API
            enableCorsCorrelation: true,
            correlationHeaderDomains: [extractHostname(config.apiBaseUrl)],

            // Privacy: no tracking cookies, use sessionStorage only
            disableCookiesUsage: true,
            enableSessionStorageBuffer: true,

            // Sampling: applies to traces/dependencies only.
            // Exceptions and custom events are always sent.
            samplingPercentage: config.samplingPercentage,

            // Mobile-friendly batching
            maxBatchSizeInBytes: 100000,
            maxBatchInterval: 15000,

            // Plugins
            extensions: [clickPlugin],
            extensionConfig: {
                [clickPlugin.identifier]: clickPluginConfig,
            },
        },
    });

    appInsights.loadAppInsights();

    // Telemetry initializer: set cloud role and strip PII from URLs
    appInsights.addTelemetryInitializer((envelope) => {
        if (envelope.tags) {
            envelope.tags['ai.cloud.role'] = 'restropulse-web';
        }

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

export function getAppInsights(): ApplicationInsights | null {
    return appInsights;
}

function extractHostname(url: string): string {
    try {
        return new URL(url).hostname;
    } catch {
        return 'localhost';
    }
}
