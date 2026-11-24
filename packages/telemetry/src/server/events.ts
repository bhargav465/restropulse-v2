/**
 * Server-side event and metric tracking.
 *
 * Custom events are emitted as OpenTelemetry log records carrying the
 * `microsoft.custom_event.name` attribute, which the Azure Monitor exporter
 * maps to the customEvents table (never subject to trace sampling). They are
 * also written to the pino logger (stdout) for local debugging.
 *
 * Before this, trackEvent only logged through pino. The Azure Monitor distro
 * instruments bunyan and winston but not pino, so those events never reached
 * Application Insights and the customEvents-based workbooks had no data.
 *
 * Metrics are pre-aggregated via OpenTelemetry and exported to the
 * customMetrics table. They are inherently cheap regardless of volume.
 */

import { metrics, type Attributes } from '@opentelemetry/api';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { createLogger } from './logger.js';
import { sanitizeEventProperties } from '../privacy.js';

const log = createLogger('events');
const meter = metrics.getMeter('restropulse');
const eventLogger = logs.getLogger('restropulse-events');

/** Attribute the Azure Monitor exporter uses to route a log record to customEvents. */
export const CUSTOM_EVENT_NAME_ATTRIBUTE = 'microsoft.custom_event.name';

// -- Custom Event Tracking --

/**
 * Track a business event. Always collected (never sampled).
 * Use EventNames constants for the name parameter.
 */
export function trackEvent(name: string, properties?: Record<string, string>): void {
    log.info({ event: name, ...properties }, `Event: ${name}`);

    try {
        // No-op until useAzureMonitor() registers a LoggerProvider (i.e. when
        // APPLICATIONINSIGHTS_CONNECTION_STRING is unset, as in dev and tests).
        const attributes = sanitizeEventProperties(properties ?? {});
        eventLogger.emit({
            severityNumber: SeverityNumber.INFO,
            severityText: 'INFO',
            body: name,
            attributes: { ...attributes, [CUSTOM_EVENT_NAME_ATTRIBUTE]: name },
        });
    } catch {
        // Telemetry must never break the caller.
    }
}

// -- Pre-defined Metrics --

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
    contentGenerated: meter.createCounter('content.generated', {
        description: 'Content generation completions',
    }),
    webhooksReceived: meter.createCounter('webhooks.received', {
        description: 'Webhook events received',
    }),
    placesCalls: meter.createCounter('places.calls', {
        description: 'Google Places API calls (Restaurant Intelligence)',
    }),
};

/**
 * Record a metric value with optional attributes.
 */
export function recordMetric(
    name: 'publishDuration' | 'cronJobDuration',
    value: number,
    attributes?: Attributes,
): void {
    const histogram = serverMetrics[name];
    if (histogram) {
        histogram.record(value, attributes);
    }
}

/**
 * Increment a counter metric.
 */
export function incrementCounter(
    name: 'publishAttempts' | 'tokenRefreshes' | 'contentGenerated' | 'webhooksReceived' | 'placesCalls',
    attributes?: Attributes,
): void {
    const counter = serverMetrics[name];
    if (counter) {
        counter.add(1, attributes);
    }
}
