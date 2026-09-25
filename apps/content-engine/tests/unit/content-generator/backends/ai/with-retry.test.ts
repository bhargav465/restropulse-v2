import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  withRetry,
  RETRY_PROFILES,
} from '../../../../../src/services/content-generator/backends/ai/with-retry.js';
import {
  TransientError,
  RateLimitError,
} from '../../../../../src/services/content-generator/backends/ai/errors.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RETRY_PROFILES', () => {
  it('exposes the three documented profiles with the ADR-specified backoffs', () => {
    expect(RETRY_PROFILES.LLM).toEqual({ maxAttempts: 3, backoffMs: [1000, 2000, 4000] });
    expect(RETRY_PROFILES.IMAGE_SUBMIT).toEqual({ maxAttempts: 3, backoffMs: [5000, 10000, 20000] });
    expect(RETRY_PROFILES.VIDEO_SUBMIT).toEqual({
      maxAttempts: 5,
      backoffMs: [10000, 20000, 40000, 80000, 160000],
    });
  });
});

describe('withRetry', () => {
  it('returns the result on first success without sleeping', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const promise = withRetry(fn, RETRY_PROFILES.LLM);
    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on TransientError up to maxAttempts and resolves when one succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new TransientError('x', 503))
      .mockRejectedValueOnce(new TransientError('x', 503))
      .mockResolvedValueOnce('done');

    const promise = withRetry(fn, RETRY_PROFILES.LLM);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(promise).resolves.toBe('done');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('rethrows after exhausting maxAttempts', async () => {
    const fn = vi.fn().mockRejectedValue(new TransientError('persistent', 503));
    const promise = withRetry(fn, RETRY_PROFILES.LLM);
    promise.catch(() => undefined); // prevent unhandled rejection warning
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(4000);
    await expect(promise).rejects.toBeInstanceOf(TransientError);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('honors RateLimitError.retryAfterMs over the profile backoff', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new RateLimitError('rl', 7000))
      .mockResolvedValueOnce('ok');

    const promise = withRetry(fn, RETRY_PROFILES.LLM);
    // profile says 1000ms, but Retry-After says 7000ms -- must wait the longer
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(6000);
    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('classifies raw HTTP-shaped errors via classifyError before deciding to retry', async () => {
    const httpErr = { status: 502, message: 'bad gateway' };
    const fn = vi.fn()
      .mockRejectedValueOnce(httpErr)
      .mockResolvedValueOnce('ok');

    const promise = withRetry(fn, RETRY_PROFILES.LLM);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry on 4xx errors (other than 429)', async () => {
    const httpErr = { status: 400, message: 'bad request' };
    const fn = vi.fn().mockRejectedValue(httpErr);
    const promise = withRetry(fn, RETRY_PROFILES.LLM);
    await expect(promise).rejects.toBe(httpErr);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
