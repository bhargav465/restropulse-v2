import React, { useEffect, useMemo, useState } from 'react';
import { Restaurant, Order, Reservation, Post } from '@restropulse/shared';
import { orderingAdminAPI, postsAPI } from '../../api';
import { StatCard } from './primitives';
import { TOKENS } from './theme';

/**
 * Dashboard bucket — the default v2 landing page (design.md §4.2). Four KPIs,
 * a "Today" panel, a 7-day CSS/SVG sparkline and a "Needs attention" list,
 * all from existing demo APIs (getOrders / getReservations / getAnalyticsSummary
 * / postsAPI.getAll). Renders cleanly with empty data.
 */

interface DashboardV2Props {
    restaurantData: Restaurant;
    onNavigate: (bucket: 'CONTENT' | 'ORDERING') => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_ORDER_STATES = new Set(['RECEIVED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY']);

/** Inline SVG sparkline — primary stroke over a soft area fill. */
const Sparkline: React.FC<{ points: number[] }> = ({ points }) => {
    const w = 280;
    const h = 64;
    const max = Math.max(1, ...points);
    const step = points.length > 1 ? w / (points.length - 1) : w;
    const coords = points.map((v, i) => [i * step, h - (v / max) * (h - 8) - 4] as const);
    const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const area = `${line} L${w},${h} L0,${h} Z`;
    return (
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-16" preserveAspectRatio="none" role="img" aria-label="Orders over the last 7 days">
            <path d={area} fill={TOKENS.primarySoft} opacity={0.7} />
            <path d={line} fill="none" stroke={TOKENS.primary} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            {coords.length > 0 && (
                <circle cx={coords[coords.length - 1][0]} cy={coords[coords.length - 1][1]} r={3} fill={TOKENS.primaryStrong} />
            )}
        </svg>
    );
};

const DashboardV2: React.FC<DashboardV2Props> = ({ restaurantData, onNavigate }) => {
    const [orders, setOrders] = useState<Order[]>([]);
    const [reservations, setReservations] = useState<Reservation[]>([]);
    const [posts, setPosts] = useState<Post[]>([]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const data = await orderingAdminAPI.getOrders();
                if (!cancelled) setOrders(data);
            } catch { /* empty */ }
            try {
                const data = await orderingAdminAPI.getReservations();
                if (!cancelled) setReservations(data);
            } catch { /* empty */ }
            try {
                const data = await postsAPI.getAll();
                if (!cancelled) setPosts(data);
            } catch { /* empty */ }
        })();
        return () => { cancelled = true; };
    }, []);

    const stats = useMemo(() => {
        const now = Date.now();
        const live = orders.filter((o) => o.status !== 'CANCELLED');
        const todays = live.filter((o) => now - new Date(o.createdAt).getTime() < DAY_MS);
        const revenueToday = todays.reduce((sum, o) => sum + (o.totals?.total ?? 0), 0);
        const avgOrder = todays.length > 0 ? revenueToday / todays.length : 0;
        const pendingReservations = reservations.filter((r) => r.status === 'pending').length;
        const pendingPosts = posts.filter((p) => p.status === 'PENDING_APPROVAL' || p.status === 'CHANGES_REQUESTED').length;
        const activeOrders = live.filter((o) => ACTIVE_ORDER_STATES.has(o.status)).length;

        // 7-day orders-per-day series (oldest → newest).
        const series: number[] = [];
        for (let d = 6; d >= 0; d--) {
            const dayStart = now - (d + 1) * DAY_MS;
            const dayEnd = now - d * DAY_MS;
            series.push(live.filter((o) => {
                const t = new Date(o.createdAt).getTime();
                return t >= dayStart && t < dayEnd;
            }).length);
        }

        return { todays: todays.length, revenueToday, avgOrder, pendingReservations, pendingPosts, activeOrders, series };
    }, [orders, reservations, posts]);

    const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

    const attention: Array<{ text: string; bucket: 'CONTENT' | 'ORDERING' }> = [];
    if (stats.pendingPosts > 0) attention.push({ text: `${stats.pendingPosts} post${stats.pendingPosts > 1 ? 's' : ''} waiting for your approval`, bucket: 'CONTENT' });
    if (stats.pendingReservations > 0) attention.push({ text: `${stats.pendingReservations} reservation${stats.pendingReservations > 1 ? 's' : ''} awaiting a decision`, bucket: 'ORDERING' });
    if (stats.activeOrders > 0) attention.push({ text: `${stats.activeOrders} order${stats.activeOrders > 1 ? 's' : ''} in the kitchen right now`, bucket: 'ORDERING' });
    if (restaurantData.storeOpen === false) attention.push({ text: 'Your store is currently closed for orders', bucket: 'ORDERING' });

    return (
        <div className="space-y-8">
            {/* Section intro */}
            <div>
                <h3 className="text-lg sm:text-xl font-bold text-ink tracking-tight flex items-center gap-2">
                    Your business at a glance
                    <span aria-hidden="true">✨</span>
                </h3>
                <p className="text-sm text-muted mt-1 leading-relaxed">
                    A live snapshot of today across orders, revenue and anything waiting on you.
                </p>
            </div>

            {/* KPI row */}
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                <StatCard label="Orders today" value={stats.todays} delta="▲ 12% vs last week" />
                <StatCard label="Revenue today" value={inr(stats.revenueToday)} delta="▲ 8% vs last week" />
                <StatCard
                    label="Pending reservations"
                    value={stats.pendingReservations}
                    delta={stats.pendingReservations > 0 ? 'awaiting a decision' : 'all handled'}
                    deltaTone={stats.pendingReservations > 0 ? 'down' : 'up'}
                />
                <StatCard
                    label="Posts to approve"
                    value={stats.pendingPosts}
                    delta={stats.pendingPosts > 0 ? 'needs your review' : 'all clear'}
                    deltaTone={stats.pendingPosts > 0 ? 'down' : 'up'}
                />
            </div>

            <div className="grid lg:grid-cols-3 gap-5">
                {/* Today panel */}
                <div className="bg-surface rounded-3xl p-6 border border-line">
                    <p className="flex items-center gap-2 text-xs font-bold text-primary-strong uppercase tracking-widest">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary-strong" aria-hidden="true" />
                        Today
                    </p>
                    <dl className="mt-5 space-y-4">
                        <div className="flex items-center justify-between">
                            <dt className="text-sm text-muted">Orders</dt>
                            <dd className="text-base font-semibold text-ink tabular-nums">{stats.todays}</dd>
                        </div>
                        <div className="h-px bg-line" />
                        <div className="flex items-center justify-between">
                            <dt className="text-sm text-muted">Revenue</dt>
                            <dd className="text-base font-semibold text-ink tabular-nums">{inr(stats.revenueToday)}</dd>
                        </div>
                        <div className="h-px bg-line" />
                        <div className="flex items-center justify-between">
                            <dt className="text-sm text-muted">Avg. order value</dt>
                            <dd className="text-base font-semibold text-ink tabular-nums">{inr(stats.avgOrder)}</dd>
                        </div>
                    </dl>
                </div>

                {/* 7-day sparkline */}
                <div className="bg-surface rounded-3xl p-6 border border-line lg:col-span-2 flex flex-col">
                    <div className="flex items-center justify-between gap-4">
                        <p className="flex items-center gap-2 text-xs font-bold text-primary-strong uppercase tracking-widest">
                            <span className="w-1.5 h-1.5 rounded-full bg-primary-strong" aria-hidden="true" />
                            Orders · last 7 days
                        </p>
                        <p className="text-sm font-semibold text-ink tabular-nums">
                            {stats.series.reduce((a, b) => a + b, 0)} <span className="text-muted font-medium">total</span>
                        </p>
                    </div>
                    <div className="mt-auto pt-6">
                        <Sparkline points={stats.series} />
                    </div>
                </div>
            </div>

            {/* Needs attention */}
            <div className="bg-surface rounded-3xl p-6 border border-line">
                <h3 className="text-base font-bold text-ink flex items-center gap-2">
                    Needs attention
                    {attention.length > 0 && (
                        <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-warning/15 text-warning text-xs font-bold tabular-nums">
                            {attention.length}
                        </span>
                    )}
                </h3>
                {attention.length === 0 ? (
                    <p className="flex items-center gap-2 text-sm text-muted mt-4">
                        <span className="w-5 h-5 rounded-full bg-success/15 text-success flex items-center justify-center text-xs" aria-hidden="true">✓</span>
                        Nothing urgent — you're all caught up.
                    </p>
                ) : (
                    <ul className="mt-3 space-y-1">
                        {attention.map((a, i) => (
                            <li key={i}>
                                <div className="flex items-start justify-between gap-4 py-2.5 px-3 -mx-3 rounded-xl hover:bg-primary-soft/40 transition-colors">
                                    <span className="flex items-start gap-2.5 text-sm text-ink min-w-0">
                                        <span className="w-1.5 h-1.5 rounded-full bg-warning shrink-0 mt-1.5" aria-hidden="true" />
                                        {a.text}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => onNavigate(a.bucket)}
                                        className="shrink-0 px-3 py-1 rounded-lg text-xs font-semibold text-primary-strong bg-primary-soft hover:bg-primary hover:text-white transition-colors"
                                    >
                                        Review
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
};

export default DashboardV2;
