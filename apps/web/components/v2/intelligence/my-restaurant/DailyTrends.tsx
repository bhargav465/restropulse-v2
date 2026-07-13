import React, { useEffect, useMemo, useState } from 'react';
import { intelligenceAPI, type SnapshotSeriesPoint } from '../../../../api';
import type { PeriodQuery } from '../period';
import { SERIES, DELTA_TEXT, type DeltaTone } from '../../theme';
import { TrendChart, Sparkline, type TrendSeries } from '../charts';
import { ProvenanceChip } from '../provenance';
import { StatCard } from '../../primitives';
import ZomatoManualModal from './ZomatoManualModal';

/**
 * DailyTrends (Brief 09 §2) — snapshot-driven My-Restaurant trends.
 * Google rating + reviews (SERIES[0]); Zomato (SERIES[1]) only when zomato
 * snapshots exist, else an "Add your Zomato numbers" card. Photo small-multiples
 * with a 14-day-stagnation nudge, SEO sparkline, computed-metric chips, and a
 * specific-date stat-card mode with day-over-day DELTA_TEXT deltas. Null/gap days
 * render as GAPS (never zeros); backfilled points get hollow markers.
 */

const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
    <div className={`bg-surface rounded-2xl p-6 border border-line ${className}`}>{children}</div>
);

