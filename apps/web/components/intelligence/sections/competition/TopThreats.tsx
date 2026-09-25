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
    <div className="bg-surface rounded-2xl p-4 sm:p-6 border border-line">{children}</div>
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
        <div className="inline-flex items-center gap-1 rounded-xl bg-canvas border border-line p-1" role="group" aria-label="Which rivals to show">
            {opt('DIRECT', 'Same food & price', directCount)}
            {opt('OVERALL', 'All nearby', overallCount)}
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
    const anything = c.strengths?.length || c.weaknesses?.length || c.whatTheyDoBetter?.length || c.whereYouWin?.length;
    return (
        <div className="px-4 py-3 bg-canvas rounded-xl space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
                {list('What they do better than you', c.whatTheyDoBetter)}
                {list('Where you win', c.whereYouWin)}
                {list('Their strengths', c.strengths)}
                {list('Their weak spots', c.weaknesses)}
            </div>
            {(c.pricingInsight || c.marketingEdge) && (
                <div className="grid sm:grid-cols-2 gap-4">
                    {c.pricingInsight && (
                        <p className="text-xs text-ink leading-relaxed"><span className="font-semibold">Pricing:</span> {c.pricingInsight}</p>
                    )}
                    {c.marketingEdge && (
                        <p className="text-xs text-ink leading-relaxed"><span className="font-semibold">How they market:</span> {c.marketingEdge}</p>
                    )}
                </div>
            )}
            {!anything && <p className="text-xs text-muted">No write-up for this restaurant yet — it will appear after your next scan.</p>}
        </div>
    );
};

/** One plain sentence per rival: where they beat you, or that you lead. */
export function beatsYouLine(c: CompetitorProfile, base?: { rating: number; totalRatings: number; photoCount: number }): string | null {
    if (!base) return null;
    const wins: string[] = [];
    if (c.rating - base.rating >= 0.1) wins.push(`rating (${c.rating.toFixed(1)} vs ${base.rating.toFixed(1)})`);
    if (c.totalRatings > base.totalRatings) wins.push(`${(c.totalRatings - base.totalRatings).toLocaleString('en-IN')} more reviews`);
    if (c.photoCount > base.photoCount) wins.push(`${(c.photoCount - base.photoCount).toLocaleString('en-IN')} more photos`);
    if (wins.length === 0) return 'You lead on rating, reviews and photos';
    return `Beats you on ${wins.join(' · ')}`;
}

