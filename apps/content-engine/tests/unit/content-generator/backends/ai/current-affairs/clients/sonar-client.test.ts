import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { SonarClient } = await import(
  '../../../../../../../src/services/content-generator/backends/ai/current-affairs/clients/sonar-client.js'
);

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  (globalThis as any).fetch = fetchMock;
});

const sampleResponse = {
  choices: [{ message: { content: 'Sample current-affairs answer.' } }],
  usage: { prompt_tokens: 50, completion_tokens: 80 },
};

describe('SonarClient', () => {
  it('throws when constructed without an apiKey', () => {
    expect(() => new SonarClient({ apiKey: '' })).toThrow(/api ?key/i);
  });

  it('posts a chat completion to the Perplexity endpoint and returns text + usage', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => sampleResponse });
    const client = new SonarClient({ apiKey: 'pplx-test' });
    const out = await client.query('What is happening in Bengaluru today?');
    expect(out.text).toBe('Sample current-affairs answer.');
    expect(out.usage.inputTokens).toBe(50);
    expect(out.usage.outputTokens).toBe(80);
    expect(out.modelId).toBe('sonar-pro');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.perplexity.ai/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer pplx-test');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('sonar-pro');
    expect(body.messages[0].content).toBe('What is happening in Bengaluru today?');
  });

  it('allows overriding the model', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => sampleResponse });
    const client = new SonarClient({ apiKey: 'k', model: 'sonar' });
    await client.query('hi');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe('sonar');
  });

  it('throws TransientError on 503', async () => {
    const { TransientError } = await import(
      '../../../../../../../src/services/content-generator/backends/ai/errors.js'
    );
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      headers: new Map(),
      json: async () => ({}),
      text: async () => '{}',
    });
    const client = new SonarClient({ apiKey: 'k' });
    await expect(client.query('q')).rejects.toBeInstanceOf(TransientError);
  });

  it('throws RateLimitError on 429', async () => {
    const { RateLimitError } = await import(
      '../../../../../../../src/services/content-generator/backends/ai/errors.js'
    );
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Map([['retry-after', '2']]),
      json: async () => ({}),
      text: async () => '{}',
    });
    const client = new SonarClient({ apiKey: 'k' });
    await expect(client.query('q')).rejects.toBeInstanceOf(RateLimitError);
  });

  it('returns empty-string text when choices is missing (defensive)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ usage: { prompt_tokens: 10, completion_tokens: 0 } }),
    });
    const client = new SonarClient({ apiKey: 'k' });
    const out = await client.query('q');
    expect(out.text).toBe('');
  });
});
