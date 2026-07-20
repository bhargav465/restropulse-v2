import React, { useEffect, useState } from 'react';
import { intelligenceAPI, type RivalFeedbackResponse } from '../../../../api';
import type { WatchlistEntry } from '@restropulse/shared';

/**
 * Rival Comments — read the actual review text your tracked rivals receive.
 * Pick a rival from the watchlist; shows their new Google/Zomato comments by
 * day (captured by the daily snapshot cron). Companion to the numeric
 * Compare/trends views.
 */

const RivalComments: React.FC = () => {
    const [rivals, setRivals] = useState<WatchlistEntry[] | null>(null);
    const [selected, setSelected] = useState<string>('');
    const [data, setData] = useState<RivalFeedbackResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        intelligenceAPI.getWatchlist()
            .then((r) => {
                setRivals(r.entries);
                if (r.entries.length > 0) setSelected(r.entries[0].placeId);
            })
            .catch((e) => setError(e?.message ?? 'Failed to load your Tracked Rivals'));
    }, []);

    useEffect(() => {
        if (!selected) { setData(null); return; }
        let cancelled = false;
        setLoading(true);
        setError(null);
        intelligenceAPI.getRivalFeedback(selected, 30)
            .then((r) => { if (!cancelled) setData(r); })
            .catch((e) => { if (!cancelled) setError(e?.message ?? 'Failed to load comments'); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [selected]);

    if (rivals === null && !error) return <p className="text-sm text-muted">Loading Tracked Rivals…</p>;

    if (rivals !== null && rivals.length === 0) {
        return (
            <div className="rounded-2xl border border-line bg-surface p-6 text-center">
                <p className="text-sm font-semibold text-ink mb-1">No rivals tracked yet</p>
                <p className="text-xs text-muted">Run a scan (top 5 competitors are added automatically) or add rivals under Tracked Rivals — their new comments will appear here daily.</p>
            </div>
        );
    }

    const daysWithComments = (data?.days ?? []).filter((d) => (d.newReviews ?? []).length > 0);

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
                <label htmlFor="rival-select" className="text-sm font-semibold text-ink">Rival:</label>
                <select
                    id="rival-select"
                    value={selected}
                    onChange={(e) => setSelected(e.target.value)}
                    className="rounded-lg border border-line bg-surface text-ink text-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
                >
                    {(rivals ?? []).map((r) => <option key={r.placeId} value={r.placeId}>{r.name}</option>)}
                </select>
                {data && data.days.length > 0 && (
                    <span className="text-xs text-muted">
                        Latest: ★ {data.days[0].rating?.toFixed?.(1) ?? data.days[0].rating} · {data.days[0].reviewCount} reviews
                    </span>
                )}
            </div>

            {error && <p className="text-sm text-danger">{error}</p>}
            {loading && <p className="text-sm text-muted">Loading comments…</p>}

            {!loading && data && daysWithComments.length === 0 && (
                <div className="rounded-2xl border border-line bg-surface p-6 text-center">
                    <p className="text-sm text-ink font-semibold mb-1">No new comments captured yet</p>
                    <p className="text-xs text-muted">Comments are collected automatically every morning — check back after the next capture. (Rating and review-count trends for this rival are already in Compare.)</p>
                </div>
            )}

            {!loading && daysWithComments.map((day) => (
                <div key={`${day.date}-${day.source}`} className="rounded-2xl border border-line bg-surface p-4">
                    <p className="text-xs font-bold text-muted uppercase tracking-wider mb-2">{day.date} · {day.source}</p>
                    <ul className="space-y-2">
                        {day.newReviews.map((r, i) => (
                            <li key={i} className="rounded-xl bg-primary-soft/30 border border-line p-3">
                                <div className="flex items-center justify-between gap-2 mb-1">
                                    <span className={`text-xs font-bold ${r.rating >= 4 ? 'text-emerald-600' : r.rating <= 2 ? 'text-red-500' : 'text-amber-500'}`}>★ {r.rating}</span>
                                    <span className="text-[11px] text-muted">{r.time}</span>
                                </div>
                                <p className="text-sm text-ink leading-snug">{r.text || <span className="text-muted italic">Rating only — no comment</span>}</p>
                                {r.author && <p className="text-[11px] text-muted mt-1">— {r.author}</p>}
                            </li>
                        ))}
                    </ul>
                </div>
            ))}
        </div>
    );
};

export default RivalComments;
