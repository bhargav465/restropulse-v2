import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { AzureBlobMediaStorage } = await import('../../../src/services/media-storage/azure-blob-media-storage.js');

const CONTAINER_URL = 'https://restropulsemediaprod.blob.core.windows.net/restropulse';
const SOURCE = 'https://replicate.delivery/xezq/abc/out-0.webp';

function makeContainer(createImpl?: () => Promise<unknown>) {
  const uploads: Array<{ name: string; data: Buffer; options: any }> = [];
  const container = {
    url: CONTAINER_URL,
    createIfNotExists: vi.fn(createImpl ?? (async () => ({}))),
    getBlockBlobClient: vi.fn((name: string) => ({
      url: `${CONTAINER_URL}/${name}`,
      uploadData: vi.fn(async (data: Buffer, options: any) => {
        uploads.push({ name, data, options });
        return {};
      }),
    })),
  };
  return { container, uploads };
}

function media(contentType = 'image/webp', body: Uint8Array = new Uint8Array([1, 2, 3]), init: ResponseInit = {}) {
  return new Response(body, { status: 200, headers: { 'content-type': contentType }, ...init });
}

function makeStorage(opts: {
  fetchFn: ReturnType<typeof vi.fn>;
  container: unknown;
  attempts?: number;
  maxBytes?: number;
}) {
  const sleep = vi.fn(async () => undefined);
  const storage = new AzureBlobMediaStorage({
    connectionString: 'unused',
    containerName: 'restropulse',
    containerClient: opts.container as never,
    fetchFn: opts.fetchFn as never,
    sleep,
    ...(opts.attempts ? { attempts: opts.attempts } : {}),
    ...(opts.maxBytes ? { maxBytes: opts.maxBytes } : {}),
  });
  return { storage, sleep };
}

beforeEach(() => vi.clearAllMocks());

