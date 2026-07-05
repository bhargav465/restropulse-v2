/**
 * ReplicateClient -- thin fetch wrapper for the Replicate Predictions API.
 *
 * Auth:    Authorization: Bearer <REPLICATE_API_TOKEN>
 * Base:    https://api.replicate.com/v1
 *
 * Official models (owner/name, no version hash):
 *   POST /models/{owner}/{name}/predictions  -> ReplicatePrediction (status: starting)
 *   GET  /predictions/{id}                   -> ReplicatePrediction (polls until done)
 *
 * Status lifecycle: starting -> processing -> succeeded | failed | canceled
 */

import { createLogger } from '@restropulse/telemetry/server';
import { classifyError, TransientError } from '../../errors.js';

const BASE_URL = 'https://api.replicate.com/v1';

const log = createLogger('replicate-client');

export type ReplicatePredictionStatus =
  | 'starting'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'canceled';

export interface ReplicatePrediction {
  id: string;
  status: ReplicatePredictionStatus;
  /** Flux dev: string[]; Kling: string | string[] | null */
  output: string[] | string | null;
  error?: string | null;
}

export interface ReplicateClientOptions {
  apiKey: string;
}

export class ReplicateClient {
  private readonly apiKey: string;

  constructor(options: ReplicateClientOptions) {
    if (!options?.apiKey) throw new Error('ReplicateClient requires a non-empty apiKey');
    this.apiKey = options.apiKey;
  }

  async createPrediction(
    modelSlug: string,
    input: Record<string, unknown>,
  ): Promise<ReplicatePrediction> {
    const [owner, name] = modelSlug.split('/');
    if (!owner || !name) throw new Error(`Invalid Replicate model slug: ${modelSlug}`);

    const url = `${BASE_URL}/models/${owner}/${name}/predictions`;
    const json = await this.fetchJson(url, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({ input }),
    }) as ReplicatePrediction;

    log.debug({ id: json.id, status: json.status, model: modelSlug }, 'replicate prediction created');
    return json;
  }

  async getPrediction(id: string): Promise<ReplicatePrediction> {
    const url = `${BASE_URL}/predictions/${id}`;
    return this.fetchJson(url, {
      method: 'GET',
      headers: this.authHeaders(),
    }) as Promise<ReplicatePrediction>;
  }

  private authHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  private async fetchJson(url: string, init: RequestInit): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      throw new TransientError(`Replicate fetch failed: ${(err as Error).message}`, undefined, err);
    }
    if (!res.ok) {
      const headers: Record<string, string> = {};
      try {
        for (const [k, v] of res.headers as any) headers[k.toLowerCase()] = String(v);
      } catch { /* best-effort */ }
      const httpish = { status: res.status, message: `Replicate HTTP ${res.status}`, headers };
      const classified = classifyError(httpish);
      if (classified instanceof Error) throw classified;
      throw new Error(httpish.message);
    }
    return res.json();
  }
}
