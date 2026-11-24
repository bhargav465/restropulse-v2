/**
 * @restropulse/db - Delivery: shipments, the dispatch outbox and partner
 * webhook receipts (Phase 2, M4, docs/LAUNCH_ARCHITECTURE B4).
 *
 *   shipments                 one per rider booking; an order may have several
 *                             over time (cancelled, then rebooked)
 *   delivery_jobs             outbox the dispatch worker drains; the API only
 *                             enqueues. `openKey` (unique, sparse) collapses
 *                             duplicate jobs while one is still open.
 *   delivery_webhook_events   provider + eventId, unique: redeliveries skip
 *
 * `mongoDeliveryStore` implements the DeliveryStore contract from
 * @restropulse/shared for the dispatcher in @restropulse/delivery.
 */

import { Collection, Db, Document, MongoServerError, WithId } from 'mongodb';
import type {
  DeliveryJob,
  DeliveryJobInsert,
  DeliveryProviderId,
  DeliveryStore,
  Order,
  Restaurant,
  RestaurantDeliverySettings,
  Shipment,
  ShipmentInsert,
  ShipmentPatch,
  ShipmentStatus,
} from '@restropulse/shared';
import { TERMINAL_SHIPMENT_STATUSES } from '@restropulse/shared';
import { getDB, getRestaurantsCollection, toApiFormat, toApiFormatArray, toObjectId } from './connection.js';
import { findOrderById, transitionOrder } from './orders.js';
import { findRestaurantById } from './restaurants.js';

export const SHIPMENTS_COLLECTION = 'shipments';
export const DELIVERY_JOBS_COLLECTION = 'delivery_jobs';
export const DELIVERY_WEBHOOK_EVENTS_COLLECTION = 'delivery_webhook_events';

export const getShipmentsCollection = (): Collection => getDB().collection(SHIPMENTS_COLLECTION);
export const getDeliveryJobsCollection = (): Collection => getDB().collection(DELIVERY_JOBS_COLLECTION);
export const getDeliveryWebhookEventsCollection = (): Collection => getDB().collection(DELIVERY_WEBHOOK_EVENTS_COLLECTION);

export const DELIVERY_INDEXES: Array<{ collection: string; spec: Record<string, 1 | -1>; options?: Record<string, unknown> }> = [
  { collection: SHIPMENTS_COLLECTION, spec: { restaurantId: 1, orderId: 1, createdAt: -1 } },
  { collection: SHIPMENTS_COLLECTION, spec: { provider: 1, providerShipmentId: 1 }, options: { unique: true } },
  { collection: SHIPMENTS_COLLECTION, spec: { provider: 1, status: 1, updatedAt: 1 } },
  { collection: DELIVERY_JOBS_COLLECTION, spec: { status: 1, nextRunAt: 1 } },
  { collection: DELIVERY_JOBS_COLLECTION, spec: { openKey: 1 }, options: { unique: true, sparse: true } },
  { collection: DELIVERY_JOBS_COLLECTION, spec: { restaurantId: 1, orderId: 1, createdAt: -1 } },
  { collection: DELIVERY_WEBHOOK_EVENTS_COLLECTION, spec: { provider: 1, eventId: 1 }, options: { unique: true } },
  // Receipts only matter for redeliveries; keep 30 days.
  { collection: DELIVERY_WEBHOOK_EVENTS_COLLECTION, spec: { receivedAt: 1 }, options: { expireAfterSeconds: 30 * 24 * 3600 } },
];

export async function ensureDeliveryIndexes(db?: Db): Promise<void> {
  const database = db ?? getDB();
  for (const { collection, spec, options } of DELIVERY_INDEXES) {
    try {
      await database.collection(collection).createIndex(spec, options ?? {});
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code !== 85 && code !== 86) throw err;
    }
  }
}

const isDuplicateKey = (err: unknown) => err instanceof MongoServerError && err.code === 11000;

// ----- Restaurant settings -----

export async function updateRestaurantDeliverySettings(
  restaurantId: string,
  settings: RestaurantDeliverySettings,
): Promise<Restaurant | null> {
  const result = await getRestaurantsCollection().findOneAndUpdate(
    { _id: toObjectId(restaurantId) as any },
    { $set: { deliverySettings: settings, updatedAt: new Date() } },
    { returnDocument: 'after' },
  );
  return toApiFormat(result) as Restaurant | null;
}

// ----- Jobs -----

/** Null when an open job with the same dedupeKey already exists. */
export async function enqueueDeliveryJob(input: DeliveryJobInsert): Promise<DeliveryJob | null> {
  const now = new Date();
  const doc = {
    type: input.type,
    restaurantId: input.restaurantId,
    orderId: input.orderId,
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.dedupeKey ? { openKey: input.dedupeKey } : {}),
    status: 'pending',
    attempts: 0,
    nextRunAt: input.runAt ?? now,
    createdAt: now,
    updatedAt: now,
  };
  try {
    const result = await getDeliveryJobsCollection().insertOne(doc);
    return { ...doc, id: result.insertedId.toString() } as unknown as DeliveryJob;
  } catch (err) {
    if (isDuplicateKey(err)) return null;
    throw err;
  }
}

export async function claimDueDeliveryJob(now: Date, leaseMs: number): Promise<DeliveryJob | null> {
  const result = await getDeliveryJobsCollection().findOneAndUpdate(
    {
      $or: [
        { status: 'pending', nextRunAt: { $lte: now } },
        // A worker that died mid-job: its lease ran out.
        { status: 'running', leaseUntil: { $lte: now } },
      ],
    },
    { $set: { status: 'running', leaseUntil: new Date(now.getTime() + leaseMs), updatedAt: now } },
    { sort: { nextRunAt: 1 }, returnDocument: 'after' },
  );
  return toApiFormat(result) as unknown as DeliveryJob | null;
}

