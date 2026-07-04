/**
 * CalendarOnlyProvider -- V1 of the current-affairs RAG.
 *
 * Produces hints like "Today is Wednesday, 13 May 2026" and "Eid al-Fitr is
 * in 2 days". Reads from cache (key = `calendar:YYYY-MM`); on cache miss,
 * lazy-fetches via GoogleCalendarClient.listHolidays. The Calendar call is
 * free, so lazy-on-miss is safe (no surprise costs).
 *
 * The cron processor calls refresh() at 06:00 IST to keep the cache warm,
 * and to fetch next month's holidays when we're in the last 7 days of a month.
 */

import { createLogger } from '@restropulse/telemetry/server';
import type { CalendarHoliday, GoogleCalendarClient } from '../clients/google-calendar-client.js';
import type { ICurrentAffairsCache } from '../cache/types.js';
import type { FetchHintsParams, ICurrentAffairsProvider } from '../types.js';

const log = createLogger('calendar-only-provider');

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;     // 24h
const HOLIDAY_WINDOW_DAYS = 7;                 // emit holidays within +/-7 days

export interface CalendarOnlyProviderOptions {
  cache: ICurrentAffairsCache;
  client: Pick<GoogleCalendarClient, 'listHolidays'>;
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function todayLine(now: Date): string {
  const wk = WEEKDAY_NAMES[now.getUTCDay()];
  const mon = MONTH_NAMES[now.getUTCMonth()];
  const day = now.getUTCDate();
  const yr = now.getUTCFullYear();
  return `Today is ${wk}, ${day} ${mon} ${yr}`;
}

function cacheKey(year: number, month1Indexed: number): string {
  return `calendar:${year}-${month1Indexed.toString().padStart(2, '0')}`;
}

function holidayLine(name: string, daysOut: number): string | null {
  if (daysOut === 0) return `${name} is today`;
  if (daysOut === 1) return `${name} is tomorrow`;
  if (daysOut === -1) return `${name} was yesterday`;
  if (daysOut > 1 && daysOut <= HOLIDAY_WINDOW_DAYS) return `${name} is in ${daysOut} days`;
  if (daysOut < -1 && daysOut >= -HOLIDAY_WINDOW_DAYS) return `${name} was ${Math.abs(daysOut)} days ago`;
  return null;
}

function differenceInDays(target: Date, base: Date): number {
  const dayMs = 24 * 60 * 60 * 1000;
  // Truncate both to UTC midnight to avoid timezone drift in the difference.
  const a = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  const b = Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate());
  return Math.round((a - b) / dayMs);
}

export class CalendarOnlyProvider implements ICurrentAffairsProvider {
  readonly name = 'calendar-only';
  private readonly cache: ICurrentAffairsCache;
  private readonly client: Pick<GoogleCalendarClient, 'listHolidays'>;

  constructor(options: CalendarOnlyProviderOptions) {
    if (!options || !options.cache || !options.client) {
      throw new Error('CalendarOnlyProvider requires { cache, client }');
    }
    this.cache = options.cache;
    this.client = options.client;
  }

  async fetchHints(_params: FetchHintsParams): Promise<string[]> {
    const now = new Date();
    const hints: string[] = [todayLine(now)];

    const months: Array<{ year: number; month: number }> = [
      { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 },
    ];
    // If we're in the last 7 days of the month, also include next month so
    // holidays in the early days of next month appear in the +/-7 window.
    const lastDayOfThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    if (now.getUTCDate() > lastDayOfThisMonth - HOLIDAY_WINDOW_DAYS) {
      const nextMonth = now.getUTCMonth() + 1 === 12
        ? { year: now.getUTCFullYear() + 1, month: 1 }
        : { year: now.getUTCFullYear(), month: now.getUTCMonth() + 2 };
      months.push(nextMonth);
    }

    for (const { year, month } of months) {
      let holidays: CalendarHoliday[] | null;
      try {
        holidays = await this.cache.get<CalendarHoliday[]>(cacheKey(year, month));
        if (holidays === null) {
          holidays = await this.client.listHolidays(year, month);
          await this.cache.set(cacheKey(year, month), holidays, CACHE_TTL_MS);
        }
      } catch (err) {
        log.warn({ err, year, month }, 'Failed to load calendar holidays; degrading to today-line only');
        continue;
      }

      for (const h of holidays) {
        const target = new Date(`${h.date}T00:00:00Z`);
        const diff = differenceInDays(target, now);
        const line = holidayLine(h.name, diff);
        if (line) hints.push(line);
      }
    }

    return hints;
  }

  async refresh(): Promise<void> {
    const now = new Date();
    const months: Array<{ year: number; month: number }> = [
      { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 },
    ];
    const lastDayOfThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    if (now.getUTCDate() > lastDayOfThisMonth - HOLIDAY_WINDOW_DAYS) {
      const nextMonth = now.getUTCMonth() + 1 === 12
        ? { year: now.getUTCFullYear() + 1, month: 1 }
        : { year: now.getUTCFullYear(), month: now.getUTCMonth() + 2 };
      months.push(nextMonth);
    }

    for (const { year, month } of months) {
      try {
        const holidays = await this.client.listHolidays(year, month);
        await this.cache.set(cacheKey(year, month), holidays, CACHE_TTL_MS);
        log.info({ year, month, count: holidays.length }, 'Calendar refresh stored');
      } catch (err) {
        log.error({ err, year, month }, 'Calendar refresh failed; cache may be stale');
      }
    }
  }
}