/** Continuous daily labels between the first and last date (reveals gap days). */
function dayAxis(dates: string[]): string[] {
    if (dates.length === 0) return [];
    const sorted = [...dates].sort();
    const start = Date.parse(`${sorted[0]}T00:00:00Z`);
    const end = Date.parse(`${sorted[sorted.length - 1]}T00:00:00Z`);
    const out: string[] = [];
    for (let t = start; t <= end; t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
    return out;
}

function toDeltaTone(delta: number): DeltaTone {
    if (delta > 0) return 'up';
    if (delta < 0) return 'down';
    return 'neutral';
}

const DeltaText: React.FC<{ delta: number; suffix?: string; digits?: number }> = ({ delta, suffix = '', digits = 0 }) => (
    <span className={`text-xs font-semibold ${DELTA_TEXT[toDeltaTone(delta)]}`}>
        {delta > 0 ? '+' : ''}
        {delta.toFixed(digits)}
        {suffix} vs prev day
    </span>
);

export const DailyTrendsView: React.FC<{
    points: SnapshotSeriesPoint[];
    mode: 'range' | 'date';
    onAddZomato: () => void;
}> = ({ points, mode, onAddZomato }) => {
    const google = useMemo(() => points.filter((p) => p.source === 'google').sort((a, b) => a.date.localeCompare(b.date)), [points]);
    const zomato = useMemo(() => points.filter((p) => p.source === 'zomato').sort((a, b) => a.date.localeCompare(b.date)), [points]);
    const hasZomato = zomato.length > 0;

    const isMonth = google[0]?.date.length === 7;
    const labels = useMemo(() => {
        const dates = google.map((p) => p.date);
        return isMonth ? [...dates].sort() : dayAxis(dates);
    }, [google, isMonth]);

    const gMap = useMemo(() => new Map(google.map((p) => [p.date, p])), [google]);
    const zMap = useMemo(() => new Map(zomato.map((p) => [p.date, p])), [zomato]);

    const ratingSeries: TrendSeries[] = useMemo(() => {
        const s: TrendSeries[] = [
            {
                key: 'g-rating',
                label: 'Google rating',
                color: SERIES[0],
                points: labels.map((d) => gMap.get(d)?.rating ?? null),
                hollow: labels.map((d) => gMap.get(d)?.backfilled === true),
            },
        ];
        if (hasZomato) {
            s.push({
                key: 'z-rating',
                label: 'Zomato rating',
                color: SERIES[1],
                points: labels.map((d) => zMap.get(d)?.rating ?? null),
            });
        }
        return s;
    }, [labels, gMap, zMap, hasZomato]);

    const reviewsSeries: TrendSeries[] = useMemo(
        () => [
            {
                key: 'g-reviews',
                label: 'Google reviews',
                color: SERIES[0],
                points: labels.map((d) => gMap.get(d)?.reviewCount ?? null),
                hollow: labels.map((d) => gMap.get(d)?.backfilled === true),
            },
        ],
        [labels, gMap],
    );

    const seoPoints = useMemo(() => labels.map((d) => gMap.get(d)?.seoScore ?? null), [labels, gMap]);
    const seoHasData = seoPoints.some((v) => v !== null);
    const photoGoogle = useMemo(() => labels.map((d) => gMap.get(d)?.photoCount ?? null), [labels, gMap]);
    const photoZomato = useMemo(() => labels.map((d) => zMap.get(d)?.photoCount ?? null), [labels, zMap]);

    // 14-day photo stagnation nudge (Google): last ≥14 present photo counts unchanged.
    const photoStagnant = useMemo(() => {
        const vals = photoGoogle.filter((v): v is number => v !== null).slice(-14);
        return vals.length >= 14 && vals.every((v) => v === vals[0]);
    }, [photoGoogle]);

    // Computed metric chips.
    const newReviewsTotal = google.reduce((s, p) => s + p.newReviews, 0);
    const daysSpan = Math.max(1, labels.length);
    const ratingVelocity = (newReviewsTotal / daysSpan) * 7; // reviews / week
    const netNewReviews = google.length >= 2 ? google[google.length - 1].reviewCount - google[0].reviewCount : newReviewsTotal;
    const lastRating = google[google.length - 1]?.rating ?? 0;

    const [showZomato, setShowZomato] = useState(false);

    // ---- Specific-date mode: stat cards + day-over-day deltas ----
    if (mode === 'date') {
        const last = google[google.length - 1];
        const prev = google[google.length - 2];
        if (!last) return <p className="text-sm text-muted">No snapshot captured for that day yet.</p>;
        return (
            <div className="space-y-4">
                <div className="flex items-center gap-2">
                    <ProvenanceChip provenance="measured" source="Google" />
                    <span className="text-xs text-muted">Snapshot for {last.date}.</span>
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div>
                        <StatCard label="Rating" value={last.rating.toFixed(1)} />
                        {prev && <DeltaText delta={Number((last.rating - prev.rating).toFixed(1))} digits={1} />}
                    </div>
                    <div>
                        <StatCard label="Reviews" value={last.reviewCount.toLocaleString('en-IN')} />
                        {prev && <DeltaText delta={last.reviewCount - prev.reviewCount} />}
                    </div>
                    <div>
                        <StatCard label="Photos" value={last.photoCount.toLocaleString('en-IN')} />
                        {prev && <DeltaText delta={last.photoCount - prev.photoCount} />}
                    </div>
                    {typeof last.seoScore === 'number' && (
                        <div>
                            <StatCard label="SEO score" value={String(last.seoScore)} />
                            {prev && typeof prev.seoScore === 'number' && <DeltaText delta={last.seoScore - prev.seoScore} />}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Rating trend */}
            <Card>
                <div className="flex items-center justify-between gap-2 mb-2">
                    <h3 className="text-base font-semibold text-ink">Rating trend</h3>
                    <ProvenanceChip provenance="measured" source="Google" />
                </div>
                <TrendChart labels={labels} series={ratingSeries} ariaLabel="Rating trend" format={(n) => n.toFixed(1)} />
                <div className="flex items-center gap-4 mt-2 text-[11px] text-muted">
                    <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: SERIES[0] }} /> Google</span>
                    {hasZomato && <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: SERIES[1] }} /> Zomato</span>}
                    <span>Hollow marker = backfilled · gaps = no snapshot that day</span>
                </div>
            </Card>

            {/* Reviews trend */}
            <Card>
                <h3 className="text-base font-semibold text-ink mb-2">Review count</h3>
                <TrendChart labels={labels} series={reviewsSeries} ariaLabel="Review count trend" />
            </Card>

            {/* Zomato section — only when data exists, else the add-numbers card */}
            {!hasZomato && (
                <Card className="border-l-[3px] border-l-orchid">
                    <h3 className="text-base font-semibold text-ink">Add your Zomato numbers</h3>
                    <p className="text-sm text-muted mt-1">Zomato has no public API. Add your current rating, reviews and photos to track them next to Google.</p>
                    <button
                        type="button"
                        onClick={onAddZomato}
                        className="mt-3 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary-strong text-white hover:opacity-90"
                    >
                        Add Zomato numbers
                    </button>
                </Card>
            )}

            {/* Photo small-multiples */}
            <Card>
                <div className="flex items-center justify-between gap-2 mb-2">
                    <h3 className="text-base font-semibold text-ink">Photos</h3>
                    <ProvenanceChip provenance="measured" source="Google" />
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                        <p className="text-xs font-semibold text-muted mb-1">Google</p>
                        <Sparkline points={photoGoogle} color={SERIES[0]} ariaLabel="Google photo count" />
                    </div>
                    {hasZomato && (
                        <div>
                            <p className="text-xs font-semibold text-muted mb-1">Zomato</p>
                            <Sparkline points={photoZomato} color={SERIES[1]} ariaLabel="Zomato photo count" />
                        </div>
                    )}
                </div>
                {photoStagnant && (
                    <p className="text-xs text-warning font-semibold mt-3">No new photos in 14 days — fresh photos lift profile engagement.</p>
                )}
            </Card>

            {/* SEO sparkline */}
            {seoHasData && (
                <Card>
                    <div className="flex items-center justify-between gap-2 mb-2">
                        <h3 className="text-base font-semibold text-ink">SEO score</h3>
                        <ProvenanceChip provenance="computed" />
                    </div>
                    <Sparkline points={seoPoints} ariaLabel="SEO score trend" />
                </Card>
            )}

            {/* Computed metric chips */}
            <Card>
                <div className="flex items-center justify-between gap-2 mb-3">
                    <h3 className="text-base font-semibold text-ink">Computed metrics</h3>
                    <ProvenanceChip provenance="computed" />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <Chip label="Rating velocity" value={`${ratingVelocity.toFixed(1)}/wk`} />
                    <Chip label="Net new reviews" value={netNewReviews.toLocaleString('en-IN')} />
                    <Chip label="Latest rating" value={lastRating.toFixed(1)} />
                </div>
            </Card>

            {showZomato && <ZomatoManualModal onClose={() => setShowZomato(false)} onSaved={onAddZomato} />}
        </div>
    );
};

