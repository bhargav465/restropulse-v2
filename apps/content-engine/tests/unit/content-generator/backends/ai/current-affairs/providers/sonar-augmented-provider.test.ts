import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  trackAIUsage: vi.fn(),
}));

vi.mock('@restropulse/db', () => ({
  insertCostEvent: vi.fn().mockResolvedValue({ id: 'ce_test' }),
}));

const { SonarAugmentedProvider } = await import(
  '../../../../../../../src/services/content-generator/backends/ai/current-affairs/providers/sonar-augmented-provider.js'
);
const { RestaurantSpecialization } = await import(
  '../../../../../../../src/services/content-generator/backends/ai/specialization/index.js'
);

function makeUpstream(hints: string[] = ['Today is Wednesday, 13 May 2026']) {
  return {
    name: 'mock-upstream',
    fetchHints: vi.fn(async () => hints),
    refresh: vi.fn(async () => {}),
  };
}

function makeCache() {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn(async <T>(k: string) => (store.has(k) ? (store.get(k) as T) : null)),
    set: vi.fn(async (k: string, v: unknown) => { store.set(k, v); }),
    cleanup: vi.fn(async () => 0),
    _store: store,
  };
}

function makeClient(text: string) {
  return {
    query: vi.fn(async () => ({
      text,
      usage: { inputTokens: 50, outputTokens: 80 },
      modelId: 'sonar-pro',
    })),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-13T00:00:00Z'));
  vi.clearAllMocks();
});

describe('SonarAugmentedProvider.fetchHints', () => {
  it('returns upstream hints + cached daily Sonar payload', async () => {
    const upstream = makeUpstream(['Today is Wednesday, 13 May 2026']);
    const cache = makeCache();
    cache._store.set('sonar-daily:2026-05-13', { text: 'IPL Final tonight in Chennai', cachedAt: '2026-05-13T06:00:00Z' });
    const client = makeClient('unused');
    const p = new SonarAugmentedProvider(upstream as any, {
      cache: cache as any,
      client: client as any,
      specialization: new RestaurantSpecialization(),
    });
    const hints = await p.fetchHints({ operation: 'draftCycle', specializationContext: {} });
    expect(hints).toContain('Today is Wednesday, 13 May 2026');
    expect(hints.some((h) => h.includes('IPL Final'))).toBe(true);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('falls back gracefully when daily cache is empty (no extra hints prepended)', async () => {
    const upstream = makeUpstream(['Today line']);
    const cache = makeCache();
    const client = makeClient('unused');
    const p = new SonarAugmentedProvider(upstream as any, {
      cache: cache as any,
      client: client as any,
      specialization: new RestaurantSpecialization(),
    });
    const hints = await p.fetchHints({ operation: 'draftCycle', specializationContext: {} });
    expect(hints).toEqual(['Today line']);
  });

  it('fires a per-post Sonar query when generatePost concept matches a trigger keyword', async () => {
    const upstream = makeUpstream(['Today line']);
    const cache = makeCache();
    const client = makeClient('Cricket-themed combos are hot in Bengaluru this weekend');
    const p = new SonarAugmentedProvider(upstream as any, {
      cache: cache as any,
      client: client as any,
      specialization: new RestaurantSpecialization(),
    });
    const hints = await p.fetchHints({
      operation: 'generatePost',
      specializationContext: { restaurantName: 'Spice Route', cuisine: 'South Indian', region: 'Bengaluru' },
      concept: 'cricket match-day biryani offer',
      restaurantId: 'r1',
      postId: 'p1',
    });
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(hints.some((h) => h.includes('Cricket-themed combos'))).toBe(true);
  });

  it('does NOT fire a per-post Sonar query when concept lacks any trigger keyword', async () => {
    const upstream = makeUpstream(['Today line']);
    const cache = makeCache();
    const client = makeClient('unused');
    const p = new SonarAugmentedProvider(upstream as any, {
      cache: cache as any,
      client: client as any,
      specialization: new RestaurantSpecialization(),
    });
    await p.fetchHints({
      operation: 'generatePost',
      specializationContext: {},
      concept: 'a regular Tuesday plate of dal',
    });
    expect(client.query).not.toHaveBeenCalled();
  });

  it('returns upstream-only when the per-post Sonar call fails (degraded mode)', async () => {
    const upstream = makeUpstream(['Today line']);
    const cache = makeCache();
    const client = { query: vi.fn().mockRejectedValue(new Error('sonar down')) };
    const p = new SonarAugmentedProvider(upstream as any, {
      cache: cache as any,
      client: client as any,
      specialization: new RestaurantSpecialization(),
    });
    const hints = await p.fetchHints({
      operation: 'generatePost',
      specializationContext: {},
      concept: 'cricket match',
    });
    expect(hints).toEqual(['Today line']);
  });
});

describe('SonarAugmentedProvider.refresh', () => {
  it('refreshes upstream first, then fires the daily platform query and writes to cache', async () => {
    const order: string[] = [];
    const upstream = {
      name: 'u', fetchHints: vi.fn(),
      refresh: vi.fn(async () => { order.push('upstream'); }),
    };
    const cache = makeCache();
    cache.set = vi.fn(async (k: string, v: unknown) => { order.push(`cache:${k}`); cache._store.set(k, v); });
    const client = makeClient('Daily platform answer');
    const p = new SonarAugmentedProvider(upstream as any, {
      cache: cache as any,
      client: client as any,
      specialization: new RestaurantSpecialization(),
    });
    await p.refresh();
    expect(order[0]).toBe('upstream');
    expect(order[1]).toBe('cache:sonar-daily:2026-05-13');
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it('writes a cost event for the daily refresh call', async () => {
    const { insertCostEvent } = await import('@restropulse/db');
    (insertCostEvent as any).mockClear();
    const upstream = makeUpstream();
    const cache = makeCache();
    const client = makeClient('Daily platform answer');
    const p = new SonarAugmentedProvider(upstream as any, {
      cache: cache as any,
      client: client as any,
      specialization: new RestaurantSpecialization(),
    });
    await p.refresh();
    const event = (insertCostEvent as any).mock.calls.find((c: any) => c[0].surface === 'sonar' && c[0].step === 'daily');
    expect(event).toBeDefined();
    expect(event[0].operation).toBe('currentAffairsRefresh');
    expect(event[0].model).toBe('sonar-pro');
  });
});