export const TopThreatsView: React.FC<{
    buckets: CompetitionBuckets;
    watchlist: WatchlistEntry[];
    max: number;
    error: string | null;
    onAdd: (c: CompetitorProfile) => void;
    /** The merchant's own Places id, filtered out of both buckets (RP-011). */
    selfPlaceId?: string;
    /** The merchant's measured numbers, for the per-row "beats you on" line. */
    base?: { rating: number; totalRatings: number; photoCount: number };
}> = ({ buckets, watchlist, max, error, onAdd, selfPlaceId, base }) => {
    const [tab, setTab] = useState<BucketKey>('DIRECT');
    const [expanded, setExpanded] = useState<string | null>(null);

    // RP-011: reports written before the report-builder fix still carry the
    // merchant inside its own buckets. Filter here too so old reports render
    // correctly without forcing a re-scan.
    const dropSelf = (rows: CompetitorProfile[]) =>
        selfPlaceId ? rows.filter((c) => c.placeId !== selfPlaceId) : rows;
    const directTop10 = dropSelf(buckets.directTop10);
    const overallTop10 = dropSelf(buckets.overallTop10);

    const rows = tab === 'DIRECT' ? directTop10 : overallTop10;
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
                    directCount={directTop10.length}
                    overallCount={overallTop10.length}
                />
                <p className="text-xs text-muted">
                    Your price range: <span className="font-semibold text-ink">{buckets.aovBand.label}</span>
                </p>
            </div>

            {error && (
                <div className="rounded-xl border border-danger/40 bg-surface p-3" role="alert">
                    <p className="text-sm text-danger">{error}</p>
                </div>
            )}

            {tab === 'DIRECT' && rows.length === 0 ? (
                <Card>
                    <p className="text-sm text-ink font-semibold">No rivals within 5 km serve the same kind of food at your prices — you may own this niche.</p>
                    <p className="text-xs text-muted mt-1">
                        If that looks wrong, check the price level on your Google profile — when Google has none, we assume mid-range.
                    </p>
                </Card>
            ) : (
                <Card>
                    <div className="overflow-x-auto no-scrollbar">
                        <table className="w-full sm:min-w-[720px] text-sm">
                            <thead>
                                <tr className="text-left text-[11px] uppercase tracking-wider text-muted">
                                    <th className="font-semibold py-2 pr-2 w-8">#</th>
                                    <th className="font-semibold py-2 pr-3">Restaurant</th>
                                    <th className="font-semibold py-2 pr-3 hidden sm:table-cell">Food</th>
                                    <th className="font-semibold py-2 pr-3 hidden sm:table-cell">Price</th>
                                    <th className="font-semibold py-2 pr-3 text-right">Rating</th>
                                    <th className="font-semibold py-2 pr-3 text-right">Reviews</th>
                                    <th className="font-semibold py-2 pr-3 text-right hidden sm:table-cell">Distance</th>
                                    <th className="font-semibold py-2 pr-3" title="How strongly this restaurant competes with you — closer, better-rated and busier means higher.">Rivalry</th>
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
                                                <td className="py-2.5 pr-3">
                                                    <p className="font-medium text-ink">{c.name}</p>
                                                    {(() => {
                                                        const line = beatsYouLine(c, base);
                                                        if (!line) return null;
                                                        const leads = line.startsWith('You lead');
                                                        return (
                                                            <p className={`text-xs mt-0.5 ${leads ? 'text-success' : 'text-muted'}`} data-testid={`beats-${c.placeId}`}>
                                                                {line}
                                                            </p>
                                                        );
                                                    })()}
                                                </td>
                                                <td className="py-2.5 pr-3 text-muted hidden sm:table-cell">{c.cuisine}</td>
                                                <td className="py-2.5 pr-3 text-muted hidden sm:table-cell">{aovBandLabel(c.priceLevel)}</td>
                                                <td className="py-2.5 pr-3 text-right text-ink tabular-nums">★ {c.rating.toFixed(1)}</td>
                                                <td className="py-2.5 pr-3 text-right text-muted tabular-nums">{c.totalRatings.toLocaleString('en-IN')}</td>
                                                <td className="py-2.5 pr-3 text-right text-muted tabular-nums hidden sm:table-cell">{c.distanceKm.toFixed(1)} km</td>
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
                                                                ? 'You already track this restaurant'
                                                                : atCapacity
                                                                  ? `You’re tracking the maximum (${max})`
                                                                  : 'Track this restaurant'
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
const TopThreats: React.FC<{ buckets?: CompetitionBuckets; selfPlaceId?: string; base?: { rating: number; totalRatings: number; photoCount: number } }> = ({ buckets, selfPlaceId, base }) => {
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
            setError(`You can track at most ${max} restaurants.`);
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
            setError(err instanceof Error ? err.message : 'Could not update the restaurants you track.');
        }
    };

    // Old reports (pre-Brief 10) have no buckets — optional-field guard.
    if (!buckets) {
        return (
            <div className="bg-surface rounded-2xl p-4 sm:p-6 border border-line">
                <p className="text-sm text-muted">
                    Your biggest rivals appear after your next scan — refresh the report to rank the restaurants closest to you.
                </p>
            </div>
        );
    }

    return <TopThreatsView buckets={buckets} watchlist={watchlist} max={max} error={error} onAdd={onAdd} selfPlaceId={selfPlaceId} base={base} />;
};

export default TopThreats;
