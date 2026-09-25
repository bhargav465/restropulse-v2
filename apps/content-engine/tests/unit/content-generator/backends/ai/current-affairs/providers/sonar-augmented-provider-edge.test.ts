import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  trackAIUsage: vi.fn(),
}));

const insertCostEvent = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'ce_test' }));
vi.mock('@restropulse/db', () => ({ insertCostEvent }));

const { SonarAugmentedProvider } = await import(
  '../../../../../../../../src/services/content-generator/backends/ai/current-affairs/providers/sonar-augmented-provider.js'
);

const TODAY_KEY = 'sonar-daily:2026-05-13';

function makeUpstream() {
  return { name: 'up', fetchHints: vi.fn(async () => ['Today is Wednesday, 13 May 2026']), refresh: vi.fn(async () => {}) };
}

function makeCache(initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    get: vi.fn(async (k: string) => (store.has(k) ? store.get(k) : null)),
    set: vi.fn(async (k: string, v: unknown) => void store.set(k, v)),
    cleanup: vi.fn(async () => 0),
  };
}

function makeClient(text = 'Sonar says hello') {
  return { query: vi.fn(async () => ({ text, usage: { inputTokens: 1000, outputTokens: 2000 }, modelId: 'sonar-pro' })) };
}

function makeSpecialization(queries: string[] = ['what is trending?']) {
  return { getSonarQueries: vi.fn().mockReturnValue(queries) };
}

function make(overrides: { cache?: any; client?: any; specialization?: any } = {}) {
  const parts = {
    cache: overrides.cache ?? makeCache(),
    client: overrides.client ?? makeClient(),
    specialization: overrides.specialization ?? makeSpecialization(),
  };
  const upstream = makeUpstream();
  return { provider: new SonarAugmentedProvider(upstream as never, parts as never), upstream, ...parts };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-13T00:00:00Z'));
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

describe('constructor validation', () => {
  it('requires an upstream provider', () => {
    expect(() => new SonarAugmentedProvider(undefined as never, {} as never)).toThrow('requires an upstream provider');
  });

  it.each([
    ['no options', undefined],
    ['no cache', { client: {}, specialization: {} }],
    ['no client', { cache: {}, specialization: {} }],
    ['no specialization', { cache: {}, client: {} }],
  ])('rejects %s', (_label, options) => {
    expect(() => new SonarAugmentedProvider(makeUpstream() as never, options as never)).toThrow('requires { cache, client, specialization }');
  });
});

describe('fetchHints per-post trigger guards', () => {
  it('skips the Sonar call when the operation has no concept', async () => {
    const { provider, client } = make();
    await provider.fetchHints({ operation: 'generatePost' } as never);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('skips the Sonar call when the concept has no trigger keyword', async () => {
    const { provider, client } = make();
    await provider.fetchHints({ operation: 'generatePost', concept: 'Paneer tikka platter' } as never);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('skips the Sonar call for operations other than generate/revise', async () => {
    const { provider, client } = make();
    await provider.fetchHints({ operation: 'draftCycle', concept: 'IPL final night' } as never);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('skips the Sonar call when the specialization has no per-post query', async () => {
    const { provider, client } = make({ specialization: makeSpecialization([]) });
    const hints = await provider.fetchHints({ operation: 'revisePost', concept: 'Diwali special' } as never);
    expect(client.query).not.toHaveBeenCalled();
    expect(hints).toEqual(['Today is Wednesday, 13 May 2026']);
  });

  it('does not append an empty Sonar response', async () => {
    const { provider, client } = make({ client: makeClient('') });
    const hints = await provider.fetchHints({ operation: 'generatePost', concept: 'Monsoon menu' } as never);
    expect(client.query).toHaveBeenCalledOnce();
    expect(hints).toEqual(['Today is Wednesday, 13 May 2026']);
  });

  it('appends the Sonar answer and attributes the cost to the post, restaurant and cycle', async () => {
    const { provider } = make({ client: makeClient('Rain expected in Hyderabad') });
    const hints = await provider.fetchHints({
      operation: 'generatePost',
      concept: 'Monsoon menu',
      restaurantId: 'r1',
      postId: 'p1',
      cycleId: 'c1',
    } as never);

    expect(hints).toContain('Rain expected in Hyderabad');
    expect(insertCostEvent).toHaveBeenCalledWith(expect.objectContaining({ restaurantId: 'r1', postId: 'p1', cycleId: 'c1', surface: 'sonar' }));
  });

  it('degrades to the upstream hints when the daily cache read fails', async () => {
    const cache = makeCache();
    cache.get.mockRejectedValue(new Error('cache down'));
    const { provider } = make({ cache });
    const hints = await provider.fetchHints({ operation: 'draftCycle' } as never);
    expect(hints).toEqual(['Today is Wednesday, 13 May 2026']);
  });

  it('degrades when the per-post Sonar call fails', async () => {
    const client = { query: vi.fn().mockRejectedValue(new Error('sonar 400')) };
    const { provider } = make({ client });
    const hints = await provider.fetchHints({ operation: 'generatePost', concept: 'Wedding menu' } as never);
    expect(hints).toEqual(['Today is Wednesday, 13 May 2026']);
  });
});

describe('refresh', () => {
  it('refreshes upstream, then stores today\'s daily answer', async () => {
    const { provider, upstream, cache, client } = make({ client: makeClient('Daily platform answer') });
    await provider.refresh();

    expect(upstream.refresh).toHaveBeenCalledOnce();
    expect(client.query).toHaveBeenCalledOnce();
    expect(cache.set).toHaveBeenCalledWith(TODAY_KEY, { text: 'Daily platform answer', cachedAt: '2026-05-13T00:00:00.000Z' }, 24 * 60 * 60 * 1000);
  });

  it('skips the daily refresh when the specialization has no daily query', async () => {
    const { provider, client, cache } = make({ specialization: makeSpecialization([]) });
    await provider.refresh();

    expect(client.query).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('leaves the cache untouched (and does not throw) when the daily Sonar call fails', async () => {
    const client = { query: vi.fn().mockRejectedValue(new Error('sonar 500')) };
    const { provider, cache } = make({ client });

    await expect(provider.refresh()).resolves.toBeUndefined();
    expect(cache.set).not.toHaveBeenCalled();
  });
});
