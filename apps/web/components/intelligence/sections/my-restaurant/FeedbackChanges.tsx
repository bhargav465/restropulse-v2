import React, { useEffect, useMemo, useState } from 'react';
import { REVIEW_THEMES, type ReviewTheme, type IntelligenceReport } from '@restropulse/shared';
import { intelligenceAPI, type FeedbackDay, type FeedbackReview } from '../../../../api';
import type { PeriodQuery } from '../period';
import type { DeepLinkTarget } from '../deep-links';
import { ProvenanceChip } from '../provenance';
import { track } from '../track';

/**
 * FeedbackChanges (Brief 09 §2) — the self-only "what changed" feed. Day-grouped
 * new-review cards with source chips and theme hashtag chips (clicking a chip
 * filters the feed). A theme trending negative over the last 7 days raises a
 * `border-danger` alert card. "Rating changed" rows carry a cause hint, and each
 * review has a "Reply now" deep link into the Get-started task.
 */

const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
    <div className={`bg-surface rounded-2xl p-4 sm:p-6 border border-line ${className}`}>{children}</div>
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

/**
 * One review + "Draft a reply". The reply is drafted by Claude (draft-only, the
 * owner copies it to Google), which is the one-tap follow-through for the
 * "negative review" nudge. Once Google Business Profile connect exists this
 * becomes "post reply".
 */
export const ReviewCard: React.FC<{ review: FeedbackReview }> = ({ review: r }) => {
    const [state, setState] = useState<{ status: 'idle' | 'loading' | 'ready' | 'error'; reply?: string; stance?: string; error?: string }>({ status: 'idle' });
    const [copied, setCopied] = useState(false);

    const draft = async () => {
        setState({ status: 'loading' });
        try {
            const out = await intelligenceAPI.draftReply({ text: r.text, rating: r.rating, ...(r.author ? { author: r.author } : {}) });
            setState({ status: 'ready', reply: out.reply, stance: out.stance });
            track.replyDrafted({ rating: r.rating, stance: out.stance, ok: true });
        } catch (e) {
            setState({ status: 'error', error: e instanceof Error ? e.message : 'Could not draft a reply right now.' });
            track.replyDrafted({ rating: r.rating, ok: false });
        }
    };
    const copy = async () => {
        if (!state.reply) return;
        try {
            await navigator.clipboard.writeText(state.reply);
            setCopied(true);
            track.replyCopied({ rating: r.rating });
            setTimeout(() => setCopied(false), 1500);
        } catch {
            /* clipboard blocked — the textarea is selectable */
        }
    };

    return (
        <div className="rounded-xl border border-line p-4 bg-surface" data-testid="review-card">
            <div className="flex items-center gap-2 flex-wrap">
                <Stars n={r.rating} />
                <SourceChip source={r.source} />
                {(r.themes ?? []).map((t) => (
                    <span key={t} className="text-[10px] text-muted">#{t}</span>
                ))}
                {state.status !== 'ready' && (
                    <button
                        type="button"
                        onClick={draft}
                        disabled={state.status === 'loading'}
                        className="ml-auto text-xs font-semibold text-primary-strong hover:underline disabled:opacity-60"
                    >
                        {state.status === 'loading' ? 'Drafting…' : r.rating <= 2 ? 'Draft a reply →' : 'Draft a thank-you →'}
                    </button>
                )}
            </div>
            <p className="text-sm text-ink mt-2 leading-relaxed">{r.text}</p>

            {state.status === 'error' && <p className="text-xs text-danger mt-2">{state.error}</p>}

            {state.status === 'ready' && state.reply && (
                <div className="mt-3 rounded-xl bg-canvas p-3" data-testid="reply-draft">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                            Suggested reply{state.stance ? ` · ${state.stance}` : ''}
                        </p>
                        <ProvenanceChip provenance="ai-inferred" />
                    </div>
                    <textarea
                        className="w-full rounded-lg border border-line bg-surface p-2.5 text-sm text-ink leading-relaxed"
                        rows={4}
                        value={state.reply}
                        onChange={(e) => setState((s) => ({ ...s, reply: e.target.value }))}
                        aria-label="Suggested reply — edit before you post it"
                    />
                    <div className="flex items-center gap-3 mt-2 flex-wrap">
                        <button type="button" onClick={copy} className="rounded-lg bg-primary-strong text-white px-3 py-1.5 text-xs font-semibold hover:opacity-90">
                            {copied ? 'Copied' : 'Copy reply'}
                        </button>
                        <button type="button" onClick={draft} className="text-xs font-semibold text-primary-strong hover:underline">
                            Try another
                        </button>
                        <span className="text-[11px] text-muted">Edit it so it sounds like you, then paste it on Google.</span>
                    </div>
                </div>
            )}
        </div>
    );
};

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

