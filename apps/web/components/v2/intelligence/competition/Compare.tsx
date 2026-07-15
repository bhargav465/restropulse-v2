import React, { useEffect, useMemo, useState } from 'react';
import type { CompareRow, SnapshotSource, IntelligenceReport } from '@restropulse/shared';
import { intelligenceAPI, type SnapshotSeriesPoint } from '../../../../api';
import type { PeriodQuery } from '../period';
import { compareParamsFor } from '../period';
import { TOKENS, SERIES } from '../../theme';
import { TrendChart, type TrendSeries } from '../charts';

/**
 * Compare (Brief 09 §3) — the competition matrix (rows self + watchlist; columns
 * rating, reviews, new-in-period, photos) with a Google / Zomato / Both source
 * toggle, an overlaid rating trend (self `primaryStrong`, competitors cycle
 * `SERIES`), and a row expand showing the period's new-review count. The
 * "Where They Beat You" view is rendered from the same rows below.
 */

type SourceMode = SnapshotSource | 'both';

const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
    <div className={`bg-surface rounded-2xl p-6 border border-line ${className}`}>{children}</div>
);

function cell(row: CompareRow, source: SnapshotSource): CompareRow['google'] | undefined {
    return source === 'google' ? row.google : row.zomato;
}

const SourceValue: React.FC<{ row: CompareRow; mode: SourceMode; pick: (d: NonNullable<CompareRow['google']>) => number | string }> = ({ row, mode, pick }) => {
    const sources: SnapshotSource[] = mode === 'both' ? ['google', 'zomato'] : [mode];
    return (
        <span className="tabular-nums text-ink">
            {sources.map((s, i) => {
                const d = cell(row, s);
                return (
                    <span key={s} className="inline-block">
                        {i > 0 && <span className="text-muted mx-1">/</span>}
                        {d ? pick(d) : <span className="text-muted">—</span>}
                    </span>
                );
            })}
        </span>
    );
};

