import React, { useEffect, useMemo, useState } from 'react';
import type { WatchlistEntry, CompetitorProfile } from '@restropulse/shared';
import { intelligenceAPI, type SnapshotSeriesPoint } from '../../../../api';
import { ThreatBar } from '../primitives';
import { Sparkline } from '../charts';
import { SERIES } from '../../theme';

/**
 * Watchlist (Brief 09 §3) — pick up to 5 competitors to track. Enforces the cap
 * client-side AND surfaces the server's 422 message. Shows an N/5 counter, a
 * picker over the latest report's competitors + free search, and one card per
 * tracked competitor (name, cuisine, distance, current ratings, 30-day
 * sparkline, threat bar). Tokens only.
 */

const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
    <div className={`bg-surface rounded-2xl p-6 border border-line ${className}`}>{children}</div>
);

export interface WatchlistCandidate {
    placeId: string;
    name: string;
    cuisine?: string;
    distanceKm?: number;
    rating?: number;
    threatScore?: number;
}

export interface WatchlistCardData {
    entry: WatchlistEntry;
    cuisine?: string;
    distanceKm?: number;
    googleRating?: number;
    zomatoRating?: number;
    threatScore?: number;
    spark?: number[];
}

export const WatchlistView: React.FC<{
    cards: WatchlistCardData[];
    candidates: WatchlistCandidate[];
    max: number;
    error: string | null;
    onAdd: (c: WatchlistCandidate) => void;
    onRemove: (placeId: string) => void;
}> = ({ cards, candidates, max, error, onAdd, onRemove }) => {
    const [search, setSearch] = useState('');
    const count = cards.length;
    const atCapacity = count >= max;
    const tracked = new Set(cards.map((c) => c.entry.placeId));

    const filtered = useMemo(
        () =>
            candidates
                .filter((c) => !tracked.has(c.placeId))
                .filter((c) => c.name.toLowerCase().includes(search.toLowerCase())),
        [candidates, tracked, search],
    );

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <h3 className="text-base font-semibold text-ink">Your watchlist</h3>
                <span className={`text-sm font-semibold tabular-nums ${atCapacity ? 'text-warning' : 'text-muted'}`} data-testid="watchlist-counter">
                    {count}/{max}
                </span>
            </div>

            {error && (
                <div className="rounded-xl border border-danger/40 bg-surface p-3" role="alert">
                    <p className="text-sm text-danger">{error}</p>
                </div>
            )}

            {atCapacity && (
                <p className="text-xs text-muted">Watchlist full — remove a competitor to swap in a new one.</p>
            )}

            {/* Tracked cards */}
            <div className="grid sm:grid-cols-2 gap-4">
                {cards.map((c) => (
                    <div key={c.entry.placeId} className="rounded-xl border border-line bg-surface p-4">
                        <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                                <p className="text-sm font-semibold text-ink truncate">{c.entry.name}</p>
                                <p className="text-xs text-muted mt-0.5">
                                    {[c.cuisine, c.distanceKm !== undefined ? `${c.distanceKm.toFixed(1)} km` : null].filter(Boolean).join(' · ')}
                                </p>
                            </div>
                            <button type="button" onClick={() => onRemove(c.entry.placeId)} className="text-xs font-semibold text-muted hover:text-danger shrink-0">
                                Remove
                            </button>
                        </div>
                        <div className="flex items-center gap-4 mt-2 text-xs">
                            {c.googleRating !== undefined && <span className="text-ink">Google ★ {c.googleRating.toFixed(1)}</span>}
                            {c.zomatoRating !== undefined && <span className="text-ink">Zomato ★ {c.zomatoRating.toFixed(1)}</span>}
                        </div>
                        {c.spark && c.spark.length > 0 && (
                            <div className="mt-2">
                                <Sparkline points={c.spark} color={SERIES[0]} ariaLabel={`${c.entry.name} 30-day rating`} height={32} />
                            </div>
                        )}
                        {c.threatScore !== undefined && <div className="mt-2"><ThreatBar value={c.threatScore} /></div>}
                    </div>
                ))}
                {cards.length === 0 && <p className="text-sm text-muted">No competitors tracked yet — add up to {max} below.</p>}
            </div>

            {/* Picker */}
            <Card>
                <h3 className="text-base font-semibold text-ink mb-2">Add a competitor</h3>
                <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search nearby competitors…"
                    aria-label="Search competitors"
                    className="w-full text-sm border border-line rounded-lg px-3 py-2 bg-surface text-ink mb-3"
                />
                <div className="space-y-1 max-h-64 overflow-y-auto">
                    {filtered.map((c) => (
                        <div key={c.placeId} className="flex items-center justify-between gap-2 py-2 border-b border-line last:border-b-0">
                            <div className="min-w-0">
                                <p className="text-sm text-ink truncate">{c.name}</p>
                                <p className="text-xs text-muted">
                                    {[c.cuisine, c.distanceKm !== undefined ? `${c.distanceKm.toFixed(1)} km` : null, c.rating !== undefined ? `★ ${c.rating.toFixed(1)}` : null].filter(Boolean).join(' · ')}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => onAdd(c)}
                                disabled={atCapacity}
                                title={atCapacity ? `Watchlist is full (${max}/${max}) — remove one to add another` : 'Add to watchlist'}
                                className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg bg-primary-strong text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                Add
                            </button>
                        </div>
                    ))}
                    {filtered.length === 0 && <p className="text-sm text-muted py-2">No matching competitors.</p>}
                </div>
            </Card>
        </div>
    );
};

