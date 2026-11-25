/**
 * The dispatcher's job loop, run by apps/dispatch-worker. The API only
 * enqueues jobs (delivery_jobs outbox); partners are never called inline.
 *
 *   dispatch  quote, rank, book (falls back to own riders), save the shipment
 *   cancel    cancel the live shipment with its partner (before pickup only)
 *
 * Polling: partners without webhooks (the mock today) are asked for their
 * latest status on each pass.
 */

import type { DeliveryJob, DeliveryStore, RestaurantDeliverySettings } from '@restropulse/shared';
import { canTransitionShipment, isTerminalShipment, resolveDeliverySettings } from '@restropulse/shared';
import { dispatchOrder, buildQuoteRequest, DispatchNotPossibleError } from './dispatch.js';
import { applyShipmentEvents, syncOrderWithShipment } from './events.js';
import { DeliveryProviderError } from './provider.js';
import type { DeliveryRegistry } from './registry.js';

export interface WorkerLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface WorkerDeps {
  store: DeliveryStore;
  registry: DeliveryRegistry;
  now?: () => Date;
  log?: WorkerLogger;
  /** Give up after this many tries. Default 6. */
  maxAttempts?: number;
  /** How long a claimed job stays ours before another worker may take it. Default 2 min. */
  leaseMs?: number;
  /** Called with every outcome worth counting (telemetry). */
  onEvent?: (name: string, props: Record<string, string>) => void;
}

const noop = () => undefined;
const silent: WorkerLogger = { info: noop, warn: noop, error: noop };

/** Retry delay after `attempts` failures: 30s, 1m, 2m ... capped at 15m. */
export function backoffMs(attempts: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 15 * 60_000);
}

/** Thrown inside a job to skip retries (the job can never succeed). */
class PermanentJobError extends Error {}

async function runDispatch(job: DeliveryJob, deps: WorkerDeps): Promise<string> {
  const { store, registry } = deps;
  const now = deps.now ?? (() => new Date());
  const order = await store.findOrder(job.restaurantId, job.orderId);
  if (!order) return 'order_missing';
  if (order.orderType !== 'delivery' || ['CANCELLED', 'COMPLETED'].includes(order.status)) return 'not_needed';
  const existing = await store.findShipmentForOrder(order.restaurantId, order.id);
  if (existing && !isTerminalShipment(existing.status)) return 'already_booked';
  const restaurant = await store.findRestaurant(order.restaurantId);
  if (!restaurant) return 'restaurant_missing';
  const req = buildQuoteRequest(order, restaurant);
  if (!req) throw new PermanentJobError('The order has no delivery address.');
  const settings: RestaurantDeliverySettings = resolveDeliverySettings(restaurant.deliverySettings);

  let outcome;
  try {
    outcome = await dispatchOrder(req, settings, registry);
  } catch (err) {
    if (err instanceof DispatchNotPossibleError) throw new PermanentJobError(err.message);
    throw err;
  }
  const failed = outcome.attempts.filter((a) => !a.ok).map((a) => `${a.provider}: ${a.error}`).join('; ');
  const at = now().toISOString();
  const fee = outcome.booked.fee ?? outcome.quote.fee;
  const etaMinutes = outcome.booked.etaMinutes ?? outcome.quote.etaMinutes;
  const shipment = await store.insertShipment({
    restaurantId: order.restaurantId,
    orderId: order.id,
    provider: outcome.provider,
    providerShipmentId: outcome.booked.providerShipmentId,
    status: outcome.booked.status,
    ...(outcome.booked.carrier ? { carrier: outcome.booked.carrier } : {}),
    ...(fee ? { fee } : {}),
    ...(etaMinutes !== undefined ? { etaMinutes } : {}),
    ...(outcome.booked.trackingUrl ? { trackingUrl: outcome.booked.trackingUrl } : {}),
    ...(outcome.booked.rider ? { rider: outcome.booked.rider } : {}),
    events: [{
      status: outcome.booked.status,
      at,
      source: 'dispatcher',
      note: outcome.fellBackToSelf
        ? `No partner could take it, so it's with your own riders (${failed})`.slice(0, 300)
        : outcome.provider === 'self' ? 'Your own riders' : `Booked with ${outcome.provider}`,
    }],
  });
  await syncOrderWithShipment(store, shipment);
  deps.onEvent?.('delivery_dispatched', {
    restaurantId: order.restaurantId,
    provider: outcome.provider,
    fellBackToSelf: String(outcome.fellBackToSelf),
  });
  return outcome.fellBackToSelf ? 'fell_back_to_self' : 'booked';
}

