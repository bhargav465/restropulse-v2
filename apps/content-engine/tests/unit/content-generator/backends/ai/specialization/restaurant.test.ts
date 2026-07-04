import { describe, it, expect } from 'vitest';
import { RestaurantSpecialization } from '../../../../../../src/services/content-generator/backends/ai/specialization/index.js';
import type {
  GeneratedPost,
  GeneratePostInput,
} from '../../../../../../src/services/content-generator/types.js';

const spec = new RestaurantSpecialization();
const ctx = {
  restaurantId: 'r1',
  restaurantName: 'Spice Route',
  cuisine: 'South Indian',
  region: 'Bengaluru',
  brandVoice: 'homestyle',
  dietaryFocus: ['vegetarian'],
  locale: 'en-IN',
};

describe('RestaurantSpecialization metadata', () => {
  it('declares domain "restaurant"', () => {
    expect(spec.domain).toBe('restaurant');
  });

  it('exposes a semver version string', () => {
    expect(spec.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('getSystemPromptFragment', () => {
  it('mentions restaurants and the supplied brand voice', () => {
    const out = spec.getSystemPromptFragment(ctx);
    expect(out.toLowerCase()).toContain('restaurant');
    expect(out).toContain('homestyle');
    expect(out).toContain('Spice Route');
  });

  it('includes the FSSAI guardrail (no over-promising health claims)', () => {
    const out = spec.getSystemPromptFragment(ctx);
    expect(out.toLowerCase()).toContain('fssai');
  });
});

describe('getTaskPrompt', () => {
  it('returns a non-empty prompt per operation', () => {
    const input: GeneratePostInput = {
      concept: 'Friday biryani special',
      type: 'IMAGE',
      platforms: ['INSTAGRAM'],
    };
    const ops = ['draftCycle', 'reviseCycle', 'generatePost', 'revisePost'] as const;
    for (const op of ops) {
      const out = spec.getTaskPrompt(op, input as any, ctx);
      expect(out.length).toBeGreaterThan(20);
    }
  });
});

describe('getSonarQueries', () => {
  it('daily-platform scope returns at least one restaurant-framed query', () => {
    const queries = spec.getSonarQueries('daily-platform', ctx);
    expect(queries.length).toBeGreaterThan(0);
    expect(queries[0].toLowerCase()).toContain('restaurant');
  });

  it('per-post-trigger scope tunes to cuisine/region from context', () => {
    const queries = spec.getSonarQueries('per-post-trigger', ctx);
    expect(queries.some((q) => q.includes('Bengaluru'))).toBe(true);
    expect(queries.some((q) => q.includes('South Indian'))).toBe(true);
  });
});

describe('getImagePromptFragment', () => {
  it('includes food-photography lighting + angle direction for IMAGE posts', () => {
    const fragment = spec.getImagePromptFragment(
      { postType: 'IMAGE', platforms: ['INSTAGRAM'], concept: 'paneer tikka' },
      ctx,
    );
    expect(fragment.toLowerCase()).toMatch(/lighting|golden|warm/);
    expect(fragment.toLowerCase()).toMatch(/angle|hero|flat/);
  });
});

describe('selectHashtags', () => {
  it('returns between 5 and 8 hashtags', () => {
    const tags = spec.selectHashtags('Try our weekend dosa platter', ctx);
    expect(tags.length).toBeGreaterThanOrEqual(5);
    expect(tags.length).toBeLessThanOrEqual(8);
  });

  it('mixes broad + cuisine + location tiers', () => {
    const tags = spec.selectHashtags('Try our weekend dosa platter', ctx);
    expect(tags.some((t) => t.toLowerCase().includes('food'))).toBe(true);
    expect(tags.some((t) => t.toLowerCase().includes('south'))).toBe(true);
    expect(tags.some((t) => t.toLowerCase().includes('bengaluru'))).toBe(true);
  });

  it('filters denylisted tags', () => {
    const tags = spec.selectHashtags('Try our weekend dosa platter', ctx);
    expect(tags.every((t) => !t.toLowerCase().includes('like4like'))).toBe(true);
  });

  it('returns lowercase tags prefixed with #', () => {
    const tags = spec.selectHashtags('Try our weekend dosa platter', ctx);
    for (const t of tags) {
      expect(t.startsWith('#')).toBe(true);
      expect(t).toBe(t.toLowerCase());
    }
  });
});

describe('validateOutput', () => {
  const validPost: GeneratedPost = {
    caption: 'Soft, flaky, ghee-laced parotta straight off the tawa.\n\n#food #southindian #bengaluru #parotta #ghee',
    thumbnail: 'http://localhost/x.jpg',
  };

  it('returns ok=true for a clean post', () => {
    const r = spec.validateOutput(validPost, ctx);
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it('rejects FSSAI-violating health claims', () => {
    const bad: GeneratedPost = {
      caption: 'Our biryani cures diabetes and prevents cancer!',
      thumbnail: 'http://localhost/x.jpg',
    };
    const r = spec.validateOutput(bad, ctx);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.severity === 'error' && /fssai|health/i.test(i.message))).toBe(true);
  });

  it('warns on captions exceeding Instagram total limit (2200)', () => {
    const long: GeneratedPost = {
      caption: 'x'.repeat(2300),
      thumbnail: 'http://localhost/x.jpg',
    };
    const r = spec.validateOutput(long, ctx);
    expect(r.issues.some((i) => i.severity === 'warning' && /2200|length/i.test(i.message))).toBe(true);
  });

  it('warns on hashtag count outside [3,15]', () => {
    const tooFew: GeneratedPost = {
      caption: 'Plain caption with #only #two',
      thumbnail: 'http://localhost/x.jpg',
    };
    const r = spec.validateOutput(tooFew, ctx);
    expect(r.issues.some((i) => /hashtag/i.test(i.message))).toBe(true);
  });
});
