/**
 * @restropulse/db - Restaurant websites: custom domains (Phase 2, M3)
 *
 * Collection `restaurant_domains` maps a hostname the owner brings to their
 * restaurant (docs/LAUNCH_ARCHITECTURE B2). The hostname is unique across all
 * restaurants, so one domain can never serve two sites. Only `active` rows route.
 */

import { Collection, Db, MongoServerError } from 'mongodb';
import type { RestaurantDomain, RestaurantDomainSslStatus, RestaurantDomainStatus } from '@restropulse/shared';
import { getDB, toApiFormat, toApiFormatArray, toObjectId } from './connection.js';

export const RESTAURANT_DOMAINS_COLLECTION = 'restaurant_domains';

export function getRestaurantDomainsCollection(): Collection {
  return getDB().collection(RESTAURANT_DOMAINS_COLLECTION);
}

export const SITE_INDEXES: Array<{ collection: string; spec: Record<string, 1 | -1>; options?: Record<string, unknown> }> = [
  { collection: RESTAURANT_DOMAINS_COLLECTION, spec: { hostname: 1 }, options: { unique: true } },
  { collection: RESTAURANT_DOMAINS_COLLECTION, spec: { restaurantId: 1, createdAt: 1 } },
];

/** Create the restaurant_domains indexes. Safe to call repeatedly. */
export async function ensureSiteIndexes(db?: Db): Promise<void> {
  const database = db ?? getDB();
  for (const { collection, spec, options } of SITE_INDEXES) {
    try {
      await database.collection(collection).createIndex(spec, options ?? {});
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code !== 85 && code !== 86) throw err;
    }
  }
}

export class DuplicateDomainError extends Error {
  constructor(hostname: string) {
    super(`${hostname} is already connected to a RestroPulse site`);
    this.name = 'DuplicateDomainError';
  }
}

export type RestaurantDomainInsert = Omit<RestaurantDomain, 'id' | 'createdAt'>;

export async function insertRestaurantDomain(domain: RestaurantDomainInsert): Promise<RestaurantDomain> {
  const doc = { ...domain, hostname: domain.hostname.toLowerCase(), createdAt: new Date() };
  try {
    const result = await getRestaurantDomainsCollection().insertOne(doc);
    return { ...doc, id: result.insertedId.toString() } as RestaurantDomain;
  } catch (err) {
    if (err instanceof MongoServerError && err.code === 11000) throw new DuplicateDomainError(doc.hostname);
    throw err;
  }
}

export async function findRestaurantDomains(restaurantId: string): Promise<RestaurantDomain[]> {
  const docs = await getRestaurantDomainsCollection().find({ restaurantId }).sort({ createdAt: 1 }).toArray();
  return toApiFormatArray(docs) as unknown as RestaurantDomain[];
}

export async function findRestaurantDomainById(restaurantId: string, id: string): Promise<RestaurantDomain | null> {
  const doc = await getRestaurantDomainsCollection().findOne({ _id: toObjectId(id) as any, restaurantId });
  return toApiFormat(doc) as unknown as RestaurantDomain | null;
}

/** The active domain row for a request's Host header, if any. */
export async function findActiveDomainByHostname(hostname: string): Promise<RestaurantDomain | null> {
  const doc = await getRestaurantDomainsCollection().findOne({ hostname: hostname.toLowerCase(), status: 'active' });
  return toApiFormat(doc) as unknown as RestaurantDomain | null;
}

export async function updateRestaurantDomainStatus(
  restaurantId: string,
  id: string,
  updates: { status: RestaurantDomainStatus; sslStatus?: RestaurantDomainSslStatus; lastError?: string | null; verifiedAt?: Date },
): Promise<RestaurantDomain | null> {
  const $set: Record<string, unknown> = { status: updates.status, lastCheckedAt: new Date() };
  const $unset: Record<string, ''> = {};
  if (updates.sslStatus) $set.sslStatus = updates.sslStatus;
  if (updates.verifiedAt) $set.verifiedAt = updates.verifiedAt;
  if (updates.lastError) $set.lastError = updates.lastError;
  else if (updates.lastError === null) $unset.lastError = '';
  const result = await getRestaurantDomainsCollection().findOneAndUpdate(
    { _id: toObjectId(id) as any, restaurantId },
    Object.keys($unset).length ? { $set, $unset } : { $set },
    { returnDocument: 'after' },
  );
  return toApiFormat(result) as unknown as RestaurantDomain | null;
}

export async function deleteRestaurantDomain(restaurantId: string, id: string): Promise<boolean> {
  const result = await getRestaurantDomainsCollection().deleteOne({ _id: toObjectId(id) as any, restaurantId });
  return result.deletedCount === 1;
}
