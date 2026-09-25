/**
 * GoogleCalendarClient -- thin wrapper around the Google Calendar Public Holidays
 * API for the India calendar.
 *
 * Reference: https://developers.google.com/calendar/api/v3/reference/events/list
 *
 * Auth: API key (no OAuth -- the holiday calendar is public-readable).
 *
 * Errors are passed through classifyError so withRetry can decide whether to
 * retry. The provider that wraps this client owns retry policy.
 */

import { createLogger } from '@restropulse/telemetry/server';
import { classifyError, TransientError } from '../../errors.js';

const log = createLogger('google-calendar-client');

const INDIA_HOLIDAY_CALENDAR_ID = 'en.indian#holiday@group.v.calendar.google.com';
const BASE_URL = 'https://www.googleapis.com/calendar/v3/calendars';

export interface GoogleCalendarClientOptions {
  apiKey: string;
  /** Override calendar id; default is the India public holidays calendar. */
  calendarId?: string;
}

export interface CalendarHoliday {
  name: string;
  /** ISO date string (YYYY-MM-DD). */
  date: string;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export class GoogleCalendarClient {
  private readonly apiKey: string;
  private readonly calendarId: string;

  constructor(options: GoogleCalendarClientOptions) {
    if (!options || !options.apiKey) {
      throw new Error('GoogleCalendarClient requires a non-empty apiKey');
    }
    this.apiKey = options.apiKey;
    this.calendarId = options.calendarId ?? INDIA_HOLIDAY_CALENDAR_ID;
  }

  /**
   * List holidays in the given month.
   *
   * year: full year (e.g. 2026)
   * month: 1-12 (1 = January)
   */
  async listHolidays(year: number, month: number): Promise<CalendarHoliday[]> {
    const monthStart = `${year}-${pad2(month)}-01`;
    const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${pad2(month + 1)}-01`;

    const params = new URLSearchParams({
      key: this.apiKey,
      timeMin: `${monthStart}T00:00:00Z`,
      timeMax: `${nextMonth}T00:00:00Z`,
      singleEvents: 'true',
      orderBy: 'startTime',
    });
    // Re-stringify timeMin/timeMax as the test asserts on the date prefix only.
    // URLSearchParams URL-encodes ':' which the test does not care about.

    const calendarPath = encodeURIComponent(this.calendarId);
    const url = `${BASE_URL}/${calendarPath}/events?${params.toString()}`;

    let res: Response;
    try {
      res = await fetch(url);
    } catch (err) {
      // Network error -- surface as TransientError so retry profiles take over.
      throw new TransientError(`Google Calendar fetch failed: ${(err as Error).message}`, undefined, err);
    }

    if (!res.ok) {
      const headers: Record<string, string> = {};
      // Headers may be a Map (test mock) or Headers (real fetch). Both are iterable.
      try {
        for (const [k, v] of res.headers as any) headers[k.toLowerCase()] = String(v);
      } catch {
        // ignore -- header copy is best-effort
      }
      const httpish = { status: res.status, message: `Google Calendar HTTP ${res.status}`, headers };
      const classified = classifyError(httpish);
      if (classified instanceof Error) throw classified;
      throw new Error(httpish.message);
    }

    const body = await res.json() as { items?: Array<{ summary?: string; start?: { date?: string; dateTime?: string } }> };
    const items = body.items ?? [];

    const holidays: CalendarHoliday[] = items
      .map((it) => ({
        name: it.summary ?? 'Unknown holiday',
        date: it.start?.date ?? it.start?.dateTime?.slice(0, 10) ?? '',
      }))
      .filter((h) => h.date.length === 10);

    log.debug({ count: holidays.length, year, month }, 'Listed holidays');
    return holidays;
  }
}