/** Container: joins watchlist + latest-report competitors + 30-day sparklines. */
const Watchlist: React.FC = () => {
    const [entries, setEntries] = useState<WatchlistEntry[]>([]);
    const [max, setMax] = useState(5);
    const [candidates, setCandidates] = useState<WatchlistCandidate[]>([]);
    const [sparks, setSparks] = useState<Record<string, number[]>>({});
    const [profiles, setProfiles] = useState<Record<string, CompetitorProfile>>({});
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const load = async () => {
        const wl = await intelligenceAPI.getWatchlist();
        setEntries(wl.entries);
        setMax(wl.max);
        // 30-day rating sparkline per tracked competitor.
        const to = new Date().toISOString().slice(0, 10);
        const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
        const sparkEntries = await Promise.all(
            wl.entries.map(async (e) => {
                try {
                    const s = await intelligenceAPI.getSnapshots({ target: e.placeId, source: 'google', granularity: 'day', from, to });
                    return [e.placeId, s.points.map((p: SnapshotSeriesPoint) => p.rating)] as const;
                } catch {
                    return [e.placeId, [] as number[]] as const;
                }
            }),
        );
        setSparks(Object.fromEntries(sparkEntries));
    };

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const report = await intelligenceAPI.getLatestReport();
                if (!cancelled && report) {
                    setCandidates(
                        report.competitors.map((c) => ({ placeId: c.placeId, name: c.name, cuisine: c.cuisine, distanceKm: c.distanceKm, rating: c.rating, threatScore: c.threatScore })),
                    );
                    setProfiles(Object.fromEntries(report.competitors.map((c) => [c.name, c])));
                }
                await load();
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const persist = async (next: WatchlistEntry[]) => {
        setError(null);
        try {
            const res = await intelligenceAPI.putWatchlist(next.map((e) => ({ placeId: e.placeId, name: e.name, zomatoUrl: e.zomatoUrl })));
            setEntries(res.entries);
            setMax(res.max);
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not update your watchlist.');
        }
    };

    const onAdd = (c: WatchlistCandidate) => {
        if (entries.length >= max) {
            setError(`Watchlist exceeds the maximum of ${max} competitors.`);
            return;
        }
        persist([...entries, { placeId: c.placeId, name: c.name, addedAt: new Date() }]);
    };
    const onRemove = (placeId: string) => persist(entries.filter((e) => e.placeId !== placeId));

    if (loading) return <p className="text-sm text-muted">Loading your watchlist…</p>;

    const cards: WatchlistCardData[] = entries.map((entry) => {
        const p = profiles[entry.name];
        return {
            entry,
            cuisine: p?.cuisine,
            distanceKm: p?.distanceKm,
            googleRating: p?.rating,
            threatScore: p?.threatScore,
            spark: sparks[entry.placeId],
        };
    });

    return <WatchlistView cards={cards} candidates={candidates} max={max} error={error} onAdd={onAdd} onRemove={onRemove} />;
};

export default Watchlist;
