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
            <div className="flex items-center gap-2 flex-wrap" role="group" aria-label="My Restaurant period">
                <div className="inline-flex items-center gap-1 rounded-xl bg-primary-soft p-1">
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
        <div className="flex items-center gap-2 flex-wrap" role="group" aria-label="Competition period">
            <div className="inline-flex items-center gap-1 rounded-xl bg-primary-soft p-1">
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
