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

describe('FalClient queue API', () => {
  it('submitToQueue POSTs to queue.fal.run/<model> and returns the requestId', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ request_id: 'req_abc', status_url: 's', response_url: 'r' }),
    });
    const client = new FalClient({ apiKey: 'k' });
    const out = await client.submitToQueue('fal-ai/kling-video/v1.6/standard/text-to-video', { prompt: 'a kitchen reel' });
    expect(out.requestId).toBe('req_abc');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://queue.fal.run/fal-ai/kling-video/v1.6/standard/text-to-video');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Key k');
    expect(JSON.parse(init.body).prompt).toBe('a kitchen reel');
  });

  it('getQueueStatus GETs status URL and returns the status value', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ status: 'IN_PROGRESS', queue_position: 0 }),
    });
    const client = new FalClient({ apiKey: 'k' });
    const out = await client.getQueueStatus('fal-ai/kling-video/v1.6/standard/text-to-video', 'req_abc');
    expect(out.status).toBe('IN_PROGRESS');
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://queue.fal.run/fal-ai/kling-video/v1.6/standard/text-to-video/requests/req_abc/status');
  });

  it('getQueueResult GETs result URL and returns the typed response shape', async () => {
    const videoResponse = {
      video: { url: 'https://fal.media/v.mp4', file_size: 1024 },
      seed: 7,
    };
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => videoResponse });
    const client = new FalClient({ apiKey: 'k' });
    const out = await client.getQueueResult('fal-ai/kling-video/v1.6/standard/text-to-video', 'req_abc');
    expect((out as any).video.url).toBe('https://fal.media/v.mp4');
  });

  it('submitToQueue propagates 5xx as TransientError', async () => {
    const { TransientError } = await import(
      '../../../../../../../src/services/content-generator/backends/ai/errors.js'
    );
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, headers: new Map(), json: async () => ({}), text: async () => '{}' });
    const client = new FalClient({ apiKey: 'k' });
    await expect(client.submitToQueue('fal-ai/kling-video/v1.6/standard/text-to-video', { prompt: 'x' })).rejects.toBeInstanceOf(TransientError);
  });

  it('getQueueStatus surfaces 404 as a regular Error (not retryable)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, headers: new Map(), json: async () => ({}), text: async () => '{}' });
    const client = new FalClient({ apiKey: 'k' });
    await expect(client.getQueueStatus('fal-ai/kling-video/v1.6/standard/text-to-video', 'req_abc')).rejects.toThrow();
  });
});
