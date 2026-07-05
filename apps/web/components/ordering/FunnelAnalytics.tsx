import React, { useCallback, useEffect, useState } from 'react';
import { orderingAdminAPI, OrderingAnalyticsSummary } from '../../api';
import { PanelLoading, PanelError, PanelEmpty } from './PanelStates';

/** Ordered storefront funnel steps (event names emitted by apps/storefront). */
const FUNNEL_STEPS: Array<{ name: string; label: string }> = [
    { name: 'menu_view', label: 'Menu viewed' },
    { name: 'item_view', label: 'Item viewed' },
    { name: 'add_to_cart', label: 'Added to cart' },
    { name: 'begin_checkout', label: 'Checkout started' },
    { name: 'login_prompt', label: 'Login prompted' },
    { name: 'order_placed', label: 'Order placed' },
];

function daysAgoISO(days: number): string {
    const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const FunnelAnalytics: React.FC = () => {
    const [from, setFrom] = useState(daysAgoISO(7));
    const [to, setTo] = useState(daysAgoISO(0));
    const [summary, setSummary] = useState<OrderingAnalyticsSummary | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async (fromDate: string, toDate: string) => {
        setSummary(null);
        setError(null);
        try {
            // Send the end of the "to" day so the range is inclusive.
            setSummary(await orderingAdminAPI.getAnalyticsSummary(new Date(`${fromDate}T00:00:00`).toISOString(), new Date(`${toDate}T23:59:59.999`).toISOString()));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load analytics');
        }
    }, []);

    useEffect(() => { load(from, to); }, [load, from, to]);

    const countByName = new Map((summary?.events ?? []).map((e) => [e.name, e]));
    const steps = FUNNEL_STEPS.map((step) => ({ ...step, ...(countByName.get(step.name) ?? { count: 0, uniqueSessions: 0 }) }));
    const maxCount = Math.max(...steps.map((s) => s.count), 1);
    const hasData = steps.some((s) => s.count > 0);

    return (
        <div className="space-y-4">
            {/* Date range picker */}
            <div className="flex items-center gap-2">
                <label htmlFor="funnel-from" className="text-xs font-bold text-slate-500 uppercase tracking-wide">From</label>
                <input id="funnel-from" type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium text-slate-700" />
                <label htmlFor="funnel-to" className="text-xs font-bold text-slate-500 uppercase tracking-wide">To</label>
                <input id="funnel-to" type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium text-slate-700" />
            </div>

            {error ? (
                <PanelError message={error} onRetry={() => load(from, to)} />
            ) : summary === null ? (
                <PanelLoading label="Loading funnel…" />
            ) : !hasData ? (
                <PanelEmpty title="No events in this range" hint="Storefront activity will show up here as customers browse and order." />
            ) : (
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-3">
                    {steps.map((step, i) => {
                        const prev = i > 0 ? steps[i - 1].count : null;
                        const conversion = prev && prev > 0 ? Math.round((step.count / prev) * 100) : null;
                        return (
                            <div key={step.name}>
                                <div className="flex items-baseline justify-between mb-1">
                                    <p className="text-xs font-bold text-slate-700">{step.label}</p>
                                    <p className="text-xs text-slate-500 font-medium">
                                        <span className="font-extrabold text-slate-800">{step.count}</span>
                                        {' '}· {step.uniqueSessions} sessions
                                        {conversion !== null && <span className="text-slate-400"> · {conversion}% of prev</span>}
                                    </p>
                                </div>
                                <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-gradient-to-r from-orange-500 to-red-500 rounded-full transition-all"
                                        style={{ width: `${Math.max((step.count / maxCount) * 100, step.count > 0 ? 2 : 0)}%` }}
                                        role="img"
                                        aria-label={`${step.label}: ${step.count} events`}
                                    ></div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default FunnelAnalytics;
