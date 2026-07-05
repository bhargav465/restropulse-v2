/**
 * @restropulse/db - Strategy collection helpers
 */

import {
  getStrategyCyclesCollection,
  getContentStrategiesCollection,
  toApiFormat,
  toApiFormatArray,
  toObjectId,
} from './connection.js';
import type { StrategyCycle, ContentStrategy } from '@restropulse/shared';

// ----- Content Strategy -----

export async function findContentStrategy(restaurantId: string): Promise<ContentStrategy | null> {
  const col = getContentStrategiesCollection();
  const doc = await col.findOne({ restaurantId });
  return toApiFormat(doc) as ContentStrategy | null;
}

export async function updateContentStrategy(
  restaurantId: string,
  updates: Partial<ContentStrategy>,
): Promise<ContentStrategy | null> {
  const col = getContentStrategiesCollection();
  const result = await col.findOneAndUpdate(
    { restaurantId },
    { $set: { ...updates, updatedAt: new Date() } },
    { returnDocument: 'after', upsert: true },
  );
  return toApiFormat(result) as ContentStrategy | null;
}

// ----- Strategy Cycles -----

export async function findAllCycles(restaurantId?: string): Promise<StrategyCycle[]> {
  const col = getStrategyCyclesCollection();
  const query = restaurantId ? { restaurantId } : {};
  const docs = await col.find(query).sort({ startDate: -1 }).toArray();
  return toApiFormatArray(docs) as StrategyCycle[];
}

export async function findCycleById(id: string): Promise<StrategyCycle | null> {
  const col = getStrategyCyclesCollection();
  const doc = await col.findOne({ _id: toObjectId(id) as any });
  return toApiFormat(doc) as StrategyCycle | null;
}

export async function createCycle(cycle: Omit<StrategyCycle, 'id'>): Promise<StrategyCycle> {
  const col = getStrategyCyclesCollection();
  const cycleWithTimestamps = {
    ...cycle,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const result = await col.insertOne(cycleWithTimestamps);
  return { ...cycle, id: result.insertedId.toString() } as StrategyCycle;
}

export async function updateCycle(id: string, updates: Partial<StrategyCycle>): Promise<StrategyCycle | null> {
  const col = getStrategyCyclesCollection();
  const result = await col.findOneAndUpdate(
    { _id: toObjectId(id) as any },
    { $set: { ...updates, updatedAt: new Date() } },
    { returnDocument: 'after' },
  );
  return toApiFormat(result) as StrategyCycle | null;
}
