import React, { useMemo } from 'react';
import type { IntelligenceSelfMetrics } from '@restropulse/shared';
import { StatCard } from '../primitives';
import { intensity } from '../theme';
import { ProvenanceChip } from './provenance';
import { resolveDeepLink, type DeepLinkTarget } from './deep-links';

/**
 * Your Metrics sub-tab (DESIGN §4.5) — internal analytics from /self-metrics
 * (events/orders, no new tracking): repeat rate, new-vs-returning revenue split,
 * AOV, the 7×24 peak-hours heatmap via intensity(), and cohort cross-links into
 * Campaigns. This absorbs the original Intelligence-v1 roadmap item.
 */

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
    <div className={`bg-surface rounded-2xl p-6 border border-line ${className}`}>{children}</div>
);

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

const YourMetrics: React.FC<{ metrics: IntelligenceSelfMetrics; onNavigate: (t: DeepLinkTarget) => void }> = ({ metrics, onNavigate }) => {
    const peakMax = useMemo(() => Math.max(1, ...metrics.peakHours.flat()), [metrics.peakHours]);
    const totalRevenue = metrics.revenue.newCustomer + metrics.revenue.returningCustomer;
    const returningShare = totalRevenue > 0 ? (metrics.revenue.returningCustomer / totalRevenue) * 100 : 0;

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-2">
                <ProvenanceChip provenance="measured" source="your orders" />
                <span className="text-xs text-muted">From your own RestroPulse orders &amp; events — not competitors.</span>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard label="Repeat rate" value={`${metrics.repeatRatePct.toFixed(0)}%`} delta={`${metrics.repeatCustomers} of ${metrics.totalCustomers} guests`} deltaTone="neutral" />
                <StatCard label="Avg order value" value={inr(metrics.avgOrderValue)} delta="per order" deltaTone="neutral" />
                <StatCard label="Orders" value={metrics.orderCount.toLocaleString('en-IN')} delta="completed" deltaTone="neutral" />
                <StatCard label="Returning revenue" value={`${returningShare.toFixed(0)}%`} delta="of total revenue" deltaTone={returningShare >= 50 ? 'up' : 'neutral'} />
            </div>

            {/* New vs returning revenue split */}
            <Card>
                <h3 className="text-base font-semibold text-ink mb-3">New vs returning revenue</h3>
                <div className="flex h-5 rounded-full overflow-hidden border border-line" role="img" aria-label="Revenue split">
                    <div style={{ width: `${100 - returningShare}%`, background: intensity(0.35) }} title={`New ${inr(metrics.revenue.newCustomer)}`} />
                    <div style={{ width: `${returningShare}%`, background: intensity(0.85) }} title={`Returning ${inr(metrics.revenue.returningCustomer)}`} />
                </div>
                <div className="flex items-center justify-between mt-2 text-xs text-muted">
                    <span>New · {inr(metrics.revenue.newCustomer)}</span>
                    <span>Returning · {inr(metrics.revenue.returningCustomer)}</span>
                </div>
            </Card>

            {/* Peak-hours heatmap 7×24 */}
            <Card>
                <h3 className="text-base font-semibold text-ink mb-1">Peak hours</h3>
                <p className="text-xs text-muted mb-3">When completed orders land, by weekday and hour.</p>
                <div className="overflow-x-auto no-scrollbar">
                    <div className="min-w-[560px]">
                        <div className="flex gap-1 pl-8 mb-1">
                            {Array.from({ length: 24 }).map((_, h) => (
                                <span key={h} className="w-4 text-center text-[8px] text-muted tabular-nums">{h % 6 === 0 ? h : ''}</span>
                            ))}
                        </div>
                        {metrics.peakHours.map((row, d) => (
                            <div key={d} className="flex gap-1 items-center mb-1">
                                <span className="w-7 text-[10px] text-muted font-semibold">{DAYS[d]}</span>
                                {row.map((count, h) => (
                                    <span
                                        key={h}
                                        className="w-4 h-4 rounded-sm"
                                        style={{ background: count === 0 ? undefined : intensity(count / peakMax), backgroundColor: count === 0 ? 'var(--color-canvas)' : undefined }}
                                        title={`${DAYS[d]} ${h}:00 — ${count} orders`}
                                    />
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            </Card>

            {/* Cohort cross-links into Campaigns */}
            {metrics.cohorts.length > 0 && (
                <Card>
                    <h3 className="text-base font-semibold text-ink mb-1">Win-back cohorts</h3>
                    <p className="text-xs text-muted mb-3">Slow Tuesdays? Turn a quiet cohort into a campaign.</p>
                    <div className="flex flex-wrap gap-2">
                        {metrics.cohorts.map((c) => (
                            <button
                                key={c.id}
                                type="button"
                                onClick={() => onNavigate(resolveDeepLink({ bucket: 'campaigns', params: { cohort: c.id } }))}
                                className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs font-medium text-ink hover:border-primary/40 hover:bg-primary-soft transition-colors"
                            >
                                {c.name}
                                <span className="text-muted tabular-nums">{c.count}</span>
                                <span className="text-primary-strong font-semibold">→ Launch offer</span>
                            </button>
                        ))}
                    </div>
                </Card>
            )}
        </div>
    );
};

export default YourMetrics;
