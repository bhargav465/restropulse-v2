/**
 * Bucket + period model for the two-bucket Intelligence dashboard (Brief 09 §1).
 *
 * PURE + unit-tested. The `PeriodFilter` widget holds NO date state of its own —
 * it derives a `{ from, to, granularity }` query object from a preset (+ an
 * optional picked date) via the helpers here, and those objects map EXACTLY onto
 * the BRIEF-07 query contract:
 *
 *   - GET /snapshots     — { from, to, granularity }
 *   - GET /compare       — day → date=to ; month → month=to.slice(0,7)
 *   - GET /feedback-changes — { from, to }
 *
 * Keeping the mapping in one pure module is what the param-mapping tests assert.
 */

export type BucketId = 'MINE' | 'COMPETITION';

/** My-Restaurant presets (Brief 09 §1: MTD · Date · Overall). */
export type MinePreset = 'MTD' | 'DATE' | 'OVERALL';
/** Competition presets (Brief 09 §1: Day · Month). */
export type CompetitionPreset = 'DAY' | 'MONTH';

/** The query contract emitted to every data call — mirrors BRIEF-07 exactly. */
export interface PeriodQuery {
    from?: string; // YYYY-MM-DD
    to?: string; // YYYY-MM-DD
    granularity: 'day' | 'month';
}

/** Today as YYYY-MM-DD (injectable for deterministic tests). */
export function todayStr(now: Date = new Date()): string {
    return now.toISOString().slice(0, 10);
}

/** First day of the month containing `date` (YYYY-MM-DD). */
export function firstOfMonth(date: string): string {
    return `${date.slice(0, 7)}-01`;
}

/**
 * My-Restaurant preset → query. `date` is the single-date picker value (only
 * read for the DATE preset). OVERALL omits from/to and aggregates by month.
 */
export function minePeriodQuery(preset: MinePreset, date: string, now: Date = new Date()): PeriodQuery {
    const today = todayStr(now);
    switch (preset) {
        case 'MTD':
            return { from: firstOfMonth(today), to: today, granularity: 'day' };
        case 'DATE':
            return { from: date, to: date, granularity: 'day' };
        case 'OVERALL':
        default:
            return { granularity: 'month' };
    }
}

/**
 * Competition preset → query. For DAY `value` is a YYYY-MM-DD date; for MONTH
 * `value` is a YYYY-MM month. Month end uses `-31` to mirror the server's
 * inclusive `$lte` window (BRIEF-07 compare.ts loadTarget).
 */
export function competitionPeriodQuery(
    preset: CompetitionPreset,
    value: string,
    _now: Date = new Date(),
): PeriodQuery {
    if (preset === 'MONTH') {
        return { from: `${value}-01`, to: `${value}-31`, granularity: 'month' };
    }
    return { from: value, to: value, granularity: 'day' };
}

/** Raw selection state the PeriodFilter widget round-trips to the parent. */
export interface MineSelection {
    preset: MinePreset;
    /** YYYY-MM-DD single-date picker value (only read for the DATE preset). */
    date: string;
}
export interface CompetitionSelection {
    preset: CompetitionPreset;
    /** YYYY-MM-DD (DAY preset). */
    day: string;
    /** YYYY-MM (MONTH preset). */
    month: string;
}

/** Default My-Restaurant selection (MTD, date defaulted to today). */
export function defaultMineSelection(now: Date = new Date()): MineSelection {
    return { preset: 'MTD', date: todayStr(now) };
}

/** Default Competition selection (single Day, day/month defaulted to today). */
export function defaultCompetitionSelection(now: Date = new Date()): CompetitionSelection {
    const t = todayStr(now);
    return { preset: 'DAY', day: t, month: t.slice(0, 7) };
}

/** My-Restaurant selection → query. */
export function mineQuery(sel: MineSelection, now: Date = new Date()): PeriodQuery {
    return minePeriodQuery(sel.preset, sel.date, now);
}

/** Competition selection → query. */
export function competitionQuery(sel: CompetitionSelection, now: Date = new Date()): PeriodQuery {
    return competitionPeriodQuery(sel.preset, sel.preset === 'MONTH' ? sel.month : sel.day, now);
}

/** Derive the GET /compare params from a period query. */
export function compareParamsFor(q: PeriodQuery): { granularity: 'day' } & { date: string } | { granularity: 'month' } & { month: string } {
    if (q.granularity === 'month') {
        return { granularity: 'month', month: (q.to ?? q.from ?? '').slice(0, 7) };
    }
    return { granularity: 'day', date: q.to ?? q.from ?? '' };
}
