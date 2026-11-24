/**
 * @restropulse/dispatch-worker -- books riders for delivery orders.
 *
 * Drains the delivery_jobs outbox the API fills (dispatch at READY/PREPARING,
 * cancel when an order is cancelled) and polls partners that don't send
 * webhooks. Runs separately from the API so a slow partner never slows an
 * order screen. Same MongoDB as the API.
 *
 *   npm run dev    tsx watch
 *   npm run start  node dist/worker.js
 */

import './instrument.js';

import { connectDB, disconnectDB, mongoDeliveryStore } from '@restropulse/db';
import { buildDeliveryRegistry } from '@restropulse/delivery';
import { createLogger, registerProcessGuards, shutdownServerTelemetry, trackEvent } from '@restropulse/telemetry/server';
import { loadWorkerConfig } from './config.js';
import { createDispatchLoop } from './loop.js';

const logger = createLogger('dispatch-worker');
const config = loadWorkerConfig();
const registry = buildDeliveryRegistry(process.env);

const loop = createDispatchLoop(
  {
    store: mongoDeliveryStore,
    registry,
    log: logger,
    onEvent: (name, props) => trackEvent(name, props),
  },
  config,
);

registerProcessGuards({
  logger,
  onShutdown: async () => {
    await loop.stop();
    await disconnectDB();
    await shutdownServerTelemetry();
  },
});

try {
  await connectDB();
  loop.start();
  logger.info({ partners: registry.list().map((p) => p.id), ...config }, 'Dispatch worker is running');
} catch (err) {
  logger.error({ err }, 'Dispatch worker failed to start');
  process.exit(1);
}
