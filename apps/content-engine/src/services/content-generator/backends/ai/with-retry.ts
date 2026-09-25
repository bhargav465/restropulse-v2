/**
 * withRetry -- wraps any async function with the retry/backoff policy from ADR 0001.
 *
 * Profiles are intentionally small and explicit (no algorithmic schedules) so the
 * exact behavior is greppable from the test names.
 */

import { createLogger } from '@restropulse/telemetry/server';
import { classifyError, RateLimitError, TransientError } from './errors.js';

const log = createLogger('ai-retry');

export interface RetryProfile {
  readonly maxAttempts: number;
  readonly backoffMs: readonly number[]; // length must be >= maxAttempts; index i = wait BEFORE attempt i+1
}

export const RETRY_PROFILES = {
  LLM: { maxAttempts: 3, backoffMs: [1000, 2000, 4000] },
  IMAGE_SUBMIT: { maxAttempts: 3, backoffMs: [5000, 10000, 20000] },
  VIDEO_SUBMIT: { maxAttempts: 5, backoffMs: [10000, 20000, 40000, 80000, 160000] },
} as const satisfies Record<string, RetryProfile>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  profile: RetryProfile,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= profile.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (rawError) {
      const classified = classifyError(rawError);
      lastError = classified;

      const isRetryable = classified instanceof TransientError;
      if (!isRetryable || attempt === profile.maxAttempts) {
        throw classified;
      }

      const profileBackoff = profile.backoffMs[attempt - 1] ?? profile.backoffMs[profile.backoffMs.length - 1] ?? 1000;
      const retryAfter =
        classified instanceof RateLimitError && classified.retryAfterMs !== undefined
          ? classified.retryAfterMs
          : 0;
      const waitMs = Math.max(profileBackoff, retryAfter);

      log.warn(
        { attempt, maxAttempts: profile.maxAttempts, waitMs, errorName: (classified as Error).name },
        'Transient error; will retry',
      );
      await sleep(waitMs);
    }
  }

  throw lastError;
}
