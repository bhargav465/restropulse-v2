import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { CalendarOnlyProvider } = await import(
  '../../../../../../../src/services/content-generator/backends/ai/current-affairs/providers/calendar-only-provider.js'
);

function makeCache() {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn(async <T>(key: string) => (store.has(key) ? (store.get(key) as T) : null)),
    set: vi.fn(async (key: string, payload: unknown) => { store.set(key, payload); }),
    cleanup: vi.fn(async () => 0),
    _store: store,
  };
}

function makeClient(holidays: Array<{ name: string; date: string }>) {
  return { listHolidays: vi.fn(async () => holidays) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-13T00:00:00Z'));
});

describe('CalendarOnlyProvider.fetchHints', () => {
  it('emits a today-line plus near-term holidays from the cache', async () => {
    const cache = makeCache();
    const client = makeClient([]);
    cache._store.set('calendar:2026-05', [
      { name: 'Eid al-Fitr', date: '2026-05-15' },
      { name: 'Buddha Purnima', date: '2026-05-23' },
    ]);
    const p = new CalendarOnlyProvider({ cache: cache as any, client: client as any });
    const hints = await p.fetchHints({ operation: 'draftCycle', specializationContext: {} });
    expect(hints[0]).toMatch(/today/i);
    expect(hints.some((h) => h.includes('Eid al-Fitr'))).toBe(true);
    expect(hints.some((h) => h.includes('Buddha Purnima'))).toBe(false); // 10 days out, beyond +/-7
    expect(client.listHolidays).not.toHaveBeenCalled();
  });

  it('lazy-fetches via the client on cache miss and writes back', async () => {
    const cache = makeCache();
    const client = makeClient([{ name: 'Eid al-Fitr', date: '2026-05-15' }]);
    const p = new CalendarOnlyProvider({ cache: cache as any, client: client as any });
    await p.fetchHints({ operation: 'draftCycle', specializationContext: {} });
    expect(client.listHolidays).toHaveBeenCalledWith(2026, 5);
    expect(cache.set).toHaveBeenCalled();
    const setKey = (cache.set as any).mock.calls[0][0];
    expect(setKey).toBe('calendar:2026-05');
  });

  it('returns degraded today-only hints if the calendar fetch throws', async () => {
    const cache = makeCache();
    const client = { listHolidays: vi.fn().mockRejectedValue(new Error('upstream down')) };
    const p = new CalendarOnlyProvider({ cache: cache as any, client: client as any });
    const hints = await p.fetchHints({ operation: 'draftCycle', specializationContext: {} });
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatch(/today/i);
  });

  it('also pulls next-month holidays when today is in the last 7 days of a month', async () => {
    vi.setSystemTime(new Date('2026-05-29T00:00:00Z'));
    const cache = makeCache();
    cache._store.set('calendar:2026-05', []);
    cache._store.set('calendar:2026-06', [{ name: 'Eid al-Adha', date: '2026-06-04' }]);
    const client = makeClient([]);
    const p = new CalendarOnlyProvider({ cache: cache as any, client: client as any });
    const hints = await p.fetchHints({ operation: 'draftCycle', specializationContext: {} });
    expect(hints.some((h) => h.includes('Eid al-Adha'))).toBe(true);
  });
});

describe('CalendarOnlyProvider.refresh', () => {
  it('fetches the current month and writes to cache', async () => {
    const cache = makeCache();
    const client = makeClient([{ name: 'Test', date: '2026-05-20' }]);
    const p = new CalendarOnlyProvider({ cache: cache as any, client: client as any });
    await p.refresh();
    expect(client.listHolidays).toHaveBeenCalledWith(2026, 5);
    expect(cache.set).toHaveBeenCalledWith('calendar:2026-05', expect.any(Array), expect.any(Number));
  });

  it('also fetches next month when today is in the last 7 days', async () => {
    vi.setSystemTime(new Date('2026-05-29T00:00:00Z'));
    const cache = makeCache();
    const client = makeClient([]);
    const p = new CalendarOnlyProvider({ cache: cache as any, client: client as any });
    await p.refresh();
    expect(client.listHolidays).toHaveBeenCalledWith(2026, 5);
    expect(client.listHolidays).toHaveBeenCalledWith(2026, 6);
  });
});
