import React from 'react';
import type {
    BucketId,
    MineSelection,
    CompetitionSelection,
    MinePreset,
    CompetitionPreset,
} from './period';

/**
 * PeriodFilter (Brief 09 §1) — bucket-scoped preset control. Holds no derived
 * date state of its own: it round-trips a raw `selection` to the parent, which
 * derives the `{ from, to, granularity }` query via the pure helpers in
 * `period.ts`. My Restaurant → MTD · Date · Overall; Competition → Day · Month.
 *
 * Tokens only: active preset `bg-primary` white, track `bg-primary-soft`.
 */

const pillClass = (active: boolean): string =>
    `px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
        active ? 'bg-primary text-white' : 'text-primary-strong hover:bg-surface/60'
    }`;

const MINE_PRESETS: Array<{ id: MinePreset; label: string }> = [
    { id: 'MTD', label: 'Month to date' },
    { id: 'DATE', label: 'Specific date' },
    { id: 'OVERALL', label: 'Overall' },
];

const COMP_PRESETS: Array<{ id: CompetitionPreset; label: string }> = [
    { id: 'DAY', label: 'Day' },
    { id: 'MONTH', label: 'Month' },
];

const inputClass = 'text-xs border border-line rounded-lg px-2 py-1.5 bg-surface text-ink';

// Mobile-only compact dropdown that replaces the pill group (< sm). Drawn with
// its own arrow so it reads as a dropdown on every phone browser, at 16px so
// iPhone Safari doesn't zoom the page when it opens.
const selectClass = 'w-full appearance-none text-base font-semibold border border-line rounded-lg pl-3 pr-9 py-2 bg-primary-soft text-primary-strong';

const MobileSelect: React.FC<{ label: string; value: string; onChange: (v: string) => void; options: Array<{ id: string; label: string }> }> = ({ label, value, onChange, options }) => (
    <div className="relative w-full sm:hidden">
        <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={selectClass}>
            {options.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
            ))}
        </select>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-primary-strong">
            <path d="M6 9l6 6 6-6" />
        </svg>
    </div>
);

interface MineProps {
    bucket: 'MINE';
    selection: MineSelection;
    onChange: (next: MineSelection) => void;
}
interface CompProps {
    bucket: 'COMPETITION';
    selection: CompetitionSelection;
    onChange: (next: CompetitionSelection) => void;
}
type PeriodFilterProps = (MineProps | CompProps) & { bucket: BucketId };

export const PeriodFilter: React.FC<PeriodFilterProps> = (props) => {
    if (props.bucket === 'MINE') {
        const { selection, onChange } = props;
        return (
            <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto" role="group" aria-label="My Restaurant period">
                {/* Mobile: compact dropdown */}
                <MobileSelect
                    label="My Restaurant period"
                    value={selection.preset}
                    onChange={(v) => onChange({ ...selection, preset: v as MinePreset })}
                    options={MINE_PRESETS}
                />
                {/* Desktop: pill group */}
                <div className="hidden sm:inline-flex items-center gap-1 rounded-xl bg-primary-soft p-1">
                    {MINE_PRESETS.map((p) => (
                        <button
                            key={p.id}
                            type="button"
                            aria-pressed={selection.preset === p.id}
                            onClick={() => onChange({ ...selection, preset: p.id })}
                            className={pillClass(selection.preset === p.id)}
                        >
                            {p.label}
                        </button>
                    ))}
                </div>
                {selection.preset === 'DATE' && (
                    <input
                        type="date"
                        aria-label="Pick a date"
                        value={selection.date}
                        onChange={(e) => onChange({ ...selection, date: e.target.value })}
                        className={inputClass}
                    />
                )}
            </div>
        );
    }

    const { selection, onChange } = props;
    return (
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto" role="group" aria-label="Competition period">
            {/* Mobile: compact dropdown */}
            <MobileSelect
                label="Competition period"
                value={selection.preset}
                onChange={(v) => onChange({ ...selection, preset: v as CompetitionPreset })}
                options={COMP_PRESETS}
            />
            {/* Desktop: pill group */}
            <div className="hidden sm:inline-flex items-center gap-1 rounded-xl bg-primary-soft p-1">
                {COMP_PRESETS.map((p) => (
                    <button
                        key={p.id}
                        type="button"
                        aria-pressed={selection.preset === p.id}
                        onClick={() => onChange({ ...selection, preset: p.id })}
                        className={pillClass(selection.preset === p.id)}
                    >
                        {p.label}
                    </button>
                ))}
            </div>
            {selection.preset === 'DAY' ? (
                <input
                    type="date"
                    aria-label="Pick a day"
                    value={selection.day}
                    onChange={(e) => onChange({ ...selection, day: e.target.value })}
                    className={inputClass}
                />
            ) : (
                <input
                    type="month"
                    aria-label="Pick a month"
                    value={selection.month}
                    onChange={(e) => onChange({ ...selection, month: e.target.value })}
                    className={inputClass}
                />
            )}
        </div>
    );
};

export default PeriodFilter;
