import { describe, it, expect, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { tagReviewThemes } from '../../src/services/intelligence/themes.js';
import type { SnapshotReview } from '@restropulse/shared';

/** Build a fake Anthropic client whose forced tool call returns `tags`. */
function fakeClient(tags: Array<{ index: number; themes: string[] }>) {
    const create = vi.fn().mockResolvedValue({
        content: [{ type: 'tool_use', name: 'tag_review_themes', input: { tags } }],
    });
    return { create, client: { messages: { create } } as unknown as Anthropic };
}

const reviews: SnapshotReview[] = [
    { rating: 5, text: 'Amazing food, great taste', time: '1 day ago' },
    { rating: 2, text: 'Delivery was very slow', time: '2 days ago' },
];

describe('tagReviewThemes', () => {
    it('short-circuits on empty input WITHOUT calling the model', async () => {
        const { create, client } = fakeClient([]);
        const out = await tagReviewThemes([], client);
        expect(out).toEqual([]);
        expect(create).not.toHaveBeenCalled();
    });

    it('attaches validated themes and makes exactly one batched call', async () => {
        const { create, client } = fakeClient([
            { index: 0, themes: ['food-quality'] },
            { index: 1, themes: ['delivery-time'] },
        ]);
        const out = await tagReviewThemes(reviews, client);
        expect(create).toHaveBeenCalledTimes(1);
        expect(out[0].themes).toEqual(['food-quality']);
        expect(out[1].themes).toEqual(['delivery-time']);
    });

    it('drops unknown themes not in REVIEW_THEMES', async () => {
        const { client } = fakeClient([
            { index: 0, themes: ['food-quality', 'not-a-real-theme', 'vibes'] },
        ]);
        const out = await tagReviewThemes(reviews, client);
        expect(out[0].themes).toEqual(['food-quality']);
    });

    it('leaves untagged reviews with an empty themes array', async () => {
        const { client } = fakeClient([{ index: 0, themes: ['service'] }]);
        const out = await tagReviewThemes(reviews, client);
        expect(out[0].themes).toEqual(['service']);
        expect(out[1].themes).toEqual([]);
    });

    it('does not mutate the input reviews', async () => {
        const { client } = fakeClient([{ index: 0, themes: ['pricing'] }]);
        await tagReviewThemes(reviews, client);
        expect(reviews[0].themes).toBeUndefined();
    });
});
