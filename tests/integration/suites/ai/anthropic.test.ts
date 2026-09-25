import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { requireSecrets } from '../../helpers/secrets.js';

const secrets = requireSecrets('anthropic', ['ANTHROPIC_API_KEY']);

describe('Anthropic Claude API', () => {
  it('generates a structured caption', async () => {
    const { AnthropicLLMProvider } = await import('../../../../apps/content-engine/src/services/content-generator/backends/ai/llm/anthropic-provider.js');
    const provider = new AnthropicLLMProvider({ apiKey: secrets.ANTHROPIC_API_KEY });
    const result = await provider.generateObject({
      model: 'haiku',
      system: 'You are a social media assistant for restaurants.',
      prompt: 'Write a 1-sentence Instagram caption for a freshly baked sourdough loaf. Return JSON with key "caption".',
      schema: z.object({ caption: z.string().min(10) }),
    });
    expect(typeof result.object.caption).toBe('string');
    expect(result.object.caption.length).toBeGreaterThan(10);
    expect(result.usage.inputTokens).toBeGreaterThan(0);
  }, 30000);

  it('returns token usage metadata', async () => {
    const { AnthropicLLMProvider } = await import('../../../../apps/content-engine/src/services/content-generator/backends/ai/llm/anthropic-provider.js');
    const provider = new AnthropicLLMProvider({ apiKey: secrets.ANTHROPIC_API_KEY });
    const result = await provider.generateObject({
      model: 'haiku',
      system: 'Reply with valid JSON only.',
      prompt: 'Reply with JSON: {"ok": true}',
      schema: z.object({ ok: z.boolean() }),
    });
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.usage.outputTokens).toBeGreaterThan(0);
    expect(result.modelId).toBeTruthy();
  }, 30000);
});
