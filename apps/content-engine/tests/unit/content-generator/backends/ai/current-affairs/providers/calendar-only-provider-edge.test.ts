import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { CalendarOnlyProvider } = await import(
  '../../../../../../../../src/services/content-generator/backends/ai/current-affairs/providers/calendar-only-provider.js'
);

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function makeDeps(cached: unknown = null) {
  return {
    cache: { get: vi.fn().mockResolvedValue(cached), set: vi.fn().mockResolvedValue(undefined) },
    client: { listHolidays: vi.fn().mockResolvedValue([]) },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('CalendarOnlyProvider constructor', () => {
  it.each([
    ['no options', undefined],
    ['no cache', { client: { listHolidays: vi.fn() } }],
    ['no client', { cache: { get: vi.fn(), set: vi.fn() } }],
  ])('rejects %s', (_label, options) => {
    expect(() => new CalendarOnlyProvider(options as never)).toThrow('requires { cache, client }');
  });
});

describe('fetchHints holiday phrasing', () => {
  it('describes holidays relative to today, only within the +/-7 day window', async () => {
    vi.setSystemTime(new Date('2026-05-13T12:00:00Z')); // a Wednesday, mid-month
    const { cache, client } = makeDeps([
      { name: 'Alpha', date: '2026-05-13' },
      { name: 'Bravo', date: '2026-05-14' },
      { name: 'Charlie', date: '2026-05-12' },
      { name: 'Delta', date: '2026-05-16' },
      { name: 'Echo', date: '2026-05-10' },
      { name: 'Foxtrot', date: '2026-05-25' }, // > 7 days ahead: omitted
      { name: 'Golf', date: '2026-05-01' }, // > 7 days back: omitted
    ]);

    const hints = await new CalendarOnlyProvider({ cache, client } as never).fetchHints({} as never);

    expect(hints).toEqual([
      'Today is Wednesday, 13 May 2026',
      'Alpha is today',
      'Bravo is tomorrow',
      'Charlie was yesterday',
      'Delta is in 3 days',
      'Echo was 3 days ago',
    ]);
    expect(client.listHolidays).not.toHaveBeenCalled(); // served from cache
  });

  it('lazy-fetches on a cache miss and stores the result for 24h', async () => {
    vi.setSystemTime(new Date('2026-05-13T12:00:00Z'));
    const { cache, client } = makeDeps(null);
    client.listHolidays.mockResolvedValue([{ name: 'Alpha', date: '2026-05-14' }]);

    const hints = await new CalendarOnlyProvider({ cache, client } as never).fetchHints({} as never);

    expect(client.listHolidays).toHaveBeenCalledWith(2026, 5);
    expect(cache.set).toHaveBeenCalledWith('calendar:2026-05', [{ name: 'Alpha', date: '2026-05-14' }], CACHE_TTL_MS);
    expect(hints).toContain('Alpha is tomorrow');
  });

  it('degrades to just the date line when loading holidays fails', async () => {
    vi.setSystemTime(new Date('2026-05-13T12:00:00Z'));
    const { cache, client } = makeDeps();
    cache.get.mockRejectedValue(new Error('cache down'));

    const hints = await new CalendarOnlyProvider({ cache, client } as never).fetchHints({} as never);

    expect(hints).toEqual(['Today is Wednesday, 13 May 2026']);
  });
});

describe('month coverage near month end', () => {
  it('also reads next month during the last 7 days of a month', async () => {
    vi.setSystemTime(new Date('2026-05-28T12:00:00Z'));
    const { cache, client } = makeDeps([]);

    await new CalendarOnlyProvider({ cache, client } as never).fetchHints({} as never);

    expect(cache.get).toHaveBeenCalledWith('calendar:2026-05');
    expect(cache.get).toHaveBeenCalledWith('calendar:2026-06');
  });

  it('rolls December over into January of the next year', async () => {
    vi.setSystemTime(new Date('2026-12-29T12:00:00Z'));
    const { cache, client } = makeDeps([]);

    await new CalendarOnlyProvider({ cache, client } as never).fetchHints({} as never);

    expect(cache.get).toHaveBeenCalledWith('calendar:2026-12');
    expect(cache.get).toHaveBeenCalledWith('calendar:2027-01');
  });
});

describe('refresh', () => {
  it('refreshes only the current month mid-month', async () => {
    vi.setSystemTime(new Date('2026-05-13T12:00:00Z'));
    const { cache, client } = makeDeps();

    await new CalendarOnlyProvider({ cache, client } as never).refresh();

    expect(client.listHolidays).toHaveBeenCalledTimes(1);
    expect(client.listHolidays).toHaveBeenCalledWith(2026, 5);
    expect(cache.set).toHaveBeenCalledWith('calendar:2026-05', [], CACHE_TTL_MS);
  });

  it('also refreshes next month in the last 7 days, rolling December to January', async () => {
    vi.setSystemTime(new Date('2026-12-29T12:00:00Z'));
    const { cache, client } = makeDeps();

    await new CalendarOnlyProvider({ cache, client } as never).refresh();

    expect(client.listHolidays).toHaveBeenCalledWith(2026, 12);
    expect(client.listHolidays).toHaveBeenCalledWith(2027, 1);
  });

  it('refreshes next month within the same year otherwise', async () => {
    vi.setSystemTime(new Date('2026-05-28T12:00:00Z'));
    const { cache, client } = makeDeps();

    await new CalendarOnlyProvider({ cache, client } as never).refresh();

    expect(client.listHolidays).toHaveBeenCalledWith(2026, 5);
    expect(client.listHolidays).toHaveBeenCalledWith(2026, 6);
  });

  it('keeps going (and does not throw) when one month fails to refresh', async () => {
    vi.setSystemTime(new Date('2026-05-28T12:00:00Z'));
    const { cache, client } = makeDeps();
    client.listHolidays.mockRejectedValueOnce(new Error('quota')).mockResolvedValueOnce([]);

    await expect(new CalendarOnlyProvider({ cache, client } as never).refresh()).resolves.toBeUndefined();

    expect(client.listHolidays).toHaveBeenCalledTimes(2);
    expect(cache.set).toHaveBeenCalledTimes(1); // only the month that succeeded
  });
});
