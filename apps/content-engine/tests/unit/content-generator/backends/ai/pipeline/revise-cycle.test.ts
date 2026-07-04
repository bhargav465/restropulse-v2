import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  trackAIUsage: vi.fn(),
}));

vi.mock('@restropulse/db', () => ({
  insertCostEvent: vi.fn().mockResolvedValue({ id: 'ce_test' }),
}));

const { runReviseCycle } = await import(
  '../../../../../../src/services/content-generator/backends/ai/pipeline/revise-cycle.js'
);
const { RestaurantSpecialization } = await import(
  '../../../../../../src/services/content-generator/backends/ai/specialization/index.js'
);

beforeEach(() => {
  vi.clearAllMocks();
});

const baseInput = {
  existingCycle: {
    period: 'w1',
    summary: 'Existing summary',
    plannedPosts: [{ category: 'chef_special', count: 2 }],
    focus: ['Chef Specials'],
  },
  feedback: {
    areas: ['hashtags', 'cta'],
    note: 'More festive tone, add CTA in offer posts.',
  },
};

function makeDeps(overrides: Partial<{ generateObject: any }> = {}) {
  const generateObject = overrides.generateObject ?? vi.fn().mockResolvedValue({
    object: {
      summary: 'Revised summary with festive tone',
      plannedPosts: [{ category: 'chef_special', count: 2 }, { category: 'offer_promo', count: 1 }],
      focus: ['Chef Specials', 'Offers'],
    },
    usage: { inputTokens: 250, outputTokens: 100 },
    modelId: 'claude-sonnet-4-6',
  });
  return {
    llm: { name: 'mock-llm', generateObject },
    media: {} as any,
    specialization: new RestaurantSpecialization(),
  };
}

describe('runReviseCycle', () => {
  it('returns the revised cycle from the LLM', async () => {
    const out = await runReviseCycle(baseInput as any, makeDeps(), { restaurantId: 'r1' });
    expect(out.summary).toBe('Revised summary with festive tone');
    expect(out.plannedPosts).toHaveLength(2);
  });

  it('includes feedback note + areas in the user prompt', async () => {
    const generateObject = vi.fn().mockResolvedValue({
      object: { summary: 's', plannedPosts: [{ category: 'a', count: 1 }], focus: ['x'] },
      usage: { inputTokens: 10, outputTokens: 10 },
      modelId: 'claude-sonnet-4-6',
    });
    await runReviseCycle(baseInput as any, makeDeps({ generateObject }), {});
    const arg = generateObject.mock.calls[0][0];
    expect(arg.prompt).toContain('More festive tone');
    expect(arg.prompt).toMatch(/hashtags|cta/);
    expect(arg.prompt).toContain('Existing summary');
  });

  it('writes cost event with operation=reviseCycle', async () => {
    const { insertCostEvent } = await import('@restropulse/db');
    (insertCostEvent as any).mockClear();
    await runReviseCycle(baseInput as any, makeDeps(), { restaurantId: 'r1' });
    const event = (insertCostEvent as any).mock.calls[0][0];
    expect(event.operation).toBe('reviseCycle');
  });
});
