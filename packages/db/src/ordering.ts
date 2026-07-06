/**
 * @restropulse/db - Online ordering collection helpers + indexes (v1)
 */

import { Db } from 'mongodb';
import {
  getDB,
  getRestaurantsCollection,
  getMenuCategoriesCollection,
  getMenuItemsCollection,
  getOrdersCollection,
  getReservationsCollection,
  getStorefrontContentCollection,
  getCustomersCollection,
  getEventsCollection,
  toApiFormat,
  toApiFormatArray,
  toObjectId,
} from './connection.js';
import type {
  Restaurant,
  MenuCategory,
  OrderingMenuItem,
  Order,
  Reservation,
  StorefrontContentDoc,
  Customer,
  AnalyticsEvent,
} from '@restropulse/shared';

// ----- Indexes -----

/**
 * Creates all indexes required by the ordering feature.
 * Accepts an optional Db (used by db-cli which manages its own connection);
 * defaults to the shared singleton connection.
 * Safe to call repeatedly — existing-index errors are ignored.
 */
export async function ensureOrderingIndexes(db?: Db): Promise<void> {
  const database = db ?? getDB();

  const specs: Array<{ collection: string; spec: Record<string, 1 | -1>; options?: Record<string, unknown> }> = [
    // Unique storefront slug on restaurants (partial: only docs that have a slug)
    {
      collection: 'restaurants',
      spec: { slug: 1 },
      options: { unique: true, partialFilterExpression: { slug: { $type: 'string' } } },
    },
    { collection: 'menu_categories', spec: { restaurantId: 1, sortOrder: 1 } },
    { collection: 'menu_items', spec: { restaurantId: 1, categoryId: 1, sortOrder: 1 } },
    { collection: 'menu_items', spec: { restaurantId: 1, name: 1 } },
    { collection: 'orders', spec: { restaurantId: 1, status: 1, createdAt: -1 } },
    { collection: 'orders', spec: { customerId: 1, createdAt: -1 } },
    { collection: 'orders', spec: { orderNumber: 1 } },
    // Idempotency dedupe (partial: only orders created with an Idempotency-Key header)
    {
      collection: 'orders',
      spec: { restaurantId: 1, idempotencyKey: 1 },
      options: { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
    },
    { collection: 'reservations', spec: { restaurantId: 1, status: 1, date: 1 } },
    { collection: 'storefront_content', spec: { restaurantId: 1 }, options: { unique: true } },
    // One customer account per email per restaurant (multi-tenant)
    { collection: 'customers', spec: { restaurantId: 1, email: 1 }, options: { unique: true } },
    { collection: 'events', spec: { restaurantId: 1, name: 1, ts: -1 } },
    { collection: 'events', spec: { sessionId: 1 } },
    // Growth campaigns (queued sends; delivery worker is a NEXT.md seam)
    { collection: 'campaigns', spec: { restaurantId: 1, createdAt: -1 } },
  ];

  for (const { collection, spec, options } of specs) {
    try {
      await database.collection(collection).createIndex(spec, options ?? {});
    } catch (err) {
      // 85 = IndexOptionsConflict, 86 = IndexKeySpecsConflict — index already exists
      const code = (err as { code?: number }).code;
      if (code !== 85 && code !== 86) throw err;
    }
  }
}

// ----- Restaurants -----

export async function findRestaurantBySlug(slug: string): Promise<Restaurant | null> {
  const doc = await getRestaurantsCollection().findOne({ slug });
  return toApiFormat(doc) as Restaurant | null;
}

// ----- Menu categories -----

export async function findMenuCategories(restaurantId: string): Promise<MenuCategory[]> {
  const docs = await getMenuCategoriesCollection()
    .find({ restaurantId })
    .sort({ sortOrder: 1, name: 1 })
    .toArray();
  return toApiFormatArray(docs) as MenuCategory[];
}

export async function findMenuCategoryById(restaurantId: string, id: string): Promise<MenuCategory | null> {
  const doc = await getMenuCategoriesCollection().findOne({ _id: toObjectId(id) as any, restaurantId });
  return toApiFormat(doc) as MenuCategory | null;
}

// ----- Menu items -----

export async function findMenuItems(
  restaurantId: string,
  opts: { includeHidden?: boolean } = {},
): Promise<OrderingMenuItem[]> {
  const filter: Record<string, unknown> = { restaurantId };
  if (!opts.includeHidden) {
    filter.availability = { $ne: 'hidden' };
  }
  const docs = await getMenuItemsCollection()
    .find(filter)
    .sort({ sortOrder: 1, name: 1 })
    .toArray();
  return toApiFormatArray(docs) as OrderingMenuItem[];
}

export async function findMenuItemsByIds(restaurantId: string, ids: string[]): Promise<OrderingMenuItem[]> {
  const docs = await getMenuItemsCollection()
    .find({ restaurantId, _id: { $in: ids.map((id) => toObjectId(id)) as any[] } })
    .toArray();
  return toApiFormatArray(docs) as OrderingMenuItem[];
}

// ----- Orders -----

export async function findOrderById(id: string): Promise<Order | null> {
  const doc = await getOrdersCollection().findOne({ _id: toObjectId(id) as any });
  return toApiFormat(doc) as Order | null;
}

export async function findOrderByIdempotencyKey(restaurantId: string, key: string): Promise<Order | null> {
  const doc = await getOrdersCollection().findOne({ restaurantId, idempotencyKey: key });
  return toApiFormat(doc) as Order | null;
}

// ----- Customers -----

export async function findCustomerByEmail(restaurantId: string, email: string): Promise<Customer | null> {
  const doc = await getCustomersCollection().findOne({ restaurantId, email: email.toLowerCase() });
  return toApiFormat(doc) as Customer | null;
}

export async function findCustomerById(id: string): Promise<Customer | null> {
  const doc = await getCustomersCollection().findOne({ _id: toObjectId(id) as any });
  return toApiFormat(doc) as Customer | null;
}

// ----- Storefront content -----

export async function findStorefrontContent(restaurantId: string): Promise<StorefrontContentDoc | null> {
  const doc = await getStorefrontContentCollection().findOne({ restaurantId });
  return toApiFormat(doc) as StorefrontContentDoc | null;
}

// ----- Analytics events -----

/** Fire-and-forget analytics insert. Never throws (analytics must not break requests). */
export async function insertAnalyticsEvent(event: Omit<AnalyticsEvent, 'id'>): Promise<void> {
  try {
    await getEventsCollection().insertOne({ ...event, ts: new Date(event.ts) });
  } catch {
    // Swallow — analytics writes are best-effort.
  }
}

// ----- Reservations -----

export async function findReservationById(restaurantId: string, id: string): Promise<Reservation | null> {
  const doc = await getReservationsCollection().findOne({ _id: toObjectId(id) as any, restaurantId });
  return toApiFormat(doc) as Reservation | null;
}
