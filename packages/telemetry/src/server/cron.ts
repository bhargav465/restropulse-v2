/**
 * Cron job tracing wrapper.
 *
 * Creates an OpenTelemetry span for each cron job invocation,
 * providing visibility into job duration, success/failure, and
 * correlation with downstream operations (DB queries, API calls).
 */

import { trace, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { createLogger } from './logger.js';
import { serverMetrics } from './events.js';

const tracer = trace.getTracer('restropulse-cron');

/**
 * Execute an async function inside a traced span.
 *
 * Usage:
 *   cron.schedule('* /5 * * * *', async () => {
 *     await tracedCronJob('publishing-job', runPublishingJob);
 *   });
 */
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
            const durationMs = Date.now() - start;

            span.setStatus({ code: SpanStatusCode.OK });
            serverMetrics.cronJobDuration.record(durationMs, { job: jobName });
            log.info({ durationMs }, 'Job completed');

            return result;
        } catch (error) {
            const durationMs = Date.now() - start;

            span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
            span.recordException(error as Error);
            serverMetrics.cronJobDuration.record(durationMs, { job: jobName, error: 'true' });
            log.error({ err: error, durationMs }, 'Job failed');

            throw error;
        } finally {
            span.end();
        }
    });
}
