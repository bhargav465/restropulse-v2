/**
 * Telemetry bootstrap -- MUST be the first import in server.ts.
 *
 * Loads .env before any other module runs so that packages which capture
 * process.env values as module-level constants (e.g. @restropulse/publishing)
 * see the correct values at initialisation time.
 *
 * Initializes Azure Monitor OpenTelemetry auto-instrumentation
 * (Express, MongoDB, HTTP) and the structured pino logger.
 */

import path from 'path';
import { loadEnvFile } from '@restropulse/shared';
import { initServerTelemetry, initLogger } from '@restropulse/telemetry/server';

// Load .env before any other module body can capture process.env constants.
loadEnvFile(path.resolve(process.cwd(), '.env'));

const environment = process.env.NODE_ENV || 'development';

initServerTelemetry({
    serviceName: 'api',
    environment,
    logLevel: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'info',
    connectionString: process.env.APPLICATIONINSIGHTS_CONNECTION_STRING,
    samplingRatio: environment === 'production' ? 0.1 : 1.0,
});

initLogger({
    serviceName: 'api',
    environment,
    logLevel: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || (environment === 'development' ? 'debug' : 'info'),
});
