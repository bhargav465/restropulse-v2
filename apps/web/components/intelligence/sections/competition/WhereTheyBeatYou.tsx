import React, { useEffect, useState } from 'react';
import type { CompareRow, MetricGap, CompetitorProfile, IntelligenceReport } from '@restropulse/shared';
import { intelligenceAPI } from '../../../../api';
import { ProvenanceChip } from '../provenance';
import { resolveDeepLink, SHOW_ACTION_CTAS, type DeepLinkTarget } from '../deep-links';

/**
 * WhereTheyBeatYou (Brief 09 §3) — one card per competitor with a non-empty
 * `beatsYou`. Deterministic `computed` gaps first (rating, review velocity,
 * response rate, photos), then the v1 `ai-inferred` whatTheyDoBetter/whereYouWin
 * lists. Cards are sorted by summed gap severity; each ends with a "Close this
 * gap →" deep link chosen by the top gap's type. A one-line verdict sits on top.
 */

/** Normalized per-gap severity so heterogeneous metrics sort sensibly. */
export function gapSeverity(gap: MetricGap): number {
    switch (gap.metric) {
        case 'rating':
            return gap.gap * 10;
        case 'reviewVelocity':
            return gap.gap * 2;
        case 'responseRate':
            return gap.gap * 0.2;
        case 'photoCount':
            return gap.gap * 0.05;
        case 'reviewCount':
            // Log-ish damping: a 10k-review lead should outrank a 200-photo lead
            // but not drown a 0.4 rating gap.
            return Math.min(8, Math.log10(Math.max(1, gap.gap)) * 2);
        default:
            return gap.gap;
    }
}

export function rowSeverity(row: CompareRow): number {
    return row.beatsYou.reduce((s, g) => s + gapSeverity(g), 0);
}

/** Deep-link bucket for the highest-severity gap type. */
function closeGapTarget(gaps: MetricGap[]): DeepLinkTarget {
    const top = [...gaps].sort((a, b) => gapSeverity(b) - gapSeverity(a))[0];
    switch (top?.metric) {
        case 'photoCount':
            return resolveDeepLink({ bucket: 'content', params: { brief: 'fresh-photos' } });
        case 'rating':
        case 'reviewVelocity':
        case 'responseRate':
        default:
            // Ratings, review pace and reply rate are all won in the reviews:
            // land on What guests say, where "Draft a reply" is one tap away.
            return resolveDeepLink({ bucket: 'get-started', params: { task: 'review-replies' } });
    }
}

const GAP_LABEL: Record<MetricGap['metric'], (g: MetricGap) => string> = {
    rating: (g) => `Rated ${g.theirs.toFixed(1)} vs your ${g.yours.toFixed(1)}`,
    reviewVelocity: (g) => `Getting ${(g.theirs / (g.yours || 1)).toFixed(1)}× more new reviews than you`,
    responseRate: (g) => `Replies to ${g.theirs}% of reviews vs your ${g.yours}%`,
    photoCount: (g) => `${g.gap.toLocaleString('en-IN')} more photos than you`,
    reviewCount: (g) => `${g.gap.toLocaleString('en-IN')} more reviews than you`,
};

/** What to DO about each gap — the insight is the instruction, not the number. */
const GAP_ADVICE: Record<MetricGap['metric'], string> = {
    rating: 'Reply to every low-star review this week — recovered guests update ratings more often than new ones.',
    reviewVelocity: 'Ask happy dine-in guests for a Google review at billing time; pace compounds into rank.',
    responseRate: 'Owners who reply look alive in search. Use “Draft a reply” on What guests say.',
    photoCount: 'Post 5 fresh dish photos this week — photos are the cheapest ranking signal you control.',
    reviewCount: 'You will not out-volume them quickly — win on rating and reply rate instead, and let photos carry discovery.',
};

