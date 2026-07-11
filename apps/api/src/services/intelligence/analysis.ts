/**
 * Anthropic-backed analysis stage. TWO calls, BOTH forced tool-use with a JSON
 * schema (module CLAUDE.md §7 — never free-text JSON parsing):
 *   Call A  classify_cuisines     — claude-haiku-4-5 (cheap classification)
 *   Call B  competitive_analysis  — claude-sonnet-4-6, max_tokens 8192
 *
 * Only compacted competitor rows (name/rating/reviews/distance) are sent — never
 * raw Places payloads (cost rule, CLAUDE §9). The model classifies, summarizes,
 * and strategizes; it never supplies ratings/review counts (those stay measured).
 *
 * ANTHROPIC_API_KEY is server-side only; a missing key raises a 503 StageError.
 * Each call retries once on a malformed/absent tool result, then fails the stage
 * with a 502 (INTEGRATION §7).
 */

import Anthropic from '@anthropic-ai/sdk';
import type { KeywordCluster } from '@restropulse/shared';
import { StageError } from './errors.js';
import {
    ANALYSIS_SYSTEM,
    ANALYSIS_TOOL,
    CLASSIFY_SYSTEM,
    CLASSIFY_TOOL,
    buildAnalysisPrompt,
    buildClassifyPrompt,
    DEEP_LINK_BUCKETS,
    type AnalysisPromptInput,
    type CompactRow,
} from './prompts.js';

const HAIKU_MODEL = 'claude-haiku-4-5';
const SONNET_MODEL = 'claude-sonnet-4-6';

export type DeepLinkBucket = (typeof DEEP_LINK_BUCKETS)[number];

export interface CuisineClassification {
    baseCuisine: string;
    /** Tolerant lookup (exact, then normalized) — returns undefined when unknown. */
    lookup: (name: string) => string | undefined;
}

export interface CompetitorEnhancement {
    name: string;
    strengths: string[];
    weaknesses: string[];
    whatTheyDoBetter?: string[];
    whereYouWin?: string[];
    sentimentLabel?: 'Positive' | 'Negative' | 'Mixed';
    pricingInsight?: string;
    marketingEdge?: string;
}

export interface AnalysisActionItem {
    priority: number;
    action: string;
    detail: string;
    impact: 'High' | 'Medium' | 'Low';
    timeframe: string;
    deepLinkBucket: DeepLinkBucket;
}

export interface CompetitiveAnalysis {
    overview: string;
    keyFindings: string[];
    immediateThreats: string;
    growthOpportunities: string;
    verdict: string;
    actionPlan: AnalysisActionItem[];
    keywords: KeywordCluster;
    enhancements: CompetitorEnhancement[];
    /** Tolerant lookup for a competitor's enhancement by name. */
    enhancementFor: (name: string) => CompetitorEnhancement | undefined;
}

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

/** Normalize a name to a tolerant lookup key (lowercase, alphanumeric only). */
function normKey(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Run a forced single-tool call and return the tool_use input. Retries once on a
 * missing/invalid tool block, then raises a 502 StageError.
 */
async function runForcedTool<T>(
    client: Anthropic,
    opts: { model: string; maxTokens: number; system: string; prompt: string; tool: Anthropic.Tool },
): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const res = await client.messages.create({
                model: opts.model,
                max_tokens: opts.maxTokens,
                system: opts.system,
                tools: [opts.tool],
                tool_choice: { type: 'tool', name: opts.tool.name },
                messages: [{ role: 'user', content: opts.prompt }],
            });
            const block = res.content.find(
                (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === opts.tool.name,
            );
            if (!block || typeof block.input !== 'object' || block.input === null) {
                throw new StageError('AI returned no structured result — please try again.', 502, 'ANALYZING');
            }
            return block.input as T;
        } catch (err) {
            lastErr = err;
            if (err instanceof Anthropic.APIError) {
                const status = err.status ?? 502;
                const message =
                    status === 401
                        ? 'AI service authentication failed — check ANTHROPIC_API_KEY.'
                        : status === 429
                          ? 'AI service is rate-limited right now — please try again in a moment.'
                          : 'AI analysis failed while generating the report — please try again.';
                // Auth/rate errors are not worth retrying; surface immediately.
                throw new StageError(message, 502, 'ANALYZING');
            }
            // Malformed tool result — retry once, then fall through.
        }
    }
    if (lastErr instanceof StageError) throw lastErr;
    throw new StageError('AI analysis returned an unexpected response — please try again.', 502, 'ANALYZING');
}

