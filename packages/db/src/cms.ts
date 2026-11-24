/**
 * @restropulse/db - Restaurant catalog, offers and site content (Lane B CMS)
 *
 * Collections (docs/LAUNCH_ARCHITECTURE.md Section 3/5):
 *   menu_categories    { restaurantId, name, description?, sortOrder }
 *   menu_items         canonical menu; unique (restaurantId, name)
 *   offers             { restaurantId, title, reward, scope, schedule, status, ... }
 *   storefront_content one doc per restaurant: draft, published, versions[]
 *
 * Every query is scoped by restaurantId (a string, as on every Lane B doc).
 * `restaurant.menu` is kept as a read-only projection of the catalog by
 * refreshMenuProjection(), so the content engine and grader keep reading the
 * embedded shape unchanged.
 */

import { Collection, Db, MongoServerError } from 'mongodb';
import type {
  MenuCategory,
  MenuItemAvailability,
  Offer,
  OrderingMenuItem,
  StorefrontContent,
  StorefrontContentDoc,
  StorefrontVersionEntry,
} from '@restropulse/shared';
import { normaliseStorefrontContent, projectLegacyMenu } from '@restropulse/shared';
import { getDB, getRestaurantsCollection, toApiFormat, toApiFormatArray, toObjectId } from './connection.js';

export const MENU_CATEGORIES_COLLECTION = 'menu_categories';
export const MENU_ITEMS_COLLECTION = 'menu_items';
export const OFFERS_COLLECTION = 'offers';
export const STOREFRONT_CONTENT_COLLECTION = 'storefront_content';

export function getMenuCategoriesCollection(): Collection {
  return getDB().collection(MENU_CATEGORIES_COLLECTION);
}

export function getMenuItemsCollection(): Collection {
  return getDB().collection(MENU_ITEMS_COLLECTION);
}

export function getOffersCollection(): Collection {
  return getDB().collection(OFFERS_COLLECTION);
}

export function getStorefrontContentCollection(): Collection {
  return getDB().collection(STOREFRONT_CONTENT_COLLECTION);
}

/** Thrown when a create/rename would break the unique (restaurantId, name) menu_items index. */
export class DuplicateMenuItemNameError extends Error {
  constructor(name: string) {
    super(`An item named "${name}" already exists`);
    this.name = 'DuplicateMenuItemNameError';
  }
}

const isDuplicateKey = (err: unknown) => err instanceof MongoServerError && err.code === 11000;

// ----- Indexes -----

export const CMS_INDEXES: Array<{ collection: string; spec: Record<string, 1 | -1>; options?: Record<string, unknown> }> = [
  { collection: MENU_CATEGORIES_COLLECTION, spec: { restaurantId: 1, sortOrder: 1 } },
  { collection: MENU_ITEMS_COLLECTION, spec: { restaurantId: 1, categoryId: 1, sortOrder: 1 } },
  // CSV upsert key + create/rename dedupe: one item name per restaurant (case-sensitive).
  { collection: MENU_ITEMS_COLLECTION, spec: { restaurantId: 1, name: 1 }, options: { unique: true } },
  { collection: OFFERS_COLLECTION, spec: { restaurantId: 1, status: 1, 'schedule.startsAt': -1 } },
  // One live code per restaurant (partial: only offers that have a code).
  {
    collection: OFFERS_COLLECTION,
    spec: { restaurantId: 1, code: 1 },
    options: { unique: true, partialFilterExpression: { code: { $type: 'string' } } },
  },
  { collection: STOREFRONT_CONTENT_COLLECTION, spec: { restaurantId: 1 }, options: { unique: true } },
];

/**
 * Create the CMS indexes. Safe to call repeatedly; an existing compatible
 * index (code 85/86) is left alone. db-cli `setup` creates the same set.
 */
export async function ensureCmsIndexes(db?: Db): Promise<void> {
  const database = db ?? getDB();
  for (const { collection, spec, options } of CMS_INDEXES) {
    try {
      await database.collection(collection).createIndex(spec, options ?? {});
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code !== 85 && code !== 86) throw err;
    }
  }
}

