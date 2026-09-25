/**
 * AI usage tracking for cost visibility.
 *
 * Currently a schema definition + no-op metrics setup.
 * When content-engine integrates an AI API (OpenAI, Claude, etc.),
 * each API call wraps with trackAIUsage() to record token counts,
 * cost, and latency. These feed the AI Cost Dashboard.
 *
 * All AI metrics use OTel counters/histograms (pre-aggregated,
 * never sampled) and custom events (always collected) for exact
 * cost accounting.
 */

import { metrics } from '@opentelemetry/api';
import { trackEvent } from './events.js';
import { EventNames } from '../types.js';

const meter = metrics.getMeter('restropulse-ai');

const aiMetrics = {
    requestDuration: meter.createHistogram('ai.request.duration_ms', {
        description: 'AI API request duration',
        unit: 'ms',
    }),
    tokensInput: meter.createCounter('ai.tokens.input', {
        description: 'Total input tokens sent to AI models',
    }),
    tokensOutput: meter.createCounter('ai.tokens.output', {
        description: 'Total output tokens received from AI models',
    }),
    costUsd: meter.createCounter('ai.cost.usd', {
        description: 'Total AI API cost in USD',
    }),
};

export interface AIUsage {
    model: string;
    operation: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    durationMs: number;
    postType?: string;
    restaurantId?: string;
    // Phase 6 -- additional dimensions for per-restaurant cost dashboards
    postId?: string;
    cycleId?: string;
    surface?: string;        // 'llm' | 'image' | 'video' | 'sonar' | 'calendar'
    step?: string;           // e.g. 'caption', 'image', 'video-submit', 'daily', 'trigger'
}

/**
 * Record an AI API call's usage and cost.
 *
 * Emits an OTel histogram (duration), counters (tokens, cost) labeled with
 * model+operation; also emits a customEvents row to Application Insights with
 * the full label set (restaurantId, postId, cycleId, surface, step) so the
 * cost-by-restaurant and per-post-audit Workbooks under infra/workbooks/ can
 * filter and group precisely. See docs/CONTENT_ENGINE_AI_ROLLOUT.md.
 */
export function trackAIUsage(usage: AIUsage): void {
    const labels = { model: usage.model, operation: usage.operation };

    aiMetrics.requestDuration.record(usage.durationMs, labels);
    aiMetrics.tokensInput.add(usage.inputTokens, labels);
    aiMetrics.tokensOutput.add(usage.outputTokens, labels);
    aiMetrics.costUsd.add(usage.costUsd, labels);

    trackEvent(EventNames.AI_REQUEST_COMPLETED, {
        model: usage.model,
        operation: usage.operation,
        inputTokens: String(usage.inputTokens),
        outputTokens: String(usage.outputTokens),
        costUsd: String(usage.costUsd),
        durationMs: String(usage.durationMs),
        postType: usage.postType ?? '',
        restaurantId: usage.restaurantId ?? '',
        postId: usage.postId ?? '',
        cycleId: usage.cycleId ?? '',
        surface: usage.surface ?? '',
        step: usage.step ?? '',
    });
}
