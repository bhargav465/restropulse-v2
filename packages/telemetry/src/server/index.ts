/**
 * Server-side telemetry exports.
 *
 * Import from '@restropulse/telemetry/server' in Node.js apps.
 */

// SDK lifecycle
export { initServerTelemetry, shutdownServerTelemetry } from './sdk.js';

// Structured logging
export { initLogger, createLogger } from './logger.js';

// Express middleware
export { requestLoggingMiddleware, errorHandlerMiddleware } from './middleware.js';

// Cron job tracing
export { tracedCronJob } from './cron.js';

// Process-level guards
export { registerProcessGuards } from './process-guards.js';
export type { ProcessGuardOptions } from './process-guards.js';

// Event and metric tracking
export { trackEvent, serverMetrics, recordMetric, incrementCounter } from './events.js';

// AI usage tracking
export { trackAIUsage } from './ai-tracker.js';
export type { AIUsage } from './ai-tracker.js';
