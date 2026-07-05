/**
 * @restropulse/db - Coupons collection helpers
 */

import {
  getCouponsCollection,
  getCouponRedemptionsCollection,
  toApiFormat,
  toApiFormatArray,
  toObjectId,
} from './connection.js';
import type { Coupon, CouponRedemption } from '@restropulse/shared';

export async function findCouponByCode(code: string): Promise<Coupon | null> {
  const col = getCouponsCollection();
  const doc = await col.findOne({ code: code.toUpperCase() });
  return toApiFormat(doc) as Coupon | null;
}

export async function findCouponById(id: string): Promise<Coupon | null> {
  const col = getCouponsCollection();
  const doc = await col.findOne({ _id: toObjectId(id) as any });
  return toApiFormat(doc) as Coupon | null;
}

export async function createCoupon(coupon: Omit<Coupon, 'id'>): Promise<Coupon> {
  const col = getCouponsCollection();
  const now = new Date();
  const result = await col.insertOne({
    ...coupon,
    code: coupon.code.toUpperCase(),
    createdAt: now,
    updatedAt: now,
  });
  return { ...coupon, id: result.insertedId.toString() } as Coupon;
}

export async function updateCoupon(
  id: string,
  updates: Partial<Coupon>,
): Promise<Coupon | null> {
  const col = getCouponsCollection();
  const result = await col.findOneAndUpdate(
    { _id: toObjectId(id) as any },
    { $set: { ...updates, updatedAt: new Date() } },
    { returnDocument: 'after' },
  );
  return toApiFormat(result) as Coupon | null;
}

export async function findAllCoupons(): Promise<Coupon[]> {
  const col = getCouponsCollection();
  const docs = await col.find({}).sort({ createdAt: -1 }).toArray();
  return toApiFormatArray(docs) as Coupon[];
}

export async function incrementCouponRedemptions(id: string): Promise<void> {
  const col = getCouponsCollection();
  await col.updateOne(
    { _id: toObjectId(id) as any },
    { $inc: { redemptionCount: 1 }, $set: { updatedAt: new Date() } },
  );
}

export async function createCouponRedemption(
  redemption: Omit<CouponRedemption, 'id'>,
): Promise<CouponRedemption> {
  const col = getCouponRedemptionsCollection();
  const result = await col.insertOne({
    ...redemption,
    redeemedAt: new Date(),
  });
  return { ...redemption, id: result.insertedId.toString() } as CouponRedemption;
}

export async function hasRestaurantRedeemedCoupon(
  couponId: string,
  restaurantId: string,
): Promise<boolean> {
  const col = getCouponRedemptionsCollection();
  const doc = await col.findOne({ couponId, restaurantId });
  return doc !== null;
}
