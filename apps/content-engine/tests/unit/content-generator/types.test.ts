import { describe, it, expect } from 'vitest';
import { ContentGenerationError } from '../../../src/services/content-generator/types.js';

describe('ContentGenerationError', () => {
  it('carries the name, code, and message', () => {
    const err = new ContentGenerationError('RATE_LIMITED', 'too many requests');
    expect(err.name).toBe('ContentGenerationError');
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.message).toBe('too many requests');
    expect(err).toBeInstanceOf(Error);
  });

  it('preserves a provided cause', () => {
    const root = new Error('root cause');
    const err = new ContentGenerationError('UNKNOWN', 'wrapped', root);
    expect(err.cause).toBe(root);
  });

  it('omits cause when not provided', () => {
    const err = new ContentGenerationError('INVALID_INPUT', 'bad input');
    expect(err.cause).toBeUndefined();
  });
});
