import { describe, it, expect, beforeEach } from 'vitest';
import {
  setContentGenerator,
  getContentGenerator,
  resetContentGenerator,
} from '../../../src/services/content-generator/provider.js';
import { ContentGenerationError, type IContentGenerator } from '../../../src/services/content-generator/types.js';

const stub: IContentGenerator = {
  name: 'stub',
  draftCycle: async () => ({ summary: '', plannedPosts: [], focus: [] }),
  reviseCycle: async () => ({ summary: '', plannedPosts: [], focus: [] }),
  generatePost: async () => ({ caption: '', thumbnail: '' }),
  revisePost: async () => ({ caption: '', thumbnail: '' }),
};

beforeEach(() => {
  resetContentGenerator();
});

describe('content-generator provider', () => {
  it('throws BACKEND_UNAVAILABLE when no generator is registered', () => {
    expect(() => getContentGenerator()).toThrow(ContentGenerationError);
    try {
      getContentGenerator();
    } catch (err) {
      expect((err as ContentGenerationError).code).toBe('BACKEND_UNAVAILABLE');
    }
  });

  it('returns the generator set via setContentGenerator', () => {
    setContentGenerator(stub);
    expect(getContentGenerator()).toBe(stub);
  });

  it('allows replacement by a second setContentGenerator call', () => {
    setContentGenerator(stub);
    const other: IContentGenerator = { ...stub, name: 'other' };
    setContentGenerator(other);
    expect(getContentGenerator().name).toBe('other');
  });

  it('resetContentGenerator restores the unset state', () => {
    setContentGenerator(stub);
    resetContentGenerator();
    expect(() => getContentGenerator()).toThrow(ContentGenerationError);
  });
});
