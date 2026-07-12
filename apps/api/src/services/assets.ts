/**
 * Asset storage seam (Brief 04 / DESIGN-04 §UPLOADS).
 *
 * Routes talk ONLY to `assetStore` (an `AssetStore`), never to GridFS directly,
 * so the storage backend can be swapped without touching route code. GridFS is
 * the sole implementation today (`packages/db/src/assets.ts`); an Azure Blob
 * impl slots in behind this same interface later (NEXT.md §11) — the
 * `/api/assets/:id` URL shape is unchanged by the swap.
 */

import {
  uploadAsset,
  openAssetDownload,
  type AssetUploadMetadata,
  type AssetDownload,
} from '@restropulse/db';

export interface AssetStore {
  put(buffer: Buffer, opts: { filename: string; contentType: string; metadata: AssetUploadMetadata }): Promise<string>;
  openDownload(id: string): Promise<AssetDownload | null>;
}

/** GridFS-backed asset store (the only impl in v1). */
export const assetStore: AssetStore = {
  put: (buffer, opts) => uploadAsset(buffer, opts),
  openDownload: (id) => openAssetDownload(id),
};

// ----- Image validation (extension AND MIME AND that they agree) -----

/** Allowed upload MIME types. */
export const ALLOWED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** Allowed file extensions (lower-case, incl. leading dot). */
export const ALLOWED_IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp'] as const;

/** Max upload size in bytes (5 MB). */
export const MAX_ASSET_BYTES = 5 * 1024 * 1024;

/** The rejection message shared by every image-validation failure. */
export const IMAGE_REJECT_MESSAGE = 'Only PNG, JPEG or WebP images up to 5 MB';

/** Extension → the MIME type it must agree with (jpg and jpeg both map to jpeg). */
const EXT_TO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

/** Lower-cases and returns the file extension (incl. dot), or '' when none. */
function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot).toLowerCase();
}

/**
 * Validates an uploaded image: extension ∈ allow-list, MIME ∈ allow-list, and
 * the two agree. Returns `true` only when all three hold.
 */
export function isValidImageUpload(filename: string, mimetype: string): boolean {
  const ext = extensionOf(filename);
  const mime = (mimetype || '').toLowerCase();
  if (!(ALLOWED_IMAGE_EXT as readonly string[]).includes(ext)) return false;
  if (!(ALLOWED_IMAGE_MIME as readonly string[]).includes(mime)) return false;
  return EXT_TO_MIME[ext] === mime;
}
