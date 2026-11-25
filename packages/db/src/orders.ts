/**
 * @restropulse/db - Online orders (Phase 2, M2)
 *
 * Collections:
 *   orders   one doc per order; status changes are optimistic (filter on the
 *            current status) so two tablets can't both move the same order.
 *            Orders are paid in cash at the counter, at the table or on
 *            delivery, so there is no payments collection.
 *
 * Every order query is scoped by restaurantId (string, as on Lane B docs).
 * Restaurant slug + ordering settings live on the restaurant document.
 */

import { Collection, Db, MongoServerError } from 'mongodb';
import type {
  Order,
  OrderStatus,
  OrderStatusHistoryEntry,
  Restaurant,
  RestaurantOrderingSettings,
} from '@restropulse/shared';
import { getDB, getRestaurantsCollection, toApiFormat, toApiFormatArray, toObjectId } from './connection.js';

export const ORDERS_COLLECTION = 'orders';

export function getOrdersCollection(): Collection {
  return getDB().collection(ORDERS_COLLECTION);
}

const isDuplicateKey = (err: unknown) => err instanceof MongoServerError && err.code === 11000;
const duplicateKeyFields = (err: unknown): string[] =>
  Object.keys(((err as { keyPattern?: Record<string, unknown> }).keyPattern) ?? {});

// ----- Indexes -----

export const ORDER_INDEXES: Array<{ collection: string; spec: Record<string, 1 | -1>; options?: Record<string, unknown> }> = [
  { collection: ORDERS_COLLECTION, spec: { restaurantId: 1, createdAt: -1 } },
  { collection: ORDERS_COLLECTION, spec: { restaurantId: 1, status: 1, createdAt: -1 } },
  { collection: ORDERS_COLLECTION, spec: { orderNumber: 1 }, options: { unique: true } },
  { collection: ORDERS_COLLECTION, spec: { trackingToken: 1 }, options: { unique: true } },
  // Checkout retries with the same Idempotency-Key return the first order.
  {
    collection: ORDERS_COLLECTION,
    spec: { restaurantId: 1, idempotencyKey: 1 },
    options: { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
  },
  // Public site URL handle; only restaurants that have one.
  {
    collection: 'restaurants',
    spec: { slug: 1 },
    options: { unique: true, partialFilterExpression: { slug: { $type: 'string' } } },
  },
];

/** Create the order indexes. Safe to call repeatedly (code 85/86 = already there). */
export async function ensureOrderIndexes(db?: Db): Promise<void> {
  const database = db ?? getDB();
  for (const { collection, spec, options } of ORDER_INDEXES) {
    try {
      await database.collection(collection).createIndex(spec, options ?? {});
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code !== 85 && code !== 86) throw err;
    }
  }
}

// ----- Restaurant slug + ordering settings -----

export class DuplicateRestaurantSlugError extends Error {
  constructor(slug: string) {
    super(`The address "${slug}" is already taken`);
    this.name = 'DuplicateRestaurantSlugError';
  }
}

export async function findRestaurantBySlug(slug: string): Promise<Restaurant | null> {
  const doc = await getRestaurantsCollection().findOne({ slug: slug.toLowerCase() });
  return toApiFormat(doc) as Restaurant | null;
}

/** Save ordering settings and/or slug. A duplicate slug throws DuplicateRestaurantSlugError. */
export async function updateRestaurantOrdering(
  restaurantId: string,
  updates: { ordering?: RestaurantOrderingSettings; slug?: string },
): Promise<Restaurant | null> {
  const $set: Record<string, unknown> = { updatedAt: new Date() };
  if (updates.ordering) $set.ordering = updates.ordering;
  if (updates.slug !== undefined) $set.slug = updates.slug.toLowerCase();
  try {
    const result = await getRestaurantsCollection().findOneAndUpdate(
      { _id: toObjectId(restaurantId) as any },
      { $set },
      { returnDocument: 'after' },
    );
    return toApiFormat(result) as Restaurant | null;
  } catch (err) {
    if (isDuplicateKey(err)) throw new DuplicateRestaurantSlugError(updates.slug ?? '');
    throw err;
  }
}

// ----- Orders -----

export type OrderInsert = Omit<Order, 'id' | 'createdAt' | 'updatedAt'>;

/** orderNumber or trackingToken collided; the caller regenerates and retries. */
export class OrderReferenceCollisionError extends Error {
  constructor() {
    super('Order reference collision');
    this.name = 'OrderReferenceCollisionError';
  }
}

/**
 * Insert an order. When the (restaurantId, idempotencyKey) pair already exists
 * the earlier order is returned with `created: false`, so a retried checkout
 * never creates a second order.
 */
export async function insertOrder(input: OrderInsert): Promise<{ order: Order; created: boolean }> {
  const now = new Date();
  const doc = { ...input, createdAt: now, updatedAt: now };
  try {
    const result = await getOrdersCollection().insertOne(doc);
    return { order: toApiFormat({ ...doc, _id: result.insertedId }) as unknown as Order, created: true };
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    if (input.idempotencyKey && duplicateKeyFields(err).includes('idempotencyKey')) {
      const existing = await findOrderByIdempotencyKey(input.restaurantId, input.idempotencyKey);
      if (existing) return { order: existing, created: false };
    }
    throw new OrderReferenceCollisionError();
  }
}

export async function findOrderByIdempotencyKey(restaurantId: string, key: string): Promise<Order | null> {
  const doc = await getOrdersCollection().findOne({ restaurantId, idempotencyKey: key });
  return toApiFormat(doc) as unknown as Order | null;
}

export async function findOrderById(restaurantId: string, id: string): Promise<Order | null> {
  const doc = await getOrdersCollection().findOne({ _id: toObjectId(id) as any, restaurantId });
  return toApiFormat(doc) as unknown as Order | null;
}

export async function findOrders(
  restaurantId: string,
  opts: { statuses?: OrderStatus[]; since?: Date; limit?: number } = {},
): Promise<Order[]> {
  const filter: Record<string, unknown> = { restaurantId };
  if (opts.statuses?.length) filter.status = { $in: opts.statuses };
  if (opts.since) filter.updatedAt = { $gte: opts.since };
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const docs = await getOrdersCollection().find(filter).sort({ createdAt: -1 }).limit(limit).toArray();
  return toApiFormatArray(docs) as unknown as Order[];
}

/**
 * Move an order from `from` to `to` only if it is still at `from`.
 * Returns null when the order moved meanwhile (or doesn't exist); the caller
 * re-reads and reports a conflict.
 */
export async function transitionOrder(
  restaurantId: string,
  id: string,
  from: OrderStatus,
  to: OrderStatus,
  entry: Omit<OrderStatusHistoryEntry, 'status' | 'at'>,
  extra: { cancelReason?: string } = {},
): Promise<Order | null> {
  const now = new Date();
  const history: OrderStatusHistoryEntry = { status: to, at: now.toISOString(), ...entry };
  const result = await getOrdersCollection().findOneAndUpdate(
    { _id: toObjectId(id) as any, restaurantId, status: from },
    { $set: { status: to, updatedAt: now, ...extra }, $push: { statusHistory: history } as any },
    { returnDocument: 'after' },
  );
  return toApiFormat(result) as unknown as Order | null;
}
