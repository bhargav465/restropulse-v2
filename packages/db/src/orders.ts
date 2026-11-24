/**
 * @restropulse/db - Online orders and payments (Phase 2, M2)
 *
 * Collections:
 *   orders                  one doc per order; status changes are optimistic
 *                           (filter on the current status) so two tablets can't
 *                           both move the same order.
 *   payments                one doc per online payment attempt (Razorpay order).
 *   payment_webhook_events  Razorpay event ids already handled (unique, 30-day TTL),
 *                           so a redelivered webhook is a no-op.
 *
 * Every order/payment query is scoped by restaurantId (string, as on Lane B docs).
 * Restaurant slug + ordering settings live on the restaurant document.
 */

import { Collection, Db, MongoServerError } from 'mongodb';
import type {
  Order,
  OrderPaymentStatus,
  OrderStatus,
  OrderStatusHistoryEntry,
  Payment,
  PaymentEventEntry,
  PaymentStatus,
  Restaurant,
  RestaurantOrderingSettings,
} from '@restropulse/shared';
import { getDB, getRestaurantsCollection, toApiFormat, toApiFormatArray, toObjectId } from './connection.js';

export const ORDERS_COLLECTION = 'orders';
export const PAYMENTS_COLLECTION = 'payments';
export const PAYMENT_WEBHOOK_EVENTS_COLLECTION = 'payment_webhook_events';

export function getOrdersCollection(): Collection {
  return getDB().collection(ORDERS_COLLECTION);
}

export function getPaymentsCollection(): Collection {
  return getDB().collection(PAYMENTS_COLLECTION);
}

export function getPaymentWebhookEventsCollection(): Collection {
  return getDB().collection(PAYMENT_WEBHOOK_EVENTS_COLLECTION);
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
  { collection: PAYMENTS_COLLECTION, spec: { providerOrderId: 1 }, options: { unique: true } },
  { collection: PAYMENTS_COLLECTION, spec: { restaurantId: 1, orderId: 1, createdAt: -1 } },
  { collection: PAYMENTS_COLLECTION, spec: { providerPaymentId: 1 }, options: { sparse: true } },
  { collection: PAYMENT_WEBHOOK_EVENTS_COLLECTION, spec: { eventId: 1 }, options: { unique: true } },
  { collection: PAYMENT_WEBHOOK_EVENTS_COLLECTION, spec: { receivedAt: 1 }, options: { expireAfterSeconds: 30 * 24 * 60 * 60 } },
  // Public site URL handle; only restaurants that have one.
  {
    collection: 'restaurants',
    spec: { slug: 1 },
    options: { unique: true, partialFilterExpression: { slug: { $type: 'string' } } },
  },
];

/** Create the order/payment indexes. Safe to call repeatedly (code 85/86 = already there). */
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
  extra: { paymentStatus?: OrderPaymentStatus; cancelReason?: string } = {},
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

export async function setOrderPaymentStatus(
  restaurantId: string,
  id: string,
  paymentStatus: OrderPaymentStatus,
): Promise<Order | null> {
  const result = await getOrdersCollection().findOneAndUpdate(
    { _id: toObjectId(id) as any, restaurantId },
    { $set: { paymentStatus, updatedAt: new Date() } },
    { returnDocument: 'after' },
  );
  return toApiFormat(result) as unknown as Order | null;
}

// ----- Payments -----

export type PaymentInsert = Omit<Payment, 'id' | 'createdAt' | 'updatedAt'>;

export async function insertPayment(input: PaymentInsert): Promise<Payment> {
  const now = new Date();
  const doc = { ...input, createdAt: now, updatedAt: now };
  const result = await getPaymentsCollection().insertOne(doc);
  return toApiFormat({ ...doc, _id: result.insertedId }) as unknown as Payment;
}

export async function findPaymentByProviderOrderId(providerOrderId: string): Promise<Payment | null> {
  const doc = await getPaymentsCollection().findOne({ providerOrderId });
  return toApiFormat(doc) as unknown as Payment | null;
}

export async function findPaymentByProviderPaymentId(providerPaymentId: string): Promise<Payment | null> {
  const doc = await getPaymentsCollection().findOne({ providerPaymentId });
  return toApiFormat(doc) as unknown as Payment | null;
}

/** The newest payment attempt for an order. */
export async function findLatestPaymentForOrder(restaurantId: string, orderId: string): Promise<Payment | null> {
  const docs = await getPaymentsCollection().find({ restaurantId, orderId }).sort({ createdAt: -1 }).limit(1).toArray();
  return (docs[0] ? toApiFormat(docs[0]) : null) as unknown as Payment | null;
}

export async function updatePayment(
  id: string,
  updates: { status?: PaymentStatus; providerPaymentId?: string; providerRefundId?: string },
  event: Omit<PaymentEventEntry, 'at'>,
): Promise<Payment | null> {
  const now = new Date();
  const $set: Record<string, unknown> = { updatedAt: now };
  for (const [key, value] of Object.entries(updates)) if (value !== undefined) $set[key] = value;
  const result = await getPaymentsCollection().findOneAndUpdate(
    { _id: toObjectId(id) as any },
    { $set, $push: { events: { at: now.toISOString(), ...event } } as any },
    { returnDocument: 'after' },
  );
  return toApiFormat(result) as unknown as Payment | null;
}

/**
 * Record a provider webhook event id. Returns false when it was already
 * recorded (a redelivery), so the handler can skip it.
 */
export async function recordPaymentWebhookEvent(eventId: string, provider: string, type: string): Promise<boolean> {
  try {
    await getPaymentWebhookEventsCollection().insertOne({ eventId, provider, type, receivedAt: new Date() });
    return true;
  } catch (err) {
    if (isDuplicateKey(err)) return false;
    throw err;
  }
}

/** Forget an event id so the provider's retry is processed (used when handling failed midway). */
export async function forgetPaymentWebhookEvent(eventId: string): Promise<void> {
  await getPaymentWebhookEventsCollection().deleteOne({ eventId });
}
