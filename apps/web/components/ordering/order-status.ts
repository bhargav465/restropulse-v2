/**
 * Order status state machine — client mirror of
 * apps/api/src/services/ordering/status.ts. Used to render only the valid
 * next-status buttons; the API remains the source of truth and re-validates.
 */
import type { OrderStatus, OrderType } from '@restropulse/shared';

export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
    PENDING_PAYMENT: ['RECEIVED', 'PAYMENT_FAILED', 'CANCELLED'],
    PAYMENT_FAILED: ['PENDING_PAYMENT', 'CANCELLED'],
    RECEIVED: ['PREPARING', 'CANCELLED'],
    PREPARING: ['READY', 'CANCELLED'],
    READY: ['OUT_FOR_DELIVERY', 'COMPLETED', 'CANCELLED'],
    OUT_FOR_DELIVERY: ['COMPLETED', 'CANCELLED'],
    COMPLETED: [],
    CANCELLED: [],
};

export const ORDER_STATUSES: OrderStatus[] = Object.keys(ORDER_STATUS_TRANSITIONS) as OrderStatus[];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
    PENDING_PAYMENT: 'Pending Payment',
    PAYMENT_FAILED: 'Payment Failed',
    RECEIVED: 'Received',
    PREPARING: 'Preparing',
    READY: 'Ready',
    OUT_FOR_DELIVERY: 'Out for Delivery',
    COMPLETED: 'Completed',
    CANCELLED: 'Cancelled',
};

export function canTransitionOrderStatus(from: OrderStatus, to: OrderStatus, orderType: OrderType): boolean {
    if (!ORDER_STATUS_TRANSITIONS[from]?.includes(to)) return false;
    if (to === 'OUT_FOR_DELIVERY' && orderType !== 'delivery') return false;
    if (from === 'READY' && to === 'COMPLETED' && orderType === 'delivery') return false;
    return true;
}

/** Valid next statuses for an order, respecting its order type. */
export function nextStatusOptions(status: OrderStatus, orderType: OrderType): OrderStatus[] {
    return ORDER_STATUS_TRANSITIONS[status].filter((to) => canTransitionOrderStatus(status, to, orderType));
}
