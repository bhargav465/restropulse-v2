/**
 * @restropulse/db - Online ordering collection helpers + indexes (v1)
 */

import { Db } from 'mongodb';
import { createLogger } from '@restropulse/telemetry/server';
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
  getPaymentsCollection,
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
  Payment,
} from '@restropulse/shared';

// ----- Indexes -----

const log = createLogger('db:ordering');

/**
 * Creates all indexes required by the ordering feature.
 * Accepts an optional Db (used by db-cli which manages its own connection);
 * defaults to the shared singleton connection.
 * Safe to call repeatedly — existing-index errors are ignored.
 *
 * NOTE: the `menu_items { restaurantId, name }` spec is marked
 * `upgradeToUnique`. Because a legacy NON-unique index of the same key may
 * already exist, a plain `createIndex(..., { unique: true })` throws
 * IndexOptionsConflict (code 85) which the generic catch would silently
 * swallow — a no-op. The dedicated upgrade path below drops the old index and
 * recreates it unique; if legacy duplicate data blocks the unique build (code
 * 11000) it restores the non-unique index, warns once, and continues booting.
 */
export async function ensureOrderingIndexes(db?: Db): Promise<void> {
  const database = db ?? getDB();

  const specs: Array<{
    collection: string;
    spec: Record<string, 1 | -1>;
    options?: Record<string, unknown>;
    /** menu_items name key: upgrade any pre-existing non-unique index to unique. */
    upgradeToUnique?: boolean;
  }> = [
    // Unique storefront slug on restaurants (partial: only docs that have a slug)
    {
      collection: 'restaurants',
      spec: { slug: 1 },
      options: { unique: true, partialFilterExpression: { slug: { $type: 'string' } } },
    },
    { collection: 'menu_categories', spec: { restaurantId: 1, sortOrder: 1 } },
    { collection: 'menu_items', spec: { restaurantId: 1, categoryId: 1, sortOrder: 1 } },
    // CSV upsert key + admin create/rename dedupe: enforce one item name per
    // restaurant (case-sensitive, matching the CSV upsert filter). Upgraded
    // from any pre-existing non-unique index — see upgrade path below.
    { collection: 'menu_items', spec: { restaurantId: 1, name: 1 }, options: { unique: true }, upgradeToUnique: true },
    { collection: 'orders', spec: { restaurantId: 1, status: 1, createdAt: -1 } },
    // Unfiltered admin orders feed sorts by createdAt with no status filter.
    { collection: 'orders', spec: { restaurantId: 1, createdAt: -1 } },
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
    // /analytics/summary matches on (restaurantId, ts range) without a name.
    { collection: 'events', spec: { restaurantId: 1, ts: -1 } },
    { collection: 'events', spec: { sessionId: 1 } },
    // Growth campaigns (queued sends; delivery worker is a NEXT.md seam)
    { collection: 'campaigns', spec: { restaurantId: 1, createdAt: -1 } },
    // Delivery-worker poll seam (docs/NEXT.md §9): fetch QUEUED oldest-first.
    { collection: 'campaigns', spec: { status: 1, createdAt: 1 } },
    // Ordering payments (Razorpay). One payment doc per order (intent idempotency backstop).
    { collection: 'payments', spec: { orderId: 1 }, options: { unique: true } },
    { collection: 'payments', spec: { restaurantId: 1, createdAt: -1 } },
    // Webhook reconciliation: Razorpay payload carries the provider order id, not ours.
    { collection: 'payments', spec: { providerOrderId: 1 } },
  ];

  for (const { collection, spec, options, upgradeToUnique } of specs) {
    try {
      await database.collection(collection).createIndex(spec, options ?? {});
    } catch (err) {
      const code = (err as { code?: number }).code;
      // A legacy NON-unique index with the same key blocks adding `unique:true`.
      // Depending on server/driver version this surfaces as 85
      // (IndexOptionsConflict) or 86 (IndexKeySpecsConflict, when the
      // auto-generated index name collides). For the menu_items name key this
      // must NOT be silently swallowed: run the drop-and-recreate upgrade.
      if ((code === 85 || code === 86) && upgradeToUnique) {
        await upgradeIndexToUnique(database, collection, spec, options ?? {});
        continue;
      }
      // 85/86 otherwise = index already exists with a compatible spec — ignore.
      if (code !== 85 && code !== 86) throw err;
    }
  }
}

/**
 * Upgrade an existing NON-unique index to unique by dropping and recreating it.
 * If legacy duplicate data blocks the unique build (code 11000), restore the
 * non-unique index (preserving query performance), warn once naming the
 * `db-cli dedupe-menu-items` remediation command, and continue — never crash
 * API startup over pre-existing duplicate rows.
 */
async function upgradeIndexToUnique(
  database: Db,
  collection: string,
  spec: Record<string, 1 | -1>,
  options: Record<string, unknown>,
): Promise<void> {
  const col = database.collection(collection);
  // Default index name mongo assigns to this key, e.g. "restaurantId_1_name_1".
  const indexName = Object.entries(spec).map(([k, v]) => `${k}_${v}`).join('_');

  try {
    await col.dropIndex(indexName);
  } catch (err) {
    // 27 = IndexNotFound — nothing to drop (already gone); proceed to create.
    const code = (err as { code?: number }).code;
    if (code !== 27) throw err;
  }

  try {
    await col.createIndex(spec, options);
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 11000) {
      // Legacy duplicates block the unique constraint. Restore the non-unique
      // index so queries stay fast, warn, and keep booting.
      const { unique: _unique, ...nonUnique } = options;
      await col.createIndex(spec, nonUnique);
      log.warn(
        { collection, index: indexName },
        `Cannot enforce unique ${collection} index — duplicate (${Object.keys(spec).join(', ')}) values exist. ` +
          'Kept the non-unique index. Resolve with: npm run db-cli -- dedupe-menu-items --apply',
      );
      return;
    }
    throw err;
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

// ----- Payments -----

export async function findPaymentByOrderId(orderId: string): Promise<Payment | null> {
  const doc = await getPaymentsCollection().findOne({ orderId });
  return toApiFormat(doc) as Payment | null;
}

export async function findPaymentByProviderOrderId(providerOrderId: string): Promise<Payment | null> {
  const doc = await getPaymentsCollection().findOne({ providerOrderId });
  return toApiFormat(doc) as Payment | null;
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
