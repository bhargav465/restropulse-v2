import React, { useMemo } from 'react';
import type { IntelligenceReport } from '@restropulse/shared';
import { StatCard } from '../primitives';
import { intensity } from '../theme';
import { ProvenanceChip } from './provenance';
import { resolveDeepLink, type DeepLinkTarget } from './deep-links';

/**
 * Reviews & Sentiment sub-tab (DESIGN §4.3) — rating vs area percentile, the
 * recent-reviews list (negatives flagged), per-competitor AI sentiment labels,
 * and a "reply weekly" CTA into the Get-started checklist.
 */

const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
    <div className={`bg-surface rounded-2xl p-6 border border-line ${className}`}>{children}</div>
);

const Stars: React.FC<{ rating: number }> = ({ rating }) => (
    <span className={`text-sm font-semibold tabular-nums ${rating <= 2 ? 'text-danger' : 'text-ink'}`} aria-label={`${rating} stars`}>
        {'★'.repeat(Math.round(rating))}
        <span className="text-line">{'★'.repeat(5 - Math.round(rating))}</span>
    </span>
);

const SENTIMENT_CLASS: Record<'Positive' | 'Negative' | 'Mixed', string> = {
    Positive: 'text-success',
    Negative: 'text-danger',
    Mixed: 'text-warning',
};

const Reviews: React.FC<{ report: IntelligenceReport; onNavigate: (t: DeepLinkTarget) => void }> = ({ report, onNavigate }) => {
    const areaAvg = useMemo(() => {
        const ratings = report.competitors.map((c) => c.rating);
        return ratings.length ? ratings.reduce((s, r) => s + r, 0) / ratings.length : report.base.rating;
    }, [report.competitors, report.base.rating]);

    const percentile = useMemo(() => {
        const all = report.competitors.map((c) => c.rating);
        if (!all.length) return 100;
        const below = all.filter((r) => r <= report.base.rating).length;
        return Math.round((below / all.length) * 100);
    }, [report.competitors, report.base.rating]);

    // Recent-review rating distribution (5→1) for the sparkline.
    const dist = useMemo(() => {
        const buckets = [0, 0, 0, 0, 0]; // index 0 = 1★ … 4 = 5★
        for (const r of report.base.recentReviews) buckets[Math.min(4, Math.max(0, Math.round(r.rating) - 1))] += 1;
        return buckets;
    }, [report.base.recentReviews]);
    const distMax = Math.max(1, ...dist);

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                <StatCard label="Your rating" value={`★ ${report.base.rating.toFixed(1)}`} delta={`Area avg ★ ${areaAvg.toFixed(1)}`} deltaTone={report.base.rating >= areaAvg ? 'up' : 'down'} />
                <StatCard label="Area percentile" value={`${percentile}th`} delta={`of ${report.competitors.length} nearby`} deltaTone="neutral" />
                <StatCard label="Total reviews" value={report.base.totalRatings.toLocaleString('en-IN')} delta="on Google" deltaTone="neutral" />
            </div>

            <Card>
                <div className="flex items-center justify-between gap-2 mb-3">
                    <h3 className="text-base font-semibold text-ink">Recent review ratings</h3>
                    <ProvenanceChip provenance="measured" source="Google" />
                </div>
                <div className="flex items-end gap-2 h-20" role="img" aria-label="Recent rating distribution">
                    {dist.map((count, i) => (
                        <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1">
                            <div className="w-full rounded-t" style={{ height: `${(count / distMax) * 100}%`, minHeight: count ? 4 : 0, background: intensity((i + 1) / 5) }} />
                            <span className="text-[10px] text-muted">{i + 1}★</span>
                        </div>
                    ))}
                </div>
            </Card>

            <Card>
                <h3 className="text-base font-semibold text-ink mb-3">Recent reviews</h3>
                <ul className="space-y-3">
                    {report.base.recentReviews.map((r, i) => (
                        <li key={i} className="border-b border-line last:border-b-0 pb-3 last:pb-0">
                            <div className="flex items-center justify-between gap-2">
                                <Stars rating={r.rating} />
                                <span className="text-[11px] text-muted">{new Date(r.time).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
                            </div>
                            <p className={`text-sm mt-1 leading-relaxed ${r.rating <= 2 ? 'text-danger' : 'text-muted'}`}>{r.text}</p>
                        </li>
                    ))}
                </ul>
            </Card>

            <Card>
                <div className="flex items-center justify-between gap-2 mb-3">
                    <h3 className="text-base font-semibold text-ink">Competitor sentiment</h3>
                    <ProvenanceChip provenance="ai-inferred" />
                </div>
                <div className="flex flex-wrap gap-2">
                    {report.topCompetitors.filter((c) => c.sentimentLabel).map((c) => (
                        <div key={c.placeId} className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-1.5">
                            <span className="text-xs text-ink font-medium">{c.name}</span>
                            <span className={`text-xs font-semibold ${SENTIMENT_CLASS[c.sentimentLabel!]}`}>{c.sentimentLabel}</span>
                        </div>
                    ))}
                </div>
            </Card>

            {/* CTA into Get-started */}
            <div className="bg-surface rounded-2xl p-6 border border-line border-l-[3px] border-l-primary flex items-center justify-between gap-4 flex-wrap">
                <div>
                    <h3 className="text-sm font-semibold text-ink">Reply to reviews weekly</h3>
                    <p className="text-xs text-muted mt-1">Owner replies lift trust and local ranking signals.</p>
                </div>
                <button
                    type="button"
                    onClick={() => onNavigate(resolveDeepLink({ bucket: 'get-started', params: { task: 'review-replies' } }))}
                    className="px-4 py-2 rounded-lg bg-primary-strong text-white text-sm font-semibold hover:opacity-90 transition-opacity whitespace-nowrap"
                >
                    Open Get started →
                </button>
            </div>
        </div>
    );
};

export default Reviews;