const AiList: React.FC<{ title: string; items?: string[]; tone: 'good' | 'bad' }> = ({ title, items, tone }) => {
    if (!items || items.length === 0) return null;
    return (
        <div>
            <p className={`text-xs font-semibold uppercase tracking-wider mb-1 ${tone === 'good' ? 'text-success' : 'text-danger'}`}>{title}</p>
            <ul className="space-y-1">
                {items.map((it, i) => (
                    <li key={i} className="text-xs text-muted leading-relaxed">• {it}</li>
                ))}
            </ul>
        </div>
    );
};

/**
 * Day-0 rows built from the scan report itself (RP-004).
 *
 * The daily-check layer that normally feeds this tab is empty until the worker's
 * first nightly run, which used to make the tab say "no competitor is beating
 * you" on the very day the report said three of them were. The report already
 * carries today's rating and photo count for you and every nearby rival, so we
 * derive the same gap rows from it and label them as coming from the scan.
 * Review velocity / reply rate need history, so they only appear once the daily
 * checks exist.
 */
export function rowsFromReport(report: IntelligenceReport): CompareRow[] {
    // Union of both buckets + top threats, deduped — the widest set the report
    // carries, so the tab shows every nearby rival that beats you on anything.
    const seen = new Set<string>();
    const pool: CompetitorProfile[] = [];
    for (const c of [
        ...(report.buckets?.directTop10 ?? []),
        ...(report.buckets?.overallTop10 ?? []),
        ...(report.topCompetitors ?? []),
    ]) {
        if (seen.has(c.placeId)) continue;
        seen.add(c.placeId);
        pool.push(c);
    }
    const yoursRating = report.base.rating;
    const yoursPhotos = report.base.photoCount;
    const yoursReviews = report.base.totalRatings;
    return pool.map((c) => {
        const beatsYou: MetricGap[] = [];
        if (c.rating - yoursRating >= 0.1) {
            beatsYou.push({ metric: 'rating', source: 'google', yours: yoursRating, theirs: c.rating, gap: Number((c.rating - yoursRating).toFixed(1)) });
        }
        if (c.photoCount > yoursPhotos) {
            beatsYou.push({ metric: 'photoCount', source: 'google', yours: yoursPhotos, theirs: c.photoCount, gap: c.photoCount - yoursPhotos });
        }
        if (c.totalRatings > yoursReviews) {
            beatsYou.push({ metric: 'reviewCount', source: 'google', yours: yoursReviews, theirs: c.totalRatings, gap: c.totalRatings - yoursReviews });
        }
        return {
            placeId: c.placeId,
            name: c.name,
            isSelf: false,
            google: { rating: c.rating, reviewCount: c.totalRatings, newReviews: 0, photoCount: c.photoCount },
            beatsYou,
        };
    });
}

