import React, { useEffect, useMemo, useState } from 'react';
import { REVIEW_THEMES, type ReviewTheme } from '@restropulse/shared';
import { intelligenceAPI, type FeedbackDay, type FeedbackReview } from '../../../../api';
import type { PeriodQuery } from '../period';
import { resolveDeepLink, type DeepLinkTarget } from '../deep-links';
import { ProvenanceChip } from '../provenance';

/**
 * FeedbackChanges (Brief 09 §2) — the self-only "what changed" feed. Day-grouped
 * new-review cards with source chips and theme hashtag chips (clicking a chip
 * filters the feed). A theme trending negative over the last 7 days raises a
 * `border-danger` alert card. "Rating changed" rows carry a cause hint, and each
 * review has a "Reply now" deep link into the Get-started task.
 */

const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
    <div className={`bg-surface rounded-2xl p-6 border border-line ${className}`}>{children}</div>
);

const Stars: React.FC<{ n: number }> = ({ n }) => (
    <span className="text-warning text-xs tabular-nums" aria-label={`${n} stars`}>
        {'★'.repeat(Math.round(n))}
        <span className="text-line">{'★'.repeat(Math.max(0, 5 - Math.round(n)))}</span>
    </span>
);

const SourceChip: React.FC<{ source: FeedbackReview['source'] }> = ({ source }) => (
    <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary-soft text-primary-strong">
        {source}
    </span>
);

const NEGATIVE_WINDOW_DAYS = 7;

/** Themes trending negative (≥2 low-star mentions) in the trailing 7 days. */
export function negativeTrendingThemes(days: FeedbackDay[]): ReviewTheme[] {
    const recent = [...days].sort((a, b) => b.date.localeCompare(a.date)).slice(0, NEGATIVE_WINDOW_DAYS);
    const counts = new Map<ReviewTheme, number>();
    for (const d of recent) {
        for (const r of d.newReviews) {
            if (r.rating > 2) continue;
            for (const t of r.themes ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
        }
    }
    return [...counts.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).map(([t]) => t);
}

export const FeedbackChangesView: React.FC<{
    days: FeedbackDay[];
    onNavigate: (t: DeepLinkTarget) => void;
}> = ({ days, onNavigate }) => {
    const [activeTheme, setActiveTheme] = useState<ReviewTheme | null>(null);

    const sortedDays = useMemo(() => [...days].sort((a, b) => b.date.localeCompare(a.date)), [days]);

    // Which themes appear anywhere in the feed (drives the chip row).
    const presentThemes = useMemo(() => {
        const set = new Set<ReviewTheme>();
        for (const d of days) for (const r of d.newReviews) for (const t of r.themes ?? []) set.add(t);
        return REVIEW_THEMES.filter((t) => set.has(t));
    }, [days]);

    const negatives = useMemo(() => negativeTrendingThemes(days), [days]);

    const reply = () => onNavigate(resolveDeepLink({ bucket: 'get-started', params: { task: 'review-replies' } }));

    const filtered = (reviews: FeedbackReview[]) =>
        activeTheme ? reviews.filter((r) => (r.themes ?? []).includes(activeTheme)) : reviews;

    return (
        <div className="space-y-6">
            {/* Negative-trend alert */}
            {negatives.length > 0 && (
                <div className="bg-surface rounded-2xl p-5 border border-line border-l-[3px] border-l-danger" data-testid="negative-trend-alert">
                    <h3 className="text-sm font-semibold text-danger">Sentiment turning negative</h3>
                    <p className="text-sm text-muted mt-1">
                        {negatives.map((t) => `#${t}`).join(', ')} mentioned in multiple low-star reviews this week. Reply and address it before it drags your rating.
                    </p>
                    <button type="button" onClick={reply} title="/admin-v2/get-started" className="mt-2 text-xs font-semibold text-primary-strong hover:underline">
                        Reply now →
                    </button>
                </div>
            )}

            {/* Theme filter chips */}
            <Card>
                <div className="flex items-center justify-between gap-2 mb-3">
                    <h3 className="text-base font-semibold text-ink">Filter by theme</h3>
                    <ProvenanceChip provenance="ai-inferred" />
                </div>
                <div className="flex flex-wrap gap-2">
                    {presentThemes.map((t) => {
                        const active = activeTheme === t;
                        return (
                            <button
                                key={t}
                                type="button"
                                aria-pressed={active}
                                onClick={() => setActiveTheme(active ? null : t)}
                                className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                                    active ? 'bg-primary text-white border-primary' : 'border-line text-ink hover:bg-primary-soft'
                                }`}
                            >
                                #{t}
                            </button>
                        );
                    })}
                    {activeTheme && (
                        <button type="button" onClick={() => setActiveTheme(null)} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-muted hover:text-ink">
                            Clear
                        </button>
                    )}
                </div>
            </Card>

            {/* Day-grouped feed */}
            {sortedDays.map((day) => {
                const reviews = filtered(day.newReviews);
                const ratingDropped = day.ratingBefore !== null && day.ratingAfter < day.ratingBefore;
                if (reviews.length === 0 && !(ratingDropped && !activeTheme)) return null;
                return (
                    <div key={day.date} className="space-y-3">
                        <div className="flex items-center gap-3">
                            <h4 className="text-sm font-semibold text-ink">{day.date}</h4>
                            {ratingDropped && (
                                <span className="text-xs text-danger font-semibold">
                                    Rating {day.ratingBefore?.toFixed(1)} → {day.ratingAfter.toFixed(1)}
                                    {day.themesTrending.length > 0 && (
                                        <span className="text-muted font-normal"> · {day.newReviews.filter((r) => r.rating <= 2).length} new low-star mentioning #{day.themesTrending[0]}</span>
                                    )}
                                </span>
                            )}
                        </div>
                        {reviews.map((r, i) => (
                            <div key={i} className="rounded-xl border border-line p-4 bg-surface">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <Stars n={r.rating} />
                                    <SourceChip source={r.source} />
                                    {(r.themes ?? []).map((t) => (
                                        <span key={t} className="text-[10px] text-muted">#{t}</span>
                                    ))}
                                    <button type="button" onClick={reply} title="/admin-v2/get-started" className="ml-auto text-xs font-semibold text-primary-strong hover:underline">
                                        Reply now →
                                    </button>
                                </div>
                                <p className="text-sm text-ink mt-2 leading-relaxed">{r.text}</p>
                            </div>
                        ))}
                    </div>
                );
            })}
        </div>
    );
};

/** Container: fetches the self feedback feed for the current window. */
const FeedbackChanges: React.FC<{ query: PeriodQuery; onNavigate: (t: DeepLinkTarget) => void }> = ({ query, onNavigate }) => {
    const [days, setDays] = useState<FeedbackDay[] | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setDays(null);
            try {
                const res = await intelligenceAPI.getFeedbackChanges({ from: query.from, to: query.to });
                if (!cancelled) setDays(res.days);
            } catch {
                if (!cancelled) setDays([]);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [query.from, query.to]);

    if (days === null) return <p className="text-sm text-muted">Loading what changed…</p>;
    if (days.length === 0) return <p className="text-sm text-muted">No new reviews in this period.</p>;
    return <FeedbackChangesView days={days} onNavigate={onNavigate} />;
};

export default FeedbackChanges;
