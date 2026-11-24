import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { OrderStatus } from '@restropulse/shared';
import { ACTIVE_ORDER_STATUSES, ORDER_STATUS_LABELS, canRestaurantCancel, restaurantNextStatuses } from '@restropulse/shared';
import { ordersAPI, type AdminOrder } from '../../api';
import { Badge, Button, Card, SectionHeader } from '../ui';
import OrderRider from './OrderRider';

/** How often the open-orders view refreshes on its own. */
export const ORDERS_POLL_MS = 15_000;

type View = 'active' | 'all';

const TYPE_LABELS: Record<AdminOrder['orderType'], string> = { delivery: 'Delivery', pickup: 'Pickup', dine_in: 'Dine-in' };

const NEXT_LABELS: Partial<Record<OrderStatus, string>> = {
    PREPARING: 'Start preparing',
    READY: 'Mark ready',
    OUT_FOR_DELIVERY: 'Out for delivery',
    COMPLETED: 'Complete',
};

const PAYMENT_LABELS: Record<AdminOrder['paymentStatus'], string> = {
    not_required: 'Cash',
    pending: 'Awaiting payment',
    paid: 'Paid online',
    failed: 'Payment failed',
    refund_pending: 'Refund in progress',
    refunded: 'Refunded',
};

function statusTone(status: OrderStatus): 'primary' | 'success' | 'warning' | 'danger' | 'muted' {
    if (status === 'RECEIVED') return 'primary';
    if (status === 'PREPARING' || status === 'READY' || status === 'OUT_FOR_DELIVERY') return 'warning';
    if (status === 'COMPLETED') return 'success';
    if (status === 'CANCELLED' || status === 'PAYMENT_FAILED') return 'danger';
    return 'muted';
}

