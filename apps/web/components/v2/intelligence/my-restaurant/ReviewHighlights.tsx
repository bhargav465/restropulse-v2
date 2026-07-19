import React, { useEffect, useMemo, useState } from 'react';
import type { IntelligenceReport } from '@restropulse/shared';
import { intelligenceAPI } from '../../../../api';

/**
 * Top Comments — three plain columns for restaurant owners:
 *   1. Top positive Google comments (4★+)
 *   2. Top negative comments (3★ and below)
 *   3. Everything from the last 7 days
 *
 * Sources: daily-snapshot new reviews (accumulated by the 9 AM cron) via
 * /feedback-changes, merged with the scan report's recentReviews so the view
 * is useful from day one, before snapshot history builds up.
 */

interface CommentRow {
    rating: number;
    text: string;
    author?: string;
    date?: string;   // YYYY-MM-DD when known (snapshot days)
    time?: string;   // relative/ISO from the source
}

const dayMs = 24 * 60 * 60 * 1000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

const Star: React.FC<{ rating: number }> = ({ rating }) => (
    <span className={`text-xs font-bold tabular-nums ${rating >= 4 ? 'text-emerald-600' : rating <= 2 ? 'text-red-500' : 'text-amber-500'}`}>
        ★ {rating.toFixed(0)}
    </span>
);

const CommentCard: React.FC<{ c: CommentRow }> = ({ c }) => (
    <li className="rounded-xl border border-line bg-primary-soft/30 p-3 space-y-1">
        <div className="flex items-center justify-between gap-2">
            <Star rating={c.rating} />
            <span className="text-[11px] text-muted">{c.date ?? c.time ?? ''}</span>
        </div>
        <p className="text-sm text-ink leading-snug">{c.text || <span className="text-muted italic">Rating only — no comment</span>}</p>
        {c.author && <p className="text-[11px] text-muted">— {c.author}</p>}
    </li>
);

const Column: React.FC<{ title: string; tone: 'up' | 'down' | 'neutral'; items: CommentRow[]; empty: string }> = ({ title, tone, items, empty }) => (
    <div className="rounded-2xl border border-line bg-surface p-4">
        <h4 className={`text-sm font-bold mb-3 ${tone === 'up' ? 'text-emerald-600' : tone === 'down' ? 'text-red-500' : 'text-ink'}`}>{title}</h4>
        {items.length === 0
            ? <p className="text-xs text-muted">{empty}</p>
            : <ul className="space-y-2">{items.map((c, i) => <CommentCard key={i} c={c} />)}</ul>}
    </div>
);

const ReviewHighlights: React.FC<{ report: IntelligenceReport }> = ({ report }) => {
    const [rows, setRows] = useState<CommentRow[] | null>(null);

    useEffect(() => {
        let cancelled = false;
        const from = iso(new Date(Date.now() - 90 * dayMs));
        intelligenceAPI.getFeedbackChanges({ from })
            .then((res) => {
                if (cancelled) return;
                const collected: CommentRow[] = [];
                for (const day of res.days ?? []) {
                    for (const r of day.newReviews ?? []) {
                        collected.push({ rating: r.rating, text: r.text, author: r.author, date: day.date, time: r.time });
                    }
                }
                setRows(collected);
            })
            .catch(() => { if (!cancelled) setRows([]); });
        return () => { cancelled = true; };
    }, []);

    const merged = useMemo(() => {
        const fromSnapshots = rows ?? [];
        const seen = new Set(fromSnapshots.map((r) => r.text.trim()));
        const fromReport: CommentRow[] = (report.base.recentReviews ?? [])
            .filter((r) => !seen.has((r.text ?? '').trim()))
            .map((r) => ({ rating: r.rating, text: r.text, time: r.time }));
        return [...fromSnapshots, ...fromReport];
    }, [rows, report]);

    const positives = useMemo(
        () => merged.filter((r) => r.rating >= 4 && r.text?.trim()).sort((a, b) => b.rating - a.rating || b.text.length - a.text.length).slice(0, 5),
        [merged],
    );
    const negatives = useMemo(
        () => merged.filter((r) => r.rating <= 3 && r.text?.trim()).sort((a, b) => a.rating - b.rating || b.text.length - a.text.length).slice(0, 5),
        [merged],
    );
    const last7 = useMemo(() => {
        const cutoff = iso(new Date(Date.now() - 7 * dayMs));
        return (rows ?? []).filter((r) => r.date && r.date >= cutoff).slice(0, 10);
    }, [rows]);

    return (
        <div className="space-y-4">
            <p className="text-xs text-muted leading-relaxed">
                Pulled from your Google reviews. New comments are captured automatically every day,
                so the “Last 7 days” column fills up as history builds.
            </p>
            <div className="grid gap-4 md:grid-cols-3">
                <Column title="Top positive comments" tone="up" items={positives} empty="No 4★+ comments captured yet." />
                <Column title="Top negative comments" tone="down" items={negatives} empty="No negative comments — nice!" />
                <Column title="Last 7 days" tone="neutral" items={last7} empty="No new comments in the last 7 days (history builds daily)." />
            </div>
        </div>
    );
};

export default ReviewHighlights;
