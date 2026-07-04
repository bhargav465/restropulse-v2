/**
 * FalClient -- thin wrapper around the fal.ai sync inference API.
 *
 * Endpoint: POST https://fal.run/<model>
 * Auth:     Authorization: Key <FAL_API_KEY>
 *
 * Phase 4 uses the sync subscribe pattern (one HTTP call returns the result).
 * Phase 5 may add the queue submit + poll pattern for slow video using
 * https://queue.fal.run/<model>.
 *
 * Errors are routed through classifyError so withRetry handles transient/
 * rate-limit failures with the IMAGE_SUBMIT profile.
 */

import { createLogger } from '@restropulse/telemetry/server';
import { classifyError, TransientError } from '../../errors.js';
import type { FalQueueSubmission, FalQueueStatus } from './queue-types.js';

const log = createLogger('fal-client');

const SYNC_BASE_URL = 'https://fal.run';

export interface FalClientOptions {
  apiKey: string;
}

export interface FalImageRequest {
  model: string;
  prompt: string;
  imageSize?: string; // 'square_hd' | 'portrait_16_9' | etc.
  numInferenceSteps?: number;
  guidanceScale?: number;
  numImages?: number;
}

export interface FalImageEditRequest {
  model: string;
  prompt: string;
  imageUrl: string;
  strength?: number;
  numInferenceSteps?: number;
}

export interface FalGeneratedImage {
  url: string;
  width: number;
  height: number;
}

export interface FalImageResponse {
  images: FalGeneratedImage[];
  seed?: number;
  modelId: string;
}

export class FalClient {
  private readonly apiKey: string;

  constructor(options: FalClientOptions) {
    if (!options || !options.apiKey) {
      throw new Error('FalClient requires a non-empty apiKey');
    }
    this.apiKey = options.apiKey;
  }

  async generateImage(req: FalImageRequest): Promise<FalImageResponse> {
    const body = {
      prompt: req.prompt,
      image_size: req.imageSize ?? 'square_hd',
      num_inference_steps: req.numInferenceSteps ?? 28,
      guidance_scale: req.guidanceScale ?? 3.5,
      num_images: req.numImages ?? 1,
    };
    return this.postAndParse(req.model, body);
  }

  async editImage(req: FalImageEditRequest): Promise<FalImageResponse> {
    const body = {
      prompt: req.prompt,
      image_url: req.imageUrl,
      strength: req.strength ?? 0.7,
      num_inference_steps: req.numInferenceSteps ?? 28,
    };
    return this.postAndParse(req.model, body);
  }

  async submitToQueue(model: string, body: Record<string, unknown>): Promise<FalQueueSubmission> {
    const url = `https://queue.fal.run/${model}`;
    const json = await this.fetchJson(url, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify(body),
    }) as { request_id: string; status_url?: string; response_url?: string };
    return {
      requestId: json.request_id,
      ...(json.status_url ? { statusUrl: json.status_url } : {}),
      ...(json.response_url ? { responseUrl: json.response_url } : {}),
    };
  }

  async getQueueStatus(model: string, requestId: string): Promise<FalQueueStatus> {
    const url = `https://queue.fal.run/${model}/requests/${requestId}/status`;
    const json = await this.fetchJson(url, {
      method: 'GET',
      headers: this.authHeaders(),
    }) as { status: string; queue_position?: number; logs?: Array<{ message?: string; level?: string }> };
    return {
      status: json.status as FalQueueStatus['status'],
      ...(json.queue_position !== undefined ? { queuePosition: json.queue_position } : {}),
      ...(json.logs ? { logs: json.logs } : {}),
    };
  }

  async getQueueResult<T = unknown>(model: string, requestId: string): Promise<T> {
    const url = `https://queue.fal.run/${model}/requests/${requestId}`;
    return this.fetchJson(url, { method: 'GET', headers: this.authHeaders() }) as Promise<T>;
  }

  private authHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Key ${this.apiKey}`,
    };
  }

  private async fetchJson(url: string, init: RequestInit): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      throw new TransientError(`fal.ai fetch failed: ${(err as Error).message}`, undefined, err);
    }
    if (!res.ok) {
      const headers: Record<string, string> = {};
      try {
        for (const [k, v] of res.headers as any) headers[k.toLowerCase()] = String(v);
      } catch {
        // best-effort
      }
      const httpish = { status: res.status, message: `fal.ai HTTP ${res.status}`, headers };
      const classified = classifyError(httpish);
      if (classified instanceof Error) throw classified;
      throw new Error(httpish.message);
    }
    return res.json();
  }

  private async postAndParse(model: string, body: Record<string, unknown>): Promise<FalImageResponse> {
    const url = `${SYNC_BASE_URL}/${model}`;
    const json = await this.fetchJson(url, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify(body),
    }) as { images?: Array<{ url?: string; width?: number; height?: number }>; seed?: number };
    const images: FalGeneratedImage[] = (json.images ?? [])
      .filter((i) => !!i.url)
      .map((i) => ({ url: i.url!, width: i.width ?? 0, height: i.height ?? 0 }));

    log.debug({ model, count: images.length }, 'fal.ai image response');
    return {
      images,
      ...(json.seed !== undefined ? { seed: json.seed } : {}),
      modelId: model,
    };
  }
}