describe('AzureBlobMediaStorage', () => {
  it('flags itself as durable', () => {
    const { container } = makeContainer();
    const { storage } = makeStorage({ fetchFn: vi.fn(), container });
    expect(storage.durable).toBe(true);
    expect(storage.name).toBe('azure-blob');
  });

  it('copies the source into the container and returns the durable URL', async () => {
    const { container, uploads } = makeContainer();
    const fetchFn = vi.fn(async () => media());
    const { storage } = makeStorage({ fetchFn, container });

    const url = await storage.persist(SOURCE, { restaurantId: 'r1', postId: 'p1' });

    expect(fetchFn).toHaveBeenCalledWith(SOURCE, expect.objectContaining({ signal: expect.anything() }));
    expect(url).toMatch(new RegExp(`^${CONTAINER_URL}/r1/p1/[0-9a-f-]{36}\\.webp$`));
    expect(uploads).toHaveLength(1);
    expect(uploads[0].data.equals(Buffer.from([1, 2, 3]))).toBe(true);
    expect(uploads[0].options.blobHTTPHeaders).toEqual({
      blobContentType: 'image/webp',
      blobCacheControl: 'public, max-age=31536000, immutable',
    });
  });

  it('creates the container once, with public blob read access', async () => {
    const { container } = makeContainer();
    const { storage } = makeStorage({ fetchFn: vi.fn(async () => media()), container });

    await storage.persist(SOURCE, { restaurantId: 'r1', postId: 'p1' });
    await storage.persist(SOURCE, { restaurantId: 'r1', postId: 'p2' });

    expect(container.createIfNotExists).toHaveBeenCalledOnce();
    expect(container.createIfNotExists).toHaveBeenCalledWith({ access: 'blob' });
  });

  it('retries container creation after a failure', async () => {
    let calls = 0;
    const { container } = makeContainer(async () => {
      if (++calls === 1) throw new Error('transient');
      return {};
    });
    const { storage } = makeStorage({ fetchFn: vi.fn(async () => media()), container });

    // First persist attempt fails creating the container, the internal retry succeeds.
    await expect(storage.persist(SOURCE, { postId: 'p1' })).resolves.toContain('/p1/');
    expect(container.createIfNotExists).toHaveBeenCalledTimes(2);
  });

  it('returns already-durable URLs untouched, without fetching', async () => {
    const { container } = makeContainer();
    const fetchFn = vi.fn();
    const { storage } = makeStorage({ fetchFn, container });
    const durable = `${CONTAINER_URL}/r1/p1/x.webp`;

    expect(await storage.persist(durable, { postId: 'p1' })).toBe(durable);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('falls back to jobId, then placeholders, in the blob path', async () => {
    const { container } = makeContainer();
    const { storage } = makeStorage({ fetchFn: vi.fn(async () => media()), container });

    expect(await storage.persist(SOURCE, { restaurantId: 'r1', jobId: 'job9' })).toContain('/r1/job9/');
    expect(await storage.persist(SOURCE, {})).toContain('/_unassigned/_misc/');
  });

  it('derives the extension from the content type, else from the URL, else bin', async () => {
    const { container } = makeContainer();
    const responses = [media('video/mp4'), media('image/avif'), media('image/svg+xml')];
    const fetchFn = vi.fn(async () => responses.shift()!);
    const { storage } = makeStorage({ fetchFn, container });

    expect(await storage.persist('https://x/y/clip', { postId: 'a' })).toMatch(/\.mp4$/);
    expect(await storage.persist('https://x/y/photo.avif?sig=1', { postId: 'b' })).toMatch(/\.avif$/);
    expect(await storage.persist('https://x/y/nodot', { postId: 'c' })).toMatch(/\.bin$/);
  });

  it('does not retry when the source is gone (4xx)', async () => {
    const { container, uploads } = makeContainer();
    const fetchFn = vi.fn(async () => new Response('gone', { status: 404 }));
    const { storage, sleep } = makeStorage({ fetchFn, container });

    await expect(storage.persist(SOURCE, { postId: 'p1' })).rejects.toThrow('media persistence failed: source fetch returned HTTP 404');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(uploads).toHaveLength(0);
  });

  it('retries transient failures (5xx, network) with backoff and then succeeds', async () => {
    const { container } = makeContainer();
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(media());
    const { storage, sleep } = makeStorage({ fetchFn, container });

    await expect(storage.persist(SOURCE, { postId: 'p1' })).resolves.toContain('/p1/');
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 500);
    expect(sleep).toHaveBeenNthCalledWith(2, 2000);
  });

  it('treats HTTP 429 as retryable', async () => {
    const { container } = makeContainer();
    const fetchFn = vi.fn().mockResolvedValueOnce(new Response('slow down', { status: 429 })).mockResolvedValueOnce(media());
    const { storage } = makeStorage({ fetchFn, container });

    await expect(storage.persist(SOURCE, { postId: 'p1' })).resolves.toBeTruthy();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('gives up after the configured attempts and reports the last error', async () => {
    const { container } = makeContainer();
    const fetchFn = vi.fn(async () => new Response('busy', { status: 503 }));
    const { storage } = makeStorage({ fetchFn, container, attempts: 2 });

    await expect(storage.persist(SOURCE, { postId: 'p1' })).rejects.toThrow('source fetch returned HTTP 503');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('rejects non-media content types without retrying', async () => {
    const { container } = makeContainer();
    const fetchFn = vi.fn(async () => media('text/html'));
    const { storage } = makeStorage({ fetchFn, container });

    await expect(storage.persist(SOURCE, { postId: 'p1' })).rejects.toThrow('unexpected content-type "text/html"');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('reports a missing content-type as unexpected', async () => {
    const { container } = makeContainer();
    const fetchFn = vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 }));
    const { storage } = makeStorage({ fetchFn, container });

    await expect(storage.persist(SOURCE, { postId: 'p1' })).rejects.toThrow('unexpected content-type');
  });

  it('rejects oversize sources by declared content-length', async () => {
    const { container } = makeContainer();
    const fetchFn = vi.fn(async () => media('image/webp', new Uint8Array([1]), { headers: { 'content-type': 'image/webp', 'content-length': '999999' } }));
    const { storage } = makeStorage({ fetchFn, container, maxBytes: 1000 });

    await expect(storage.persist(SOURCE, { postId: 'p1' })).rejects.toThrow('over the 1000 byte limit');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('rejects oversize sources by actual body length', async () => {
    const { container } = makeContainer();
    const fetchFn = vi.fn(async () => media('image/webp', new Uint8Array(2000)));
    const { storage } = makeStorage({ fetchFn, container, maxBytes: 1000 });

    await expect(storage.persist(SOURCE, { postId: 'p1' })).rejects.toThrow('over the 1000 byte limit');
  });

  it('rejects an empty body', async () => {
    const { container } = makeContainer();
    const fetchFn = vi.fn(async () => media('image/webp', new Uint8Array(0)));
    const { storage } = makeStorage({ fetchFn, container, attempts: 1 });

    await expect(storage.persist(SOURCE, { postId: 'p1' })).rejects.toThrow('empty body');
  });
});
