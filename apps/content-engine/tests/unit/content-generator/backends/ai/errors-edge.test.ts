import { describe, it, expect } from 'vitest';
import {
  TransientError,
  RateLimitError,
  classifyError,
} from '../../../../../src/services/content-generator/backends/ai/errors.js';

describe('error constructors without optional details', () => {
  it('TransientError leaves status and cause unset when not given', () => {
    const err = new TransientError('flaky');
    expect(err.status).toBeUndefined();
    expect(err.cause).toBeUndefined();
  });

  it('RateLimitError leaves retryAfterMs unset when not given, but keeps a cause', () => {
    const root = new Error('root');
    const err = new RateLimitError('slow down', undefined, root);
    expect(err.retryAfterMs).toBeUndefined();
    expect(err.cause).toBe(root);
    expect(err.status).toBe(429);
  });
});

describe('classifyError details', () => {
  it('429 without a message uses the default text', () => {
    const out = classifyError({ status: 429 }) as RateLimitError;
    expect(out).toBeInstanceOf(RateLimitError);
    expect(out.message).toBe('Rate limited');
    expect(out.retryAfterMs).toBeUndefined();
  });

  it.each([
    ['string header', { 'retry-after': '2' }, 2000],
    ['array header (first value wins)', { 'retry-after': ['3', '9'] }, 3000],
    ['capitalised header name', { 'Retry-After': '4' }, 4000],
    ['non-numeric header', { 'retry-after': 'soon' }, undefined],
    ['empty header', { 'retry-after': '' }, undefined],
    ['no headers at all', undefined, undefined],
  ])('429 Retry-After: %s', (_label, headers, expected) => {
    const out = classifyError({ status: 429, message: 'limited', headers }) as RateLimitError;
    expect(out).toBeInstanceOf(RateLimitError);
    expect(out.retryAfterMs).toBe(expected);
  });

  it.each([502, 503, 504])('%i without a message uses the default upstream text', (status) => {
    const out = classifyError({ status }) as TransientError;
    expect(out).toBeInstanceOf(TransientError);
    expect(out.message).toBe(`Upstream ${status}`);
    expect(out.status).toBe(status);
  });

  it('keeps the original message on a 5xx and wraps the original error as the cause', () => {
    const original = { status: 503, message: 'overloaded' };
    const out = classifyError(original) as TransientError;
    expect(out.message).toBe('overloaded');
    expect(out.cause).toBe(original);
  });

  it('returns other errors and non-errors unchanged', () => {
    const plain = new Error('boom');
    expect(classifyError(plain)).toBe(plain);
    expect(classifyError({ status: 400 })).toEqual({ status: 400 });
    expect(classifyError(null)).toBeNull();
    expect(classifyError('text')).toBe('text');
  });
});
