/**
 * runReviseCycle -- single-call cycle revision.
 *
 * Same shape as runDraftCycle but with the existing cycle + feedback laid
 * into the user prompt. Sonnet for reasoning. The specialization decides how
 * to phrase "address the feedback while preserving what worked."
 */

import {
  ContentGenerationError,
  type GeneratedCycle,
  type GenerationContext,
  type ReviseCycleInput,
} from '../../../types.js';
import { withRetry, RETRY_PROFILES } from '../with-retry.js';
import { withCostTracking } from '../with-cost-tracking.js';
import { CycleSchema } from '../llm/schemas.js';
import { computeCostUsd } from '../llm/pricing.js';
import { type PipelineDeps, toSpecializationContext, resolveCurrentAffairsHints } from './types.js';

export async function runReviseCycle(
  input: ReviseCycleInput,
  deps: PipelineDeps,
  ctx?: GenerationContext,
): Promise<GeneratedCycle> {
  if (!input.existingCycle) {
    throw new ContentGenerationError('INVALID_INPUT', 'reviseCycle requires existingCycle');
  }
  if (!input.feedback) {
    throw new ContentGenerationError('INVALID_INPUT', 'reviseCycle requires feedback');
  }

  const specCtx = toSpecializationContext(ctx);
  const system = deps.specialization.getSystemPromptFragment(specCtx);
  const taskPrompt = deps.specialization.getTaskPrompt('reviseCycle', input, specCtx);

  const hints = await resolveCurrentAffairsHints(
    input.currentAffairsHints,
    deps.currentAffairs,
    {
      operation: 'reviseCycle',
      specializationContext: specCtx,
      ...(ctx?.restaurantId ? { restaurantId: ctx.restaurantId } : {}),
    },
  );

  const userPrompt = [
    taskPrompt,
    '',
    'Existing cycle:',
    `Period: ${input.existingCycle.period}`,
    `Summary: ${input.existingCycle.summary}`,
    `Focus areas: ${input.existingCycle.focus.join(', ')}`,
    `Planned posts: ${JSON.stringify(input.existingCycle.plannedPosts)}`,
    '',
    'Feedback to address:',
    `Areas: ${input.feedback.areas.join(', ')}`,
    `Note: ${input.feedback.note}`,
    input.feedback.resolution ? `Resolution: ${input.feedback.resolution}` : '',
    hints.length
      ? `\nCurrent-affairs hints:\n- ${hints.join('\n- ')}`
      : '',
  ].filter(Boolean).join('\n');

  const telemetryAttributes: Record<string, string> = { operation: 'reviseCycle' };
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
        operation: 'reviseCycle',
        surface: 'llm',
        step: 'cycle',
        model: 'claude-sonnet-4-6',
      },
    ),
    RETRY_PROFILES.LLM,
  );
}
