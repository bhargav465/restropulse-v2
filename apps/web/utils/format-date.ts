const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Format a stored date for display in the viewer's locale.
 *
 * Date-only strings ("2024-01-15", as written for `menuLastUpdated`) are
 * calendar dates, not instants. `new Date('2024-01-15')` parses them as UTC
 * midnight, which renders as the previous day anywhere west of UTC. Build
 * them as local dates instead; full timestamps are formatted as-is.
 */
export function formatCalendarDate(value: string, locales?: string | string[]): string {
    const m = DATE_ONLY.exec(value);
    const date = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
    return date.toLocaleDateString(locales);
}
