/**
 * withCostTracking -- emits an OTel metric (via trackAIUsage) and persists a
 * denormalized row to the costEvents collection for every wrapped call.
 *
 * The wrapped function returns its result PLUS a usage object. withCostTracking
 * unwraps the result for the caller and side-effects the cost tracking. Failures
 * are recorded as status='failure' with costUsd=0, and the original error is
 * rethrown so callers can react.
 *
 * The cost-event write itself is best-effort: a Mongo outage must NOT poison
 * the AI generation call.
 */

import { createLogger, trackAIUsage } from '@restropulse/telemetry/server';
import { insertCostEvent } from '@restropulse/db';
import type { CostEvent, CostOperation, CostSurface } from '@restropulse/shared';

const log = createLogger('ai-cost-tracker');

export interface CostTrackingLabels {
  restaurantId?: string;
  postId?: string;
  cycleId?: string;
  operation: CostOperation;
  surface: CostSurface;
  step: string;
  model: string;
}

export interface AICallUsage {
  inputTokens?: number;
  outputTokens?: number;
  costUsd: number;
}

export interface AICallResult<T> {
  result: T;
  usage: AICallUsage;
}

export async function withCostTracking<T>(
  fn: () => Promise<AICallResult<T>>,
  labels: CostTrackingLabels,
): Promise<T> {
  const start = Date.now();
  try {
    const { result, usage } = await fn();
    const durationMs = Date.now() - start;

    trackAIUsage({
      model: labels.model,
      operation: labels.operation,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      costUsd: usage.costUsd,
      durationMs,
      ...(labels.restaurantId ? { restaurantId: labels.restaurantId } : {}),
      ...(labels.postId ? { postId: labels.postId } : {}),
      ...(labels.cycleId ? { cycleId: labels.cycleId } : {}),
      surface: labels.surface,
      step: labels.step,
    });

    await persistCostEvent({
      ...labels,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: usage.costUsd,
      durationMs,
      status: 'success',
      createdAt: new Date(),
    });

    return result;
  } catch (err) {
    const durationMs = Date.now() - start;
    const errorCode = (err as Error)?.name ?? 'UnknownError';

    await persistCostEvent({
      ...labels,
      costUsd: 0,
      durationMs,
      status: 'failure',
      errorCode,
      createdAt: new Date(),
    });

    throw err;
  }
}

async function persistCostEvent(event: Omit<CostEvent, 'id'>): Promise<void> {
  try {
    await insertCostEvent(event);
  } catch (err) {
    log.error({ err, postId: event.postId, restaurantId: event.restaurantId }, 'Failed to persist cost event; continuing');
  }
}
