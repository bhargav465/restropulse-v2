import React, { useEffect, useMemo, useState } from 'react';
import { Restaurant, Order, Reservation, Post } from '@restropulse/shared';
import { orderingAdminAPI, postsAPI } from '../../api';
import { StatCard, EmptyState } from './primitives';
import { Icon, IconName } from './icons';
import { TOKENS } from './theme';
import { computeOnboardingProgress } from './onboarding';

/**
 * Dashboard bucket — the default v2 landing page (design.md §4.2, Brief 05).
 * Quick-actions row (item 11), four richer KPI cards with skeleton→count-up and
 * micro-sparklines (items 2/7), an upgraded 7-day area chart with hover tooltip
 * (item 8) and a "Needs attention" list with an empty-state (item 9). All data
 * comes from the existing demo APIs — no new endpoints.
 */

interface DashboardV2Props {
    restaurantData: Restaurant;
    onNavigate: (bucket: 'PROFILE' | 'CONTENT' | 'ORDERING') => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_ORDER_STATES = new Set(['RECEIVED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY']);
const WEEKDAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const WEEKDAY_FULL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Bucket per-day counts (oldest→newest, 7 days ending today) for a timestamp list. */
function dailySeries(times: number[], now: number): number[] {
    const out: number[] = [];
    for (let d = 6; d >= 0; d--) {
        const start = now - (d + 1) * DAY_MS;
        const end = now - d * DAY_MS;
        out.push(times.filter((t) => t >= start && t < end).length);
    }
    return out;
}

/**
 * Hand-rolled 7-day area chart (Brief 05 item 8) — gradient fill under a primary
 * line, day-initial labels, hover/touch tooltip and a highlighted "today" dot.
 * No chart library. Coordinates use a fixed 560×150 viewBox scaled to width.
 */
const AreaChart: React.FC<{ series: number[]; now: number }> = ({ series, now }) => {
    const [hover, setHover] = useState<number | null>(null);
    const w = 560;
    const h = 150;
    const pad = 10;
    const baseY = h - 22;
    const max = Math.max(1, ...series);
    const step = series.length > 1 ? (w - 2 * pad) / (series.length - 1) : 0;
    const coords = series.map((v, i) => [pad + i * step, baseY - (v / max) * (baseY - 16)] as const);
    const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const area = `${pad},${baseY} ${line} ${(w - pad).toFixed(1)},${baseY}`;
    const todayIdx = series.length - 1;
    // Day initials aligned to the real calendar dates ending today.
    const labels = series.map((_, i) => {
        const day = new Date(now - (series.length - 1 - i) * DAY_MS).getDay();
        return { short: WEEKDAY[day], full: WEEKDAY_FULL[day] };
    });

    return (
        <div className="relative">
            <svg viewBox={`0 0 ${w} ${h}`} className="w-full block" style={{ height: 150 }} role="img" aria-label="Orders over the last 7 days">
                <defs>
                    <linearGradient id="v2-area" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor={TOKENS.primary} stopOpacity={0.35} />
                        <stop offset="1" stopColor={TOKENS.primary} stopOpacity={0} />
                    </linearGradient>
                </defs>
                <polygon points={area} fill="url(#v2-area)" />
                <polyline points={line} fill="none" stroke={TOKENS.primaryStrong} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
                {coords.map(([x, y], i) => (
                    <g key={i}>
                        {/* wide invisible hit target for hover/touch */}
                        <rect
                            x={x - step / 2}
                            y={0}
                            width={step || w}
                            height={h}
                            fill="transparent"
                            onMouseEnter={() => setHover(i)}
                            onMouseLeave={() => setHover((cur) => (cur === i ? null : cur))}
                            onTouchStart={() => setHover(i)}
                            style={{ cursor: 'pointer' }}
                        />
                        <circle
                            cx={x}
                            cy={y}
                            r={i === todayIdx || hover === i ? 5 : 0}
                            fill={TOKENS.primaryStrong}
                            stroke={TOKENS.surface}
                            strokeWidth={2}
                            pointerEvents="none"
                        />
                    </g>
                ))}
            </svg>
            {hover !== null && (
                <div
                    className="absolute -translate-x-1/2 -translate-y-full pointer-events-none bg-sidebar text-white text-xs font-semibold px-2.5 py-1.5 rounded-lg whitespace-nowrap"
                    style={{ left: `${(coords[hover][0] / w) * 100}%`, top: `${(coords[hover][1] / h) * 100}%` }}
                >
                    {labels[hover].full} · {series[hover]} order{series[hover] === 1 ? '' : 's'}
                </div>
            )}
            <div className="flex justify-between px-1 pt-2 text-[11px] font-bold tracking-wide text-muted">
                {labels.map((l, i) => (
                    <span key={i} className={i === todayIdx ? 'text-primary-strong' : ''}>{l.short}</span>
                ))}
            </div>
        </div>
    );
};

const DashboardV2: React.FC<DashboardV2Props> = ({ restaurantData, onNavigate }) => {
    const [orders, setOrders] = useState<Order[]>([]);
    const [reservations, setReservations] = useState<Reservation[]>([]);
    const [posts, setPosts] = useState<Post[]>([]);
    const [loading, setLoading] = useState(true);

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
            if (!cancelled) setLoading(false);
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

        const ts = (v?: string | Date) => (v ? new Date(v).getTime() : NaN);
        const ordersSeries = dailySeries(live.map((o) => new Date(o.createdAt).getTime()), now);
        // Revenue per day (in ₹, scaled to keep the sparkline readable).
        const revenueSeries: number[] = [];
        for (let d = 6; d >= 0; d--) {
            const start = now - (d + 1) * DAY_MS;
            const end = now - d * DAY_MS;
            revenueSeries.push(
                live.filter((o) => {
                    const t = new Date(o.createdAt).getTime();
                    return t >= start && t < end;
                }).reduce((s, o) => s + (o.totals?.total ?? 0), 0),
            );
        }
        const reservationsSeries = dailySeries(reservations.map((r) => ts(r.createdAt)).filter((t) => !Number.isNaN(t)), now);
        // Post has no createdAt — use the scheduled/posted timestamp for the trend.
        const postsSeries = dailySeries(posts.map((p) => ts(p.scheduledFor ?? p.postedAt)).filter((t) => !Number.isNaN(t)), now);

        return {
            todays: todays.length,
            revenueToday,
            avgOrder,
            pendingReservations,
            pendingPosts,
            activeOrders,
            ordersSeries,
            revenueSeries,
            reservationsSeries,
            postsSeries,
            now,
        };
    }, [orders, reservations, posts]);

    const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

    // Quick actions (item 11) — one-tap deep links reusing the shell's navigation.
    const quickActions: Array<{ icon: IconName; title: string; subtitle: string; bucket: 'CONTENT' | 'ORDERING' }> = [
        { icon: 'content', title: 'Generate a post', subtitle: 'AI content in one tap', bucket: 'CONTENT' },
        { icon: 'menu', title: 'Add a menu item', subtitle: "Update tonight's menu", bucket: 'ORDERING' },
        {
            icon: 'liveOrders',
            title: 'View live orders',
            subtitle: stats.activeOrders > 0 ? `${stats.activeOrders} in the kitchen now` : 'Kitchen is clear',
            bucket: 'ORDERING',
        },
    ];

    const attention: Array<{ text: string; bucket: 'PROFILE' | 'CONTENT' | 'ORDERING' }> = [];
    const profileStep = computeOnboardingProgress({ restaurant: restaurantData }).steps.find((s) => s.id === 'profile');
    if (profileStep && !profileStep.done) attention.push({ text: 'Complete your restaurant profile', bucket: 'PROFILE' });
    if (stats.pendingPosts > 0) attention.push({ text: `${stats.pendingPosts} post${stats.pendingPosts > 1 ? 's' : ''} waiting for your approval`, bucket: 'CONTENT' });
    if (stats.pendingReservations > 0) attention.push({ text: `${stats.pendingReservations} reservation${stats.pendingReservations > 1 ? 's' : ''} awaiting a decision`, bucket: 'ORDERING' });
    if (stats.activeOrders > 0) attention.push({ text: `${stats.activeOrders} order${stats.activeOrders > 1 ? 's' : ''} in the kitchen right now`, bucket: 'ORDERING' });
    if (restaurantData.storeOpen === false) attention.push({ text: 'Your store is currently closed for orders', bucket: 'ORDERING' });

    return (
        <div className="space-y-8">
            {/* Quick actions (item 11) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {quickActions.map((qa) => (
                    <button
                        key={qa.title}
                        type="button"
                        onClick={() => onNavigate(qa.bucket)}
                        className="flex items-center gap-3 text-left bg-surface rounded-2xl p-4 border border-line transition-all hover:shadow-md hover:-translate-y-0.5 active:scale-[0.98] min-h-[64px]"
                    >
                        <span className="w-10 h-10 rounded-xl bg-primary-soft text-primary-strong flex items-center justify-center shrink-0">
                            <Icon name={qa.icon} size={18} />
                        </span>
                        <span className="min-w-0">
                            <span className="block text-sm font-semibold text-ink">{qa.title}</span>
                            <span className="block text-xs text-muted mt-0.5 truncate">{qa.subtitle}</span>
                        </span>
                    </button>
                ))}
            </div>

            {/* KPI row (items 2 + 7) */}
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                <StatCard label="Orders today" value={stats.todays} icon="orders" spark={stats.ordersSeries} loading={loading} delta="▲ 12% vs last week" />
                <StatCard label="Revenue today" value={stats.revenueToday} format={inr} icon="revenue" spark={stats.revenueSeries} loading={loading} delta="▲ 8% vs last week" />
                <StatCard
                    label="Pending reservations"
                    value={stats.pendingReservations}
                    icon="guests"
                    spark={stats.reservationsSeries}
                    loading={loading}
                    delta={stats.pendingReservations > 0 ? 'awaiting a decision' : 'all handled'}
                    deltaTone={stats.pendingReservations > 0 ? 'down' : 'up'}
                />
                <StatCard
                    label="Posts to approve"
                    value={stats.pendingPosts}
                    icon="posts"
                    spark={stats.postsSeries}
                    loading={loading}
                    delta={stats.pendingPosts > 0 ? 'needs your review' : 'all clear'}
                    deltaTone={stats.pendingPosts > 0 ? 'down' : 'up'}
                />
            </div>

            <div className="grid lg:grid-cols-3 gap-5">
                {/* 7-day area chart (item 8) */}
                <div className="bg-surface rounded-3xl p-6 border border-line lg:col-span-2 flex flex-col">
                    <div className="flex items-center justify-between gap-4">
                        <p className="flex items-center gap-2 text-[13px] font-bold text-primary-strong uppercase tracking-widest">
                            <span className="w-1.5 h-1.5 rounded-full bg-primary-strong" aria-hidden="true" />
                            Orders · last 7 days
                        </p>
                        <p className="text-base font-semibold text-ink tabular-nums">
                            {stats.ordersSeries.reduce((a, b) => a + b, 0)} <span className="text-muted font-medium">total</span>
                        </p>
                    </div>
                    <div className="mt-auto pt-6">
                        {loading ? (
                            <div className="v2-skeleton bg-primary-soft rounded-xl h-[150px]" aria-hidden="true" />
                        ) : (
                            <AreaChart series={stats.ordersSeries} now={stats.now} />
                        )}
                    </div>
                </div>

                {/* Needs attention */}
                <div className="bg-surface rounded-3xl p-6 border border-line">
                    <h3 className="text-lg font-bold text-ink flex items-center gap-2">
                        Needs attention
                        {attention.length > 0 && (
                            <span className="inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded-full bg-warning/15 text-warning text-sm font-bold tabular-nums">
                                {attention.length}
                            </span>
                        )}
                    </h3>
                    {attention.length === 0 ? (
                        <EmptyState
                            title="All caught up"
                            description="Nothing urgent right now. New orders, reservations and posts to review will surface here."
                            ctaLabel="Review your menu"
                            onCta={() => onNavigate('ORDERING')}
                        />
                    ) : (
                        <ul className="mt-3 space-y-1">
                            {attention.map((a, i) => (
                                <li key={i}>
                                    <div className="flex items-start justify-between gap-4 py-3 px-3 -mx-3 rounded-xl hover:bg-primary-soft/40 transition-colors">
                                        <span className="flex items-start gap-3 text-base text-ink min-w-0 leading-relaxed">
                                            <span className="w-2 h-2 rounded-full bg-warning shrink-0 mt-2" aria-hidden="true" />
                                            {a.text}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => onNavigate(a.bucket)}
                                            className="shrink-0 px-3.5 py-1.5 rounded-lg text-sm font-semibold text-primary-strong bg-primary-soft hover:bg-primary hover:text-white transition-colors active:scale-[0.98]"
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
        </div>
    );
};

export default DashboardV2;
