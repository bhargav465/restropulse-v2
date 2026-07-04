/**
 * Structured logger built on pino.
 *
 * Features:
 *   - Automatic OTel trace/span ID injection for log-trace correlation
 *   - Automatic PII sanitization via privacy.ts
 *   - Dev: human-readable output via pino-pretty
 *   - Prod: JSON to stdout (collected by Azure Monitor agent or log pipeline)
 *   - pino-level redaction as defense-in-depth for known sensitive fields
 */

import pino from 'pino';
import { trace, context } from '@opentelemetry/api';
import { sanitize } from '../privacy.js';
import type { TelemetryConfig } from '../types.js';

let rootLogger: pino.Logger | null = null;

export function initLogger(config: Pick<TelemetryConfig, 'serviceName' | 'environment' | 'logLevel'>): void {
    const isDev = config.environment === 'development';

    rootLogger = pino({
        level: config.logLevel || (isDev ? 'debug' : 'info'),
        transport: isDev
            ? { target: 'pino-pretty', options: { colorize: true } }
            : undefined,
        formatters: {
            log(obj: Record<string, unknown>) {
                // Inject active trace context for log-trace correlation
                const span = trace.getSpan(context.active());
                if (span) {
                    const ctx = span.spanContext();
                    obj.traceId = ctx.traceId;
                    obj.spanId = ctx.spanId;
                }
                return sanitize(obj);
            },
        },
        redact: {
            paths: [
                'phone', 'email', 'accessToken', 'password', 'otp',
                '*.phone', '*.email', '*.accessToken', '*.password', '*.otp',
                '*.secret', '*.encryptionKey',
            ],
            censor: '[REDACTED]',
        },
        base: {
            service: config.serviceName,
        },
    });
}

/**
 * Create a child logger for a specific component.
 * Replaces the [ComponentName] prefix pattern used in console.log calls.
 *
 * Usage:
 *   const log = createLogger('publishing-cron');
 *   log.info({ postId }, 'Processing post');
 */
export function createLogger(component: string): pino.Logger {
    if (!rootLogger) {
        // Fallback for tests or if initLogger was not called
        rootLogger = pino({ level: 'silent' });
    }
    return rootLogger.child({ component });
}
