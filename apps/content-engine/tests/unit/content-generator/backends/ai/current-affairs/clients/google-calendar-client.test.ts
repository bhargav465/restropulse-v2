import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { GoogleCalendarClient } = await import(
  '../../../../../../../src/services/content-generator/backends/ai/current-affairs/clients/google-calendar-client.js'
);

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  // Replace global fetch
  (globalThis as any).fetch = fetchMock;
});

const sampleResponse = {
  items: [
    {
      summary: 'Eid al-Fitr',
      start: { date: '2026-05-15' },
      end: { date: '2026-05-16' },
    },
    {
      summary: 'Buddha Purnima',
      start: { date: '2026-05-23' },
      end: { date: '2026-05-24' },
    },
  ],
};

describe('GoogleCalendarClient', () => {
  it('throws when constructed without an apiKey', () => {
    expect(() => new GoogleCalendarClient({ apiKey: '' })).toThrow(/api ?key/i);
  });

  it('lists holidays for a given month', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => sampleResponse,
    });
    const client = new GoogleCalendarClient({ apiKey: 'test-key' });
    const holidays = await client.listHolidays(2026, 5);
    expect(holidays).toEqual([
      { name: 'Eid al-Fitr', date: '2026-05-15' },
      { name: 'Buddha Purnima', date: '2026-05-23' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain('/calendar/v3/calendars/');
    expect(url).toContain('key=test-key');
    expect(url).toContain('timeMin=2026-05-01');
    expect(url).toContain('timeMax=2026-06-01');
  });

  it('returns [] for an empty items array', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ items: [] }) });
    const client = new GoogleCalendarClient({ apiKey: 'k' });
    expect(await client.listHolidays(2026, 12)).toEqual([]);
  });

  it('throws TransientError on 503', async () => {
    const { TransientError } = await import(
      '../../../../../../../src/services/content-generator/backends/ai/errors.js'
    );
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      headers: new Map(),
      json: async () => ({ error: 'unavail' }),
      text: async () => '{}',
    });
    const client = new GoogleCalendarClient({ apiKey: 'k' });
    await expect(client.listHolidays(2026, 5)).rejects.toBeInstanceOf(TransientError);
  });

  it('throws RateLimitError on 429', async () => {
    const { RateLimitError } = await import(
      '../../../../../../../src/services/content-generator/backends/ai/errors.js'
    );
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Map([['retry-after', '5']]),
      json: async () => ({ error: 'rate limited' }),
      text: async () => '{}',
    });
    const client = new GoogleCalendarClient({ apiKey: 'k' });
    await expect(client.listHolidays(2026, 5)).rejects.toBeInstanceOf(RateLimitError);
  });

  it('throws plain Error on 4xx other than 429', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      headers: new Map(),
      json: async () => ({ error: 'forbidden' }),
      text: async () => '{}',
    });
    const client = new GoogleCalendarClient({ apiKey: 'k' });
    await expect(client.listHolidays(2026, 5)).rejects.toThrow();
  });
});
