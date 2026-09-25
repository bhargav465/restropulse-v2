/**
 * Timezone-aware date helpers for the daily snapshot loop (Brief 08).
 *
 * Snapshots are dated `YYYY-MM-DD` in the *restaurant's* local timezone so the
 * "02:00 local" cron and the ≤7-day backfill agree on which calendar day a row
 * belongs to. There is no per-restaurant timezone field on the Restaurant record
 * today, so every tenant defaults to `Asia/Kolkata` (see DEFAULT_TIMEZONE);
 * the resolver is injectable so a future field slots in without touching callers.
 *
 * All functions take an explicit `now` (a `Date`) — the loop injects a fixed
 * clock so tests never depend on wall-clock time.
 */

/** Default restaurant timezone (no per-tenant field exists yet — see ASSUMPTION). */
export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

/** The backfill / `--date` horizon: today plus the previous 6 days. */
export const BACKFILL_WINDOW_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Format an instant as a `YYYY-MM-DD` calendar date in the given IANA timezone.
 * Uses `en-CA` which renders ISO `YYYY-MM-DD` directly.
 */
export function localDateString(now: Date, timeZone: string = DEFAULT_TIMEZONE): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(now);
}

/** Add (or subtract) whole days to a `YYYY-MM-DD` string; returns `YYYY-MM-DD`. */
export function addDays(date: string, delta: number): string {
    const [y, m, d] = date.split('-').map(Number);
    const base = Date.UTC(y, m - 1, d);
    const shifted = new Date(base + delta * MS_PER_DAY);
    return shifted.toISOString().slice(0, 10);
}

/** Whole-day difference `a - b` for two `YYYY-MM-DD` strings (a later ⇒ positive). */
export function dayDiff(a: string, b: string): number {
    const [ay, am, ad] = a.split('-').map(Number);
    const [by, bm, bd] = b.split('-').map(Number);
    return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / MS_PER_DAY);
}

/**
 * The `windowDays` calendar dates ending at `today` (newest last), i.e. the
 * backfill horizon `[today-6 … today]`.
 */
export function recentDates(today: string, windowDays: number = BACKFILL_WINDOW_DAYS): string[] {
    const dates: string[] = [];
    for (let i = windowDays - 1; i >= 0; i--) dates.push(addDays(today, -i));
    return dates;
}
