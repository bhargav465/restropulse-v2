/**
 * runDraftCycle -- single-call cycle drafting.
 *
 * Composes:
 *   specialization.getSystemPromptFragment + getTaskPrompt('draftCycle', ...)
 *   -> LLM generateObject(model='sonnet', schema=CycleSchema)
 * Wrapped in withRetry(LLM) + withCostTracking so transient failures retry and
 * every call lands in the costEvents collection tagged with restaurantId/cycleId.
 */

import {
  ContentGenerationError,
  type DraftCycleInput,
  type GeneratedCycle,
  type GenerationContext,
} from '../../../types.js';
import { withRetry, RETRY_PROFILES } from '../with-retry.js';
import { withCostTracking } from '../with-cost-tracking.js';
import { CycleSchema } from '../llm/schemas.js';
import { computeCostUsd } from '../llm/pricing.js';
import { type PipelineDeps, toSpecializationContext, resolveCurrentAffairsHints } from './types.js';

export async function runDraftCycle(
  input: DraftCycleInput,
  deps: PipelineDeps,
  ctx?: GenerationContext,
): Promise<GeneratedCycle> {
  const period = input.period?.trim();
  if (!period) {
    throw new ContentGenerationError('INVALID_INPUT', 'draftCycle requires a non-empty period');
  }

  const specCtx = toSpecializationContext(ctx);
  const system = deps.specialization.getSystemPromptFragment(specCtx);

  const hints = await resolveCurrentAffairsHints(
    input.currentAffairsHints,
    deps.currentAffairs,
    {
      operation: 'draftCycle',
      specializationContext: specCtx,
      ...(ctx?.restaurantId ? { restaurantId: ctx.restaurantId } : {}),
    },
  );

  const userPrompt = [
    deps.specialization.getTaskPrompt('draftCycle', input, specCtx),
    hints.length
      ? `\nCurrent-affairs hints (use sparingly):\n- ${hints.join('\n- ')}`
      : '',
  ].filter(Boolean).join('\n');

  const telemetryAttributes: Record<string, string> = { operation: 'draftCycle' };
  if (ctx?.restaurantId) telemetryAttributes.restaurantId = ctx.restaurantId;
  if (ctx?.correlationId) telemetryAttributes.correlationId = ctx.correlationId;

  return withRetry(
    () => withCostTracking(
      async () => {
        const { object, usage, modelId } = await deps.llm.generateObject({
          model: 'sonnet',
          system,
          prompt: userPrompt,
          schema: CycleSchema,
          telemetryAttributes,
        });
        const costUsd = computeCostUsd(modelId, usage);
        return {
          result: {
            summary: object.summary,
            plannedPosts: object.plannedPosts,
            focus: object.focus,
            ...(object.rationale ? { rationale: object.rationale } : {}),
          },
          usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            costUsd,
          },
        };
      },
      {
        ...(ctx?.restaurantId ? { restaurantId: ctx.restaurantId } : {}),
        operation: 'draftCycle',
        surface: 'llm',
        step: 'cycle',
        model: 'claude-sonnet-4-6',  // best-known; refined inside withCostTracking
      },
    ),
    RETRY_PROFILES.LLM,
  );
}
