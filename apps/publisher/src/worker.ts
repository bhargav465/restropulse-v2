/**
 * @restropulse/publisher - Worker Entry Point
 *
 * Standalone worker process that handles:
 *   1. Publishing scheduled posts to Instagram/Facebook (every 5 minutes)
 *   2. Refreshing expiring Instagram tokens (daily at 2 AM IST)
 *
 * This worker runs independently of the API server.
 * It connects to the same MongoDB database and reads/writes post statuses.
 *
 * Usage:
 *   npm run dev   -- development with hot-reload (tsx watch)
 *   npm run start -- production (node dist/worker.js)
 */

import './instrument.js';

import path from 'node:path';
import { config as dotenvConfig } from 'dotenv';
import { loadAndValidateEnv, z } from '@restropulse/shared';
import { connectDB, disconnectDB } from '@restropulse/db';
import { startPublishingCron, startTokenRefreshCron } from '@restropulse/publishing';
import { createLogger, shutdownServerTelemetry, registerProcessGuards } from '@restropulse/telemetry/server';
import { createSecretsProvider, hydrateEnvFromProvider, PUBLISHER_SECRET_KEYS } from '@restropulse/secrets';

const logger = createLogger('publisher');

dotenvConfig({ path: path.resolve(process.cwd(), '.env'), override: false });

if (process.env.SECRETS_BACKEND) {
  await hydrateEnvFromProvider(
    createSecretsProvider(process.env.SECRETS_BACKEND),
    PUBLISHER_SECRET_KEYS,
  );
}

loadAndValidateEnv({
  serviceName: 'publisher',
  envPath: path.resolve(process.cwd(), '.env'),
  schema: z.object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    MONGODB_URI: z.string().min(1),
    MONGODB_DB_NAME: z.string().min(1).default('restropulse'),
    INSTAGRAM_APP_ID: z.string().min(1),
    INSTAGRAM_APP_SECRET: z.string().min(1),
    ENCRYPTION_KEY: z.string().regex(/^[A-Fa-f0-9]{64}$/),
    INSTAGRAM_REDIRECT_URI: z.string().url().optional(),
    ASSET_SERVER_BASE_URL: z.string().url().optional(),
    CRON_PUBLISHER: z.string().default('*/5 * * * *'),
    SECRETS_BACKEND: z.enum(['env', 'azure-kv']).default('env'),
    AZURE_KEY_VAULT_URL: z.string().url().optional(),
    AZURE_KEY_VAULT_KEY_PREFIX: z.string().optional(),
  }).passthrough(),
});

const startWorker = async () => {
  try {
    logger.info({ environment: process.env.NODE_ENV || 'development' }, 'RestroPulse Publisher Worker starting');

    await connectDB();

    // Start cron jobs
    startPublishingCron();
    startTokenRefreshCron();

    logger.info('Publisher worker is running -- Publishing cron: every 5 minutes, Token refresh cron: daily at 2:00 AM IST');
  } catch (error) {
    logger.error({ err: error }, 'Failed to start worker');
    process.exit(1);
  }
};

registerProcessGuards({
  logger,
  onShutdown: async () => {
    await disconnectDB();
    await shutdownServerTelemetry();
  },
});

startWorker();
