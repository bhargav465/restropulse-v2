import React, { useEffect, useState } from 'react';
import { Restaurant, Order, Reservation } from '@restropulse/shared';
import { orderingAdminAPI } from '../../api';
import MenuManager from '../ordering/MenuManager';
import OrdersFeed from '../ordering/OrdersFeed';
import ReservationsPanel from '../ordering/ReservationsPanel';
import SiteContentEditor from '../ordering/SiteContentEditor';
import FunnelAnalytics from '../ordering/FunnelAnalytics';
import { StatCard, SubNav, SubNavTab } from './primitives';

type OrderingTab = 'OVERVIEW' | 'ORDERS' | 'MENU' | 'RESERVATIONS' | 'CONTENT' | 'FUNNEL';

const STOREFRONT_URL = 'https://bhargav465.github.io/restropulse-v2/demo';

interface OrderingV2Props {
    restaurantData: Restaurant;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Overview panel — KPIs pulled from the same ordering APIs the sub-views use. */
const OrderingOverview: React.FC<{ onNavigate: (tab: OrderingTab) => void }> = ({ onNavigate }) => {
    const [orders, setOrders] = useState<Order[]>([]);
    const [reservations, setReservations] = useState<Reservation[]>([]);
    const [funnelEvents, setFunnelEvents] = useState<Array<{ name: string; count: number; uniqueSessions: number }>>([]);

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
                const summary = await orderingAdminAPI.getAnalyticsSummary();
                if (!cancelled) setFunnelEvents(summary.events || []);
            } catch { /* empty */ }
        })();
        return () => { cancelled = true; };
    }, []);

    const now = Date.now();
    const todaysOrders = orders.filter(o => o.status !== 'CANCELLED' && now - new Date(o.createdAt).getTime() < DAY_MS);
    const revenueToday = todaysOrders.reduce((sum, o) => sum + (o.totals?.total ?? 0), 0);
    const pendingReservations = reservations.filter(r => r.status === 'pending').length;

    const menuViews = funnelEvents.find(e => e.name === 'menu_view')?.uniqueSessions ?? 0;
    const placed = funnelEvents.find(e => e.name === 'order_placed')?.uniqueSessions ?? 0;
    const conversion = menuViews > 0 ? ((placed / menuViews) * 100).toFixed(1) : null;

    const linkChips: Array<{ tab: OrderingTab; emoji: string; label: string }> = [
        { tab: 'ORDERS', emoji: '🧾', label: 'Orders' },
        { tab: 'MENU', emoji: '📖', label: 'Menu Manager' },
        { tab: 'RESERVATIONS', emoji: '📅', label: 'Reservations' },
        { tab: 'CONTENT', emoji: '🎨', label: 'Site Content' },
        { tab: 'FUNNEL', emoji: '📈', label: 'Funnel' },
    ];

    return (
        <div className="space-y-6">
            {/* KPI row */}
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                <StatCard emoji="🧾" label="Orders today" value={todaysOrders.length} delta="▲ 12% vs last week" />
                <StatCard
                    emoji="💰"
                    label="Revenue today"
                    value={`₹${Math.round(revenueToday).toLocaleString('en-IN')}`}
                    delta="▲ 8% vs last week"
                />
                <StatCard
                    emoji="📅"
                    label="Pending reservations"
                    value={pendingReservations}
                    delta={pendingReservations > 0 ? 'awaiting a yes 🤝' : 'all handled 🎉'}
                    deltaTone={pendingReservations > 0 ? 'down' : 'up'}
                />
                <StatCard
                    emoji="📈"
                    label="Funnel conversion"
                    value={conversion !== null ? `${conversion}%` : '—'}
                    delta="menu view → order"
                    deltaTone="neutral"
                />
            </div>

            {/* Quick links */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
                <h3 className="font-bold text-slate-800 mb-4">⚡ Jump to</h3>
                <div className="flex gap-2 flex-wrap">
                    {linkChips.map((c) => (
                        <button
                            key={c.tab}
                            type="button"
                            onClick={() => onNavigate(c.tab)}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-slate-50 text-slate-600 border border-slate-200 hover:bg-[#fdece5] hover:text-[#c04a2e] hover:border-[#f3c4b4] transition-colors"
                        >
                            <span aria-hidden="true">{c.emoji}</span>
                            {c.label}
                        </button>
                    ))}
                    <a
                        href={STOREFRONT_URL}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-[#e8674a] text-white shadow-md shadow-[#e8674a]/30 hover:bg-[#d75b3f] transition-colors"
                    >
                        <span aria-hidden="true">🌐</span>
                        View live storefront ↗
                    </a>
                </div>
                <p className="text-xs text-slate-400 mt-3">
                    Your storefront is where customers browse the menu, order and book tables — everything here keeps it fresh.
                </p>
            </div>
        </div>
    );
};

/**
 * Online Ordering bucket — v2 Overview plus the existing ordering admin
 * sub-views (components/ordering/*) mounted unchanged inside the v2 frame.
 */
const OrderingV2: React.FC<OrderingV2Props> = ({ restaurantData }) => {
    const [tab, setTab] = useState<OrderingTab>('OVERVIEW');

    const tabs: Array<SubNavTab<OrderingTab>> = [
        { id: 'OVERVIEW', label: 'Overview', emoji: '🏠' },
        { id: 'ORDERS', label: 'Orders', emoji: '🧾' },
        { id: 'MENU', label: 'Menu Manager', emoji: '📖' },
        { id: 'RESERVATIONS', label: 'Reservations', emoji: '📅' },
        { id: 'CONTENT', label: 'Site Content', emoji: '🎨' },
        { id: 'FUNNEL', label: 'Funnel', emoji: '📈' },
    ];

    return (
        <div>
            <SubNav tabs={tabs} active={tab} onChange={setTab} label="Online Ordering sections" />
            {tab === 'OVERVIEW' && <OrderingOverview onNavigate={setTab} />}
            {tab !== 'OVERVIEW' && (
                <div className="max-w-3xl">
                    {tab === 'ORDERS' && <OrdersFeed initialStoreOpen={restaurantData.storeOpen === true} />}
                    {tab === 'MENU' && <MenuManager />}
                    {tab === 'RESERVATIONS' && <ReservationsPanel />}
                    {tab === 'CONTENT' && <SiteContentEditor />}
                    {tab === 'FUNNEL' && <FunnelAnalytics />}
                </div>
            )}
        </div>
    );
};

export default OrderingV2;
