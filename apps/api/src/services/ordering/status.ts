/**
 * Order status state machine (v1).
 * Pure functions — unit tested in tests/unit/ordering-status.test.ts.
 */

import type { OrderStatus, OrderType } from '@restropulse/shared';

/** Allowed forward transitions per status. */
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
    PENDING_PAYMENT: ['RECEIVED', 'CANCELLED'],
    RECEIVED: ['PREPARING', 'CANCELLED'],
    PREPARING: ['READY', 'CANCELLED'],
    READY: ['OUT_FOR_DELIVERY', 'COMPLETED', 'CANCELLED'],
    OUT_FOR_DELIVERY: ['COMPLETED', 'CANCELLED'],
    COMPLETED: [],
    CANCELLED: [],
};

export const ORDER_STATUSES: OrderStatus[] = Object.keys(ORDER_STATUS_TRANSITIONS) as OrderStatus[];

export function isOrderStatus(value: unknown): value is OrderStatus {
    return typeof value === 'string' && (ORDER_STATUSES as string[]).includes(value);
}

/**
 * Validates a status transition.
 * - Follows ORDER_STATUS_TRANSITIONS.
 * - OUT_FOR_DELIVERY is only valid for delivery orders.
 * - READY → COMPLETED is only valid for non-delivery orders (pickup/dine-in
 *   complete at handoff; delivery must pass through OUT_FOR_DELIVERY).
 */
export function canTransitionOrderStatus(from: OrderStatus, to: OrderStatus, orderType: OrderType): boolean {
    if (!ORDER_STATUS_TRANSITIONS[from]?.includes(to)) return false;
    if (to === 'OUT_FOR_DELIVERY' && orderType !== 'delivery') return false;
    if (from === 'READY' && to === 'COMPLETED' && orderType === 'delivery') return false;
    return true;
}
