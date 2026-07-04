import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  trackAIUsage: vi.fn(),
}));

vi.mock('@restropulse/db', () => ({
  insertCostEvent: vi.fn().mockResolvedValue({ id: 'ce_1' }),
}));

const { trackAIUsage } = await import('@restropulse/telemetry/server');
const { insertCostEvent } = await import('@restropulse/db');
const { withCostTracking } = await import(
  '../../../../../src/services/content-generator/backends/ai/with-cost-tracking.js'
);

beforeEach(() => {
  vi.clearAllMocks();
});

const baseLabels = {
  restaurantId: 'r1',
  postId: 'p1',
  cycleId: 'c1',
  operation: 'generatePost' as const,
  surface: 'llm' as const,
  step: 'caption',
  model: 'claude-sonnet-4-6',
};

describe('withCostTracking', () => {
  it('returns the wrapped function result and unwraps usage', async () => {
    const out = await withCostTracking(
      async () => ({
        result: { caption: 'hi' },
        usage: { inputTokens: 100, outputTokens: 50, costUsd: 0.012 },
      }),
      baseLabels,
    );
    expect(out).toEqual({ caption: 'hi' });
  });

  it('records a success cost event with all labels and usage fields', async () => {
    await withCostTracking(
      async () => ({
        result: 'x',
        usage: { inputTokens: 100, outputTokens: 50, costUsd: 0.012 },
      }),
      baseLabels,
    );
    expect(insertCostEvent).toHaveBeenCalledTimes(1);
    const event = (insertCostEvent as any).mock.calls[0][0];
    expect(event.restaurantId).toBe('r1');
    expect(event.postId).toBe('p1');
    expect(event.cycleId).toBe('c1');
    expect(event.operation).toBe('generatePost');
    expect(event.surface).toBe('llm');
    expect(event.step).toBe('caption');
    expect(event.model).toBe('claude-sonnet-4-6');
    expect(event.inputTokens).toBe(100);
    expect(event.outputTokens).toBe(50);
    expect(event.costUsd).toBe(0.012);
    expect(event.status).toBe('success');
    expect(typeof event.durationMs).toBe('number');
    expect(event.durationMs).toBeGreaterThanOrEqual(0);
    expect(event.createdAt).toBeInstanceOf(Date);
  });

  it('forwards the success metric to trackAIUsage', async () => {
    await withCostTracking(
      async () => ({
        result: 'x',
        usage: { inputTokens: 10, outputTokens: 20, costUsd: 0.001 },
      }),
      baseLabels,
    );
    expect(trackAIUsage).toHaveBeenCalledTimes(1);
    const usage = (trackAIUsage as any).mock.calls[0][0];
    expect(usage.model).toBe('claude-sonnet-4-6');
    expect(usage.operation).toBe('generatePost');
    expect(usage.inputTokens).toBe(10);
    expect(usage.outputTokens).toBe(20);
    expect(usage.costUsd).toBe(0.001);
    expect(usage.restaurantId).toBe('r1');
    // Phase 6 -- additional dimensions
    expect(usage.postId).toBe('p1');
    expect(usage.cycleId).toBe('c1');
    expect(usage.surface).toBe('llm');
    expect(usage.step).toBe('caption');
  });

  it('records a failure cost event and rethrows the error', async () => {
    const boom = new Error('boom');
    await expect(
      withCostTracking(async () => { throw boom; }, baseLabels),
    ).rejects.toBe(boom);
    expect(insertCostEvent).toHaveBeenCalledTimes(1);
    const event = (insertCostEvent as any).mock.calls[0][0];
    expect(event.status).toBe('failure');
    expect(event.errorCode).toBe('Error');
    expect(event.costUsd).toBe(0);
  });

  it('does not throw if the cost-event write itself fails', async () => {
    (insertCostEvent as any).mockRejectedValueOnce(new Error('mongo down'));
    const out = await withCostTracking(
      async () => ({ result: 42, usage: { costUsd: 0 } }),
      baseLabels,
    );
    expect(out).toBe(42);
  });
});
