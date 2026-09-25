/**
 * Review theme tagging (Brief 07).
 *
 * `tagReviewThemes` attaches the fixed `REVIEW_THEMES` taxonomy ("hashtags") to
 * the new reviews captured in a daily snapshot. ONE batched `claude-haiku-4-5`
 * call, forced tool-use (module CLAUDE.md §7 — never free-text JSON parsing).
 * Unknown themes returned by the model are dropped; a zero-review day never
 * calls the model (short-circuit). Provenance of the resulting themes is
 * `ai-inferred`.
 *
 * Exported for reuse: the daily worker (Brief 08) and the on-demand
 * `POST /snapshots/capture` route both tag via this one function.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { SnapshotReview, ReviewTheme } from '@restropulse/shared';
import { REVIEW_THEMES } from '@restropulse/shared';
import { StageError } from './errors.js';

const HAIKU_MODEL = 'claude-haiku-4-5';

const THEME_SET = new Set<string>(REVIEW_THEMES as readonly string[]);

const TAG_TOOL: Anthropic.Tool = {
    name: 'tag_review_themes',
    description:
        'Tag each review with zero or more themes from the fixed taxonomy. ' +
        'Only use the allowed theme values; never invent new ones.',
    input_schema: {
        type: 'object',
        properties: {
            tags: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        index: { type: 'integer', description: 'Zero-based index of the review.' },
                        themes: {
                            type: 'array',
                            items: { type: 'string', enum: [...REVIEW_THEMES] },
                        },
                    },
                    required: ['index', 'themes'],
                },
            },
        },
        required: ['tags'],
    },
};

const TAG_SYSTEM =
    'You classify short restaurant reviews into a fixed set of themes. ' +
    'Return, for each review, the subset of allowed themes it expresses. ' +
    `Allowed themes: ${REVIEW_THEMES.join(', ')}. Use only these values.`;

function getClient(): Anthropic {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        throw new StageError(
            'AI analysis is not configured on the server (missing ANTHROPIC_API_KEY).',
            503,
            'ANALYZING',
        );
    }
    return new Anthropic({ apiKey });
}

interface TagToolInput {
    tags?: Array<{ index?: number; themes?: unknown[] }>;
}

function buildPrompt(reviews: SnapshotReview[]): string {
    const lines = reviews.map(
        (r, i) => `[${i}] (${r.rating}★) ${r.text.replace(/\s+/g, ' ').slice(0, 300)}`,
    );
    return `Tag these ${reviews.length} reviews. Return one entry per review index.\n\n${lines.join('\n')}`;
}

/**
 * Tag review themes in one batched, forced-tool-use call.
 * Returns a NEW array — inputs are not mutated. Reviews the model does not tag
 * (or that only receive unknown themes) come back with `themes: []`.
 * Empty input short-circuits with no model call.
 */
export async function tagReviewThemes(
    reviews: SnapshotReview[],
    client?: Anthropic,
): Promise<SnapshotReview[]> {
    // Short-circuit: never call the model for a zero-review day.
    if (reviews.length === 0) return [];

    const c = client ?? getClient();

    let input: TagToolInput;
    try {
        const res = await c.messages.create({
            model: HAIKU_MODEL,
            max_tokens: 1024,
            system: TAG_SYSTEM,
            tools: [TAG_TOOL],
            tool_choice: { type: 'tool', name: TAG_TOOL.name },
            messages: [{ role: 'user', content: buildPrompt(reviews) }],
        });
        const block = res.content.find(
            (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === TAG_TOOL.name,
        );
        input = (block?.input as TagToolInput) ?? {};
    } catch {
        // Theme tagging is best-effort — a failed call leaves reviews untagged
        // rather than failing the whole capture (the numbers are what matter).
        return reviews.map((r) => ({ ...r, themes: [] as ReviewTheme[] }));
    }

    const byIndex = new Map<number, ReviewTheme[]>();
    for (const tag of input.tags ?? []) {
        if (typeof tag?.index !== 'number') continue;
        const themes = (Array.isArray(tag.themes) ? tag.themes : [])
            .filter((t): t is ReviewTheme => typeof t === 'string' && THEME_SET.has(t));
        byIndex.set(tag.index, themes);
    }

    return reviews.map((r, i) => ({ ...r, themes: byIndex.get(i) ?? [] }));
}
