/** Telemetry bootstrap -- must be the first import in worker.ts (loads .env first). */

import path from 'path';
import { loadEnvFile } from '@restropulse/shared';
import { initLogger, initServerTelemetry } from '@restropulse/telemetry/server';

loadEnvFile(path.resolve(process.cwd(), '.env'));

const environment = process.env.NODE_ENV || 'development';
const logLevel = (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'info';

initServerTelemetry({
  serviceName: 'dispatch-worker',
  environment,
  logLevel,
  connectionString: process.env.APPLICATIONINSIGHTS_CONNECTION_STRING,
  samplingRatio: environment === 'production' ? 0.1 : 1.0,
});
initLogger({ serviceName: 'dispatch-worker', environment, logLevel });
