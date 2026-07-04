import { describe, it, expect } from 'vitest';
import {
  TransientError,
  RateLimitError,
  classifyError,
} from '../../../../../src/services/content-generator/backends/ai/errors.js';

describe('TransientError / RateLimitError', () => {
  it('TransientError carries name + status + cause', () => {
    const root = new Error('socket hangup');
    const err = new TransientError('upstream 502', 502, root);
    expect(err.name).toBe('TransientError');
    expect(err.status).toBe(502);
    expect(err.cause).toBe(root);
    expect(err).toBeInstanceOf(Error);
  });

  it('RateLimitError extends TransientError and carries retryAfterMs', () => {
    const err = new RateLimitError('too many requests', 1500);
    expect(err.name).toBe('RateLimitError');
    expect(err.status).toBe(429);
    expect(err.retryAfterMs).toBe(1500);
    expect(err).toBeInstanceOf(TransientError);
  });
});

describe('classifyError', () => {
  it('returns the error itself when it is already a TransientError', () => {
    const t = new TransientError('x', 503);
    expect(classifyError(t)).toBe(t);
  });

  it('classifies HTTP 429 as RateLimitError, reading Retry-After when present', () => {
    const httpErr = { status: 429, message: 'rate limited', headers: { 'retry-after': '2' } };
    const out = classifyError(httpErr);
    expect(out).toBeInstanceOf(RateLimitError);
    expect((out as RateLimitError).retryAfterMs).toBe(2000);
  });

  it('classifies HTTP 502/503/504 as TransientError', () => {
    for (const status of [502, 503, 504]) {
      const out = classifyError({ status, message: `upstream ${status}` });
      expect(out).toBeInstanceOf(TransientError);
      expect((out as TransientError).status).toBe(status);
    }
  });

  it('returns the original error unchanged for 4xx (other than 429)', () => {
    const httpErr = { status: 400, message: 'bad request' };
    const out = classifyError(httpErr);
    expect(out).toBe(httpErr);
    expect(out).not.toBeInstanceOf(TransientError);
  });

  it('returns the original error for unknown shapes', () => {
    const weird = new Error('unparseable');
    expect(classifyError(weird)).toBe(weird);
  });
});
