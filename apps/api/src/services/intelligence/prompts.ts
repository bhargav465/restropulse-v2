/**
 * All intelligence prompt text + tool schemas live here (module CLAUDE.md §7 —
 * prompts never inline in routes). Rewritten for Anthropic tool-use: the model
 * is FORCED to call a single tool whose `input_schema` is the JSON schema of the
 * result, so we read structured `tool_use.input` and never parse free-text JSON
 * (the predecessor's `parseLlmJson` is banned here).
 *
 * The competitive-analysis persona ports the predecessor's "senior restaurant
 * competitive intelligence strategist" with two additions (ARCHITECTURE §3.2):
 *   (a) every actionPlan item must include a deepLink bucket;
 *   (b) never state numeric platform metrics that are not present in the input.
 */

import type Anthropic from '@anthropic-ai/sdk';

/** Specific cuisine labels the classifier must choose from (no generic "Food"). */
export const CUISINE_TYPES = [
    'Biryani', 'North Indian', 'South Indian', 'Chinese', 'Pizza', 'Italian',
    'Continental', 'Mughlai', 'Tandoori', 'Cafe/Coffee', 'Fast Food', 'Burger',
    'Street Food', 'Seafood', 'Bakery/Desserts', 'Japanese', 'Thai', 'Korean',
    'Mexican', 'Arabian/Lebanese', 'Ice Cream', 'Multi-cuisine', 'Vegetarian',
    'BBQ/Grill', 'Kebab', 'Andhra',
];

/**
 * RP-002 / RP-014 option (b): this app has no Ordering or Campaigns module, so
 * the model may only route actions to tools that exist —
 *   'content'     → draft posts/photos in Content Studio
 *   'get-started' → fix the Google profile / reply to reviews (Intelligence)
 * Old reports still carry 'ordering'/'campaigns'; the web resolves those to a
 * no-op rather than a dead page.
 */
export const DEEP_LINK_BUCKETS = ['content', 'get-started'] as const;

// A compacted competitor row — the ONLY competitor data sent to the model.
// Never send raw Places payloads (cost rule, CLAUDE §9).
export interface CompactRow {
    name: string;
    rating: number;
    reviews: number;
    distanceKm?: number;
    priceLevel?: number;
}

// ============================================================
// Call A — classify_cuisines (cheap; may run on claude-haiku-4-5)
// ============================================================

export const CLASSIFY_SYSTEM =
    'You classify restaurants into a single most-specific cuisine label from a fixed list. ' +
    'You never invent restaurants and never change the provided names. Use the classify_cuisines tool.';

export const CLASSIFY_TOOL: Anthropic.Tool = {
    name: 'classify_cuisines',
    description: 'Classify every provided restaurant into one specific cuisine label and identify the base restaurant cuisine.',
    input_schema: {
        type: 'object',
        properties: {
            baseCuisine: {
                type: 'string',
                description: 'The single most-specific cuisine of the base restaurant (e.g. "Biryani", not "Indian").',
            },
            classifications: {
                type: 'array',
                description: 'One entry per nearby restaurant. Copy each name EXACTLY, character for character.',
                items: {
                    type: 'object',
                    properties: {
                        name: { type: 'string', description: 'Exact restaurant name as provided.' },
                        cuisine: { type: 'string', description: `One specific cuisine label from: ${CUISINE_TYPES.join(', ')}.` },
                    },
                    required: ['name', 'cuisine'],
                },
            },
        },
        required: ['baseCuisine', 'classifications'],
    },
};

export function buildClassifyPrompt(base: { name: string; city: string }, rows: CompactRow[]): string {
    return [
        `Base restaurant: ${base.name} (city: ${base.city}).`,
        'Classify the base restaurant and EVERY nearby restaurant below into one specific cuisine.',
        `Allowed labels: ${CUISINE_TYPES.join(', ')}.`,
        'Rules: use the EXACT name as the key; pick the single most specific label; never use "Restaurant" or "Food".',
        '',
        'Nearby restaurants:',
        ...rows.map((r, i) => `${i + 1}. ${r.name} — rating ${r.rating}, ${r.reviews} reviews`),
    ].join('\n');
}

// ============================================================
// Call B — competitive_analysis (claude-sonnet-4-6, max_tokens 8192)
// ============================================================

export const ANALYSIS_SYSTEM =
    'You are a senior restaurant competitive intelligence strategist with 15+ years of experience in the ' +
    'Indian food & beverage market. You write detailed, highly specific, and actionable analyses that ' +
    'restaurant owners can immediately act on. Every insight must be tied to the actual data provided and ' +
    'must name real restaurants from the input — no generic statements. ' +
    // Addition (a):
    'Every action-plan item MUST include a deepLinkBucket routing the owner to the right RestroPulse tool ' +
    `(one of: ${DEEP_LINK_BUCKETS.join(', ')}): use "content" for actions done by posting content or photos, ` +
    '"get-started" for actions done on the Google profile or by replying to reviews. ' +
    'Every action must be something the owner can do with those two tools or on their Google Business Profile — ' +
    'do NOT recommend launching ad campaigns, loyalty programs, SMS/WhatsApp blasts, discounts, or online-ordering ' +
    'features: this product does not have them. ' +
    // Addition (b):
    'You must NEVER state numeric platform metrics (ratings, review counts, follower counts, delivery-app ' +
    'numbers) that are not present in the input data. Do not estimate Swiggy/Zomato numbers. ' +
    'Use the competitive_analysis tool for your entire response.';

