import React from 'react';
import type { Provenance } from '@restropulse/shared';

/**
 * Provenance chips (DESIGN §3 legend + module CLAUDE.md §8): every metric is
 * honestly labeled by how it was obtained —
 *   ● Measured (Google)  — solid success dot, from Places
 *   ● Computed           — solid primary dot, our formulas
 *   ◌ AI estimate        — DASHED border chip, Sonnet inference (never a fact)
 *
 * Tokens only: success / primary / muted via semantic classes.
 */

const META: Record<Provenance, { label: string; dot: string; ring: string; text: string }> = {
    measured: { label: 'Measured', dot: 'bg-success', ring: 'border-line', text: 'text-muted' },
    computed: { label: 'Computed', dot: 'bg-primary', ring: 'border-line', text: 'text-muted' },
    // AI estimate is the only chip with a dashed border — the honest "don't
    // trust this as a fact" signal (CLAUDE.md §8).
    'ai-inferred': { label: 'AI estimate', dot: 'bg-orchid', ring: 'border-orchid/60 border-dashed', text: 'text-muted' },
};

export const ProvenanceChip: React.FC<{ provenance: Provenance; source?: string; className?: string }> = ({
    provenance,
    source,
    className = '',
}) => {
    const m = META[provenance];
    return (
        <span
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border ${m.ring} bg-surface text-[11px] font-semibold ${m.text} whitespace-nowrap ${className}`}
            title={`${m.label}${source ? ` — ${source}` : ''}`}
        >
            <span className={`w-1.5 h-1.5 rounded-full ${m.dot}`} aria-hidden="true" />
            {m.label}
            {source ? <span className="font-normal text-muted/80">({source})</span> : null}
        </span>
    );
};

/** The legend row shown under the RestroScore header band (DESIGN §3). */
export const ProvenanceLegend: React.FC<{ className?: string }> = ({ className = '' }) => (
    <div className={`flex items-center gap-2 flex-wrap ${className}`}>
        <span className="text-[11px] text-muted font-semibold uppercase tracking-wider">How we know</span>
        <ProvenanceChip provenance="measured" source="Google" />
        <ProvenanceChip provenance="computed" />
        <ProvenanceChip provenance="ai-inferred" />
    </div>
);