async function runCancel(job: DeliveryJob, deps: WorkerDeps): Promise<string> {
  const { store, registry } = deps;
  const now = deps.now ?? (() => new Date());
  const shipment = await store.findShipmentForOrder(job.restaurantId, job.orderId);
  if (!shipment || isTerminalShipment(shipment.status)) return 'nothing_to_cancel';
  if (!canTransitionShipment(shipment.status, 'CANCELLED')) return 'already_picked_up';
  const provider = registry.get(shipment.provider);
  if (!provider) throw new PermanentJobError(`Provider ${shipment.provider} is not available on this server.`);
  const reason = job.reason ?? 'Cancelled by the restaurant';
  await provider.cancelShipment(shipment.providerShipmentId, reason);
  const saved = await store.updateShipment(shipment.id, shipment.status, {
    status: 'CANCELLED',
    cancelReason: reason,
    events: [...shipment.events, { status: 'CANCELLED', at: now().toISOString(), source: 'restaurant', note: reason.slice(0, 200) }],
  });
  if (!saved) throw new Error('Shipment changed while cancelling; trying again.');
  return 'cancelled';
}

export async function runJob(job: DeliveryJob, deps: WorkerDeps): Promise<string> {
  return job.type === 'cancel' ? runCancel(job, deps) : runDispatch(job, deps);
}

export interface PassResult {
  done: number;
  retried: number;
  failed: number;
}

/** Work through due jobs, up to `max` of them. */
export async function processDueJobs(deps: WorkerDeps, max = 20): Promise<PassResult> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? silent;
  const maxAttempts = deps.maxAttempts ?? 6;
  const result: PassResult = { done: 0, retried: 0, failed: 0 };
  for (let i = 0; i < max; i += 1) {
    const job = await deps.store.claimDueJob(now(), deps.leaseMs ?? 120_000);
    if (!job) break;
    try {
      const outcome = await runJob(job, deps);
      await deps.store.completeJob(job.id);
      result.done += 1;
      log.info({ jobId: job.id, type: job.type, orderId: job.orderId, outcome }, 'delivery job done');
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
      const attempts = job.attempts + 1;
      const permanent = err instanceof PermanentJobError || (err instanceof DeliveryProviderError && !err.retryable);
      if (permanent || attempts >= maxAttempts) {
        await deps.store.failJob(job.id, message);
        result.failed += 1;
        log.error({ jobId: job.id, type: job.type, orderId: job.orderId, attempts, err: message }, 'delivery job failed');
        deps.onEvent?.('delivery_job_failed', { restaurantId: job.restaurantId, type: job.type });
      } else {
        await deps.store.retryJob(job.id, new Date(now().getTime() + backoffMs(attempts)), message);
        result.retried += 1;
        log.warn({ jobId: job.id, type: job.type, orderId: job.orderId, attempts, err: message }, 'delivery job will retry');
      }
    }
  }
  return result;
}

/** Ask polled partners for news on their live shipments. Returns how many changed. */
export async function pollLiveShipments(deps: WorkerDeps, limit = 50): Promise<number> {
  const log = deps.log ?? silent;
  const polled = deps.registry.list().filter((p) => p.id !== 'self' && !p.webhooks).map((p) => p.id);
  if (!polled.length) return 0;
  let changed = 0;
  for (const shipment of await deps.store.findLiveShipments(polled, limit)) {
    try {
      const event = await deps.registry.get(shipment.provider)?.track(shipment.providerShipmentId);
      if (!event) continue;
      const r = await applyShipmentEvents(deps.store, shipment, [event], 'provider');
      if (r.applied) changed += 1;
    } catch (err) {
      log.warn({ shipmentId: shipment.id, err: err instanceof Error ? err.message : String(err) }, 'could not track shipment');
    }
  }
  return changed;
}