// ----- Menu categories -----

export async function findMenuCategories(restaurantId: string): Promise<MenuCategory[]> {
  const docs = await getMenuCategoriesCollection().find({ restaurantId }).sort({ sortOrder: 1, name: 1 }).toArray();
  return toApiFormatArray(docs) as unknown as MenuCategory[];
}

export async function findMenuCategoryById(restaurantId: string, id: string): Promise<MenuCategory | null> {
  const doc = await getMenuCategoriesCollection().findOne({ _id: toObjectId(id) as any, restaurantId });
  return toApiFormat(doc) as unknown as MenuCategory | null;
}

export async function insertMenuCategory(
  restaurantId: string,
  input: { name: string; description?: string; sortOrder: number },
): Promise<MenuCategory> {
  const now = new Date();
  const doc = { restaurantId, ...input, createdAt: now, updatedAt: now };
  const result = await getMenuCategoriesCollection().insertOne(doc);
  return toApiFormat({ ...doc, _id: result.insertedId }) as unknown as MenuCategory;
}

export async function updateMenuCategory(
  restaurantId: string,
  id: string,
  updates: Partial<Pick<MenuCategory, 'name' | 'description' | 'sortOrder'>>,
): Promise<MenuCategory | null> {
  const result = await getMenuCategoriesCollection().findOneAndUpdate(
    { _id: toObjectId(id) as any, restaurantId },
    { $set: { ...updates, updatedAt: new Date() } },
    { returnDocument: 'after' },
  );
  return toApiFormat(result) as unknown as MenuCategory | null;
}

export async function deleteMenuCategory(restaurantId: string, id: string): Promise<boolean> {
  const result = await getMenuCategoriesCollection().deleteOne({ _id: toObjectId(id) as any, restaurantId });
  return result.deletedCount > 0;
}

export async function countMenuItemsInCategory(restaurantId: string, categoryId: string): Promise<number> {
  return getMenuItemsCollection().countDocuments({ restaurantId, categoryId });
}

/** Set sortOrder = position (1-based) for each id; ids from other restaurants are ignored. */
export async function reorderMenuCategories(restaurantId: string, orderedIds: string[]): Promise<void> {
  await reorder(getMenuCategoriesCollection(), restaurantId, orderedIds);
}

async function reorder(col: Collection, restaurantId: string, orderedIds: string[]): Promise<void> {
  if (orderedIds.length === 0) return;
  const now = new Date();
  await col.bulkWrite(
    orderedIds.map((id, index) => ({
      updateOne: {
        filter: { _id: toObjectId(id) as any, restaurantId },
        update: { $set: { sortOrder: index + 1, updatedAt: now } },
      },
    })),
    { ordered: false },
  );
}

// ----- Menu items -----

export type MenuItemInput = Omit<OrderingMenuItem, 'id' | 'restaurantId' | 'createdAt' | 'updatedAt'>;

export async function findMenuItems(
  restaurantId: string,
  opts: { includeHidden?: boolean } = {},
): Promise<OrderingMenuItem[]> {
  const filter: Record<string, unknown> = { restaurantId };
  if (!opts.includeHidden) filter.availability = { $ne: 'hidden' };
  const docs = await getMenuItemsCollection().find(filter).sort({ sortOrder: 1, name: 1 }).toArray();
  return toApiFormatArray(docs) as unknown as OrderingMenuItem[];
}

export async function findMenuItemById(restaurantId: string, id: string): Promise<OrderingMenuItem | null> {
  const doc = await getMenuItemsCollection().findOne({ _id: toObjectId(id) as any, restaurantId });
  return toApiFormat(doc) as unknown as OrderingMenuItem | null;
}

export async function insertMenuItem(restaurantId: string, input: MenuItemInput): Promise<OrderingMenuItem> {
  const now = new Date();
  const doc = { restaurantId, ...input, createdAt: now, updatedAt: now };
  try {
    const result = await getMenuItemsCollection().insertOne(doc);
    return toApiFormat({ ...doc, _id: result.insertedId }) as unknown as OrderingMenuItem;
  } catch (err) {
    if (isDuplicateKey(err)) throw new DuplicateMenuItemNameError(input.name);
    throw err;
  }
}

