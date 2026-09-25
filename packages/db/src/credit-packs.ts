/**
 * @restropulse/db - Credit Packs collection helpers
 */

import {
  getCreditPacksCollection,
  getCreditPurchasesCollection,
  toApiFormat,
  toApiFormatArray,
  toObjectId,
} from './connection.js';
import type { CreditPack, CreditPurchase } from '@restropulse/shared';

export async function findActiveCreditPacks(): Promise<CreditPack[]> {
  const col = getCreditPacksCollection();
  const docs = await col.find({ isActive: true }).sort({ sortOrder: 1 }).toArray();
  return toApiFormatArray(docs) as CreditPack[];
}

export async function findCreditPackById(id: string): Promise<CreditPack | null> {
  const col = getCreditPacksCollection();
  const doc = await col.findOne({ _id: toObjectId(id) as any });
  return toApiFormat(doc) as CreditPack | null;
}

export async function createCreditPack(pack: Omit<CreditPack, 'id'>): Promise<CreditPack> {
  const col = getCreditPacksCollection();
  const now = new Date();
  const result = await col.insertOne({
    ...pack,
    createdAt: now,
    updatedAt: now,
  });
  return { ...pack, id: result.insertedId.toString() } as CreditPack;
}

export async function updateCreditPack(
  id: string,
  updates: Partial<CreditPack>,
): Promise<CreditPack | null> {
  const col = getCreditPacksCollection();
  const result = await col.findOneAndUpdate(
    { _id: toObjectId(id) as any },
    { $set: { ...updates, updatedAt: new Date() } },
    { returnDocument: 'after' },
  );
  return toApiFormat(result) as CreditPack | null;
}

export async function createCreditPurchase(
  purchase: Omit<CreditPurchase, 'id'>,
): Promise<CreditPurchase> {
  const col = getCreditPurchasesCollection();
  const now = new Date();
  const result = await col.insertOne({
    ...purchase,
    createdAt: now,
    updatedAt: now,
  });
  return { ...purchase, id: result.insertedId.toString() } as CreditPurchase;
}

export async function findCreditPurchaseByOrderId(
  razorpayOrderId: string,
): Promise<CreditPurchase | null> {
  const col = getCreditPurchasesCollection();
  const doc = await col.findOne({ razorpayOrderId });
  return toApiFormat(doc) as CreditPurchase | null;
}

export async function updateCreditPurchase(
  id: string,
  updates: Partial<CreditPurchase>,
): Promise<CreditPurchase | null> {
  const col = getCreditPurchasesCollection();
  const result = await col.findOneAndUpdate(
    { _id: toObjectId(id) as any },
    { $set: { ...updates, updatedAt: new Date() } },
    { returnDocument: 'after' },
  );
  return toApiFormat(result) as CreditPurchase | null;
}