const Chip: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <div className="rounded-xl border border-line bg-canvas px-3 py-2">
        <p className="text-[11px] uppercase tracking-wider text-muted font-semibold">{label}</p>
        <p className="text-sm font-semibold text-ink tabular-nums mt-0.5">{value}</p>
    </div>
);

/** Container: fetches the series for the current period + a manual-Zomato modal. */
const DailyTrends: React.FC<{ query: PeriodQuery }> = ({ query }) => {
    const [points, setPoints] = useState<SnapshotSeriesPoint[] | null>(null);
    const [showModal, setShowModal] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

    const mode: 'range' | 'date' = query.granularity === 'day' && query.from && query.from === query.to ? 'date' : 'range';

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setPoints(null);
            // In specific-date mode widen the fetch to a trailing window so we can
            // show a day-over-day delta; display logic still targets the picked day.
            const fetchQuery =
                mode === 'date' && query.to
                    ? { from: new Date(Date.parse(`${query.to}T00:00:00Z`) - 30 * 86400000).toISOString().slice(0, 10), to: query.to }
                    : { from: query.from, to: query.to };
            try {
                const res = await intelligenceAPI.getSnapshots({
                    target: 'self',
                    source: 'both',
                    granularity: query.granularity,
                    ...fetchQuery,
                });
                if (!cancelled) setPoints(res.points);
            } catch {
                if (!cancelled) setPoints([]);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [query.granularity, query.from, query.to, mode, reloadKey]);

    if (points === null) return <p className="text-sm text-muted">Loading your trends…</p>;

    return (
        <>
            <DailyTrendsView points={points} mode={mode} onAddZomato={() => setShowModal(true)} />
            {showModal && (
                <ZomatoManualModal
                    onClose={() => setShowModal(false)}
                    onSaved={() => setReloadKey((k) => k + 1)}
                />
            )}
        </>
    );
};

export default DailyTrends;
