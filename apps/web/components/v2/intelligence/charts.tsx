import React from 'react';
import { TOKENS } from '../theme';

/**
 * Token-native SVG charts for the two-bucket dashboard (Brief 09). Hand-rolled
 * (no chart lib) for exact token control + gap/hollow-marker support:
 *   - null points render as GAPS (the line breaks) — never plotted as zero.
 *   - `hollow` points (backfilled catch-up) get a white-filled ringed marker.
 * Colors come only from `theme.ts` (TOKENS / SERIES) — no raw hex in callers.
 */

export interface TrendSeries {
    key: string;
    label: string;
    color: string;
    /** Aligned to `labels`; null = gap day (no snapshot). */
    points: Array<number | null>;
    /** Aligned to `labels`; true = backfilled → hollow marker. */
    hollow?: boolean[];
}

interface TrendChartProps {
    labels: string[];
    series: TrendSeries[];
    height?: number;
    /** y-axis value formatter for the tooltip title. */
    format?: (n: number) => string;
    ariaLabel: string;
}

const PAD = { top: 8, right: 8, bottom: 8, left: 8 };

export const TrendChart: React.FC<TrendChartProps> = ({ labels, series, height = 120, format, ariaLabel }) => {
    const W = 320;
    const H = height;
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const n = labels.length;

    const all = series.flatMap((s) => s.points.filter((p): p is number => p !== null));
    const yMin = all.length ? Math.min(...all) : 0;
    const yMax = all.length ? Math.max(...all) : 1;
    const span = yMax - yMin || 1;

    const xFor = (i: number) => PAD.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const yFor = (v: number) => PAD.top + innerH - ((v - yMin) / span) * innerH;

    return (
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} className="max-w-full">
            {series.map((s) => {
                // Split into contiguous segments (break at null → gap).
                const segments: Array<Array<{ x: number; y: number }>> = [];
                let cur: Array<{ x: number; y: number }> = [];
                s.points.forEach((p, i) => {
                    if (p === null) {
                        if (cur.length) segments.push(cur);
                        cur = [];
                    } else {
                        cur.push({ x: xFor(i), y: yFor(p) });
                    }
                });
                if (cur.length) segments.push(cur);
                return (
                    <g key={s.key}>
                        {segments.map((seg, si) => (
                            <polyline
                                key={si}
                                fill="none"
                                stroke={s.color}
                                strokeWidth={2}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                points={seg.map((pt) => `${pt.x},${pt.y}`).join(' ')}
                            />
                        ))}
                        {s.points.map((p, i) =>
                            p === null ? null : (
                                <circle
                                    key={i}
                                    cx={xFor(i)}
                                    cy={yFor(p)}
                                    r={s.hollow?.[i] ? 3.5 : 2.5}
                                    fill={s.hollow?.[i] ? TOKENS.surface : s.color}
                                    stroke={s.color}
                                    strokeWidth={s.hollow?.[i] ? 1.5 : 0}
                                    strokeDasharray={s.hollow?.[i] ? '2 1' : undefined}
                                >
                                    <title>
                                        {`${s.label} · ${labels[i]} · ${format ? format(p) : p}${s.hollow?.[i] ? ' (backfilled)' : ''}`}
                                    </title>
                                </circle>
                            ),
                        )}
                    </g>
                );
            })}
        </svg>
    );
};

/** Single-series sparkline (SEO / photos small-multiples). */
export const Sparkline: React.FC<{ points: Array<number | null>; color?: string; height?: number; ariaLabel: string }> = ({
    points,
    color = TOKENS.primary,
    height = 40,
    ariaLabel,
}) => (
    <TrendChart
        labels={points.map((_, i) => String(i))}
        series={[{ key: 'spark', label: ariaLabel, color, points }]}
        height={height}
        ariaLabel={ariaLabel}
    />
);

/** Horizontal stacked bar (star-mix). Segments are token-colored by the caller. */
export const StackedBar: React.FC<{ segments: Array<{ label: string; value: number; color: string }>; ariaLabel: string }> = ({
    segments,
    ariaLabel,
}) => {
    const total = segments.reduce((s, x) => s + x.value, 0) || 1;
    return (
        <div className="flex h-4 rounded-full overflow-hidden border border-line" role="img" aria-label={ariaLabel}>
            {segments.map((s) => (
                <div key={s.label} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} title={`${s.label}: ${s.value}`} />
            ))}
        </div>
    );
};
