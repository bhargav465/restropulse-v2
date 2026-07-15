import React, { useEffect, useState } from 'react';
import type { CompetitionBuckets, CompetitorProfile, WatchlistEntry } from '@restropulse/shared';
import { intelligenceAPI } from '../../../../api';
import { ThreatBar } from '../primitives';
import { aovBandLabel } from '../aov';

/**
 * Top Threats (Brief 10 §2) — the FIRST competition sub-tab. A segmented control
 * switches one ranked table between two buckets:
 *   - "Same cuisine & AOV" → report.buckets.directTop10
 *   - "Overall"            → report.buckets.overallTop10
 * Columns: #, name, cuisine, AOV band, rating, reviews, distance, threat bar.
 * Rows expand to the v1 strengths/weaknesses and can add to the (≤5) watchlist.
 * Renders from the [SAMPLE] fixtures in demo mode with zero backend. Tokens only.
 */

type BucketKey = 'DIRECT' | 'OVERALL';

const Card: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="bg-surface rounded-2xl p-6 border border-line">{children}</div>
);

const Segmented: React.FC<{
    value: BucketKey;
    onChange: (k: BucketKey) => void;
    directCount: number;
    overallCount: number;
}> = ({ value, onChange, directCount, overallCount }) => {
    const opt = (k: BucketKey, label: string, count: number) => (
        <button
            type="button"
            onClick={() => onChange(k)}
            aria-pressed={value === k}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                value === k ? 'bg-primary-strong text-white' : 'text-muted hover:text-ink'
            }`}
        >
            {label} <span className="tabular-nums opacity-80">({count})</span>
        </button>
    );
    return (
        <div className="inline-flex items-center gap-1 rounded-xl bg-canvas border border-line p-1" role="group" aria-label="Threat bucket">
            {opt('DIRECT', 'Same cuisine & AOV', directCount)}
            {opt('OVERALL', 'Overall', overallCount)}
        </div>
    );
};

const ExpandRow: React.FC<{ c: CompetitorProfile }> = ({ c }) => {
    const list = (title: string, items?: string[]) =>
        items && items.length > 0 ? (
            <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-1">{title}</p>
                <ul className="space-y-1">
                    {items.map((s, i) => (
                        <li key={i} className="text-xs text-ink leading-relaxed">• {s}</li>
                    ))}
                </ul>
            </div>
        ) : null;
    return (
        <div className="grid sm:grid-cols-2 gap-4 px-4 py-3 bg-canvas rounded-xl">
            {list('Strengths', c.strengths)}
            {list('Weaknesses', c.weaknesses)}
            {!c.strengths?.length && !c.weaknesses?.length && (
                <p className="text-xs text-muted">No qualitative breakdown for this competitor yet.</p>
            )}
        </div>
    );
};

export const TopThreatsView: React.FC<{
    buckets: CompetitionBuckets;
    watchlist: WatchlistEntry[];
    max: number;
    error: string | null;
    onAdd: (c: CompetitorProfile) => void;
}> = ({ buckets, watchlist, max, error, onAdd }) => {
    const [tab, setTab] = useState<BucketKey>('DIRECT');
    const [expanded, setExpanded] = useState<string | null>(null);

    const rows = tab === 'DIRECT' ? buckets.directTop10 : buckets.overallTop10;
    const tracked = new Set(watchlist.map((w) => w.placeId));
    const atCapacity = watchlist.length >= max;

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <Segmented
                    value={tab}
                    onChange={(k) => {
                        setTab(k);
                        setExpanded(null);
                    }}
                    directCount={buckets.directTop10.length}
                    overallCount={buckets.overallTop10.length}
                />
                <p className="text-xs text-muted">
                    Your AOV band: <span className="font-semibold text-ink">{buckets.aovBand.label}</span>
                </p>
            </div>

            {error && (
                <div className="rounded-xl border border-danger/40 bg-surface p-3" role="alert">
                    <p className="text-sm text-danger">{error}</p>
                </div>
            )}

            {tab === 'DIRECT' && rows.length === 0 ? (
                <Card>
                    <p className="text-sm text-ink font-semibold">No same-cuisine, same-AOV rivals in 5 km — you may own this niche.</p>
                    <p className="text-xs text-muted mt-1">
                        If that looks off, verify your AOV (price level) on your Google profile — a missing price level is treated as mid-range.
                    </p>
                </Card>
            ) : (
                <Card>
                    <div className="overflow-x-auto no-scrollbar">
                        <table className="w-full min-w-[720px] text-sm">
                            <thead>
                                <tr className="text-left text-[11px] uppercase tracking-wider text-muted">
                                    <th className="font-semibold py-2 pr-2 w-8">#</th>
                                    <th className="font-semibold py-2 pr-3">Restaurant</th>
                                    <th className="font-semibold py-2 pr-3">Cuisine</th>
                                    <th className="font-semibold py-2 pr-3">AOV</th>
                                    <th className="font-semibold py-2 pr-3 text-right">Rating</th>
                                    <th className="font-semibold py-2 pr-3 text-right">Reviews</th>
                                    <th className="font-semibold py-2 pr-3 text-right">Distance</th>
                                    <th className="font-semibold py-2 pr-3">Threat</th>
                                    <th className="font-semibold py-2" />
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((c, i) => {
                                    const isOpen = expanded === c.placeId;
                                    const isTracked = tracked.has(c.placeId);
                                    return (
                                        <React.Fragment key={c.placeId}>
                                            <tr className="border-t border-line">
                                                <td className="py-2.5 pr-2 text-muted tabular-nums">{i + 1}</td>
                                                <td className="py-2.5 pr-3 font-medium text-ink">{c.name}</td>
                                                <td className="py-2.5 pr-3 text-muted">{c.cuisine}</td>
                                                <td className="py-2.5 pr-3 text-muted">{aovBandLabel(c.priceLevel)}</td>
                                                <td className="py-2.5 pr-3 text-right text-ink tabular-nums">★ {c.rating.toFixed(1)}</td>
                                                <td className="py-2.5 pr-3 text-right text-muted tabular-nums">{c.totalRatings.toLocaleString('en-IN')}</td>
                                                <td className="py-2.5 pr-3 text-right text-muted tabular-nums">{c.distanceKm.toFixed(1)} km</td>
                                                <td className="py-2.5 pr-3"><ThreatBar value={c.threatScore} /></td>
                                                <td className="py-2.5 text-right whitespace-nowrap">
                                                    <button
                                                        type="button"
                                                        onClick={() => setExpanded(isOpen ? null : c.placeId)}
                                                        className="text-xs font-semibold text-primary-strong hover:underline mr-3"
                                                        aria-expanded={isOpen}
                                                    >
                                                        {isOpen ? 'Hide' : 'Details'}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => onAdd(c)}
                                                        disabled={isTracked || atCapacity}
                                                        title={
                                                            isTracked
                                                                ? 'Already on your watchlist'
                                                                : atCapacity
                                                                  ? `Watchlist is full (${max}/${max})`
                                                                  : 'Add to watchlist'
                                                        }
                                                        className="text-xs font-semibold text-primary-strong hover:underline disabled:text-muted disabled:no-underline disabled:cursor-not-allowed"
                                                    >
                                                        {isTracked ? 'Tracking' : 'Watch'}
                                                    </button>
                                                </td>
                                            </tr>
                                            {isOpen && (
                                                <tr>
                                                    <td colSpan={9} className="pb-3">
                                                        <ExpandRow c={c} />
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </Card>
            )}
        </div>
    );
};

/** Container: pulls buckets from the report and manages watchlist adds (≤5 cap). */
const TopThreats: React.FC<{ buckets?: CompetitionBuckets }> = ({ buckets }) => {
    const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
    const [max, setMax] = useState(5);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const wl = await intelligenceAPI.getWatchlist();
                if (!cancelled) {
                    setWatchlist(wl.entries);
                    setMax(wl.max);
                }
            } catch {
                /* watchlist optional */
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const onAdd = async (c: CompetitorProfile) => {
        setError(null);
        if (watchlist.length >= max) {
            setError(`Watchlist exceeds the maximum of ${max} competitors.`);
            return;
        }
        const next = [...watchlist, { placeId: c.placeId, name: c.name, addedAt: new Date() }];
        try {
            const res = await intelligenceAPI.putWatchlist(
                next.map((e) => ({ placeId: e.placeId, name: e.name, zomatoUrl: e.zomatoUrl })),
            );
            setWatchlist(res.entries);
            setMax(res.max);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not update your watchlist.');
        }
    };

    // Old reports (pre-Brief 10) have no buckets — optional-field guard.
    if (!buckets) {
        return (
            <div className="bg-surface rounded-2xl p-6 border border-line">
                <p className="text-sm text-muted">
                    Top Threats appears after your next scan — re-scan to rank your closest same-cuisine and overall rivals.
                </p>
            </div>
        );
    }

    return <TopThreatsView buckets={buckets} watchlist={watchlist} max={max} error={error} onAdd={onAdd} />;
};

export default TopThreats;
