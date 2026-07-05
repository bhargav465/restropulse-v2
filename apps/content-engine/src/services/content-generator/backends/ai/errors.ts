/**
 * Retry-classification error types for the AI content generator.
 *
 * The retry helper inspects thrown errors via classifyError(); errors that
 * resolve to TransientError or RateLimitError get retried per the configured
 * backoff profile. All other errors propagate immediately (e.g. 4xx auth,
 * validation failures, programmer mistakes).
 */

export class TransientError extends Error {
  readonly status?: number;
  readonly cause?: unknown;

  constructor(message: string, status?: number, cause?: unknown) {
    super(message);
    this.name = 'TransientError';
    if (status !== undefined) this.status = status;
    if (cause !== undefined) this.cause = cause;
  }
}

export class RateLimitError extends TransientError {
  readonly retryAfterMs?: number;

  constructor(message: string, retryAfterMs?: number, cause?: unknown) {
    super(message, 429, cause);
    this.name = 'RateLimitError';
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs;
  }
}

interface MaybeHttpError {
  status?: number;
  message?: string;
  headers?: Record<string, string | string[] | undefined>;
}

function readRetryAfterMs(headers: MaybeHttpError['headers']): number | undefined {
  if (!headers) return undefined;
  const raw = headers['retry-after'] ?? headers['Retry-After'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

/**
 * Classify an unknown error into TransientError / RateLimitError when possible,
 * otherwise return it unchanged. Pure function -- no side effects.
 */
export function classifyError(err: unknown): unknown {
  if (err instanceof TransientError) return err;

  const httpish = err as MaybeHttpError | null;
  const status = httpish?.status;

  if (status === 429) {
    return new RateLimitError(
      httpish?.message ?? 'Rate limited',
      readRetryAfterMs(httpish?.headers),
      err,
    );
  }

  if (status === 502 || status === 503 || status === 504) {
    return new TransientError(httpish?.message ?? `Upstream ${status}`, status, err);
  }

  return err;
}