export async function updateMenuItem(
  restaurantId: string,
  id: string,
  updates: Partial<MenuItemInput>,
): Promise<OrderingMenuItem | null> {
  try {
    const result = await getMenuItemsCollection().findOneAndUpdate(
      { _id: toObjectId(id) as any, restaurantId },
      { $set: { ...updates, updatedAt: new Date() } },
      { returnDocument: 'after' },
    );
    return toApiFormat(result) as unknown as OrderingMenuItem | null;
  } catch (err) {
    if (isDuplicateKey(err)) throw new DuplicateMenuItemNameError(updates.name ?? '');
    throw err;
  }
}

export async function setMenuItemAvailability(
  restaurantId: string,
  id: string,
  availability: MenuItemAvailability,
): Promise<OrderingMenuItem | null> {
  return updateMenuItem(restaurantId, id, { availability });
}

export async function deleteMenuItem(restaurantId: string, id: string): Promise<boolean> {
  const result = await getMenuItemsCollection().deleteOne({ _id: toObjectId(id) as any, restaurantId });
  return result.deletedCount > 0;
}

export async function reorderMenuItems(restaurantId: string, orderedIds: string[]): Promise<void> {
  await reorder(getMenuItemsCollection(), restaurantId, orderedIds);
}

/**
 * CSV import upsert keyed on (restaurantId, name). `set` always applies;
 * `setOnInsert` only for new rows. A concurrent import can race the
 * upsert-insert into the unique index (11000); the retry then resolves as an update.
 */
export async function upsertMenuItemByName(
  restaurantId: string,
  name: string,
  set: Partial<MenuItemInput>,
  setOnInsert: Partial<MenuItemInput>,
): Promise<'created' | 'updated'> {
  const run = () => getMenuItemsCollection().updateOne(
    { restaurantId, name },
    {
      $set: { ...set, updatedAt: new Date() },
      $setOnInsert: { ...setOnInsert, restaurantId, name, createdAt: new Date() },
    },
    { upsert: true },
  );
  let result;
  try {
    result = await run();
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    result = await run();
  }
  return result.upsertedCount > 0 ? 'created' : 'updated';
}

/**
 * Rewrite `restaurant.menu` from the catalog and mark the restaurant as
 * catalog-managed. Call after every catalog write. Returns the item count.
 */
export async function refreshMenuProjection(restaurantId: string): Promise<number> {
  const [categories, items] = await Promise.all([
    findMenuCategories(restaurantId),
    findMenuItems(restaurantId, { includeHidden: true }),
  ]);
  const menu = projectLegacyMenu(categories, items);
  await getRestaurantsCollection().updateOne(
    { _id: toObjectId(restaurantId) as any },
    {
      $set: {
        menu,
        menuSource: 'catalog',
        menuLastUpdated: new Date().toISOString().split('T')[0],
        updatedAt: new Date(),
      },
    },
  );
  return menu.length;
}

// ----- Offers -----

export type OfferInput = Omit<Offer, 'id' | 'restaurantId' | 'createdAt' | 'updatedAt'>;

/** Thrown when an offer code is already used by another offer of the same restaurant. */
export class DuplicateOfferCodeError extends Error {
  constructor(code: string) {
    super(`Another offer already uses the code ${code}`);
    this.name = 'DuplicateOfferCodeError';
  }
}

export async function findOffers(restaurantId: string, opts: { includeArchived?: boolean } = {}): Promise<Offer[]> {
  const filter: Record<string, unknown> = { restaurantId };
  if (!opts.includeArchived) filter.status = { $ne: 'archived' };
  const docs = await getOffersCollection().find(filter).sort({ 'schedule.startsAt': -1, title: 1 }).toArray();
  return toApiFormatArray(docs) as unknown as Offer[];
}

/** Active offers flagged for content promotion; the caller applies isOfferPromotable() for dates. */
export async function findPromotableOffers(restaurantId: string): Promise<Offer[]> {
  const docs = await getOffersCollection().find({ restaurantId, status: 'active', promoteInContent: true }).toArray();
  return toApiFormatArray(docs) as unknown as Offer[];
}

