import React from 'react';
import type { IntelligenceReport, IntelligenceSelfMetrics } from '@restropulse/shared';
import V1Overview from '../Overview';
import { intensity } from '../../theme';
import { ProvenanceChip } from '../provenance';
import type { DeepLinkTarget } from '../deep-links';
import RevenueCard from './RevenueCard';

/**
 * My-Restaurant · Overview (Brief 09 §2). Re-homes the v1 Overview (narrative,
 * key findings, 5-action plan, threats vs opportunities) unchanged, and merges
 * in the internal-ops strip from /self-metrics (repeat rate + peak-hours heatmap
 * via intensity()). Nothing from v1 is deleted — it is composed here.
 */

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const OpsStrip: React.FC<{ metrics: IntelligenceSelfMetrics }> = ({ metrics }) => {
    const peakMax = Math.max(1, ...metrics.peakHours.flat());
    return (
        <div className="bg-surface rounded-2xl p-6 border border-line">
            <div className="flex items-center gap-2 mb-4">
                <h3 className="text-base font-semibold text-ink">Your operations</h3>
                <ProvenanceChip provenance="measured" source="your orders" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
                <Stat label="Repeat rate" value={`${metrics.repeatRatePct.toFixed(0)}%`} />
                <Stat label="Avg order value" value={`₹${metrics.avgOrderValue.toLocaleString('en-IN')}`} />
                <Stat label="Orders" value={metrics.orderCount.toLocaleString('en-IN')} />
                <Stat label="Customers" value={metrics.totalCustomers.toLocaleString('en-IN')} />
            </div>
            <p className="text-xs text-muted mb-2 font-semibold uppercase tracking-wider">Peak hours</p>
            <div className="overflow-x-auto no-scrollbar">
                <div className="min-w-[560px]">
                    {metrics.peakHours.map((row, d) => (
                        <div key={d} className="flex gap-1 items-center mb-1">
                            <span className="w-7 text-[10px] text-muted font-semibold">{DAYS[d]}</span>
                            {row.map((count, h) => (
                                <span
                                    key={h}
                                    className="w-4 h-4 rounded-sm"
                                    style={{ background: count === 0 ? 'var(--color-canvas)' : intensity(count / peakMax) }}
                                    title={`${DAYS[d]} ${h}:00 — ${count} orders`}
                                />
                            ))}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <div>
        <p className="text-[11px] uppercase tracking-wider text-muted font-semibold">{label}</p>
        <p className="text-lg font-semibold text-ink tabular-nums mt-0.5">{value}</p>
    </div>
);

const Overview: React.FC<{
    report: IntelligenceReport;
    metrics: IntelligenceSelfMetrics | null;
    onNavigate: (t: DeepLinkTarget) => void;
}> = ({ report, metrics, onNavigate }) => (
    <div className="space-y-6">
        {/* Ranking summary line (Brief 10, from the sample report). */}
        <p className="text-sm text-ink font-semibold" data-testid="ranking-summary">
            You are ranked #{report.ranking.rank}{' '}
            <span className="text-muted font-normal">of {report.ranking.total} nearby</span>
        </p>
        <RevenueCard report={report} />
        <V1Overview report={report} onNavigate={onNavigate} />
        {metrics && <OpsStrip metrics={metrics} />}
    </div>
);

export default Overview;
