/**
 * @restropulse/content-engine - Worker Entry Point
 *
 * Standalone worker process that polls for content generation work:
 *   1. Adhoc post requests (status: PENDING_CONTENT) -- every 2 minutes
 *   2. Approved strategy cycles needing posts -- every 5 minutes
 *   3. Strategy generation requests (status: PENDING_GENERATION) -- every 5 minutes
 *
 * Also starts a local HTTP server to serve placeholder media assets
 * so that generated content URLs resolve correctly for the publishing service.
 *
 * This worker runs independently of the API server and publisher.
 * It connects to the same MongoDB database and reads/writes post and cycle data.
 *
 * Usage:
 *   npm run dev   -- development with hot-reload (tsx watch)
 *   npm run start -- production (node dist/worker.js)
 *
 * First-time setup:
 *   npm run download-assets  -- download placeholder images and videos to assets/
 */

import './instrument.js';

import http from 'node:http';
import path from 'node:path';
import cron from 'node-cron';
import { loadAndValidateEnv, z, ROLLING_WINDOW_HOURS, POST_APPROVAL_BUFFER_HOURS, CYCLE_APPROVAL_BUFFER_HOURS, validateTimingConstraints } from '@restropulse/shared';
import { connectDB, disconnectDB } from '@restropulse/db';
import { createLogger, shutdownServerTelemetry, tracedCronJob } from '@restropulse/telemetry/server';
import { createSecretsProvider, hydrateEnvFromProvider, CONTENT_ENGINE_SECRET_KEYS } from '@restropulse/secrets';
import {
  createAdhocProcessor,
  createStrategyProcessor,
  createRollingWindowProcessor,
  createRevisionProcessor,
  createDeadlineProcessor,
  createCycleSyncProcessor,
  createCurrentAffairsRefreshProcessor,
  createMediaJobPollerProcessor,
  type IProcessor,
} from './services/processors/index.js';
import { startAssetServer } from './services/asset-server.js';
import {
  createContentGenerator,
  getLastAiCurrentAffairsProvider,
  getLastAiMediaJobStore,
  getLastAiMediaGenerator,
  setContentGenerator,
  type ContentGeneratorBackend,
} from './services/content-generator/index.js';
import { runPostResumeOnBoot } from './services/post-resume.js';

const logger = createLogger('content-engine');

if (process.env.SECRETS_BACKEND) {
  await hydrateEnvFromProvider(
    createSecretsProvider(process.env.SECRETS_BACKEND),
    CONTENT_ENGINE_SECRET_KEYS,
  );
}

const env = loadAndValidateEnv({
  serviceName: 'content-engine',
  envPath: path.resolve(process.cwd(), '.env'),
  schema: z.object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    MONGODB_URI: z.string().min(1),
    MONGODB_DB_NAME: z.string().min(1).default('restropulse'),
    ASSET_SERVER_PORT: z.coerce.number().int().positive().default(3002),
    ASSET_SERVER_BASE_URL: z.string().url().optional(),
    // Time window configuration in MINUTES — easier to set small values for testing.
    // Default values mirror the shared constants (converted to mins).
    // node-cron v4 supports 6-field cron (seconds) for the CRON_* vars:
    //   5-field: */2 * * * *   = every 2 minutes  (production)
    //   6-field: */30 * * * * * = every 30 seconds (local testing)
    ROLLING_WINDOW_MINS: z.coerce.number().positive().default(ROLLING_WINDOW_HOURS * 60),
    POST_APPROVAL_BUFFER_MINS: z.coerce.number().positive().default(POST_APPROVAL_BUFFER_HOURS * 60),
    CYCLE_APPROVAL_BUFFER_MINS: z.coerce.number().positive().default(CYCLE_APPROVAL_BUFFER_HOURS * 60),
    // Per-processor cron schedules.
    CRON_PENDING_POSTS: z.string().default('*/2 * * * *'),
    CRON_PENDING_CYCLES: z.string().default('*/2 * * * *'),
    CRON_ROLLING_WINDOW: z.string().default('*/2 * * * *'),
    CRON_REVISIONS: z.string().default('*/2 * * * *'),
    CRON_DEADLINES: z.string().default('*/2 * * * *'),
    CRON_CYCLE_SYNC: z.string().default('*/2 * * * *'),
    ENABLED_PLATFORMS: z.string().default('INSTAGRAM,FACEBOOK'),
    CONTENT_GENERATOR_BACKEND: z.enum(['placeholder', 'ai']).default('placeholder'),
    CURRENT_AFFAIRS_V1_ENABLED: z.string().default('true'),
    CURRENT_AFFAIRS_V2_ENABLED: z.string().default('false'),
    GOOGLE_CALENDAR_API_KEY: z.string().optional(),
    PERPLEXITY_API_KEY: z.string().optional(),
    CRON_CURRENT_AFFAIRS_REFRESH: z.string().default('0 6 * * *'),
    MEDIA_BACKEND: z.enum(['placeholder', 'fal-ai', 'replicate']).default('placeholder'),
    FAL_API_KEY: z.string().optional(),
    REPLICATE_API_TOKEN: z.string().optional(),
    CRON_MEDIA_JOB_POLLER: z.string().default('*/30 * * * * *'),
    SECRETS_BACKEND: z.enum(['env', 'azure-kv']).default('env'),
    AZURE_KEY_VAULT_URL: z.string().url().optional(),
    AZURE_KEY_VAULT_KEY_PREFIX: z.string().optional(),
  }).passthrough(),
});

