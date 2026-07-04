/**
 * @restropulse/db - Users collection helpers
 */

import { getUsersCollection, toApiFormat, toObjectId } from './connection.js';
import type { User } from '@restropulse/shared';

export async function findUserByEmail(email: string): Promise<User | null> {
  const col = getUsersCollection();
  const doc = await col.findOne({ email });
  return toApiFormat(doc) as User | null;
}

export async function findUserByPhone(phone: string): Promise<User | null> {
  const col = getUsersCollection();
  const doc = await col.findOne({ phone });
  return toApiFormat(doc) as User | null;
}

export async function findUserById(id: string): Promise<User | null> {
  const col = getUsersCollection();
  const doc = await col.findOne({ _id: toObjectId(id) as any });
  return toApiFormat(doc) as User | null;
}

export async function findUserByFirebaseUid(firebaseUid: string): Promise<User | null> {
  const col = getUsersCollection();
  const doc = await col.findOne({ firebaseUid });
  return toApiFormat(doc) as User | null;
}

export async function findUserByRestaurantId(restaurantId: string): Promise<User | null> {
  const col = getUsersCollection();
  const doc = await col.findOne({ restaurantId });
  return toApiFormat(doc) as User | null;
}

export async function createUser(user: Omit<User, 'id'>): Promise<User> {
  const col = getUsersCollection();
  const result = await col.insertOne({
    ...user,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return { ...user, id: result.insertedId.toString() } as User;
}

export async function updateUser(id: string, updates: Partial<User>): Promise<User | null> {
  const col = getUsersCollection();
  const result = await col.findOneAndUpdate(
    { _id: toObjectId(id) as any },
    { $set: { ...updates, updatedAt: new Date() } },
    { returnDocument: 'after' },
  );
  return toApiFormat(result) as User | null;
}