interface ClassifyToolInput {
    baseCuisine?: string;
    classifications?: Array<{ name?: string; cuisine?: string }>;
}

/** Call A — classify base + nearby cuisines. */
export async function classifyCuisines(
    base: { name: string; city: string },
    rows: CompactRow[],
    client: Anthropic = getClient(),
): Promise<CuisineClassification> {
    const input = await runForcedTool<ClassifyToolInput>(client, {
        model: HAIKU_MODEL,
        maxTokens: 2048,
        system: CLASSIFY_SYSTEM,
        prompt: buildClassifyPrompt(base, rows),
        tool: CLASSIFY_TOOL,
    });

    const exact: Record<string, string> = {};
    const normalized: Record<string, string> = {};
    for (const c of input.classifications ?? []) {
        if (!c?.name || !c?.cuisine) continue;
        exact[c.name] = c.cuisine;
        normalized[normKey(c.name)] = c.cuisine;
    }
    return {
        baseCuisine: input.baseCuisine || 'Multi-cuisine',
        lookup: (name: string) => exact[name] ?? normalized[normKey(name)],
    };
}

interface AnalysisToolInput {
    overview?: string;
    keyFindings?: string[];
    immediateThreats?: string;
    growthOpportunities?: string;
    verdict?: string;
    actionPlan?: Array<Partial<AnalysisActionItem>>;
    keywords?: Partial<KeywordCluster>;
    competitors?: CompetitorEnhancement[];
}

function coerceBucket(v: unknown): DeepLinkBucket {
    return (DEEP_LINK_BUCKETS as readonly string[]).includes(v as string)
        ? (v as DeepLinkBucket)
        : 'get-started';
}

/** Call B — full competitive analysis, keywords, and per-competitor layer. */
export async function analyzeCompetition(
    input: AnalysisPromptInput,
    client: Anthropic = getClient(),
): Promise<CompetitiveAnalysis> {
    const out = await runForcedTool<AnalysisToolInput>(client, {
        model: SONNET_MODEL,
        maxTokens: 8192,
        system: ANALYSIS_SYSTEM,
        prompt: buildAnalysisPrompt(input),
        tool: ANALYSIS_TOOL,
    });

    const keywords: KeywordCluster = {
        primary: out.keywords?.primary ?? [],
        longTail: out.keywords?.longTail ?? [],
        trending: out.keywords?.trending ?? [],
        competitor: out.keywords?.competitor ?? [],
        negativeToMonitor: out.keywords?.negativeToMonitor ?? [],
    };

    const actionPlan: AnalysisActionItem[] = (out.actionPlan ?? []).map((a, i) => ({
        priority: typeof a.priority === 'number' ? a.priority : i + 1,
        action: a.action ?? '',
        detail: a.detail ?? '',
        impact: (a.impact as AnalysisActionItem['impact']) ?? 'Medium',
        timeframe: a.timeframe ?? '',
        deepLinkBucket: coerceBucket((a as { deepLinkBucket?: unknown }).deepLinkBucket),
    }));

    const enhancements = out.competitors ?? [];
    const byName: Record<string, CompetitorEnhancement> = {};
    for (const e of enhancements) {
        if (e?.name) byName[normKey(e.name)] = e;
    }

    return {
        overview: out.overview ?? '',
        keyFindings: out.keyFindings ?? [],
        immediateThreats: out.immediateThreats ?? '',
        growthOpportunities: out.growthOpportunities ?? '',
        verdict: out.verdict ?? '',
        actionPlan,
        keywords,
        enhancements,
        enhancementFor: (name: string) => byName[normKey(name)],
    };
}