async function closeJob(id: string, status: 'done' | 'failed', error?: string): Promise<void> {
  await getDeliveryJobsCollection().updateOne(
    { _id: toObjectId(id) as any },
    {
      $set: { status, updatedAt: new Date(), ...(error ? { lastError: error } : {}) },
      $unset: { openKey: '', leaseUntil: '' },
      ...(status === 'failed' ? { $inc: { attempts: 1 } } : {}),
    },
  );
}

export const completeDeliveryJob = (id: string) => closeJob(id, 'done');
export const failDeliveryJob = (id: string, error: string) => closeJob(id, 'failed', error);

export async function retryDeliveryJob(id: string, nextRunAt: Date, error: string): Promise<void> {
  await getDeliveryJobsCollection().updateOne(
    { _id: toObjectId(id) as any },
    { $set: { status: 'pending', nextRunAt, lastError: error, updatedAt: new Date() }, $inc: { attempts: 1 }, $unset: { leaseUntil: '' } },
  );
}

/** Open (pending or running) jobs for an order, for the dashboard. */
export async function findOpenDeliveryJobs(restaurantId: string, orderId: string): Promise<DeliveryJob[]> {
  const docs = await getDeliveryJobsCollection()
    .find({ restaurantId, orderId, status: { $in: ['pending', 'running'] } })
    .sort({ createdAt: -1 })
    .toArray();
  return toApiFormatArray(docs) as unknown as DeliveryJob[];
}

/** The newest job for an order (shows a failed dispatch in the dashboard). */
export async function findLatestDeliveryJob(restaurantId: string, orderId: string): Promise<DeliveryJob | null> {
  const doc = await getDeliveryJobsCollection().findOne({ restaurantId, orderId }, { sort: { createdAt: -1 } });
  return toApiFormat(doc) as unknown as DeliveryJob | null;
}

// ----- Shipments -----

export async function insertShipment(input: ShipmentInsert): Promise<Shipment> {
  const now = new Date();
  const doc = { ...input, createdAt: now, updatedAt: now };
  const result = await getShipmentsCollection().insertOne(doc);
  return { ...doc, id: result.insertedId.toString() } as Shipment;
}

export async function findShipmentForOrder(restaurantId: string, orderId: string): Promise<Shipment | null> {
  const doc = await getShipmentsCollection().findOne({ restaurantId, orderId }, { sort: { createdAt: -1 } });
  return toApiFormat(doc) as unknown as Shipment | null;
}

/** Newest shipment per order, for a page of orders (dashboard feed). */
export async function findShipmentsForOrders(restaurantId: string, orderIds: string[]): Promise<Shipment[]> {
  if (!orderIds.length) return [];
  const docs = await getShipmentsCollection()
    .aggregate([
      { $match: { restaurantId, orderId: { $in: orderIds } } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$orderId', doc: { $first: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$doc' } },
    ])
    .toArray();
  return toApiFormatArray(docs as WithId<Document>[]) as unknown as Shipment[];
}

export async function findShipmentByProviderId(provider: DeliveryProviderId, providerShipmentId: string): Promise<Shipment | null> {
  const doc = await getShipmentsCollection().findOne({ provider, providerShipmentId });
  return toApiFormat(doc) as unknown as Shipment | null;
}

export async function updateShipment(id: string, expected: ShipmentStatus, patch: ShipmentPatch): Promise<Shipment | null> {
  const result = await getShipmentsCollection().findOneAndUpdate(
    { _id: toObjectId(id) as any, status: expected },
    { $set: { ...patch, updatedAt: new Date() } },
    { returnDocument: 'after' },
  );
  return toApiFormat(result) as unknown as Shipment | null;
}

export async function findLiveShipments(providers: DeliveryProviderId[], limit: number): Promise<Shipment[]> {
  const docs = await getShipmentsCollection()
    .find({ provider: { $in: providers }, status: { $nin: [...TERMINAL_SHIPMENT_STATUSES] } })
    .sort({ updatedAt: 1 })
    .limit(limit)
    .toArray();
  return toApiFormatArray(docs) as unknown as Shipment[];
}

// ----- Webhook receipts -----

/** False when this provider event was already received. */
export async function recordDeliveryWebhookEvent(provider: DeliveryProviderId, eventId: string): Promise<boolean> {
  try {
    await getDeliveryWebhookEventsCollection().insertOne({ provider, eventId, receivedAt: new Date() });
    return true;
  } catch (err) {
    if (isDuplicateKey(err)) return false;
    throw err;
  }
}

/** Undo a receipt when processing failed, so the partner's retry is handled. */
export async function forgetDeliveryWebhookEvent(provider: DeliveryProviderId, eventId: string): Promise<void> {
  await getDeliveryWebhookEventsCollection().deleteOne({ provider, eventId });
}

// ----- The dispatcher's store -----

export const mongoDeliveryStore: DeliveryStore = {
  enqueueJob: enqueueDeliveryJob,
  claimDueJob: claimDueDeliveryJob,
  completeJob: completeDeliveryJob,
  retryJob: retryDeliveryJob,
  failJob: failDeliveryJob,
  findRestaurant: (id: string) => findRestaurantById(id),
  findOrder: (rid: string, id: string): Promise<Order | null> => findOrderById(rid, id),
  moveOrder: (rid, id, from, to, note) => transitionOrder(rid, id, from, to, { by: 'system', note }),
  insertShipment,
  findShipmentForOrder,
  findShipmentByProviderId,
  updateShipment,
  findLiveShipments,
};
