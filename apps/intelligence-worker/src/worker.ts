/**
 * @restropulse/intelligence-worker - Worker Entry Point
 *
 * Standalone worker that runs the weekly Restaurant Intelligence refresh:
 * re-scan active restaurants, compute trend deltas + competitor alerts, prune
 * report history to the last 12, and emit alert events into the existing
 * `events` collection.
 *
 * Runs independently of the API server; connects to the same MongoDB.
 * Mirrors apps/publisher/src/worker.ts.
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
import { createLogger, shutdownServerTelemetry } from '@restropulse/telemetry/server';
import { createSecretsProvider, hydrateEnvFromProvider, INTELLIGENCE_WORKER_SECRET_KEYS } from '@restropulse/secrets';
import { startIntelligenceRefreshCron } from './refresh.js';
import { startDailySnapshotCron } from './daily-cron.js';
import { runBackfill } from './backfill.js';

const logger = createLogger('intelligence-worker');

dotenvConfig({ path: path.resolve(process.cwd(), '.env'), override: false });

if (process.env.SECRETS_BACKEND) {
    await hydrateEnvFromProvider(
        createSecretsProvider(process.env.SECRETS_BACKEND),
        INTELLIGENCE_WORKER_SECRET_KEYS,
    );
}

loadAndValidateEnv({
    serviceName: 'intelligence-worker',
    envPath: path.resolve(process.cwd(), '.env'),
    schema: z
        .object({
            NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
            MONGODB_URI: z.string().min(1),
            MONGODB_DB_NAME: z.string().min(1).default('restropulse'),
            CRON_INTELLIGENCE: z.string().default('0 3 * * 1'),
            // Daily snapshot loop (Brief 08): schedule + kill switch.
            CRON_INTELLIGENCE_DAILY: z.string().default('0 2 * * *'),
            INTELLIGENCE_DAILY_ENABLED: z.string().optional(),
            // Server-side only; needed once the in-process re-scan seam is wired
            // (see src/rescan.ts). The default enqueue seam does not use them.
            GOOGLE_MAPS_API_KEY: z.string().optional(),
            ANTHROPIC_API_KEY: z.string().optional(),
            SECRETS_BACKEND: z.enum(['env', 'azure-kv']).default('env'),
            AZURE_KEY_VAULT_URL: z.string().url().optional(),
            AZURE_KEY_VAULT_KEY_PREFIX: z.string().optional(),
        })
        .passthrough(),
});

const startWorker = async (): Promise<void> => {
    try {
        logger.info({ environment: process.env.NODE_ENV || 'development' }, 'RestroPulse Intelligence Worker starting');

        await connectDB();
        startIntelligenceRefreshCron();
        startDailySnapshotCron();

        // Backfill on boot: fill any missing days in the last 7 (Brief 08).
        // Best-effort — never blocks the crons from being scheduled.
        runBackfill().catch((error) => logger.error({ err: error }, 'Backfill on boot failed'));

        logger.info('Intelligence worker is running -- weekly + daily crons scheduled');
    } catch (error) {
        logger.error({ err: error }, 'Failed to start worker');
        process.exit(1);
    }
};

// Graceful shutdown
process.on('SIGINT', async () => {
    logger.info('Shutting down gracefully...');
    await disconnectDB();
    await shutdownServerTelemetry();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    logger.info('Shutting down gracefully...');
    await disconnectDB();
    await shutdownServerTelemetry();
    process.exit(0);
});

startWorker();
