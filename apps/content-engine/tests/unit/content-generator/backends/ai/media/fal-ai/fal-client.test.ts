import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { FalClient } = await import(
  '../../../../../../../src/services/content-generator/backends/ai/media/fal-ai/fal-client.js'
);

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  (globalThis as any).fetch = fetchMock;
});

const sampleImageResponse = {
  images: [{ url: 'https://fal.media/files/abc.jpg', width: 1024, height: 1024 }],
  seed: 42,
  has_nsfw_concepts: [false],
  prompt: 'a paneer tikka platter',
};

describe('FalClient', () => {
  it('throws when constructed without an apiKey', () => {
    expect(() => new FalClient({ apiKey: '' })).toThrow(/api ?key/i);
  });

  it('generateImage POSTs to fal.run/<model> with prompt + size + auth header', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => sampleImageResponse });
    const client = new FalClient({ apiKey: 'fal-test' });
    const out = await client.generateImage({
      model: 'fal-ai/flux/dev',
      prompt: 'a paneer tikka platter',
      imageSize: 'square_hd',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://fal.run/fal-ai/flux/dev');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Key fal-test');
    expect(init.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body);
    expect(body.prompt).toBe('a paneer tikka platter');
    expect(body.image_size).toBe('square_hd');
    expect(body.num_images).toBe(1);

    expect(out.images).toHaveLength(1);
    expect(out.images[0].url).toBe('https://fal.media/files/abc.jpg');
    expect(out.images[0].width).toBe(1024);
    expect(out.modelId).toBe('fal-ai/flux/dev');
  });

  it('editImage POSTs image_url + strength + prompt for img2img', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => sampleImageResponse });
    const client = new FalClient({ apiKey: 'k' });
    await client.editImage({
      model: 'fal-ai/flux/dev/image-to-image',
      prompt: 'warmer lighting',
      imageUrl: 'https://example.com/base.jpg',
      strength: 0.6,
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.prompt).toBe('warmer lighting');
    expect(body.image_url).toBe('https://example.com/base.jpg');
    expect(body.strength).toBe(0.6);
  });

  it('throws TransientError on 503', async () => {
    const { TransientError } = await import(
      '../../../../../../../src/services/content-generator/backends/ai/errors.js'
    );
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, headers: new Map(), json: async () => ({}), text: async () => '{}' });
    const client = new FalClient({ apiKey: 'k' });
    await expect(client.generateImage({ model: 'fal-ai/flux/dev', prompt: 'p' })).rejects.toBeInstanceOf(TransientError);
  });

  it('throws RateLimitError on 429 honoring retry-after', async () => {
    const { RateLimitError } = await import(
      '../../../../../../../src/services/content-generator/backends/ai/errors.js'
    );
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, headers: new Map([['retry-after', '4']]), json: async () => ({}), text: async () => '{}' });
    const client = new FalClient({ apiKey: 'k' });
    await expect(client.generateImage({ model: 'fal-ai/flux/dev', prompt: 'p' })).rejects.toBeInstanceOf(RateLimitError);
  });

  it('passes 4xx (non-429) errors through unchanged', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 422, headers: new Map(), json: async () => ({ error: 'bad prompt' }), text: async () => '{}' });
    const client = new FalClient({ apiKey: 'k' });
    await expect(client.generateImage({ model: 'fal-ai/flux/dev', prompt: 'p' })).rejects.toThrow();
  });

  it('handles empty images array gracefully (returns empty list, not crash)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ images: [] }) });
    const client = new FalClient({ apiKey: 'k' });
    const out = await client.generateImage({ model: 'fal-ai/flux/dev', prompt: 'p' });
    expect(out.images).toEqual([]);
  });
});