export async function findOfferById(restaurantId: string, id: string): Promise<Offer | null> {
  const doc = await getOffersCollection().findOne({ _id: toObjectId(id) as any, restaurantId });
  return toApiFormat(doc) as unknown as Offer | null;
}

export async function insertOffer(restaurantId: string, input: OfferInput): Promise<Offer> {
  const now = new Date();
  const doc = { restaurantId, ...input, createdAt: now, updatedAt: now };
  try {
    const result = await getOffersCollection().insertOne(doc);
    return toApiFormat({ ...doc, _id: result.insertedId }) as unknown as Offer;
  } catch (err) {
    if (isDuplicateKey(err)) throw new DuplicateOfferCodeError(input.code ?? '');
    throw err;
  }
}

/** Replace the editable fields; a field set to undefined in `updates` is removed (e.g. clearing the code). */
export async function updateOffer(restaurantId: string, id: string, updates: Partial<OfferInput>): Promise<Offer | null> {
  const $set: Record<string, unknown> = { updatedAt: new Date() };
  const $unset: Record<string, ''> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) $unset[key] = '';
    else $set[key] = value;
  }
  try {
    const result = await getOffersCollection().findOneAndUpdate(
      { _id: toObjectId(id) as any, restaurantId },
      Object.keys($unset).length ? { $set, $unset } : { $set },
      { returnDocument: 'after' },
    );
    return toApiFormat(result) as unknown as Offer | null;
  } catch (err) {
    if (isDuplicateKey(err)) throw new DuplicateOfferCodeError(String(updates.code ?? ''));
    throw err;
  }
}

export async function deleteOffer(restaurantId: string, id: string): Promise<boolean> {
  const result = await getOffersCollection().deleteOne({ _id: toObjectId(id) as any, restaurantId });
  return result.deletedCount > 0;
}

// ----- Site content -----

export async function findStorefrontContent(restaurantId: string): Promise<StorefrontContentDoc | null> {
  const doc = await getStorefrontContentCollection().findOne({ restaurantId });
  const out = toApiFormat(doc) as unknown as StorefrontContentDoc | null;
  if (!out) return null;
  return {
    ...out,
    draft: normaliseStorefrontContent(out.draft),
    ...(out.published ? { published: normaliseStorefrontContent(out.published) } : {}),
    versions: out.versions ?? [],
  };
}

export async function saveStorefrontDraft(restaurantId: string, draft: StorefrontContent): Promise<StorefrontContentDoc> {
  const result = await getStorefrontContentCollection().findOneAndUpdate(
    { restaurantId },
    { $set: { draft, updatedAt: new Date() }, $setOnInsert: { restaurantId, versions: [] } },
    { upsert: true, returnDocument: 'after' },
  );
  return (await findStorefrontContent(restaurantId)) ?? (toApiFormat(result) as unknown as StorefrontContentDoc);
}

/**
 * Persist a publish/rollback result. `expectedVersion` is the publishedVersion
 * the caller read; if another publish landed in between, nothing is written
 * and null is returned so the caller can answer 409 instead of losing history.
 */
export async function saveStorefrontPublish(
  restaurantId: string,
  expectedVersion: number | undefined,
  result: {
    published: StorefrontContent;
    publishedVersion: number;
    publishedAt: string;
    versions: StorefrontVersionEntry[];
    draft?: StorefrontContent;
  },
): Promise<StorefrontContentDoc | null> {
  const filter: Record<string, unknown> = { restaurantId };
  filter.publishedVersion = expectedVersion === undefined ? { $exists: false } : expectedVersion;
  const $set: Record<string, unknown> = {
    published: result.published,
    publishedVersion: result.publishedVersion,
    publishedAt: result.publishedAt,
    versions: result.versions,
    updatedAt: new Date(),
  };
  if (result.draft) $set.draft = result.draft;
  const updated = await getStorefrontContentCollection().findOneAndUpdate(filter, { $set }, { returnDocument: 'after' });
  if (!updated) return null;
  return findStorefrontContent(restaurantId);
}
