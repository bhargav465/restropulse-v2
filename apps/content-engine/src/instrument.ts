/**
 * Telemetry bootstrap -- MUST be the first import in worker.ts.
 *
 * Loads .env before any other module runs so that packages which capture
 * process.env values as module-level constants see the correct values at
 * initialisation time.
 *
 * Initializes Azure Monitor OpenTelemetry auto-instrumentation
 * (MongoDB, HTTP) and the structured pino logger.
 */

import path from 'path';
import { loadEnvFile } from '@restropulse/shared';
import { initServerTelemetry, initLogger } from '@restropulse/telemetry/server';

// Load .env before any other module body can capture process.env constants.
loadEnvFile(path.resolve(process.cwd(), '.env'));

const environment = process.env.NODE_ENV || 'development';

initServerTelemetry({
    serviceName: 'content-engine',
    environment,
    logLevel: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'info',
    connectionString: process.env.APPLICATIONINSIGHTS_CONNECTION_STRING,
    samplingRatio: environment === 'production' ? 0.1 : 1.0,
});

initLogger({
    serviceName: 'content-engine',
    environment,
    logLevel: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || (environment === 'development' ? 'debug' : 'info'),
});
