import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  trackAIUsage: vi.fn(),
}));

vi.mock('@restropulse/db', () => ({
  insertCostEvent: vi.fn().mockResolvedValue({ id: 'ce_test' }),
}));

const { runDraftCycle } = await import(
  '../../../../../../src/services/content-generator/backends/ai/pipeline/draft-cycle.js'
);
const { RestaurantSpecialization } = await import(
  '../../../../../../src/services/content-generator/backends/ai/specialization/index.js'
);

beforeEach(() => {
  vi.clearAllMocks();
});

function makeDeps(overrides: Partial<{ generateObject: any }> = {}) {
  const generateObject = overrides.generateObject ?? vi.fn().mockResolvedValue({
    object: {
      summary: 'A focused week on chef specials',
      plannedPosts: [{ category: 'chef_special', count: 2 }],
      focus: ['Chef Specials'],
    },
    usage: { inputTokens: 200, outputTokens: 80 },
    modelId: 'claude-sonnet-4-6',
  });
  return {
    llm: { name: 'mock-llm', generateObject },
    media: {} as any,
    specialization: new RestaurantSpecialization(),
  };
}

describe('runDraftCycle', () => {
  it('returns the LLM-produced cycle', async () => {
    const deps = makeDeps();
    const out = await runDraftCycle(
      { period: 'week-of-2026-05-04', strategyFocus: ['Chef Specials'] },
      deps,
      { restaurantId: 'r1', restaurantName: 'Spice Route' },
    );
    expect(out.summary).toBe('A focused week on chef specials');
    expect(out.plannedPosts).toEqual([{ category: 'chef_special', count: 2 }]);
    expect(out.focus).toEqual(['Chef Specials']);
  });

  it('passes the specialization system fragment + sonnet model + telemetry tags to the LLM', async () => {
    const generateObject = vi.fn().mockResolvedValue({
      object: { summary: 's', plannedPosts: [{ category: 'a', count: 1 }], focus: ['x'] },
      usage: { inputTokens: 10, outputTokens: 10 },
      modelId: 'claude-sonnet-4-6',
    });
    const deps = makeDeps({ generateObject });
    await runDraftCycle(
      { period: 'w1' },
      deps,
      { restaurantId: 'r1', restaurantName: 'Spice Route' },
    );

    const arg = generateObject.mock.calls[0][0];
    expect(arg.model).toBe('sonnet');
    expect(arg.system.toLowerCase()).toContain('restaurant');
    expect(arg.prompt).toContain('Spice Route');
    expect(arg.telemetryAttributes).toMatchObject({
      operation: 'draftCycle',
      restaurantId: 'r1',
    });
  });

  it('writes a cost event via withCostTracking', async () => {
    const { insertCostEvent } = await import('@restropulse/db');
    (insertCostEvent as any).mockClear();
    const deps = makeDeps();
    await runDraftCycle({ period: 'w1' }, deps, { restaurantId: 'r1' });
    expect(insertCostEvent).toHaveBeenCalledTimes(1);
    const event = (insertCostEvent as any).mock.calls[0][0];
    expect(event.operation).toBe('draftCycle');
    expect(event.surface).toBe('llm');
    expect(event.step).toBe('cycle');
    expect(event.model).toBe('claude-sonnet-4-6');
    expect(event.restaurantId).toBe('r1');
  });

  it('throws ContentGenerationError on empty period', async () => {
    const deps = makeDeps();
    await expect(runDraftCycle({ period: '' }, deps, {})).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });
});