export const CompareView: React.FC<{
    rows: CompareRow[];
    trend?: { labels: string[]; series: TrendSeries[] };
}> = ({ rows, trend }) => {
    const [mode, setMode] = useState<SourceMode>('google');
    const [expanded, setExpanded] = useState<string | null>(null);

    const MODES: Array<{ id: SourceMode; label: string }> = [
        { id: 'google', label: 'Google' },
        { id: 'zomato', label: 'Zomato' },
        { id: 'both', label: 'Both' },
    ];

    return (
        <div className="space-y-6">
            {/* Source toggle */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <h3 className="text-base font-semibold text-ink">Compare</h3>
                <div className="inline-flex items-center gap-1 rounded-xl bg-primary-soft p-1" role="group" aria-label="Compare source">
                    {MODES.map((m) => (
                        <button
                            key={m.id}
                            type="button"
                            aria-pressed={mode === m.id}
                            onClick={() => setMode(m.id)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                                mode === m.id ? 'bg-primary text-white' : 'text-primary-strong hover:bg-surface/60'
                            }`}
                        >
                            {m.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Overlaid rating trend */}
            {trend && trend.series.length > 0 && (
                <Card>
                    <h3 className="text-sm font-semibold text-ink mb-2">Rating trend</h3>
                    <TrendChart labels={trend.labels} series={trend.series} ariaLabel="Rating comparison trend" format={(n) => n.toFixed(1)} />
                    <div className="flex flex-wrap items-center gap-3 mt-2 text-[11px] text-muted">
                        {trend.series.map((s) => (
                            <span key={s.key} className="inline-flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full" style={{ background: s.color }} /> {s.label}
                            </span>
                        ))}
                    </div>
                </Card>
            )}

            {/* Matrix */}
            <Card>
                <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-2 px-1 pb-2 text-[11px] font-semibold text-muted uppercase tracking-wider border-b border-line">
                    <span>Restaurant</span>
                    <span className="text-right">Rating</span>
                    <span className="text-right">Reviews</span>
                    <span className="text-right">New</span>
                    <span className="text-right">Photos</span>
                </div>
                {rows.map((row) => (
                    <div key={row.placeId} className="border-b border-line last:border-b-0">
                        <button
                            type="button"
                            onClick={() => setExpanded((e) => (e === row.placeId ? null : row.placeId))}
                            aria-expanded={expanded === row.placeId}
                            className="w-full grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-2 py-3 px-1 text-left hover:bg-canvas/60 rounded-lg items-center"
                        >
                            <span className={`text-sm truncate ${row.isSelf ? 'font-semibold text-primary-strong' : 'text-ink'}`}>
                                {row.isSelf ? `${row.name} (you)` : row.name}
                            </span>
                            <span className="text-right text-sm"><SourceValue row={row} mode={mode} pick={(d) => d.rating.toFixed(1)} /></span>
                            <span className="text-right text-sm"><SourceValue row={row} mode={mode} pick={(d) => d.reviewCount.toLocaleString('en-IN')} /></span>
                            <span className="text-right text-sm"><SourceValue row={row} mode={mode} pick={(d) => `+${d.newReviews}`} /></span>
                            <span className="text-right text-sm"><SourceValue row={row} mode={mode} pick={(d) => d.photoCount.toLocaleString('en-IN')} /></span>
                        </button>
                        {expanded === row.placeId && (
                            <div className="px-1 pb-3">
                                <div className="rounded-xl bg-canvas p-4 text-xs text-muted">
                                    {(() => {
                                        const d = cell(row, mode === 'both' ? 'google' : mode);
                                        const n = d?.newReviews ?? 0;
                                        return n > 0
                                            ? `${n} new review${n === 1 ? '' : 's'} in this period.`
                                            : 'No new reviews in this period.';
                                    })()}
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </Card>
        </div>
    );
};

/** Container: fetches the compare rows + per-target rating trend for the period. */
const Compare: React.FC<{ query: PeriodQuery }> = ({ query }) => {
    const [rows, setRows] = useState<CompareRow[] | null>(null);
    const [trend, setTrend] = useState<{ labels: string[]; series: TrendSeries[] } | undefined>(undefined);

    const compareParams = useMemo(() => compareParamsFor(query), [query.from, query.to, query.granularity]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setRows(null);
            try {
                const data = await intelligenceAPI.getCompare(compareParams);
                if (cancelled) return;
                setRows(data);

                // Overlaid rating trend: trailing 30-day google series per row.
                const to = query.to ?? new Date().toISOString().slice(0, 10);
                const from = new Date(Date.parse(`${to}T00:00:00Z`) - 30 * 86400000).toISOString().slice(0, 10);
                const seriesRaw = await Promise.all(
                    data.map(async (r, idx) => {
                        try {
                            const s = await intelligenceAPI.getSnapshots({ target: r.isSelf ? 'self' : r.placeId, source: 'google', granularity: 'day', from, to });
                            return { row: r, idx, points: s.points as SnapshotSeriesPoint[] };
                        } catch {
                            return { row: r, idx, points: [] as SnapshotSeriesPoint[] };
                        }
                    }),
                );
                if (cancelled) return;
                const labelSet = new Set<string>();
                for (const { points } of seriesRaw) for (const p of points) labelSet.add(p.date);
                const labels = [...labelSet].sort();
                let compColor = 0;
                const series: TrendSeries[] = seriesRaw.map(({ row, points }) => {
                    const map = new Map(points.map((p) => [p.date, p.rating]));
                    const color = row.isSelf ? TOKENS.primaryStrong : SERIES[compColor++ % SERIES.length];
                    return { key: row.placeId, label: row.isSelf ? `${row.name} (you)` : row.name, color, points: labels.map((d) => map.get(d) ?? null) };
                });
                setTrend({ labels, series });
            } catch {
                if (!cancelled) setRows([]);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [compareParams.granularity, (compareParams as { date?: string }).date, (compareParams as { month?: string }).month]);

    if (rows === null) return <p className="text-sm text-muted">Loading the comparison…</p>;

    return <CompareView rows={rows} trend={trend} />;
};

export default Compare;
