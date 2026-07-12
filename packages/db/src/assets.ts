/**
 * @restropulse/db - GridFS asset storage (net-new, Brief 04).
 *
 * Stores restaurant logo/cover images in a GridFS bucket named `assets`
 * (collections `assets.files` / `assets.chunks`; the driver auto-creates its
 * own required indexes). Rides the existing `MONGODB_URI` — zero new infra.
 *
 * This is the GridFS implementation behind the `AssetStore` seam in
 * `apps/api/src/services/assets.ts`; an Azure Blob impl swaps in there later
 * (NEXT.md §11) without changing the `/api/assets/:id` URL shape.
 */

import { GridFSBucket, ObjectId } from 'mongodb';
import type { Readable } from 'node:stream';
import { getDB, toObjectId } from './connection.js';

const BUCKET_NAME = 'assets';

/** Returns the shared `assets` GridFS bucket (uses the singleton connection). */
export function getAssetsBucket(): GridFSBucket {
  return new GridFSBucket(getDB(), { bucketName: BUCKET_NAME });
}

export interface AssetUploadMetadata {
  restaurantId: string;
  kind: 'logo' | 'cover';
}

/**
 * Uploads a buffer to the `assets` bucket and resolves with the new file id
 * (24-char hex string). Write-once: replacing an asset creates a new id.
 */
export function uploadAsset(
  buffer: Buffer,
  opts: { filename: string; contentType: string; metadata: AssetUploadMetadata },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const bucket = getAssetsBucket();
    const stream = bucket.openUploadStream(opts.filename, {
      contentType: opts.contentType,
      metadata: opts.metadata,
    });
    stream.on('error', reject);
    stream.on('finish', () => resolve(stream.id.toString()));
    stream.end(buffer);
  });
}

export interface AssetDownload {
  stream: Readable;
  contentType: string;
  length: number;
}

/**
 * Opens a download stream for an asset id, or resolves `null` when the id is
 * malformed or unknown. Reuses the `toObjectId` safety guard — a non-ObjectId
 * string can never match a GridFS file, so it short-circuits to null.
 */
export async function openAssetDownload(id: string): Promise<AssetDownload | null> {
  const oid = toObjectId(id);
  if (!(oid instanceof ObjectId)) return null;

  const bucket = getAssetsBucket();
  const files = await bucket.find({ _id: oid }).limit(1).toArray();
  const file = files[0];
  if (!file) return null;

  return {
    stream: bucket.openDownloadStream(oid),
    contentType: file.contentType ?? 'application/octet-stream',
    length: file.length,
  };
}

/**
 * Ensures the query index used to list a restaurant's assets. Called from
 * `startServer()` next to the other ensure-index calls (Brief 03 pattern);
 * idempotent and safe to run every boot.
 */
export async function ensureAssetIndexes(): Promise<void> {
  try {
    await getDB().collection(`${BUCKET_NAME}.files`).createIndex({ 'metadata.restaurantId': 1 });
  } catch (err) {
    // 85 = IndexOptionsConflict, 86 = IndexKeySpecsConflict — already exists.
    const code = (err as { code?: number }).code;
    if (code !== 85 && code !== 86) throw err;
  }
}
