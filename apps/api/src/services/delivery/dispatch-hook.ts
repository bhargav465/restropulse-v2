/**
 * Hooks rider dispatch onto order status moves (Phase 2, M4).
 *
 * The API never calls a delivery partner inline: when a delivery order reaches
 * the restaurant's dispatch point (READY by default, PREPARING if they chose
 * a head start) a `dispatch` job goes into the outbox; when an order is
 * cancelled with a live rider booking, a `cancel` job does. The dispatch
 * worker (apps/dispatch-worker) does the rest.
 */

import { enqueueDeliveryJob, findRestaurantById, findShipmentForOrder } from '@restropulse/db';
import type { Order, OrderStatus } from '@restropulse/shared';
import { canTransitionShipment, resolveDeliverySettings } from '@restropulse/shared';
import { trackEvent } from '@restropulse/telemetry/server';
import { onOrderStatusChange } from '../orders/order-service.js';

export async function handleOrderStatusForDelivery(order: Order, _from: OrderStatus): Promise<void> {
    if (order.orderType !== 'delivery') return;

    if (order.status === 'CANCELLED') {
        const shipment = await findShipmentForOrder(order.restaurantId, order.id);
        if (!shipment || !canTransitionShipment(shipment.status, 'CANCELLED')) return;
        const job = await enqueueDeliveryJob({
            type: 'cancel',
            restaurantId: order.restaurantId,
            orderId: order.id,
            reason: order.cancelReason ?? 'Order cancelled',
            dedupeKey: `cancel:${order.id}`,
        });
        if (job) trackEvent('delivery_job_enqueued', { restaurantId: order.restaurantId, type: 'cancel', trigger: 'order_cancelled' });
        return;
    }

    const restaurant = await findRestaurantById(order.restaurantId);
    const settings = resolveDeliverySettings(restaurant?.deliverySettings);
    if (!settings.dispatchEnabled || order.status !== settings.dispatchAt) return;
    const job = await enqueueDeliveryJob({ type: 'dispatch', restaurantId: order.restaurantId, orderId: order.id, dedupeKey: `dispatch:${order.id}` });
    if (job) trackEvent('delivery_job_enqueued', { restaurantId: order.restaurantId, type: 'dispatch', trigger: order.status });
}

let unregister: (() => void) | null = null;

/** Call once at startup. Returns the unregister function. */
export function registerDeliveryDispatch(): () => void {
    if (!unregister) unregister = onOrderStatusChange(handleOrderStatusForDelivery);
    const off = unregister;
    return () => {
        off();
        unregister = null;
    };
}
