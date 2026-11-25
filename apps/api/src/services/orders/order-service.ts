/**
 * Order service (Phase 2, M2): checkout, status moves and cancellation.
 * Orders are paid in cash (at the counter, at the table or on delivery), so
 * there is no payment step. Routes stay thin; everything that touches more
 * than one collection lives here so the public and admin paths agree.
 *
 * Pricing is always server-side (priceOrder in @restropulse/shared) from the
 * stored catalog; client prices are never read.
 */

import crypto from 'crypto';
import {
    findMenuItems,
    findOfferByCode,
    findSiteOffers,
    insertOrder,
    OrderReferenceCollisionError,
    transitionOrder,
} from '@restropulse/db';
import type {
    Order,
    OrderAddress,
    OrderStatus,
    OrderType,
    PaymentMethod,
    PricedOrder,
    RequestedOrderItem,
    Restaurant,
} from '@restropulse/shared';
import {
    canTransitionOrderStatus,
    isOrderTypeEnabled,
    normaliseOfferCode,
    OrderValidationError,
    priceOrder,
    resolveOrderingSettings,
} from '@restropulse/shared';
import { createLogger, trackEvent } from '@restropulse/telemetry/server';

const log = createLogger('orders');

/** A request the customer or merchant can fix; routes map `status` straight to HTTP. */
export class OrderFlowError extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string, message: string) {
        super(message);
        this.name = 'OrderFlowError';
        this.status = status;
        this.code = code;
    }
}

// ----- References -----

const REF_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'; // no 0/O/1/I/L/U

export function newOrderNumber(): string {
    let ref = '';
    for (let i = 0; i < 6; i += 1) ref += REF_ALPHABET[crypto.randomInt(REF_ALPHABET.length)];
    return `RP-${ref}`;
}

export function newTrackingToken(): string {
    return crypto.randomBytes(18).toString('base64url');
}

/** Constant-time compare for the customer's tracking token. */
export function tokenMatches(order: Pick<Order, 'trackingToken'>, token: unknown): boolean {
    if (typeof token !== 'string' || token.length !== order.trackingToken.length) return false;
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(order.trackingToken));
}

// ----- Status listeners (seam for M4 delivery dispatch at READY) -----

export type OrderStatusListener = (order: Order, from: OrderStatus) => Promise<void> | void;
const listeners: OrderStatusListener[] = [];

/** Register a hook that runs after every successful status move. Errors are logged, never thrown. */
export function onOrderStatusChange(listener: OrderStatusListener): () => void {
    listeners.push(listener);
    return () => {
        const i = listeners.indexOf(listener);
        if (i >= 0) listeners.splice(i, 1);
    };
}

async function notifyListeners(order: Order, from: OrderStatus): Promise<void> {
    for (const listener of listeners) {
        try {
            await listener(order, from);
        } catch (err) {
            log.error({ err, orderId: order.id, status: order.status }, 'order status listener failed');
        }
    }
}

// ----- Pricing -----

export interface CartInput {
    orderType: OrderType;
    items: RequestedOrderItem[];
    offerCode?: string;
}

/** Price a cart for a restaurant (quote and checkout share this). */
export async function priceCart(restaurant: Restaurant, cart: CartInput, now: Date = new Date()): Promise<PricedOrder> {
    const settings = resolveOrderingSettings(restaurant.ordering);
    if (!isOrderTypeEnabled(settings, cart.orderType)) {
        throw new OrderFlowError(400, 'ORDER_TYPE_DISABLED', 'This restaurant is not taking that kind of order right now.');
    }
    const catalog = await findMenuItems(restaurant.id);
    const code = normaliseOfferCode(cart.offerCode);
    let offer;
    if (code) {
        offer = await findOfferByCode(restaurant.id, code);
        if (!offer) throw new OrderFlowError(400, 'OFFER_NOT_FOUND', "We couldn't find that code.");
    }
    const autoOffers = code ? [] : await findSiteOffers(restaurant.id);
    try {
        return priceOrder(cart.items, catalog, { orderType: cart.orderType, settings, offer: offer ?? undefined, autoOffers, now });
    } catch (err) {
        if (err instanceof OrderValidationError) throw new OrderFlowError(400, err.code, err.message);
        throw err;
    }
}

// ----- Checkout -----