validateTimingConstraints({
  postApprovalBufferMins: env.POST_APPROVAL_BUFFER_MINS,
  rollingWindowMins: env.ROLLING_WINDOW_MINS,
  cycleApprovalBufferMins: env.CYCLE_APPROVAL_BUFFER_MINS,
});

const ASSET_PORT = env.ASSET_SERVER_PORT;

const rollingWindowConfig = { rollingWindowHours: env.ROLLING_WINDOW_MINS / 60 };
const deadlineConfig = {
  postApprovalBufferHours: env.POST_APPROVAL_BUFFER_MINS / 60,
  cycleApprovalBufferHours: env.CYCLE_APPROVAL_BUFFER_MINS / 60,
};

function registerProcessor(processor: IProcessor): void {
  cron.schedule(processor.cron, async () => {
    try {
      await tracedCronJob(processor.name, () => processor.run());
    } catch (error) {
      logger.error({ err: error, processor: processor.name }, 'Processor job failed');
    }
  }, { timezone: 'Asia/Kolkata' });
}

let assetServer: http.Server | null = null;

const startWorker = async () => {
  try {
    logger.info({ environment: process.env.NODE_ENV || 'development' }, 'RestroPulse Content Engine starting');

    await connectDB();

    // Register the configured content generator backend. Default is 'placeholder';
    // flip CONTENT_GENERATOR_BACKEND=ai to engage the AI generator (see ADR 0001).
    // Tests swap this via setContentGenerator().
    const backend: ContentGeneratorBackend = env.CONTENT_GENERATOR_BACKEND;
    setContentGenerator(await createContentGenerator(backend));
    logger.info({ generator: backend }, 'Content generator registered');

    // Start local asset server for placeholder media
    assetServer = startAssetServer(ASSET_PORT);

    const processors: IProcessor[] = [
      createAdhocProcessor(env.CRON_PENDING_POSTS),
      createStrategyProcessor(env.CRON_PENDING_CYCLES),
      createRollingWindowProcessor(env.CRON_ROLLING_WINDOW, rollingWindowConfig),
      createRevisionProcessor(env.CRON_REVISIONS),
      createDeadlineProcessor(env.CRON_DEADLINES, deadlineConfig),
      createCycleSyncProcessor(env.CRON_CYCLE_SYNC),
    ];

    const aiCurrentAffairs = getLastAiCurrentAffairsProvider();
    if (aiCurrentAffairs && aiCurrentAffairs.name !== 'noop') {
      processors.push(createCurrentAffairsRefreshProcessor(env.CRON_CURRENT_AFFAIRS_REFRESH, aiCurrentAffairs));
      logger.info(
        { provider: aiCurrentAffairs.name, cron: env.CRON_CURRENT_AFFAIRS_REFRESH },
        'current-affairs-refresh processor registered',
      );
    }

    const aiMediaStore = getLastAiMediaJobStore();
    const aiMediaGen = getLastAiMediaGenerator();
    if (aiMediaStore && aiMediaGen) {
      processors.push(createMediaJobPollerProcessor(env.CRON_MEDIA_JOB_POLLER, {
        store: aiMediaStore,
        media: aiMediaGen,
      }));
      logger.info(
        { cron: env.CRON_MEDIA_JOB_POLLER },
        'media-job-poller processor registered',
      );
    }

    if (aiMediaStore && aiMediaGen) {
      // Best-effort -- failures don't block worker boot.
      runPostResumeOnBoot({ store: aiMediaStore, media: aiMediaGen }).catch((err) => {
        logger.error({ err }, 'post-resume scan failed');
      });
    }

    for (const processor of processors) {
      registerProcessor(processor);
    }

    logger.info(
      {
        assetServerUrl: `http://localhost:${ASSET_PORT}`,
        rollingWindowMins: env.ROLLING_WINDOW_MINS,
        postApprovalBufferMins: env.POST_APPROVAL_BUFFER_MINS,
        cycleApprovalBufferMins: env.CYCLE_APPROVAL_BUFFER_MINS,
        schedules: Object.fromEntries(processors.map((p) => [p.name, p.cron])),
      },
      'Content engine is running',
    );

    // Run all processors once immediately in development so local smoke tests
    // do not need to wait for the first cron tick.
    if (process.env.NODE_ENV === 'development') {
      logger.info('Development mode: Running initial check in 5 seconds...');
      setTimeout(async () => {
        for (const processor of processors) {
          await processor.run();
        }
      }, 5000);
    }
  } catch (error) {
    logger.error({ err: error }, 'Failed to start worker');
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down gracefully...');
  assetServer?.close();
  await disconnectDB();
  await shutdownServerTelemetry();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Shutting down gracefully...');
  assetServer?.close();
  await disconnectDB();
  await shutdownServerTelemetry();
  process.exit(0);
});

startWorker();
