import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

const generateObjectMock = vi.fn();
const anthropicProviderFactoryMock = vi.fn((modelId: string) => ({ modelId }));

vi.mock('ai', () => ({
  generateObject: generateObjectMock,
}));

vi.mock('@ai-sdk/anthropic', () => ({
  anthropic: anthropicProviderFactoryMock,
}));

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { AnthropicLLMProvider } = await import(
  '../../../../../../src/services/content-generator/backends/ai/llm/anthropic-provider.js'
);
const { TransientError, RateLimitError } = await import(
  '../../../../../../src/services/content-generator/backends/ai/errors.js'
);

const Schema = z.object({ greeting: z.string() });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AnthropicLLMProvider', () => {
  it('exposes name "anthropic"', () => {
    const p = new AnthropicLLMProvider({ apiKey: 'sk-test' });
    expect(p.name).toBe('anthropic');
  });

  it('throws when constructed without an apiKey', () => {
    expect(() => new AnthropicLLMProvider({ apiKey: '' })).toThrow(/api ?key/i);
  });

  it('maps haiku/sonnet families to concrete Anthropic model ids', async () => {
    generateObjectMock.mockResolvedValue({
      object: { greeting: 'hi' },
      usage: { promptTokens: 100, completionTokens: 50 },
    });
    const p = new AnthropicLLMProvider({ apiKey: 'sk-test' });
    await p.generateObject({ model: 'haiku', system: 's', prompt: 'p', schema: Schema });
    expect(anthropicProviderFactoryMock).toHaveBeenCalledWith('claude-haiku-4-5-20251001');

    anthropicProviderFactoryMock.mockClear();
    await p.generateObject({ model: 'sonnet', system: 's', prompt: 'p', schema: Schema });
    expect(anthropicProviderFactoryMock).toHaveBeenCalledWith('claude-sonnet-4-6');
  });

  it('passes system + prompt + schema + cache control to generateObject', async () => {
    generateObjectMock.mockResolvedValue({
      object: { greeting: 'hi' },
      usage: { promptTokens: 100, completionTokens: 50 },
    });
    const p = new AnthropicLLMProvider({ apiKey: 'sk-test' });
    await p.generateObject({
      model: 'haiku',
      system: 'system fragment',
      prompt: 'user prompt',
      schema: Schema,
      telemetryAttributes: { operation: 'generatePost', restaurantId: 'r1' },
    });

    expect(generateObjectMock).toHaveBeenCalledTimes(1);
    const arg = generateObjectMock.mock.calls[0][0];
    expect(arg.system).toBe('system fragment');
    expect(arg.prompt).toBe('user prompt');
    expect(arg.schema).toBe(Schema);
    expect(arg.experimental_telemetry?.isEnabled).toBe(true);
    expect(arg.experimental_telemetry?.metadata).toMatchObject({ operation: 'generatePost', restaurantId: 'r1' });
    expect(arg.providerOptions?.anthropic?.cacheControl).toEqual({ type: 'ephemeral' });
  });

  it('returns object + usage with model id', async () => {
    generateObjectMock.mockResolvedValue({
      object: { greeting: 'hi' },
      usage: { promptTokens: 100, completionTokens: 50, cachedPromptTokens: 25 },
    });
    const p = new AnthropicLLMProvider({ apiKey: 'sk-test' });
    const out = await p.generateObject({
      model: 'sonnet',
      system: 's',
      prompt: 'p',
      schema: Schema,
    });
    expect(out.object).toEqual({ greeting: 'hi' });
    expect(out.usage.inputTokens).toBe(100);
    expect(out.usage.outputTokens).toBe(50);
    expect(out.usage.cacheReadTokens).toBe(25);
    expect(out.modelId).toBe('claude-sonnet-4-6');
  });

  it('classifies HTTP-shaped 429 errors as RateLimitError', async () => {
    generateObjectMock.mockRejectedValue({ status: 429, message: 'rate limited', headers: { 'retry-after': '3' } });
    const p = new AnthropicLLMProvider({ apiKey: 'sk-test' });
    await expect(
      p.generateObject({ model: 'haiku', system: 's', prompt: 'p', schema: Schema }),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it('classifies HTTP 502/503/504 as TransientError', async () => {
    generateObjectMock.mockRejectedValue({ status: 503, message: 'unavail' });
    const p = new AnthropicLLMProvider({ apiKey: 'sk-test' });
    await expect(
      p.generateObject({ model: 'haiku', system: 's', prompt: 'p', schema: Schema }),
    ).rejects.toBeInstanceOf(TransientError);
  });

  it('passes 4xx (non-429) errors through unchanged', async () => {
    const httpErr = { status: 400, message: 'bad request' };
    generateObjectMock.mockRejectedValue(httpErr);
    const p = new AnthropicLLMProvider({ apiKey: 'sk-test' });
    await expect(
      p.generateObject({ model: 'haiku', system: 's', prompt: 'p', schema: Schema }),
    ).rejects.toBe(httpErr);
  });
});
