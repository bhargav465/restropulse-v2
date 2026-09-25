/**
 * SonarClient -- thin wrapper around the Perplexity Sonar Pro API.
 *
 * Endpoint:    https://api.perplexity.ai/chat/completions
 * Default model: sonar-pro (high quality, ~$3/M input, ~$15/M output)
 * Alternative:   sonar (cheaper, faster)
 *
 * Cost tracking is not done here -- callers wrap the call in withCostTracking
 * with the surface='sonar' label.
 */

import { createLogger } from '@restropulse/telemetry/server';
import { classifyError, TransientError } from '../../errors.js';

const log = createLogger('sonar-client');

const ENDPOINT = 'https://api.perplexity.ai/chat/completions';

export interface SonarClientOptions {
  apiKey: string;
  /** Default 'sonar-pro'; can be overridden to 'sonar' for cheaper queries. */
  model?: string;
}

export interface SonarUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface SonarImageResult {
  url: string;
  description?: string;
}

export interface SonarQueryOptions {
  /** When true, passes return_images: true to the Perplexity API. */
  returnImages?: boolean;
}

export interface SonarResponse {
  text: string;
  usage: SonarUsage;
  modelId: string;
  /** Populated when returnImages was true and the API returned image results. */
  images?: SonarImageResult[];
}

export class SonarClient {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(options: SonarClientOptions) {
    if (!options || !options.apiKey) {
      throw new Error('SonarClient requires a non-empty apiKey');
    }
    this.apiKey = options.apiKey;
    this.model = options.model ?? 'sonar-pro';
  }

  async query(question: string, options?: SonarQueryOptions): Promise<SonarResponse> {
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: question }],
          ...(options?.returnImages ? { return_images: true } : {}),
        }),
      });
    } catch (err) {
      throw new TransientError(`Sonar fetch failed: ${(err as Error).message}`, undefined, err);
    }

    if (!res.ok) {
      const headers: Record<string, string> = {};
      try {
        for (const [k, v] of res.headers as any) headers[k.toLowerCase()] = String(v);
      } catch {
        // best-effort
      }
      const httpish = { status: res.status, message: `Sonar HTTP ${res.status}`, headers };
      const classified = classifyError(httpish);
      if (classified instanceof Error) throw classified;
      throw new Error(httpish.message);
    }

    const body = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      images?: Array<{ url?: string; description?: string }>;
    };

    const text = body.choices?.[0]?.message?.content ?? '';
    const usage: SonarUsage = {
      inputTokens: body.usage?.prompt_tokens ?? 0,
      outputTokens: body.usage?.completion_tokens ?? 0,
    };

    const images: SonarImageResult[] | undefined = body.images?.length
      ? body.images.filter(img => !!img.url).map(img => ({ url: img.url!, description: img.description }))
      : undefined;

    log.debug({ inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, modelId: this.model, imageCount: images?.length }, 'Sonar query');
    return { text, usage, modelId: this.model, images };
  }
}