export const ANALYSIS_TOOL: Anthropic.Tool = {
    name: 'competitive_analysis',
    description: 'Produce the full competitive intelligence narrative, keyword clusters, per-competitor qualitative layer, and a 5-item action plan.',
    input_schema: {
        type: 'object',
        properties: {
            overview: { type: 'string', description: '3–4 sentence high-level overview of the competitive landscape and the base restaurant\'s standing.' },
            keyFindings: {
                type: 'array',
                description: '8–10 specific, data-backed findings — each references actual restaurants/metrics from the input and ends with why it matters to the owner.',
                items: { type: 'string' },
                minItems: 8,
                maxItems: 10,
            },
            immediateThreats: { type: 'string', description: '2–3 sentences naming the most urgent competitive threats and why.' },
            growthOpportunities: { type: 'string', description: '2–3 sentences on the biggest untapped opportunities.' },
            verdict: { type: 'string', description: 'A 90-day strategic verdict (2–4 sentences).' },
            actionPlan: {
                type: 'array',
                description: 'Exactly 5 prioritized actions (priority 1 = most urgent).',
                minItems: 5,
                maxItems: 5,
                items: {
                    type: 'object',
                    properties: {
                        priority: { type: 'integer', description: '1 (most urgent) to 5.' },
                        action: { type: 'string', description: 'Short action title.' },
                        detail: { type: 'string', description: '2–3 sentences: exactly what to do and how.' },
                        impact: { type: 'string', enum: ['High', 'Medium', 'Low'] },
                        timeframe: { type: 'string', description: 'e.g. "This week", "1–2 weeks", "1 month".' },
                        deepLinkBucket: { type: 'string', enum: [...DEEP_LINK_BUCKETS], description: 'RestroPulse tool this action routes to.' },
                    },
                    required: ['priority', 'action', 'detail', 'impact', 'timeframe', 'deepLinkBucket'],
                },
            },
            keywords: {
                type: 'object',
                properties: {
                    primary: { type: 'array', items: { type: 'string' } },
                    longTail: { type: 'array', items: { type: 'string' } },
                    trending: { type: 'array', items: { type: 'string' } },
                    competitor: { type: 'array', items: { type: 'string' } },
                    negativeToMonitor: { type: 'array', items: { type: 'string' } },
                },
                required: ['primary', 'longTail', 'trending', 'competitor', 'negativeToMonitor'],
            },
            competitors: {
                type: 'array',
                description: 'Qualitative layer for each of the top competitors provided. Use the EXACT competitor name.',
                items: {
                    type: 'object',
                    properties: {
                        name: { type: 'string', description: 'Exact competitor name as provided.' },
                        strengths: { type: 'array', items: { type: 'string' } },
                        weaknesses: { type: 'array', items: { type: 'string' } },
                        whatTheyDoBetter: { type: 'array', items: { type: 'string' } },
                        whereYouWin: { type: 'array', items: { type: 'string' } },
                        sentimentLabel: { type: 'string', enum: ['Positive', 'Negative', 'Mixed'] },
                        pricingInsight: { type: 'string' },
                        marketingEdge: { type: 'string' },
                    },
                    required: ['name', 'strengths', 'weaknesses', 'sentimentLabel'],
                },
            },
        },
        required: ['overview', 'keyFindings', 'immediateThreats', 'growthOpportunities', 'verdict', 'actionPlan', 'keywords', 'competitors'],
    },
};

export interface AnalysisPromptInput {
    base: { name: string; city: string; cuisine: string; rating: number; reviews: number };
    topCompetitors: CompactRow[];
    sameCuisineRows: CompactRow[];
}

export function buildAnalysisPrompt(input: AnalysisPromptInput): string {
    const { base, topCompetitors, sameCuisineRows } = input;
    const fmt = (r: CompactRow) =>
        `- ${r.name}: rating ${r.rating}, ${r.reviews} reviews${r.distanceKm !== undefined ? `, ${r.distanceKm} km away` : ''}`;
    return [
        `Analyze the competitive landscape for ${base.name} in ${base.city}.`,
        `Base restaurant cuisine: ${base.cuisine}. Base rating: ${base.rating}. Base reviews: ${base.reviews}.`,
        '',
        'Top competitors (by threat):',
        ...topCompetitors.map(fmt),
        '',
        'Same-cuisine rivals nearby:',
        ...(sameCuisineRows.length ? sameCuisineRows.map(fmt) : ['- (none within range)']),
        '',
        'Produce the analysis via the competitive_analysis tool. keyFindings must be 8 to 10 items, each anchored ',
        'to a specific number from the data above (a rating, review count, distance, or photo count) and each ending ',
        'with why it matters to the owner in plain words. actionPlan exactly 5 items. ',
        'Only reference numbers that appear above — never invent platform metrics.',
    ].join('\n');
}
