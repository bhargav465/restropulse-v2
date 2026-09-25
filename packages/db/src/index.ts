/**
 * @restropulse/db - Barrel export
 * Central entry point for all database operations.
 */

export {
  connectDB,
  disconnectDB,
  getDB,
  setDB,
  getConfig,
  getUsersCollection,
  getRestaurantsCollection,
  getPostsCollection,
  getStrategyCyclesCollection,
  getContentStrategiesCollection,
  getCostEventsCollection,
  getCurrentAffairsCacheCollection,
  getMediaJobsCollection,
  getSessionsCollection,
  getOtpChallengesCollection,
  getOauthSessionsCollection,
  getDataDeletionAuditsCollection,
  getAccountManagersCollection,
  getCitiesCollection,
  getSubscriptionPlansCollection,
  getSubscriptionsCollection,
  getCouponsCollection,
  getCouponRedemptionsCollection,
  getCreditPurchasesCollection,
  getCreditPacksCollection,
  getInvoicesCollection,
  getSettingsCollection,
  getArchivedAccountsCollection,
  toApiFormat,
  toApiFormatArray,
  toObjectId,
  ObjectId,
} from './connection.js';

export type { DatabaseConfig } from './connection.js';

export * from './users.js';
export * from './restaurants.js';
export * from './posts.js';
export * from './strategy.js';
export * from './account-managers.js';
export * from './cities.js';
export * from './subscription-plans.js';
export * from './subscriptions.js';
export * from './coupons.js';
export * from './credit-packs.js';
export * from './invoices.js';
export * from './archived-accounts.js';
export * from './cost-events.js';
export * from './media-jobs.js';
export * from './intelligence.js';
export * from './settings.js';
