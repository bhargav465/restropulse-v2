import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Power, RefreshCw } from 'lucide-react';
import { Order, OrderStatus } from '@restropulse/shared';
import { orderingAdminAPI } from '../../api';
import { ActionNotice } from '../ActionNotice';
import { PanelLoading, PanelError, PanelEmpty } from './PanelStates';
import { ORDER_STATUSES, ORDER_STATUS_LABELS, nextStatusOptions } from './order-status';

const POLL_INTERVAL_MS = 10_000;

const STATUS_BADGE_CLASSES: Record<OrderStatus, string> = {
    PENDING_PAYMENT: 'bg-slate-100 text-slate-600',
    PAYMENT_FAILED: 'bg-red-50 text-red-700',
    RECEIVED: 'bg-blue-50 text-blue-700',
    PREPARING: 'bg-amber-50 text-amber-700',
    READY: 'bg-emerald-50 text-emerald-700',
    OUT_FOR_DELIVERY: 'bg-indigo-50 text-indigo-700',
    COMPLETED: 'bg-green-50 text-green-700',
    CANCELLED: 'bg-red-50 text-red-600',
};

interface OrdersFeedProps {
    initialStoreOpen: boolean;
}

const OrdersFeed: React.FC<OrdersFeedProps> = ({ initialStoreOpen }) => {
    const [orders, setOrders] = useState<Order[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<{ message: string; type: 'error' | 'success' } | null>(null);
    const [statusFilter, setStatusFilter] = useState<OrderStatus | ''>('');
    const [storeOpen, setStoreOpen] = useState(initialStoreOpen);
    const [togglingStore, setTogglingStore] = useState(false);
    const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
    const statusFilterRef = useRef(statusFilter);
    statusFilterRef.current = statusFilter;

    const load = useCallback(async (silent: boolean) => {
        if (!silent) {
            setOrders(null);
            setError(null);
        }
        try {
            const filter = statusFilterRef.current;
            const data = await orderingAdminAPI.getOrders(filter ? { status: filter } : undefined);
            setOrders(data);
            setError(null);
        } catch (err) {
            // Keep stale data visible on background poll failures.
            if (!silent) setError(err instanceof Error ? err.message : 'Failed to load orders');
        }
    }, []);

    // Initial load + reload on filter change
    useEffect(() => {
        load(false);
    }, [load, statusFilter]);

    // Poll the feed every 10s
    useEffect(() => {
        const interval = setInterval(() => load(true), POLL_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [load]);

    const handleToggleStore = async () => {
        setTogglingStore(true);
        try {
            const next = await orderingAdminAPI.setStoreOpen(!storeOpen);
            setStoreOpen(next);
            setNotice({ message: next ? 'Store is now open for orders.' : 'Store closed — customers cannot place orders.', type: 'success' });
        } catch (err) {
            setNotice({ message: err instanceof Error ? err.message : 'Failed to toggle store', type: 'error' });
        } finally {
            setTogglingStore(false);
        }
    };

    const handleTransition = async (order: Order, to: OrderStatus) => {
        setUpdatingOrderId(order.id);
        try {
            const updated = await orderingAdminAPI.updateOrderStatus(order.id, to);
            setOrders((prev) => prev?.map((o) => (o.id === updated.id ? updated : o)) ?? prev);
        } catch (err) {
            setNotice({ message: err instanceof Error ? err.message : 'Failed to update order', type: 'error' });
            load(true);
        } finally {
            setUpdatingOrderId(null);
        }
    };

    return (
        <div className="space-y-4">
            {/* Prominent store open/close toggle */}
            <button
                onClick={handleToggleStore}
                disabled={togglingStore}
                aria-label={storeOpen ? 'Close store' : 'Open store'}
                className={`w-full flex items-center justify-between p-4 rounded-2xl border-2 transition-all active:scale-[0.99] ${
                    storeOpen ? 'bg-emerald-50 border-emerald-300' : 'bg-red-50 border-red-300'
                } ${togglingStore ? 'opacity-60' : ''}`}
            >
                <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${storeOpen ? 'bg-emerald-500' : 'bg-red-500'}`}>
                        <Power size={20} className="text-white" strokeWidth={2.5} />
                    </div>
                    <div className="text-left">
                        <p className={`font-extrabold text-sm ${storeOpen ? 'text-emerald-800' : 'text-red-800'}`}>
                            {storeOpen ? 'Store Open' : 'Store Closed'}
                        </p>
                        <p className={`text-xs font-medium ${storeOpen ? 'text-emerald-600' : 'text-red-500'}`}>
                            {storeOpen ? 'Accepting online orders' : 'Not accepting orders'}
                        </p>
                    </div>
                </div>
                <span className={`text-xs font-bold px-3 py-1.5 rounded-full ${storeOpen ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}>
                    {storeOpen ? 'Tap to close' : 'Tap to open'}
                </span>
            </button>

            {notice && <ActionNotice message={notice.message} type={notice.type} onDismiss={() => setNotice(null)} />}

            {/* Status filter + manual refresh */}
            <div className="flex items-center gap-2">
                <label htmlFor="order-status-filter" className="text-xs font-bold text-slate-500 uppercase tracking-wide">Status</label>
                <select
                    id="order-status-filter"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as OrderStatus | '')}
                    className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium text-slate-700"
                >
                    <option value="">All statuses</option>
                    {ORDER_STATUSES.map((s) => (
                        <option key={s} value={s}>{ORDER_STATUS_LABELS[s]}</option>
                    ))}
                </select>
                <button
                    onClick={() => load(true)}
                    aria-label="Refresh orders"
                    className="w-9 h-9 bg-white border border-slate-200 rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-50 active:scale-95 transition-all"
                >
                    <RefreshCw size={16} />
                </button>
            </div>

            {/* Feed */}
            {error ? (
                <PanelError message={error} onRetry={() => load(false)} />
            ) : orders === null ? (
                <PanelLoading label="Loading orders…" />
            ) : orders.length === 0 ? (
                <PanelEmpty title="No orders yet" hint={statusFilter ? `No ${ORDER_STATUS_LABELS[statusFilter]} orders right now.` : 'New orders will appear here automatically.'} />
            ) : (
                <div className="space-y-3">
                    {orders.map((order) => {
                        const nextOptions = nextStatusOptions(order.status, order.orderType);
                        const busy = updatingOrderId === order.id;
                        return (
                            <div key={order.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
                                <div className="flex items-start justify-between gap-2 mb-2">
                                    <div>
                                        <p className="font-extrabold text-slate-800 text-sm">{order.orderNumber}</p>
                                        <p className="text-xs text-slate-500 font-medium">
                                            {order.customerName || 'Customer'} · {order.orderType.replace('_', '-')}
                                            {order.customerPhone ? ` · ${order.customerPhone}` : ''}
                                        </p>
                                    </div>
                                    <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide shrink-0 ${STATUS_BADGE_CLASSES[order.status]}`}>
                                        {ORDER_STATUS_LABELS[order.status]}
                                    </span>
                                </div>

                                <ul className="text-xs text-slate-600 mb-2 space-y-0.5">
                                    {order.items.map((item, i) => (
                                        <li key={`${item.menuItemId}-${i}`}>
                                            {item.qty}× {item.name}{item.variant ? ` (${item.variant.name})` : ''} — ₹{item.lineTotal.toFixed(2)}
                                        </li>
                                    ))}
                                </ul>
                                {order.address && (
                                    <p className="text-[11px] text-slate-400 mb-2">
                                        {[order.address.line1, order.address.line2, order.address.city, order.address.pincode].filter(Boolean).join(', ')}
                                    </p>
                                )}
                                <div className="flex items-center justify-between border-t border-slate-100 pt-2">
                                    <p className="text-sm font-extrabold text-slate-800">₹{order.totals.total.toFixed(2)}</p>
                                    <p className="text-[11px] text-slate-400 font-medium">{new Date(order.createdAt).toLocaleString()}</p>
                                </div>

                                {/* Only valid next transitions are rendered */}
                                {nextOptions.length > 0 && (
                                    <div className="flex flex-wrap gap-2 mt-3">
                                        {nextOptions.map((to) => (
                                            <button
                                                key={to}
                                                onClick={() => handleTransition(order, to)}
                                                disabled={busy}
                                                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all active:scale-95 disabled:opacity-50 ${
                                                    to === 'CANCELLED'
                                                        ? 'bg-white border border-red-200 text-red-600 hover:bg-red-50'
                                                        : 'bg-orange-600 text-white hover:bg-orange-700'
                                                }`}
                                            >
                                                {to === 'CANCELLED' ? 'Cancel order' : `Mark ${ORDER_STATUS_LABELS[to]}`}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default OrdersFeed;
