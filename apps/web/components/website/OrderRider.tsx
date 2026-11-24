import React, { useEffect, useState } from 'react';
import type { OrderStatus, ShipmentStatus } from '@restropulse/shared';
import { ACTIVE_ORDER_STATUSES, SHIPMENT_STATUS_LABELS, canTransitionShipment, isTerminalShipment } from '@restropulse/shared';
import { deliveryAPI, type AdminOrder, type OrderRiderView, type OwnRiderStep } from '../../api';
import { Badge, Button } from '../ui';

const inputClass = 'w-full rounded-xl border border-[var(--rp-line)] bg-[var(--rp-surface)] px-3 py-2 text-sm text-[var(--rp-text)]';

/** Orders a rider can still be found for (mirrors the API). */
const DISPATCHABLE: OrderStatus[] = ['RECEIVED', 'PREPARING', 'READY'];

/** The next step an own rider can be marked with, in order. */
const OWN_RIDER_STEPS: Array<{ status: OwnRiderStep; label: string }> = [
    { status: 'RIDER_ASSIGNED', label: 'Rider assigned' },
    { status: 'PICKED_UP', label: 'Picked up' },
    { status: 'DELIVERED', label: 'Delivered' },
];

export function riderTone(status: ShipmentStatus): 'primary' | 'success' | 'warning' | 'danger' | 'muted' {
    if (status === 'DELIVERED') return 'success';
    if (status === 'CANCELLED' || status === 'FAILED') return 'danger';
    if (status === 'PICKED_UP' || status === 'IN_TRANSIT') return 'warning';
    return 'primary';
}

export function nextOwnRiderStep(status: ShipmentStatus): (typeof OWN_RIDER_STEPS)[number] | undefined {
    return OWN_RIDER_STEPS.find((s) => canTransitionShipment(status, s.status));
}

/**
 * The rider part of a delivery order card (Phase 2 M4): who is delivering,
 * and the restaurant's actions (find a rider, use own rider, mark own-rider
 * steps, cancel the booking before pickup).
 */
const OrderRider: React.FC<{ order: AdminOrder; onOrderChanged: (orderId: string) => void }> = ({ order, onOrderChanged }) => {
    const [view, setView] = useState<OrderRiderView | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loadFailed, setLoadFailed] = useState(false);
    const [riderName, setRiderName] = useState('');
    const [cancelling, setCancelling] = useState(false);
    const [reason, setReason] = useState('');

    const apply = (next: OrderRiderView) => {
        setView(next);
        setError(null);
        if (next.orderStatus && next.orderStatus !== order.status) onOrderChanged(order.id);
    };

    const open = ACTIVE_ORDER_STATUSES.includes(order.status);

    useEffect(() => {
        // Closed orders show the feed's rider status only (no call per old order).
        if (!open) return undefined;
        let live = true;
        deliveryAPI.getRider(order.id)
            .then((v) => { if (live) { setLoadFailed(false); apply(v); } })
            .catch(() => { if (live) setLoadFailed(true); });
        return () => { live = false; };
        // Reload when the order moves (the board polls), not on every render.
    }, [order.id, order.status, open]);

    const run = async (fn: () => Promise<OrderRiderView>) => {
        setBusy(true);
        try {
            apply(await fn());
            setCancelling(false);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const shipment = view?.shipment ?? null;
    const status = shipment?.status ?? order.delivery?.status;
    const live = !!shipment && !isTerminalShipment(shipment.status);
    const canBook = DISPATCHABLE.includes(order.status) && !live && view?.queued !== 'dispatch';
    const ownStep = live && shipment.provider === 'self' ? nextOwnRiderStep(shipment.status) : undefined;
    const canCancel = live && canTransitionShipment(shipment.status, 'CANCELLED') && view?.queued !== 'cancel';

    return (
        <div className="space-y-2 rounded-xl border border-[var(--rp-line)] p-3" aria-label={`Rider for ${order.orderNumber}`}>
            <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-[var(--rp-text)]">Rider</span>
                {status && <Badge tone={riderTone(status)}>{SHIPMENT_STATUS_LABELS[status]}</Badge>}
                {view?.queued === 'dispatch' && <Badge tone="muted">Finding a rider…</Badge>}
                {view?.queued === 'cancel' && <Badge tone="muted">Cancelling…</Badge>}
                {!status && !view?.queued && <span className="text-[var(--rp-muted)]">None booked yet</span>}
            </div>
            {shipment && (
                <p className="text-sm text-[var(--rp-muted)]">
                    {shipment.carrier ?? shipment.provider}
                    {shipment.rider?.name && <> · {shipment.rider.name}</>}
                    {shipment.rider?.phone && <> · {shipment.rider.phone}</>}
                    {shipment.etaMinutes !== undefined && live && <> · about {shipment.etaMinutes} min</>}
                    {shipment.fee ? <> · ₹{shipment.fee}</> : null}
                </p>
            )}
            {shipment?.cancelReason && shipment.status === 'CANCELLED' && <p className="text-sm text-[var(--rp-muted)]">{shipment.cancelReason}</p>}
            {view?.lastError && !live && <p className="text-sm text-[var(--rp-danger)]">Couldn't book a rider: {view.lastError}</p>}
            {loadFailed && <p className="text-sm text-[var(--rp-muted)]">Couldn't load the rider just now. It refreshes with the board.</p>}
            {error && <p role="alert" className="text-sm text-[var(--rp-danger)]">{error}</p>}

            {ownStep?.status === 'RIDER_ASSIGNED' && (
                <input aria-label="Rider's name" className={inputClass} placeholder="Rider's name (optional)" value={riderName} onChange={(e) => setRiderName(e.target.value)} />
            )}
            {!cancelling && (
                <div className="flex flex-wrap gap-2">
                    {canBook && <Button disabled={busy} onClick={() => void run(() => deliveryAPI.findRider(order.id))}>Find a rider</Button>}
                    {canBook && <Button variant="secondary" disabled={busy} onClick={() => void run(() => deliveryAPI.useOwnRider(order.id))}>Use own rider</Button>}
                    {ownStep && (
                        <Button
                            disabled={busy}
                            onClick={() => void run(() => deliveryAPI.updateOwnRider(order.id, {
                                status: ownStep.status,
                                ...(ownStep.status === 'RIDER_ASSIGNED' && riderName.trim() ? { riderName: riderName.trim() } : {}),
                            }))}
                        >
                            {ownStep.label}
                        </Button>
                    )}
                    {canCancel && <Button variant="secondary" disabled={busy} onClick={() => setCancelling(true)}>Cancel rider</Button>}
                </div>
            )}
            {cancelling && (
                <div className="space-y-2">
                    <input aria-label="Why cancel the rider" className={inputClass} placeholder="Customer will collect, rider too far…" value={reason} onChange={(e) => setReason(e.target.value)} />
                    <div className="flex gap-2">
                        <Button disabled={busy || reason.trim().length < 3} onClick={() => void run(() => deliveryAPI.cancelRider(order.id, reason.trim()))}>Confirm</Button>
                        <Button variant="secondary" disabled={busy} onClick={() => setCancelling(false)}>Keep rider</Button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default OrderRider;
