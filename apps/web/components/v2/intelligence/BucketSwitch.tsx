import React from 'react';
import type { BucketId } from './period';

/**
 * BucketSwitch (Brief 09 §1) — the top-level segmented control that toggles the
 * Intelligence dashboard between the two buckets. `bg-primary-soft` track, the
 * active segment `bg-primary` + white text. Tokens only.
 *
 * Selection is owned by IntelligenceV2 (persisted per session + `?bucket=`),
 * so this is a controlled component.
 */

const SEGMENTS: Array<{ id: BucketId; label: string }> = [
    { id: 'MINE', label: 'My Restaurant' },
    { id: 'COMPETITION', label: 'Competition' },
];

export const BucketSwitch: React.FC<{
    value: BucketId;
    onChange: (id: BucketId) => void;
}> = ({ value, onChange }) => (
    <div
        className="inline-flex items-center gap-1 rounded-xl bg-primary-soft p-1"
        role="tablist"
        aria-label="Intelligence bucket"
    >
        {SEGMENTS.map((s) => {
            const active = s.id === value;
            return (
                <button
                    key={s.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => onChange(s.id)}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                        active ? 'bg-primary text-white shadow-sm' : 'text-primary-strong hover:bg-surface/60'
                    }`}
                >
                    {s.label}
                </button>
            );
        })}
    </div>
);

export default BucketSwitch;
