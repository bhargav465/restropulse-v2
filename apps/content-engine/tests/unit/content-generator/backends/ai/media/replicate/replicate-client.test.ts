import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { ReplicateClient } = await import(
  '../../../../../../../../src/services/content-generator/backends/ai/media/replicate/replicate-client.js'
);

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => vi.clearAllMocks());

function okResponse(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    headers: { entries: () => [] } as any,
  });
}

function errorResponse(status: number) {
  return Promise.resolve({
    ok: false,
    status,
    json: () => Promise.resolve({ detail: 'error' }),
    headers: { [Symbol.iterator]: function* () {} } as any,
  });
}

describe('ReplicateClient', () => {
  it('throws if apiKey is empty', () => {
    expect(() => new ReplicateClient({ apiKey: '' })).toThrow();
  });

  it('createPrediction posts to the correct endpoint with Bearer auth', async () => {
    const client = new ReplicateClient({ apiKey: 'r8_test' });
    const predictionResponse = { id: 'pred_1', status: 'starting', output: null };
    mockFetch.mockReturnValueOnce(okResponse(predictionResponse));

    const result = await client.createPrediction('black-forest-labs/flux-dev', { prompt: 'pizza' });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.replicate.com/v1/models/black-forest-labs/flux-dev/predictions');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer r8_test');
    expect(JSON.parse(init.body)).toEqual({ input: { prompt: 'pizza' } });
    expect(result).toEqual(predictionResponse);
  });

  it('getPrediction calls the predictions endpoint', async () => {
    const client = new ReplicateClient({ apiKey: 'r8_test' });
    const done = { id: 'pred_1', status: 'succeeded', output: ['https://replicate.delivery/img.webp'] };
    mockFetch.mockReturnValueOnce(okResponse(done));

    const result = await client.getPrediction('pred_1');

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.replicate.com/v1/predictions/pred_1');
    expect(result).toEqual(done);
  });

  it('throws TransientError on 503', async () => {
    const client = new ReplicateClient({ apiKey: 'r8_test' });
    mockFetch.mockReturnValueOnce(errorResponse(503));
    await expect(client.createPrediction('black-forest-labs/flux-dev', {})).rejects.toMatchObject({ name: 'TransientError' });
  });

  it('throws RateLimitError on 429', async () => {
    const client = new ReplicateClient({ apiKey: 'r8_test' });
    mockFetch.mockReturnValueOnce(errorResponse(429));
    await expect(client.createPrediction('black-forest-labs/flux-dev', {})).rejects.toMatchObject({ name: 'RateLimitError' });
  });

  it('throws TransientError on network failure', async () => {
    const client = new ReplicateClient({ apiKey: 'r8_test' });
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(client.createPrediction('black-forest-labs/flux-dev', {})).rejects.toMatchObject({ name: 'TransientError' });
  });
});