export interface CheckoutInput extends CartInput {
    /** Always cash; kept so older clients that send it still validate. */
    paymentMethod?: PaymentMethod;
    customerName: string;
    customerPhone: string;
    address?: OrderAddress;
    table?: string;
    notes?: string;
}

export interface CheckoutResult {
    order: Order;
    /** False when the Idempotency-Key matched an earlier order. */
    created: boolean;
}

export async function checkout(
    restaurant: Restaurant,
    input: CheckoutInput,
    idempotencyKey: string | undefined,
): Promise<CheckoutResult> {
    const settings = resolveOrderingSettings(restaurant.ordering);
    if (!settings.storeOpen) throw new OrderFlowError(409, 'STORE_CLOSED', 'This restaurant is not taking orders right now.');
    if (input.orderType === 'delivery' && !input.address) {
        throw new OrderFlowError(400, 'ADDRESS_REQUIRED', 'Add a delivery address.');
    }

    const priced = await priceCart(restaurant, input);
    const status: OrderStatus = 'RECEIVED';
    const nowIso = new Date().toISOString();

    let result: { order: Order; created: boolean } | undefined;
    for (let attempt = 0; attempt < 3 && !result; attempt += 1) {
        try {
            result = await insertOrder({
                restaurantId: restaurant.id,
                orderNumber: newOrderNumber(),
                trackingToken: newTrackingToken(),
                orderType: input.orderType,
                items: priced.items,
                totals: priced.totals,
                ...(priced.offer ? { offer: priced.offer } : {}),
                status,
                statusHistory: [{ status, at: nowIso, by: 'customer' }],
                paymentMethod: 'cash',
                customerName: input.customerName,
                customerPhone: input.customerPhone,
                ...(input.orderType === 'delivery' && input.address ? { address: input.address } : {}),
                ...(input.orderType === 'dine_in' && input.table ? { table: input.table } : {}),
                ...(input.notes ? { notes: input.notes } : {}),
                ...(idempotencyKey ? { idempotencyKey } : {}),
            });
        } catch (err) {
            if (!(err instanceof OrderReferenceCollisionError)) throw err;
        }
    }
    if (!result) throw new Error('Could not allocate an order number');

    const { order, created } = result;
    if (created) {
        trackEvent('storefront_order_created', {
            restaurantId: restaurant.id,
            orderType: order.orderType,
            paymentMethod: order.paymentMethod,
            total: String(order.totals.total),
            offer: order.offer?.offerId ?? '',
        });
        await notifyListeners(order, 'RECEIVED');
    }
    return { order, created };
}

// ----- Restaurant actions -----

export async function advanceOrder(order: Order, to: OrderStatus, note?: string): Promise<Order> {
    if (to === 'CANCELLED') throw new OrderFlowError(400, 'USE_CANCEL', 'Use cancel to cancel an order.');
    if (!canTransitionOrderStatus(order.status, to, order.orderType)) {
        throw new OrderFlowError(409, 'INVALID_TRANSITION', `An order that is ${order.status.toLowerCase().replace(/_/g, ' ')} can't move to ${to.toLowerCase().replace(/_/g, ' ')}.`);
    }
    const moved = await transitionOrder(order.restaurantId, order.id, order.status, to, { by: 'restaurant', ...(note ? { note } : {}) });
    if (!moved) throw new OrderFlowError(409, 'ORDER_CHANGED', 'This order was just updated. Refresh to see its latest status.');
    trackEvent('storefront_order_status', { restaurantId: order.restaurantId, from: order.status, to });
    await notifyListeners(moved, order.status);
    return moved;
}

/** Cancel an order. Orders are paid in cash, so there is nothing to refund. */
export async function cancelOrder(order: Order, reason: string): Promise<Order> {
    if (!canTransitionOrderStatus(order.status, 'CANCELLED', order.orderType)) {
        throw new OrderFlowError(409, 'INVALID_TRANSITION', 'This order can no longer be cancelled.');
    }
    const moved = await transitionOrder(order.restaurantId, order.id, order.status, 'CANCELLED', { by: 'restaurant', note: reason }, { cancelReason: reason });
    if (!moved) throw new OrderFlowError(409, 'ORDER_CHANGED', 'This order was just updated. Refresh to see its latest status.');
    trackEvent('storefront_order_cancelled', { restaurantId: order.restaurantId, from: order.status });
    await notifyListeners(moved, order.status);
    return moved;
}

/** Test-only: drop every registered status listener. */
export function _resetOrderListeners(): void {
    listeners.length = 0;
}
