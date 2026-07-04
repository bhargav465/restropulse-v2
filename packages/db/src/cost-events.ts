/**
 * @restropulse/db - Cost events collection helpers
 *
 * Each AI/external API call writes a single row. Used by the per-restaurant
 * billing dashboards and the per-post audit dashboard (see ADR 0001).
 */

import { getCostEventsCollection, toApiFormat, toApiFormatArray } from './connection.js';
import type { CostEvent } from '@restropulse/shared';

export async function insertCostEvent(event: Omit<CostEvent, 'id'>): Promise<CostEvent> {
  const col = getCostEventsCollection();
  const doc = { ...event, createdAt: event.createdAt ?? new Date() };
  const result = await col.insertOne(doc as any);
  return { ...doc, id: result.insertedId.toString() } as CostEvent;
}

export async function findCostEventsByPost(postId: string): Promise<CostEvent[]> {
  const col = getCostEventsCollection();
  const docs = await col.find({ postId }).sort({ createdAt: 1 }).toArray();
  return toApiFormatArray(docs) as CostEvent[];
}

export async function findCostEventsByRestaurant(
  restaurantId: string,
  range?: { from: Date; to: Date },
): Promise<CostEvent[]> {
  const col = getCostEventsCollection();
  const filter: Record<string, unknown> = { restaurantId };
  if (range) {
    filter.createdAt = { $gte: range.from, $lte: range.to };
  }
  const docs = await col.find(filter).sort({ createdAt: 1 }).toArray();
  return toApiFormatArray(docs) as CostEvent[];
}

export async function sumCostByRestaurant(
  restaurantId: string,
  range?: { from: Date; to: Date },
): Promise<number> {
  const events = await findCostEventsByRestaurant(restaurantId, range);
  return events.reduce((acc, e) => acc + (e.costUsd ?? 0), 0);
}
