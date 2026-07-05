import { describe, it, expect } from 'vitest';
import {
  CycleSchema,
  PlannedPostSchema,
  PostCaptionSchema,
} from '../../../../../../src/services/content-generator/backends/ai/llm/schemas.js';

describe('CycleSchema', () => {
  it('accepts a minimal valid cycle', () => {
    const valid = {
      summary: 'Week 1 focus on chef specials and behind-the-scenes content',
      plannedPosts: [{ category: 'chef_special', count: 2 }],
      focus: ['Chef Specials'],
    };
    expect(() => CycleSchema.parse(valid)).not.toThrow();
  });

  it('accepts an optional rationale', () => {
    const valid = {
      summary: 's',
      plannedPosts: [{ category: 'a', count: 1 }],
      focus: ['x'],
      rationale: 'because reasons',
    };
    expect(() => CycleSchema.parse(valid)).not.toThrow();
  });

  it('rejects a cycle missing required fields', () => {
    expect(() => CycleSchema.parse({ summary: 's' })).toThrow();
    expect(() => CycleSchema.parse({ plannedPosts: [], focus: [] })).toThrow();
  });

  it('rejects a plannedPost with non-numeric count', () => {
    expect(() =>
      CycleSchema.parse({
        summary: 's',
        plannedPosts: [{ category: 'c', count: 'two' }],
        focus: ['x'],
      }),
    ).toThrow();
  });
});

describe('PlannedPostSchema', () => {
  it('PlannedPostSchema accepts optional themes array', () => {
    const withThemes = PlannedPostSchema.parse({
      category: 'FESTIVAL_TIE_IN',
      count: 1,
      themes: ['Eid', 'biryani'],
    });
    expect(withThemes.themes).toEqual(['Eid', 'biryani']);

    const withoutThemes = PlannedPostSchema.parse({
      category: 'CRAVING_CUE',
      count: 2,
    });
    expect(withoutThemes.themes).toBeUndefined();
  });

  it('PlannedPostSchema rejects themes array with more than 3 items', () => {
    expect(() =>
      PlannedPostSchema.parse({
        category: 'FESTIVAL_TIE_IN',
        count: 1,
        themes: ['a', 'b', 'c', 'd'],
      })
    ).toThrow();
  });
});

describe('PostCaptionSchema', () => {
  it('accepts a caption + motivation + optional fields', () => {
    const valid = {
      caption: 'Soft, flaky, ghee-laced parotta straight off the tawa.',
      motivation: 'Highlighting the chef special to drive awareness of the signature dish during monsoon season.',
      suggestedHashtags: ['#parotta', '#southindian'],
      archetype: 'CHEFS_PICK',
      selectedDish: 'Parotta',
    };
    expect(() => PostCaptionSchema.parse(valid)).not.toThrow();
  });

  it('accepts caption + motivation (other fields optional)', () => {
    const valid = { caption: 'Hello world', motivation: 'Testing basic generation flow.' };
    expect(() => PostCaptionSchema.parse(valid)).not.toThrow();
  });

  it('rejects caption without motivation', () => {
    expect(() => PostCaptionSchema.parse({ caption: 'Hello world' })).toThrow();
  });

  it('rejects empty caption', () => {
    expect(() => PostCaptionSchema.parse({ caption: '', motivation: 'some reason' })).toThrow();
  });

  it('accepts carousel slides (2-6 items)', () => {
    const valid = {
      caption: 'Hello',
      motivation: 'reason',
      carouselSlides: [
        'Whole cauliflower on charcoal grill, outer leaves beginning to blacken',
        'Close-up of achaar emulsion being spooned onto a charred floret',
        'Plated hero — finished dish on a copper plate with micro herbs',
      ],
    };
    expect(() => PostCaptionSchema.parse(valid)).not.toThrow();
  });

  it('rejects carousel with fewer than 2 slides', () => {
    expect(() =>
      PostCaptionSchema.parse({
        caption: 'Hello',
        motivation: 'reason',
        carouselSlides: ['only one slide'],
      })
    ).toThrow();
  });
});
