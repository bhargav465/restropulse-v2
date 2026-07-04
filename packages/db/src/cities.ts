/**
 * @restropulse/db - Cities collection helpers
 */

import { getCitiesCollection, toApiFormatArray } from './connection.js';
import type { City } from '@restropulse/shared';

export async function getAllCities(): Promise<City[]> {
  const col = getCitiesCollection();
  const docs = await col.find({}).sort({ name: 1 }).toArray();
  return toApiFormatArray(docs) as City[];
}
