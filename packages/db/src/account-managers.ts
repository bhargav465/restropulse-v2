/**
 * @restropulse/db - Account Managers collection helpers
 */

import { getAccountManagersCollection, toApiFormatArray } from './connection.js';
import type { AccountManager } from '@restropulse/shared';

export async function getAccountManagersByCity(city: string): Promise<AccountManager[]> {
  const col = getAccountManagersCollection();
  const docs = await col.find({ city: { $regex: new RegExp(`^${city}$`, 'i') } }).toArray();
  return toApiFormatArray(docs) as AccountManager[];
}

export async function getAccountManagersByCityAndZone(
  city: string,
  zone?: string,
): Promise<AccountManager[]> {
  const col = getAccountManagersCollection();
  const query: Record<string, any> = { city: { $regex: new RegExp(`^${city}$`, 'i') } };
  if (zone) {
    query.zone = { $regex: new RegExp(`^${zone}$`, 'i') };
  }
  const docs = await col.find(query).toArray();
  return toApiFormatArray(docs) as AccountManager[];
}
