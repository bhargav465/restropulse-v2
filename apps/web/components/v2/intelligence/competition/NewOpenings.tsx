import React, { useEffect, useState } from 'react';
import { intelligenceAPI, type NewOpening } from '../../../../api';
import { resolveDeepLink, type DeepLinkTarget } from '../deep-links';

/**
 * NewOpenings (Brief 09 §3) — the 5 km new-openings radar. `sinceDays` chip
 * filter (30/60/90), radius fixed at 5 km. Cards show name, cuisine chip,
 * distance, first-seen date and review ramp; `fastStarter` is flagged
 * `text-warning`. Actions: add-to-watchlist (disabled at 5/5 with a tooltip) and
 * "Draft a response post" → Content Engine. Friendly empty state.
 */

const SINCE_OPTIONS: Array<30 | 60 | 90> = [30, 60, 90];

export const NewOpeningsView: React.FC<{
    openings: NewOpening[];
    sinceDays: 30 | 60 | 90;
    onSinceDaysChange: (d: 30 | 60 | 90) => void;
    atCapacity: boolean;
    trackedPlaceIds: Set<string>;
    onAdd: (o: NewOpening) => void;
    onNavigate: (t: DeepLinkTarget) => void;
}> = ({ openings, sinceDays, onSinceDaysChange, atCapacity, trackedPlaceIds, onAdd, onNavigate }) => (
    <div className="space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
            <h3 className="text-base font-semibold text-ink">New openings within 5 km</h3>
            <div className="inline-flex items-center gap-1 rounded-xl bg-primary-soft p-1">
                {SINCE_OPTIONS.map((d) => (
                    <button
                        key={d}
                        type="button"
                        aria-pressed={sinceDays === d}
                        onClick={() => onSinceDaysChange(d)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                            sinceDays === d ? 'bg-primary text-white' : 'text-primary-strong hover:bg-surface/60'
                        }`}
                    >
                        {d}d
                    </button>
                ))}
            </div>
        </div>

        {openings.length === 0 ? (
            <div className="bg-surface rounded-2xl p-6 border border-line">
                <p className="text-sm text-muted">
                    No new openings within 5 km in the last {sinceDays} days — quiet streets are good news.
                </p>
            </div>
        ) : (
            <div className="grid sm:grid-cols-2 gap-4">
                {openings.map((o) => {
                    const tracked = trackedPlaceIds.has(o.placeId);
                    return (
                        <div key={o.placeId} className="rounded-xl border border-line bg-surface p-4">
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-ink truncate">{o.name}</p>
                                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                                        {o.cuisine && <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary-soft text-primary-strong">{o.cuisine}</span>}
                                        <span className="text-xs text-muted">{o.distanceKm.toFixed(1)} km</span>
                                    </div>
                                </div>
                                {o.fastStarter && <span className="text-xs font-semibold text-warning shrink-0">Fast starter</span>}
                            </div>
                            <p className="text-xs text-muted mt-2">
                                First seen {new Date(o.firstSeenAt).toISOString().slice(0, 10)} · +{o.reviewsSinceFirstSeen} reviews in {o.daysSinceFirstSeen}d
                            </p>
                            <div className="flex items-center gap-3 mt-3">
                                <button
                                    type="button"
                                    onClick={() => onAdd(o)}
                                    disabled={atCapacity || tracked}
                                    title={tracked ? 'Already on your watchlist' : atCapacity ? 'Watchlist is full (5/5) — remove one to add another' : 'Add to watchlist'}
                                    className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-primary-strong text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    {tracked ? 'Tracked' : 'Add to watchlist'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onNavigate(resolveDeepLink({ bucket: 'content', params: { brief: 'new-competitor-response' } }))}
                                    title="/admin-v2/content"
                                    className="text-xs font-semibold text-primary-strong hover:underline"
                                >
                                    Draft a response post →
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        )}
    </div>
);

/** Container: fetches openings for the current sinceDays + wires add-to-watchlist. */
const NewOpenings: React.FC<{ onNavigate: (t: DeepLinkTarget) => void }> = ({ onNavigate }) => {
    const [sinceDays, setSinceDays] = useState<30 | 60 | 90>(30);
    const [openings, setOpenings] = useState<NewOpening[] | null>(null);
    const [tracked, setTracked] = useState<Set<string>>(new Set());
    const [max, setMax] = useState(5);
    const [count, setCount] = useState(0);

    const loadWatchlist = async () => {
        const wl = await intelligenceAPI.getWatchlist();
        setTracked(new Set(wl.entries.map((e) => e.placeId)));
        setMax(wl.max);
        setCount(wl.entries.length);
    };

    useEffect(() => {
        loadWatchlist().catch(() => {});
    }, []);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setOpenings(null);
            try {
                const res = await intelligenceAPI.getNewOpenings({ sinceDays });
                if (!cancelled) setOpenings(res);
            } catch {
                if (!cancelled) setOpenings([]);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [sinceDays]);

    const onAdd = async (o: NewOpening) => {
        if (count >= max) return;
        const wl = await intelligenceAPI.getWatchlist();
        try {
            await intelligenceAPI.putWatchlist([
                ...wl.entries.map((e) => ({ placeId: e.placeId, name: e.name, zomatoUrl: e.zomatoUrl })),
                { placeId: o.placeId, name: o.name },
            ]);
            await loadWatchlist();
        } catch {
            /* cap enforced server-side; ignore */
        }
    };

    if (openings === null) return <p className="text-sm text-muted">Scanning nearby streets…</p>;

    return (
        <NewOpeningsView
            openings={openings}
            sinceDays={sinceDays}
            onSinceDaysChange={setSinceDays}
            atCapacity={count >= max}
            trackedPlaceIds={tracked}
            onAdd={onAdd}
            onNavigate={onNavigate}
        />
    );
};

export default NewOpenings;