export const WhereTheyBeatYouView: React.FC<{
    rows: CompareRow[];
    profilesByName: Record<string, CompetitorProfile>;
    /** Your own measured numbers, for the side-by-side row on each card. */
    yours?: { rating: number; reviewCount: number; photoCount: number };
    onNavigate: (t: DeepLinkTarget) => void;
    /** 'daily' = from the nightly checks for this period; 'scan' = seeded from the latest report (day 0). */
    source?: 'daily' | 'scan';
}> = ({ rows, profilesByName, yours, onNavigate, source = 'daily' }) => {
    const cards = rows
        .filter((r) => !r.isSelf && r.beatsYou.length > 0)
        .sort((a, b) => rowSeverity(b) - rowSeverity(a));

    if (cards.length === 0) {
        // Two different truths that used to share one sentence: "we have data and
        // nobody is ahead" vs "we have no data for this period yet".
        if (rows.length === 0) {
            return (
                <div className="bg-surface rounded-2xl p-4 sm:p-6 border border-line" data-testid="wtby-no-data">
                    <p className="text-sm font-semibold text-ink">Nothing recorded for this period yet</p>
                    <p className="text-sm text-muted mt-1">
                        Every night we note the rating, reviews and photos of you and the rivals you track. Comparisons for this
                        period will appear once those checks exist — try “Overall”, or check back tomorrow.
                    </p>
                </div>
            );
        }
        return (
            <p className="text-sm text-muted" data-testid="wtby-no-gaps">
                None of these restaurants is ahead of you on rating, reviews, replies or photos right now. Keep it up.
            </p>
        );
    }

    return (
        <div className="space-y-4 sm:space-y-6">
            {source === 'scan' && (
                <p className="text-xs text-muted" data-testid="wtby-from-scan">
                    From your latest scan. Day-by-day comparisons — including who is gaining reviews faster and who replies more —
                    start after tonight’s first check.
                </p>
            )}
            {/* One-line verdict instead of the old bubble radar (which encoded the
                same information as unreadable dots): who is ahead, on what, in words. */}
            <div className="bg-surface rounded-2xl p-4 sm:p-6 border border-line" data-testid="wtby-summary">
                <p className="text-[15px] text-ink leading-relaxed">
                    <span className="font-semibold">{cards.length}</span> of the{' '}
                    <span className="font-semibold">{rows.filter((r) => !r.isSelf).length}</span> rivals we compared are ahead of you
                    on at least one measure.{' '}
                    {cards[0] && (
                        <>
                            The strongest is <span className="font-semibold">{cards[0].name}</span> —{' '}
                            {GAP_LABEL[[...cards[0].beatsYou].sort((a, b) => gapSeverity(b) - gapSeverity(a))[0].metric]([...cards[0].beatsYou].sort((a, b) => gapSeverity(b) - gapSeverity(a))[0]).toLowerCase()}.
                        </>
                    )}
                </p>
            </div>

            {cards.map((row) => {
                const profile = profilesByName[row.name];
                const target = closeGapTarget(row.beatsYou);
                const topGap = [...row.beatsYou].sort((a, b) => gapSeverity(b) - gapSeverity(a))[0];
                const theirs = row.google;
                return (
                    <div key={row.placeId} className="bg-surface rounded-2xl p-4 sm:p-6 border border-line">
                        <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                            <h3 className="text-lg font-semibold text-ink">{row.name}</h3>
                            <div className="flex items-center gap-2">
                                {profile && (
                                    <span className="text-xs text-muted">
                                        {profile.cuisine} · {profile.distanceKm.toFixed(1)} km from you
                                    </span>
                                )}
                                <ProvenanceChip provenance="computed" />
                            </div>
                        </div>
                        {/* Where they're ahead — one line each, plain words. */}
                        <ul className="mb-3 space-y-1">
                            {row.beatsYou.map((g, i) => (
                                <li key={i} className="text-sm text-ink flex items-start gap-2">
                                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-danger shrink-0" aria-hidden="true" />
                                    {GAP_LABEL[g.metric](g)}
                                </li>
                            ))}
                        </ul>
                        {/* The numbers, side by side — so "ahead" is inspectable. */}
                        {theirs && yours && (
                            <div className="mb-4 grid grid-cols-3 gap-2 rounded-xl border border-line overflow-hidden text-center" data-testid="wtby-numbers">
                                {(
                                    [
                                        { label: 'Rating', you: yours.rating.toFixed(1), them: theirs.rating.toFixed(1), worse: theirs.rating > yours.rating },
                                        { label: 'Reviews', you: yours.reviewCount.toLocaleString('en-IN'), them: theirs.reviewCount.toLocaleString('en-IN'), worse: theirs.reviewCount > yours.reviewCount },
                                        { label: 'Photos', you: yours.photoCount.toLocaleString('en-IN'), them: theirs.photoCount.toLocaleString('en-IN'), worse: theirs.photoCount > yours.photoCount },
                                    ] as const
                                ).map((m) => (
                                    <div key={m.label} className="py-2.5 px-2 border-r border-line last:border-r-0 bg-canvas/50">
                                        <p className="text-[11px] uppercase tracking-wider text-muted font-semibold">{m.label}</p>
                                        <p className="text-sm tabular-nums mt-1">
                                            <span className="text-ink font-semibold">{m.you}</span>
                                            <span className="text-muted mx-1.5">vs</span>
                                            <span className={m.worse ? 'text-danger font-semibold' : 'text-success font-semibold'}>{m.them}</span>
                                        </p>
                                    </div>
                                ))}
                            </div>
                        )}
                        {/* What to do about the biggest gap. */}
                        {topGap && (
                            <p className="mb-4 rounded-xl bg-primary-soft px-3 py-2.5 text-sm text-ink leading-relaxed" data-testid="wtby-advice">
                                <span className="font-semibold">Do this: </span>
                                {GAP_ADVICE[topGap.metric]}
                            </p>
                        )}
                        {/* v1 ai-inferred lists + pricing/marketing reads */}
                        {profile && (profile.whatTheyDoBetter || profile.whereYouWin || profile.pricingInsight || profile.marketingEdge) && (
                            <div className="rounded-xl bg-canvas p-4 mb-4 space-y-4">
                                <div className="grid sm:grid-cols-2 gap-4">
                                    <AiList title="What they do better" items={profile.whatTheyDoBetter} tone="bad" />
                                    <AiList title="Where you win" items={profile.whereYouWin} tone="good" />
                                </div>
                                {(profile.pricingInsight || profile.marketingEdge) && (
                                    <div className="grid sm:grid-cols-2 gap-4">
                                        {profile.pricingInsight && (
                                            <p className="text-sm text-ink leading-relaxed"><span className="font-semibold">Their pricing:</span> {profile.pricingInsight}</p>
                                        )}
                                        {profile.marketingEdge && (
                                            <p className="text-sm text-ink leading-relaxed"><span className="font-semibold">How they market:</span> {profile.marketingEdge}</p>
                                        )}
                                    </div>
                                )}
                                <ProvenanceChip provenance="ai-inferred" />
                            </div>
                        )}
                        {SHOW_ACTION_CTAS && (
                            <button
                                type="button"
                                onClick={() => onNavigate(target)}
                                title={target.href}
                                className="text-xs font-semibold text-primary-strong hover:underline"
                            >
                                Close this gap →
                            </button>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

/** Container: fetches compare rows for the period and joins the v1 report layer. */
/**
 * No period filter here (Bhargav, 20 Aug): "where they beat you" is a question
 * about NOW. Always fetch the current month's tracked data; the report seed
 * covers everything else.
 */
const WhereTheyBeatYou: React.FC<{
    report: IntelligenceReport | null;
    onNavigate: (t: DeepLinkTarget) => void;
}> = ({ report, onNavigate }) => {
    const [rows, setRows] = useState<CompareRow[] | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setRows(null);
            try {
                const month = new Date().toISOString().slice(0, 7);
                const data = await intelligenceAPI.getCompare({ granularity: 'month', month });
                if (!cancelled) setRows(data);
            } catch {
                if (!cancelled) setRows([]);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [report?._id]); // eslint-disable-line react-hooks/exhaustive-deps

    if (rows === null) return <p className="text-sm text-muted">Loading where they beat you…</p>;

    const profilesByName = report ? Object.fromEntries(report.competitors.map((c) => [c.name, c])) : {};
    const yours = report
        ? { rating: report.base.rating, reviewCount: report.base.totalRatings, photoCount: report.base.photoCount }
        : undefined;

    // Seed from the report whenever the daily layer would render ZERO gap cards
    // for this period — empty rows, self-only rows, or rival rows with no gaps.
    // The daily view only earns the tab once it can actually show something.
    const dailyGapCards = rows.filter((r) => !r.isSelf && (r.google || r.zomato) && r.beatsYou.length > 0);
    if (dailyGapCards.length === 0 && report) {
        return (
            <WhereTheyBeatYouView rows={rowsFromReport(report)} profilesByName={profilesByName} yours={yours} onNavigate={onNavigate} source="scan" />
        );
    }
    return <WhereTheyBeatYouView rows={rows} profilesByName={profilesByName} yours={yours} onNavigate={onNavigate} />;
};

export default WhereTheyBeatYou;