type SentimentFilter = 'all' | 'positive' | 'negative';

/** "What changed" summary for the trailing few days of the feed. */
export function lastDaysSummary(days: FeedbackDay[], window = 3): {
    total: number; positive: number; negative: number;
    ratingFrom: number | null; ratingTo: number | null;
    themesUp: ReviewTheme[];
} {
    const recent = [...days].sort((a, b) => b.date.localeCompare(a.date)).slice(0, window);
    let total = 0, positive = 0, negative = 0;
    const themeCounts = new Map<ReviewTheme, number>();
    for (const d of recent) {
        for (const r of d.newReviews) {
            total++;
            if (r.rating >= 4) positive++;
            if (r.rating <= 2) negative++;
            for (const t of r.themes ?? []) themeCounts.set(t, (themeCounts.get(t) ?? 0) + 1);
        }
    }
    const oldest = recent[recent.length - 1];
    const newest = recent[0];
    return {
        total, positive, negative,
        ratingFrom: oldest?.ratingBefore ?? null,
        ratingTo: newest?.ratingAfter ?? null,
        themesUp: [...themeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t),
    };
}

export const FeedbackChangesView: React.FC<{
    days: FeedbackDay[];
    onNavigate: (t: DeepLinkTarget) => void;
}> = ({ days, onNavigate }) => {
    const [activeTheme, setActiveTheme] = useState<ReviewTheme | null>(null);
    const [sentiment, setSentiment] = useState<SentimentFilter>('all');

    const sortedDays = useMemo(() => [...days].sort((a, b) => b.date.localeCompare(a.date)), [days]);
    const summary = useMemo(() => lastDaysSummary(days), [days]);

    // Which themes appear anywhere in the feed (drives the chip row).
    const presentThemes = useMemo(() => {
        const set = new Set<ReviewTheme>();
        for (const d of days) for (const r of d.newReviews) for (const t of r.themes ?? []) set.add(t);
        return REVIEW_THEMES.filter((t) => set.has(t));
    }, [days]);

    const negatives = useMemo(() => negativeTrendingThemes(days), [days]);

    const filtered = (reviews: FeedbackReview[]) => {
        let out = activeTheme ? reviews.filter((r) => (r.themes ?? []).includes(activeTheme)) : reviews;
        if (sentiment === 'positive') out = out.filter((r) => r.rating >= 4);
        if (sentiment === 'negative') out = out.filter((r) => r.rating <= 2);
        return out;
    };

    return (
        <div className="space-y-4 sm:space-y-6">
            {/* What changed in the last few days — the strip that answers the daily
                question before the owner reads a single review. */}
            {summary.total > 0 && (
                <div className="bg-surface rounded-2xl p-4 sm:p-5 border border-line" data-testid="what-changed-strip">
                    <p className="text-[15px] text-ink leading-relaxed">
                        <span className="font-semibold">Last few days:</span>{' '}
                        {summary.total} new review{summary.total === 1 ? '' : 's'} —{' '}
                        <span className="text-success font-semibold">{summary.positive} positive</span>,{' '}
                        <span className="text-danger font-semibold">{summary.negative} negative</span>
                        {summary.ratingFrom !== null && summary.ratingTo !== null && summary.ratingFrom !== summary.ratingTo && (
                            <> · rating {summary.ratingFrom.toFixed(1)} → <span className={summary.ratingTo < summary.ratingFrom ? 'text-danger font-semibold' : 'text-success font-semibold'}>{summary.ratingTo.toFixed(1)}</span></>
                        )}
                        {summary.themesUp.length > 0 && (
                            <> · guests talking about {summary.themesUp.map((t) => `#${t}`).join(', ')}</>
                        )}
                        .
                    </p>
                </div>
            )}
            {/* Negative-trend alert */}
            {negatives.length > 0 && (
                <div className="bg-surface rounded-2xl p-5 border border-line border-l-[3px] border-l-danger" data-testid="negative-trend-alert">
                    <h3 className="text-sm font-semibold text-danger">Reviews are turning negative</h3>
                    <p className="text-sm text-muted mt-1">
                        {negatives.map((t) => `#${t}`).join(', ')} mentioned in multiple low-star reviews this week. Reply and address it before it drags your rating.
                    </p>
                    <p className="mt-2 text-xs text-muted">Use “Draft a reply” on the low-star reviews below — replying quickly is what turns this around.</p>
                </div>
            )}

            {/* Theme filter chips */}
            <Card>
                <div className="flex items-center justify-between gap-2 mb-3">
                    <h3 className="text-base font-semibold text-ink">What guests are talking about</h3>
                    <ProvenanceChip provenance="ai-inferred" />
                </div>
                {/* Positive / negative first — the split the owner filters by most. */}
                <div className="flex flex-wrap gap-2 mb-2" role="group" aria-label="Filter by sentiment">
                    {([
                        { id: 'all', label: 'All' },
                        { id: 'positive', label: 'Where you shine' },
                        { id: 'negative', label: 'Where it hurts' },
                    ] as const).map((f) => (
                        <button
                            key={f.id}
                            type="button"
                            aria-pressed={sentiment === f.id}
                            onClick={() => setSentiment(f.id)}
                            className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                                sentiment === f.id
                                    ? f.id === 'negative' ? 'bg-danger text-white border-danger' : f.id === 'positive' ? 'bg-success text-white border-success' : 'bg-primary text-white border-primary'
                                    : 'border-line text-ink hover:bg-primary-soft'
                            }`}
                        >
                            {f.label}
                        </button>
                    ))}
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
                            <ReviewCard key={`${day.date}-${i}`} review={r} />
                        ))}
                    </div>
                );
            })}
        </div>
    );
};

/** Container: fetches the self feedback feed for the current window. */
const FeedbackChanges: React.FC<{ query: PeriodQuery; report?: IntelligenceReport | null; onNavigate: (t: DeepLinkTarget) => void }> = ({ query, report, onNavigate }) => {
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

    if (days === null) return <p className="text-sm text-muted">Loading recent reviews…</p>;

    // Day 0: the nightly checks haven't run yet, but the scan itself carries the
    // latest Google reviews — show those (Draft-a-reply works on them too)
    // rather than a blank tab.
    if (days.length === 0) {
        const recent = report?.base.recentReviews ?? [];
        if (recent.length === 0) {
            return <p className="text-sm text-muted">No new reviews in this period.</p>;
        }
        return (
            <div className="space-y-3" data-testid="feedback-from-scan">
                <p className="text-xs text-muted">
                    From your latest scan — your most recent Google reviews. Day-by-day tracking of what changed starts after
                    tonight’s first check.
                </p>
                {recent.map((r, i) => (
                    <ReviewCard key={i} review={{ rating: r.rating, text: r.text, time: r.time, source: 'google' }} />
                ))}
            </div>
        );
    }
    return <FeedbackChangesView days={days} onNavigate={onNavigate} />;
};

export default FeedbackChanges;
