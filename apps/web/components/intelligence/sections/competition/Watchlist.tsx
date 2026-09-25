import React, { useEffect, useMemo, useState } from 'react';
import type { WatchlistEntry, CompetitorProfile } from '@restropulse/shared';
import { intelligenceAPI, type SnapshotSeriesPoint, type RivalDigest, type WatchlistDigestResponse } from '../../../../api';
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
    <div className={`bg-surface rounded-2xl p-4 sm:p-6 border border-line ${className}`}>{children}</div>
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

/**
 * Per-rival week digest — what their guests said, split positive / negative.
 * This is the insight the tab existed for: not "you track 2 rivals" but "what
 * happened at those rivals yesterday and this week".
 */
export const RivalDigestBlock: React.FC<{ d: RivalDigest }> = ({ d }) => {
    const [tab, setTab] = useState<'negative' | 'positive'>(d.negativeComments.length > 0 ? 'negative' : 'positive');
    const comments = tab === 'negative' ? d.negativeComments : d.positiveComments;
    if (!d.latest) {
        return (
            <p className="text-xs text-muted mt-3" data-testid={`digest-empty-${d.placeId}`}>
                Daily tracking starts after tonight’s first check — reviews and comments will appear here.
            </p>
        );
    }
    return (
        <div className="mt-3 rounded-xl bg-canvas p-3 space-y-2.5" data-testid={`digest-${d.placeId}`}>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <span className="text-ink">
                    <span className="font-semibold">Yesterday:</span>{' '}
                    {d.yesterday.total === 0 ? 'no new reviews' : (
                        <>{d.yesterday.total} new · <span className="text-success font-semibold">{d.yesterday.positive} positive</span> · <span className="text-danger font-semibold">{d.yesterday.negative} negative</span></>
                    )}
                </span>
                <span className="text-ink">
                    <span className="font-semibold">This week:</span>{' '}
                    {d.week.total === 0 ? 'no new reviews' : (
                        <>{d.week.total} new · <span className="text-success font-semibold">{d.week.positive} positive</span> · <span className="text-danger font-semibold">{d.week.negative} negative</span></>
                    )}
                </span>
            </div>
            {(d.positiveComments.length > 0 || d.negativeComments.length > 0) && (
                <>
                    <div className="flex items-center gap-1">
                        {(['negative', 'positive'] as const).map((t) => {
                            const n = t === 'negative' ? d.negativeComments.length : d.positiveComments.length;
                            if (n === 0) return null;
                            return (
                                <button
                                    key={t}
                                    type="button"
                                    aria-pressed={tab === t}
                                    onClick={() => setTab(t)}
                                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold ${
                                        tab === t ? (t === 'negative' ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success') : 'text-muted hover:text-ink'
                                    }`}
                                >
                                    {t === 'negative' ? `What upset their guests (${n})` : `What their guests loved (${n})`}
                                </button>
                            );
                        })}
                    </div>
                    <ul className="space-y-1.5">
                        {comments.map((c, i) => (
                            <li key={i} className="text-xs text-ink leading-relaxed">
                                <span className={`font-semibold ${c.rating <= 2 ? 'text-danger' : 'text-success'}`}>{'★'.repeat(Math.max(1, Math.round(c.rating)))}</span>{' '}
                                “{c.text}” <span className="text-muted">· {c.date}</span>
                            </li>
                        ))}
                    </ul>
                </>
            )}
        </div>
    );
};

export const WatchlistView: React.FC<{
    cards: WatchlistCardData[];
    candidates: WatchlistCandidate[];
    max: number;
    error: string | null;
    digest?: WatchlistDigestResponse | null;
    onAdd: (c: WatchlistCandidate) => void;
    onRemove: (placeId: string) => void;
}> = ({ cards, candidates, max, error, digest, onAdd, onRemove }) => {
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
        <div className="space-y-4 sm:space-y-6">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <h3 className="text-base font-semibold text-ink">Rivals you track</h3>
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
                <p className="text-xs text-muted">You’re tracking the maximum — remove one to add another.</p>
            )}

            {/* Tracked cards */}
            <div className="grid lg:grid-cols-2 gap-4">
                {cards.map((c) => {
                    const d = digest?.rivals.find((r) => r.placeId === c.entry.placeId);
                    return (
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
                        {d?.aheadOnRating && (
                            <p className="mt-2 text-xs font-semibold text-danger">Currently rated above you</p>
                        )}
                        {d && <RivalDigestBlock d={d} />}
                    </div>
                    );
                })}
                {cards.length === 0 && (
                    <p className="text-sm text-muted">
                        No rivals tracked yet — add up to {max} below. Once tracked, we check them every night and show you
                        their new reviews here, split into what guests loved and what upset them.
                    </p>
                )}
            </div>

            {/* Picker */}
            <Card>
                <h3 className="text-base font-semibold text-ink mb-2">Track another restaurant</h3>
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
                                title={atCapacity ? `You’re tracking the maximum (${max}) — remove one to add another` : 'Track this restaurant'}
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
    const [digest, setDigest] = useState<WatchlistDigestResponse | null>(null);

    const load = async () => {
        const wl = await intelligenceAPI.getWatchlist();
        setEntries(wl.entries);
        setMax(wl.max);
        intelligenceAPI.getWatchlistDigest().then(setDigest).catch(() => undefined);
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
            setError(err instanceof Error ? err.message : 'Could not update the restaurants you track.');
        }
    };

    const onAdd = (c: WatchlistCandidate) => {
        if (entries.length >= max) {
            setError(`You can track at most ${max} restaurants.`);
            return;
        }
        persist([...entries, { placeId: c.placeId, name: c.name, addedAt: new Date() }]);
    };
    const onRemove = (placeId: string) => persist(entries.filter((e) => e.placeId !== placeId));

    if (loading) return <p className="text-sm text-muted">Loading the rivals you track…</p>;

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

    return <WatchlistView cards={cards} candidates={candidates} max={max} error={error} digest={digest} onAdd={onAdd} onRemove={onRemove} />;
};

export default Watchlist;
