/**
 * @restropulse/db - Database Connection
 * Singleton MongoDB connection manager used by api, publisher, and content-engine.
 */

import { MongoClient, Db, Collection, ObjectId, WithId, Document } from 'mongodb';
import { createLogger } from '@restropulse/telemetry/server';

const log = createLogger('db');

let client: MongoClient | null = null;
let db: Db | null = null;

export interface DatabaseConfig {
  uri: string;
  database: string;
}

export function getConfig(): DatabaseConfig {
  const uri = process.env.MONGODB_URI;
  const database = process.env.MONGODB_DB_NAME;

  if (!uri) {
    throw new Error('MONGODB_URI environment variable is not set');
  }

  return {
    uri,
    database: database || 'restropulse',
  };
}

export async function connectDB(): Promise<Db> {
  if (db) return db;

  const config = getConfig();
  client = new MongoClient(config.uri);
  await client.connect();
  db = client.db(config.database);

  log.info({ database: config.database }, 'Connected to MongoDB');
  return db;
}

export async function disconnectDB(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    log.info('Disconnected from MongoDB');
  }
}

export function getDB(): Db {
  if (!db) {
    throw new Error('Database not connected. Call connectDB() first.');
  }
  return db;
}

/**
 * Allows external callers (e.g. tests) to inject a pre-connected Db instance.
 */
export function setDB(externalDb: Db): void {
  db = externalDb;
}

// ----- Collection getters -----

export function getUsersCollection(): Collection {
  return getDB().collection('users');
}

export function getRestaurantsCollection(): Collection {
  return getDB().collection('restaurants');
}

export function getPostsCollection(): Collection {
  return getDB().collection('posts');
}

export function getStrategyCyclesCollection(): Collection {
  return getDB().collection('strategyCycles');
}

export function getContentStrategiesCollection(): Collection {
  return getDB().collection('contentStrategies');
}

export function getSessionsCollection(): Collection {
  return getDB().collection('sessions');
}

export function getOtpChallengesCollection(): Collection {
  return getDB().collection('otpChallenges');
}

export function getOauthSessionsCollection(): Collection {
  return getDB().collection('oauthSessions');
}

export function getDataDeletionAuditsCollection(): Collection {
  return getDB().collection('dataDeletionAudits');
}

export function getAccountManagersCollection(): Collection {
  return getDB().collection('accountManagers');
}

export function getCitiesCollection(): Collection {
  return getDB().collection('cities');
}

export function getSubscriptionPlansCollection(): Collection {
  return getDB().collection('subscriptionPlans');
}

export function getSubscriptionsCollection(): Collection {
  return getDB().collection('subscriptions');
}

export function getCouponsCollection(): Collection {
  return getDB().collection('coupons');
}

export function getCouponRedemptionsCollection(): Collection {
  return getDB().collection('couponRedemptions');
}

export function getCreditPurchasesCollection(): Collection {
  return getDB().collection('creditPurchases');
}

export function getCreditPacksCollection(): Collection {
  return getDB().collection('creditPacks');
}

export function getInvoicesCollection(): Collection {
  return getDB().collection('invoices');
}

export function getSettingsCollection(): Collection {
  return getDB().collection('settings');
}

export function getArchivedAccountsCollection(): Collection {
  return getDB().collection('archivedAccounts');
}

export function getCostEventsCollection(): Collection {
  return getDB().collection('costEvents');
}

export function getCurrentAffairsCacheCollection(): Collection {
  return getDB().collection('currentAffairsCache');
}

export function getMediaJobsCollection(): Collection {
  return getDB().collection('mediaJobs');
}

// ----- Helpers -----

/**
 * Convert MongoDB document (with _id) to API format (with id string).
 * Also transforms instagramCredentials to instagramConnection (public-safe).
 */
export function toApiFormat<T extends Document>(doc: WithId<T> | null): (Omit<T, '_id'> & { id: string }) | null {
  if (!doc) return null;
  const { _id, instagramCredentials, ...rest } = doc as any;

  const result: any = { ...rest, id: _id.toString() };

  if (instagramCredentials) {
    const tokenExpiresAt = instagramCredentials.tokenExpiresAt
      ? new Date(instagramCredentials.tokenExpiresAt)
      : null;
    const now = new Date();
    const daysUntilExpiry = tokenExpiresAt
      ? Math.floor((tokenExpiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      : null;

    let tokenStatus: 'valid' | 'expiring_soon' | 'expired' = 'valid';
    if (daysUntilExpiry !== null) {
      if (daysUntilExpiry <= 0) {
        tokenStatus = 'expired';
      } else if (daysUntilExpiry <= 7) {
        tokenStatus = 'expiring_soon';
      }
    }

    result.instagramConnection = {
      connected: true,
      username: instagramCredentials.username,
      userId: instagramCredentials.userId,
      pageName: instagramCredentials.pageName,
      connectedAt: instagramCredentials.connectedAt,
      tokenStatus,
      needsReauthorization: tokenStatus === 'expired',
    };
  }

  return result as Omit<T, '_id'> & { id: string };
}

export function toApiFormatArray<T extends Document>(docs: WithId<T>[]): (Omit<T, '_id'> & { id: string })[] {
  return docs.map((doc) => toApiFormat(doc)!);
}

/**
 * Convert string ID to ObjectId when valid, otherwise return as string
 * (supports custom string IDs like 'r1', 'p1' used in seed data).
 */
export function toObjectId(id: string): ObjectId | string {
  if (ObjectId.isValid(id) && id.length === 24) {
    return new ObjectId(id);
  }
  return id;
}

export { ObjectId } from 'mongodb';
