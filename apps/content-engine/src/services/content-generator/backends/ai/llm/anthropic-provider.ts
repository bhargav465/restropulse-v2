/**
 * AnthropicLLMProvider -- Vercel AI SDK + @ai-sdk/anthropic.
 *
 * Default LLM provider. Family ('haiku' | 'sonnet') maps to concrete model ids
 * via ANTHROPIC_MODEL_IDS so the orchestration layer never hardcodes a model
 * version. Anthropic prompt caching is enabled on the system prompt by default
 * (5-minute ephemeral cache).
 *
 * The generateObject() call is wrapped in classifyError so transient/rate-limit
 * errors surface as the right exception type for withRetry to handle.
 */

import { generateObject as aiGenerateObject } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { createLogger } from '@restropulse/telemetry/server';
import { classifyError, TransientError } from '../errors.js';
import { ANTHROPIC_MODEL_IDS } from './model-selection.js';
import type {
  GenerateObjectRequest,
  GenerateObjectResponse,
  ILLMProvider,
  LLMUsage,
} from './types.js';

const log = createLogger('anthropic-llm');

export interface AnthropicLLMProviderOptions {
  apiKey: string;
  /**
   * Override the default Anthropic model ids per family. Useful for tests or
   * forcing a specific snapshot in production.
   */
  modelOverrides?: Partial<Record<'haiku' | 'sonnet', string>>;
}

export class AnthropicLLMProvider implements ILLMProvider {
  readonly name = 'anthropic';
  private readonly modelIds: Record<'haiku' | 'sonnet', string>;

  constructor(options: AnthropicLLMProviderOptions) {
    if (!options || !options.apiKey) {
      throw new Error('AnthropicLLMProvider requires a non-empty apiKey');
    }
    // The @ai-sdk/anthropic package reads ANTHROPIC_API_KEY from env when not
    // configured otherwise. Set it here so callers can pass the key explicitly
    // without having to mutate process.env elsewhere.
    if (!process.env.ANTHROPIC_API_KEY) {
      process.env.ANTHROPIC_API_KEY = options.apiKey;
    }
    this.modelIds = {
      haiku: options.modelOverrides?.haiku ?? ANTHROPIC_MODEL_IDS.haiku,
      sonnet: options.modelOverrides?.sonnet ?? ANTHROPIC_MODEL_IDS.sonnet,
    };
  }

  async generateObject<T>(req: GenerateObjectRequest<T>): Promise<GenerateObjectResponse<T>> {
    const modelId = this.modelIds[req.model];
    log.debug({ modelId, family: req.model }, 'AnthropicLLMProvider.generateObject');

    try {
      const result = await aiGenerateObject({
        model: anthropic(modelId),
        system: req.system,
        prompt: req.prompt,
        schema: req.schema,
        experimental_telemetry: {
          isEnabled: true,
          metadata: req.telemetryAttributes ?? {},
        },
        providerOptions: {
          anthropic: {
            cacheControl: { type: 'ephemeral' },
          },
        },
      });

      const usage: LLMUsage = {
        inputTokens: (result.usage as any)?.promptTokens ?? 0,
        outputTokens: (result.usage as any)?.completionTokens ?? 0,
      };
      const cacheRead = (result.usage as any)?.cachedPromptTokens
        ?? (result.usage as any)?.promptCacheReadTokens;
      if (cacheRead !== undefined) usage.cacheReadTokens = cacheRead;
      const cacheWrite = (result.usage as any)?.promptCacheWriteTokens;
      if (cacheWrite !== undefined) usage.cacheWriteTokens = cacheWrite;

      return {
        object: result.object as T,
        usage,
        modelId,
      };
    } catch (rawError) {
      const classified = classifyError(rawError);
      // Throw the classified version so withRetry can decide. Note that classifyError
      // returns the input unchanged when it's not retry-eligible (e.g. 4xx) -- we
      // preserve that exact reference here.
      if (classified instanceof TransientError) throw classified;
      throw rawError;
    }
  }
}
