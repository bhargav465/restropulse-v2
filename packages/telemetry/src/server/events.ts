/**
 * Server-side event and metric tracking.
 *
 * Custom events are sent via the Azure Monitor exporter's log pipeline.
 * They populate the customEvents table in Log Analytics and are NEVER
 * subject to trace sampling -- counts are always exact.
 *
 * Metrics are pre-aggregated via OpenTelemetry and exported to the
 * customMetrics table. They are inherently cheap regardless of volume.
 */

import { metrics, type Attributes } from '@opentelemetry/api';
import { createLogger } from './logger.js';

const log = createLogger('events');
const meter = metrics.getMeter('restropulse');

// -- Custom Event Tracking --

/**
 * Track a business event. Always collected (never sampled).
 * Use EventNames constants for the name parameter.
 */
export function trackEvent(name: string, properties?: Record<string, string>): void {
    // Log the event so it appears in Azure Monitor traces table
    // with a special 'event' field that can be queried
    log.info({ event: name, ...properties }, `Event: ${name}`);
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
    name: 'publishAttempts' | 'tokenRefreshes' | 'contentGenerated' | 'webhooksReceived',
    attributes?: Attributes,
): void {
    const counter = serverMetrics[name];
    if (counter) {
        counter.add(1, attributes);
    }
}
