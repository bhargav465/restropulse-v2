import { randomUUID } from 'node:crypto';
import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob';
import { createLogger } from '@restropulse/telemetry/server';
import type { IMediaStorage, PersistMediaContext } from './types.js';

const log = createLogger('azure-blob-media-storage');

const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;
const DEFAULT_FETCH_TIMEOUT_MS = 60_000;
const DEFAULT_ATTEMPTS = 3;
const BACKOFF_MS = [500, 2000];

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

/** A failure that retrying cannot fix (e.g. the source file is already gone). */
class NonRetryableError extends Error {}

export interface AzureBlobMediaStorageOptions {
  connectionString: string;
  containerName: string;
  /** Test seams. */
  containerClient?: ContainerClient;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxBytes?: number;
  attempts?: number;
}

function extensionFor(contentType: string, sourceUrl: string): string {
  const mapped = EXTENSION_BY_CONTENT_TYPE[contentType];
  if (mapped) return mapped;
  const match = sourceUrl.split('?')[0].match(/\.([a-zA-Z0-9]{2,5})$/);
  return match ? match[1].toLowerCase() : 'bin';
}

/**
 * Copies media into a public-read Azure Blob container. Blob names are
 * `{restaurantId}/{postId|jobId}/{uuid}.{ext}` -- unguessable, immutable, and
 * cacheable. The container is created on first use with blob-level public read,
 * because Meta's servers must be able to fetch the URL when publishing.
 */
export class AzureBlobMediaStorage implements IMediaStorage {
  readonly name = 'azure-blob';
  readonly durable = true;

  private readonly container: ContainerClient;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxBytes: number;
  private readonly attempts: number;
  private ensured: Promise<void> | null = null;

  constructor(options: AzureBlobMediaStorageOptions) {
    this.container =
      options.containerClient ??
      BlobServiceClient.fromConnectionString(options.connectionString).getContainerClient(options.containerName);
    this.fetchFn = options.fetchFn ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  }

  async persist(sourceUrl: string, context: PersistMediaContext): Promise<string> {
    // Already durable (e.g. a revised post reusing an existing blob): nothing to copy.
    if (sourceUrl.startsWith(`${this.container.url}/`)) return sourceUrl;

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      try {
        return await this.copyOnce(sourceUrl, context);
      } catch (err) {
        lastError = err;
        if (err instanceof NonRetryableError || attempt === this.attempts) break;
        const waitMs = BACKOFF_MS[attempt - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
        log.warn({ err, attempt, waitMs, postId: context.postId }, 'Media persist failed; retrying');
        await this.sleep(waitMs);
      }
    }
    log.error({ err: lastError, postId: context.postId, jobId: context.jobId }, 'Media persist failed');
    throw new Error(`media persistence failed: ${(lastError as Error)?.message ?? 'unknown error'}`);
  }

  private ensureContainer(): Promise<void> {
    if (this.ensured) return this.ensured;
    const attempt = this.container.createIfNotExists({ access: 'blob' }).then(() => undefined);
    this.ensured = attempt;
    attempt.catch(() => {
      if (this.ensured === attempt) this.ensured = null; // let the next persist retry creation
    });
    return attempt;
  }

  private async copyOnce(sourceUrl: string, context: PersistMediaContext): Promise<string> {
    await this.ensureContainer();

    const response = await this.fetchFn(sourceUrl, { signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS) });
    if (!response.ok) {
      const message = `source fetch returned HTTP ${response.status}`;
      // 4xx: the file is gone or forbidden; retrying will not bring it back.
      if (response.status >= 400 && response.status < 500 && response.status !== 429) throw new NonRetryableError(message);
      throw new Error(message);
    }

    const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!contentType.startsWith('image/') && !contentType.startsWith('video/')) {
      throw new NonRetryableError(`unexpected content-type "${contentType || 'none'}" from source`);
    }

    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > this.maxBytes) {
      throw new NonRetryableError(`source is ${declared} bytes, over the ${this.maxBytes} byte limit`);
    }
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length === 0) throw new Error('source returned an empty body');
    if (body.length > this.maxBytes) {
      throw new NonRetryableError(`source is ${body.length} bytes, over the ${this.maxBytes} byte limit`);
    }

    const blobName = `${context.restaurantId ?? '_unassigned'}/${context.postId ?? context.jobId ?? '_misc'}/${randomUUID()}.${extensionFor(contentType, sourceUrl)}`;
    const blob = this.container.getBlockBlobClient(blobName);
    await blob.uploadData(body, {
      blobHTTPHeaders: { blobContentType: contentType, blobCacheControl: 'public, max-age=31536000, immutable' },
    });
    return blob.url;
  }
}