const rupees = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export function minutesSince(iso: string | Date, now: number = Date.now()): string {
    const mins = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.floor(mins / 60);
    return hours < 24 ? `${hours} h ago` : new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** Merge a poll's changed orders into the list (newest first). */
export function mergeOrders(current: AdminOrder[], changed: AdminOrder[]): AdminOrder[] {
    const byId = new Map(current.map((o) => [o.id, o]));
    for (const o of changed) byId.set(o.id, o);
    return [...byId.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

const OrderCard: React.FC<{
    order: AdminOrder;
    busy: boolean;
    onMove: (to: OrderStatus) => void;
    onCancel: (reason: string, refund: boolean) => void;
    onRiderChanged: (orderId: string) => void;
}> = ({ order, busy, onMove, onCancel, onRiderChanged }) => {
    const [cancelling, setCancelling] = useState(false);
    const [reason, setReason] = useState('');
    const [refund, setRefund] = useState(true);
    const next = restaurantNextStatuses(order);
    const paidOnline = order.paymentMethod === 'online' && order.paymentStatus === 'paid';

    return (
        <Card className="space-y-3" p="p-4">
            <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-[var(--rp-text)]">{order.orderNumber}</span>
                <Badge tone={statusTone(order.status)}>{ORDER_STATUS_LABELS[order.status]}</Badge>
                <Badge>{TYPE_LABELS[order.orderType]}</Badge>
                <span className="ml-auto text-xs text-[var(--rp-muted)]">{minutesSince(order.createdAt)}</span>
            </div>
            <div className="text-sm text-[var(--rp-text)]">
                <span className="font-semibold">{order.customerName}</span>
                <span className="text-[var(--rp-muted)]"> · {order.customerPhone}</span>
                {order.table && <span className="text-[var(--rp-muted)]"> · Table {order.table}</span>}
            </div>
            {order.address && (
                <p className="text-sm text-[var(--rp-muted)]">
                    {[order.address.line1, order.address.line2, order.address.landmark, order.address.city, order.address.pincode].filter(Boolean).join(', ')}
                </p>
            )}
            <ul className="text-sm text-[var(--rp-text)] space-y-0.5">
                {order.items.map((item, i) => (
                    <li key={`${item.menuItemId}-${i}`} className="flex justify-between gap-3">
                        <span>
                            {item.qty} × {item.name}
                            {item.variant && <span className="text-[var(--rp-muted)]"> ({item.variant.name})</span>}
                            {item.addons?.length ? <span className="text-[var(--rp-muted)]"> + {item.addons.map((a) => a.name).join(', ')}</span> : null}
                        </span>
                        <span className="tabular-nums">{rupees(item.lineTotal)}</span>
                    </li>
                ))}
            </ul>
            {order.notes && <p className="text-sm italic text-[var(--rp-muted)]">“{order.notes}”</p>}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--rp-line)] pt-3 text-sm">
                <span className="text-[var(--rp-muted)]">
                    {PAYMENT_LABELS[order.paymentStatus]}
                    {order.offer && <> · {order.offer.title}</>}
                </span>
                <span className="font-bold text-[var(--rp-text)] tabular-nums">{rupees(order.totals.total)}</span>
            </div>
            {order.cancelReason && <p className="text-sm text-[var(--rp-danger)]">Cancelled: {order.cancelReason}</p>}
            {order.orderType === 'delivery' && order.status !== 'PENDING_PAYMENT' && order.status !== 'PAYMENT_FAILED' && (
                <OrderRider order={order} onOrderChanged={onRiderChanged} />
            )}

            {(next.length > 0 || canRestaurantCancel(order)) && !cancelling && (
                <div className="flex flex-wrap gap-2">
                    {next.map((to) => (
                        <Button key={to} disabled={busy} onClick={() => onMove(to)}>{NEXT_LABELS[to] ?? ORDER_STATUS_LABELS[to]}</Button>
                    ))}
                    {canRestaurantCancel(order) && (
                        <Button variant="secondary" disabled={busy} onClick={() => setCancelling(true)}>Cancel order</Button>
                    )}
                </div>
            )}
            {cancelling && (
                <div className="space-y-2 rounded-xl border border-[var(--rp-line)] p-3">
                    <label className="block text-sm font-medium text-[var(--rp-text)]">
                        Reason
                        <input
                            className="mt-1 w-full rounded-xl border border-[var(--rp-line)] bg-[var(--rp-surface)] px-3 py-2 text-sm text-[var(--rp-text)]"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="Out of stock, kitchen closing…"
                        />
                    </label>
                    {paidOnline && (
                        <label className="flex items-center gap-2 text-sm text-[var(--rp-text)]">
                            <input type="checkbox" checked={refund} onChange={(e) => setRefund(e.target.checked)} />
                            Refund {rupees(order.totals.total)} to the customer
                        </label>
                    )}
                    <div className="flex gap-2">
                        <Button disabled={busy || !reason.trim()} onClick={() => onCancel(reason.trim(), paidOnline && refund)}>Confirm cancel</Button>
                        <Button variant="secondary" disabled={busy} onClick={() => setCancelling(false)}>Keep order</Button>
                    </div>
                </div>
            )}
        </Card>
    );
};

/**
 * Live order board: open orders refresh every 15 seconds; each card offers the
 * next allowed status (from the shared status machine) and cancel with refund.
 */
const OrdersBoard: React.FC = () => {
    const [view, setView] = useState<View>('active');
    const [orders, setOrders] = useState<AdminOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const sinceRef = useRef<string | null>(null);

    const load = useCallback(async (v: View) => {
        setLoading(true);
        try {
            const feed = await ordersAPI.getFeed({ status: v });
            setOrders(feed.orders);
            sinceRef.current = feed.serverTime;
            setError(null);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(view); }, [view, load]);

    // Poll for changes since the last read while the kitchen view is open.
    useEffect(() => {
        if (view !== 'active') return undefined;
        const timer = setInterval(async () => {
            if (!sinceRef.current) return;
            try {
                const feed = await ordersAPI.getFeed({ status: 'all', since: sinceRef.current });
                sinceRef.current = feed.serverTime;
                if (feed.orders.length) {
                    setOrders((cur) => mergeOrders(cur, feed.orders).filter((o) => ACTIVE_ORDER_STATUSES.includes(o.status)));
                }
            } catch {
                /* keep the board as it is; the next tick retries */
            }
        }, ORDERS_POLL_MS);
        return () => clearInterval(timer);
    }, [view]);

    const replace = (updated: AdminOrder) => setOrders((cur) => {
        const merged = mergeOrders(cur, [updated]);
        return view === 'active' ? merged.filter((o) => restaurantNextStatuses(o).length > 0) : merged;
    });

    const move = async (order: AdminOrder, to: OrderStatus) => {
        setBusyId(order.id);
        setNotice(null);
        try {
            replace(await ordersAPI.setStatus(order.id, to));
            setError(null);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusyId(null);
        }
    };

    /** A rider update moved the order (picked up, delivered): show its new status. */
    const refreshOrder = async (id: string) => {
        try {
            replace(await ordersAPI.getOrder(id));
        } catch {
            /* the next poll catches up */
        }
    };

    const cancel = async (order: AdminOrder, reason: string, refund: boolean) => {
        setBusyId(order.id);
        try {
            const result = await ordersAPI.cancel(order.id, reason, refund);
            replace(result.order);
            setError(null);
            setNotice(result.refund === 'requested'
                ? `${order.orderNumber} cancelled. The refund is on its way to the customer.`
                : result.refund === 'failed'
                    ? `${order.orderNumber} cancelled, but the refund didn't go through. Refund it from your Razorpay dashboard.`
                    : `${order.orderNumber} cancelled.`);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusyId(null);
        }
    };

    return (
        <div className="space-y-4">
            <SectionHeader
                title="Orders"
                subtitle={view === 'active' ? 'Open orders refresh on their own.' : 'Your latest 50 orders.'}
                right={(
                    <div className="flex items-center gap-2">
                        <select
                            aria-label="Which orders"
                            className="rounded-xl border border-[var(--rp-line)] bg-[var(--rp-surface)] px-3 py-2 text-sm text-[var(--rp-text)]"
                            value={view}
                            onChange={(e) => setView(e.target.value as View)}
                        >
                            <option value="active">Open</option>
                            <option value="all">All</option>
                        </select>
                        <Button variant="secondary" onClick={() => void load(view)} disabled={loading}>
                            <span className="inline-flex items-center gap-1"><RefreshCw size={14} aria-hidden /> Refresh</span>
                        </Button>
                    </div>
                )}
            />
            {error && <p role="alert" className="text-sm font-medium text-[var(--rp-danger)]">{error}</p>}
            {notice && <p role="status" className="text-sm font-medium text-[var(--rp-success)]">{notice}</p>}
            {loading && orders.length === 0 && <p className="text-sm text-[var(--rp-muted)]">Loading orders…</p>}
            {!loading && orders.length === 0 && (
                <Card><p className="text-sm text-[var(--rp-muted)]">{view === 'active' ? 'No open orders right now.' : 'No orders yet.'}</p></Card>
            )}
            <div className="grid gap-3 md:grid-cols-2">
                {orders.map((o) => (
                    <OrderCard key={o.id} order={o} busy={busyId === o.id} onMove={(to) => void move(o, to)} onCancel={(r, refund) => void cancel(o, r, refund)} onRiderChanged={(id) => void refreshOrder(id)} />
                ))}
            </div>
        </div>
    );
};

export default OrdersBoard;
