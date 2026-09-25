import React, { useEffect, useState } from 'react';
import { intelligenceAPI, type SnapshotSeriesPoint, type FeedbackDay } from '../../../../api';
import { ProvenanceChip } from '../provenance';
import { StatCard } from '../../primitives';

/**
 * "Yesterday" — the overnight numbers, at the top of My Restaurant · Overview.
 * The nightly check already records rating, reviews and photos; this is the
 * daily reason to open the app: what moved since the last time you looked, in
 * four tiles, with the new reviews split positive / negative. Honest when there
 * is nothing: "Nothing changed yesterday" is a real answer, and "no daily check
 * yet" is a different one.
 */

const POSITIVE_MIN = 4;
const NEGATIVE_MAX = 2;

const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

export const YesterdayView: React.FC<{
    last: SnapshotSeriesPoint | null;
    prev: SnapshotSeriesPoint | null;
    reviews: FeedbackDay | null;
}> = ({ last, prev, reviews }) => {
    if (!last) {
        return (
            <div className="bg-surface rounded-2xl p-4 sm:p-5 border border-line" data-testid="yesterday-empty">
                <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-ink">Yesterday</h3>
                    <ProvenanceChip provenance="measured" />
                </div>
                <p className="text-sm text-muted mt-1">
                    No daily check yet. Every night we note your Google rating, reviews and photos — from tomorrow this shows what moved overnight.
                </p>
            </div>
        );
    }

    const ratingDelta = prev ? Number((last.rating - prev.rating).toFixed(1)) : 0;
    const reviewsDelta = prev ? last.reviewCount - prev.reviewCount : last.newReviews;
    const photosDelta = prev ? last.photoCount - prev.photoCount : 0;
    const pos = reviews?.newReviews.filter((r) => r.rating >= POSITIVE_MIN).length ?? 0;
    const neg = reviews?.newReviews.filter((r) => r.rating <= NEGATIVE_MAX).length ?? 0;
    const nothing = ratingDelta === 0 && reviewsDelta === 0 && photosDelta === 0;
    const signed = (n: number, digits = 0) => `${n > 0 ? '+' : ''}${n.toFixed(digits)}`;

    return (
        <div className="bg-surface rounded-2xl p-4 sm:p-5 border border-line" data-testid="yesterday">
            <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-ink">Yesterday</h3>
                    <ProvenanceChip provenance="measured" />
                </div>
                <p className="text-xs text-muted">{last.date}</p>
            </div>
            {nothing ? (
                <p className="text-sm text-muted mt-2">Nothing changed overnight — rating {last.rating.toFixed(1)}, {last.reviewCount.toLocaleString('en-IN')} reviews, {last.photoCount.toLocaleString('en-IN')} photos.</p>
            ) : (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
                    <StatCard label="Rating" value={last.rating.toFixed(1)} delta={prev ? `${signed(ratingDelta, 1)} vs day before` : 'first check'} deltaTone={ratingDelta > 0 ? 'up' : ratingDelta < 0 ? 'down' : 'neutral'} />
                    <StatCard label="New reviews" value={String(Math.max(0, reviewsDelta))} delta={pos || neg ? `${pos} positive · ${neg} negative` : 'none overnight'} deltaTone={neg > 0 ? 'down' : pos > 0 ? 'up' : 'neutral'} />
                    <StatCard label="Total reviews" value={last.reviewCount.toLocaleString('en-IN')} delta={prev ? `${signed(reviewsDelta)} vs day before` : 'first check'} deltaTone={reviewsDelta > 0 ? 'up' : 'neutral'} />
                    <StatCard label="Photos" value={last.photoCount.toLocaleString('en-IN')} delta={prev ? `${signed(photosDelta)} vs day before` : 'first check'} deltaTone={photosDelta > 0 ? 'up' : 'neutral'} />
                </div>
            )}
        </div>
    );
};

/** Container: last two Google self checks + yesterday's review list. */
const Yesterday: React.FC = () => {
    const [state, setState] = useState<{ last: SnapshotSeriesPoint | null; prev: SnapshotSeriesPoint | null; reviews: FeedbackDay | null } | null>(null);
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const from = isoDaysAgo(3);
                const to = isoDaysAgo(0);
                const [series, fb] = await Promise.all([
                    intelligenceAPI.getSnapshots({ target: 'self', source: 'google', granularity: 'day', from, to }),
                    intelligenceAPI.getFeedbackChanges({ from, to }).catch(() => ({ days: [] as FeedbackDay[] })),
                ]);
                const pts = [...series.points].sort((a, b) => a.date.localeCompare(b.date));
                const last = pts[pts.length - 1] ?? null;
                const prev = pts.length >= 2 ? pts[pts.length - 2] : null;
                const reviews = last ? fb.days.find((d) => d.date === last.date) ?? null : null;
                if (!cancelled) setState({ last, prev, reviews });
            } catch {
                if (!cancelled) setState({ last: null, prev: null, reviews: null });
            }
        })();
        return () => { cancelled = true; };
    }, []);
    if (!state) return null;
    return <YesterdayView last={state.last} prev={state.prev} reviews={state.reviews} />;
};

export default Yesterday;
