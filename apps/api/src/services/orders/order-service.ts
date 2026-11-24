/**
 * Order service (Phase 2, M2): checkout, payment confirmation, status moves,
 * cancellation with refund. Routes stay thin; everything that touches more than
 * one collection lives here so the public, admin and webhook paths agree.
 *
 * Pricing is always server-side (priceOrder in @restropulse/shared) from the
 * stored catalog; client prices are never read.
 */

import crypto from 'crypto';
import {
    findLatestPaymentForOrder,
    findMenuItems,
    findOfferByCode,
    findOrderById,
    findSiteOffers,
    insertOrder,
    insertPayment,
    OrderReferenceCollisionError,
    setOrderPaymentStatus,
    transitionOrder,
    updatePayment,
} from '@restropulse/db';
import type {
    Order,
    OrderAddress,
    OrderStatus,
    OrderType,
    Payment,
    PaymentIntent,
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
    toPaise,
} from '@restropulse/shared';
import { createLogger, trackEvent } from '@restropulse/telemetry/server';
import {
    createRazorpayOrder,
    getRazorpayKeyId,
    isRazorpayConfigured,
    refundRazorpayPayment,
} from '../razorpay.js';

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
    paymentMethod: PaymentMethod;
    customerName: string;
    customerPhone: string;
    address?: OrderAddress;
    table?: string;
    notes?: string;
}

export interface CheckoutResult {
    order: Order;
    /** Present for online orders still awaiting payment. */
    payment?: PaymentIntent;
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
    if (input.paymentMethod === 'cash' && !settings.cashAccepted) {
        throw new OrderFlowError(400, 'CASH_NOT_ACCEPTED', 'This restaurant only takes online payment.');
    }
    if (input.paymentMethod === 'online' && !isRazorpayConfigured()) {
        throw new OrderFlowError(503, 'PAYMENTS_UNAVAILABLE', 'Online payment is not available right now.');
    }

    const priced = await priceCart(restaurant, input);
    const online = input.paymentMethod === 'online';
    if (online && toPaise(priced.totals.total) < 100) {
        // Razorpay's minimum order amount is ₹1.
        throw new OrderFlowError(400, 'TOTAL_TOO_LOW', 'Online payment needs an order total of at least ₹1.');
    }
    const status: OrderStatus = online ? 'PENDING_PAYMENT' : 'RECEIVED';
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
                paymentMethod: input.paymentMethod,
                paymentStatus: online ? 'pending' : 'not_required',
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
        if (order.status === 'RECEIVED') await notifyListeners(order, 'RECEIVED');
    }

    if (order.status !== 'PENDING_PAYMENT' && order.status !== 'PAYMENT_FAILED') return { order, created };

    // A retried checkout reuses the open payment attempt instead of opening another.
    const existing = created ? null : await findLatestPaymentForOrder(restaurant.id, order.id);
    const payment = existing && existing.status === 'created' ? existing : await openPayment(order);
    return { order, created, payment: toIntent(payment) };
}

function toIntent(payment: Payment): PaymentIntent {
    return { providerOrderId: payment.providerOrderId, keyId: getRazorpayKeyId(), amount: payment.amount, currency: 'INR' };
}

async function openPayment(order: Order): Promise<Payment> {
    const amount = toPaise(order.totals.total);
    const rzp = await createRazorpayOrder(amount, order.orderNumber, 'INR', {
        kind: 'storefront_order',
        orderId: order.id,
        restaurantId: order.restaurantId,
    });
    return insertPayment({
        restaurantId: order.restaurantId,
        orderId: order.id,
        provider: 'razorpay',
        providerOrderId: rzp.id,
        amount,
        currency: 'INR',
        status: 'created',
        events: [{ at: new Date().toISOString(), type: 'intent_created', source: 'intent' }],
    });
}

/** A new payment attempt after a failed or abandoned one. */
export async function retryPayment(order: Order): Promise<PaymentIntent> {
    if (order.status === 'PAYMENT_FAILED') {
        const moved = await transitionOrder(order.restaurantId, order.id, 'PAYMENT_FAILED', 'PENDING_PAYMENT', { by: 'customer', note: 'Payment retried' }, { paymentStatus: 'pending' });
        if (!moved) throw new OrderFlowError(409, 'ORDER_CHANGED', 'This order has changed. Refresh and try again.');
    } else if (order.status !== 'PENDING_PAYMENT') {
        throw new OrderFlowError(409, 'NOT_AWAITING_PAYMENT', 'This order is not waiting for payment.');
    }
    if (!isRazorpayConfigured()) throw new OrderFlowError(503, 'PAYMENTS_UNAVAILABLE', 'Online payment is not available right now.');
    return toIntent(await openPayment(order));
}

// ----- Payment confirmation (verify + webhook) -----

/**
 * Mark a payment captured and move its order to RECEIVED. Idempotent: an order
 * already past payment is returned unchanged. Called by the checkout verify
 * route (after the signature check) and by the payment.captured webhook.
 */
export async function confirmPayment(
    payment: Payment,
    providerPaymentId: string,
    source: 'verify' | 'webhook',
    eventId?: string,
): Promise<Order | null> {
    if (payment.status !== 'captured') {
        await updatePayment(payment.id, { status: 'captured', providerPaymentId }, {
            type: source === 'verify' ? 'verify_ok' : 'webhook:payment.captured',
            source,
            providerPaymentId,
            ...(eventId ? { eventId } : {}),
        });
    }
    const order = await findOrderById(payment.restaurantId, payment.orderId);
    if (!order) return null;
    if (order.status !== 'PENDING_PAYMENT' && order.status !== 'PAYMENT_FAILED') {
        if (order.status === 'CANCELLED' && order.paymentStatus !== 'refunded' && order.paymentStatus !== 'refund_pending') {
            // Paid after the restaurant cancelled: refund straight away.
            await refundForOrder(order, { ...payment, status: 'captured', providerPaymentId }, 'Paid after cancellation');
        }
        return order;
    }
    const moved = await transitionOrder(order.restaurantId, order.id, order.status, 'RECEIVED', { by: 'system', note: 'Payment received' }, { paymentStatus: 'paid' });
    if (!moved) return findOrderById(payment.restaurantId, payment.orderId);
    trackEvent('storefront_order_paid', { restaurantId: order.restaurantId, source, total: String(order.totals.total) });
    await notifyListeners(moved, order.status);
    return moved;
}

/** A failed attempt; the customer can retry, so the order stays open. */
export async function failPayment(
    payment: Payment,
    detail: { providerPaymentId?: string; errorCode?: string; errorDescription?: string; eventId?: string },
): Promise<Order | null> {
    if (payment.status === 'captured' || payment.status === 'refunded' || payment.status === 'refund_pending') {
        return findOrderById(payment.restaurantId, payment.orderId);
    }
    await updatePayment(payment.id, { status: 'failed', providerPaymentId: detail.providerPaymentId }, {
        type: 'webhook:payment.failed',
        source: 'webhook',
        ...detail,
    });
    const moved = await transitionOrder(payment.restaurantId, payment.orderId, 'PENDING_PAYMENT', 'PAYMENT_FAILED', { by: 'system', note: 'Payment failed' }, { paymentStatus: 'failed' });
    return moved ?? findOrderById(payment.restaurantId, payment.orderId);
}

/** Refund settled (refund.processed webhook). */
export async function settleRefund(payment: Payment, refundId: string, eventId?: string): Promise<void> {
    if (payment.status !== 'refunded') {
        await updatePayment(payment.id, { status: 'refunded', providerRefundId: refundId }, {
            type: 'webhook:refund.processed',
            source: 'webhook',
            ...(eventId ? { eventId } : {}),
        });
    }
    await setOrderPaymentStatus(payment.restaurantId, payment.orderId, 'refunded');
}

// ----- Restaurant actions -----

export async function advanceOrder(order: Order, to: OrderStatus, note?: string): Promise<Order> {
    if (to === 'CANCELLED') throw new OrderFlowError(400, 'USE_CANCEL', 'Use cancel to cancel an order.');
    if (order.status === 'PENDING_PAYMENT' || order.status === 'PAYMENT_FAILED') {
        throw new OrderFlowError(409, 'AWAITING_PAYMENT', 'This order is still waiting for payment.');
    }
    if (!canTransitionOrderStatus(order.status, to, order.orderType)) {
        throw new OrderFlowError(409, 'INVALID_TRANSITION', `An order that is ${order.status.toLowerCase().replace(/_/g, ' ')} can't move to ${to.toLowerCase().replace(/_/g, ' ')}.`);
    }
    const moved = await transitionOrder(order.restaurantId, order.id, order.status, to, { by: 'restaurant', ...(note ? { note } : {}) });
    if (!moved) throw new OrderFlowError(409, 'ORDER_CHANGED', 'This order was just updated. Refresh to see its latest status.');
    trackEvent('storefront_order_status', { restaurantId: order.restaurantId, from: order.status, to });
    await notifyListeners(moved, order.status);
    return moved;
}

export interface CancelResult {
    order: Order;
    refund: 'none' | 'requested' | 'failed';
}

/**
 * Cancel an order. A paid online order is refunded in full unless `refund` is
 * false. A refund that Razorpay rejects leaves the order cancelled with
 * paymentStatus 'paid' and returns refund: 'failed' so the merchant can act.
 */
export async function cancelOrder(order: Order, reason: string, refund: boolean = true): Promise<CancelResult> {
    if (!canTransitionOrderStatus(order.status, 'CANCELLED', order.orderType)) {
        throw new OrderFlowError(409, 'INVALID_TRANSITION', 'This order can no longer be cancelled.');
    }
    const moved = await transitionOrder(order.restaurantId, order.id, order.status, 'CANCELLED', { by: 'restaurant', note: reason }, { cancelReason: reason });
    if (!moved) throw new OrderFlowError(409, 'ORDER_CHANGED', 'This order was just updated. Refresh to see its latest status.');
    trackEvent('storefront_order_cancelled', { restaurantId: order.restaurantId, from: order.status, paid: String(order.paymentStatus === 'paid') });
    await notifyListeners(moved, order.status);

    if (!refund || order.paymentMethod !== 'online' || order.paymentStatus !== 'paid') return { order: moved, refund: 'none' };
    const payment = await findLatestPaymentForOrder(order.restaurantId, order.id);
    if (!payment || payment.status !== 'captured' || !payment.providerPaymentId) {
        log.warn({ orderId: order.id }, 'paid order has no captured payment to refund');
        return { order: moved, refund: 'failed' };
    }
    const outcome = await refundForOrder(moved, payment, reason);
    return { order: (await findOrderById(order.restaurantId, order.id)) ?? moved, refund: outcome };
}

async function refundForOrder(order: Order, payment: Payment, reason: string): Promise<'requested' | 'failed'> {
    try {
        const refund = await refundRazorpayPayment(payment.providerPaymentId!, {
            notes: { orderId: order.id, reason: reason.slice(0, 200) },
        });
        await updatePayment(payment.id, { status: 'refund_pending', providerRefundId: refund.id }, { type: 'refund_requested', source: 'restaurant' });
        await setOrderPaymentStatus(order.restaurantId, order.id, 'refund_pending');
        trackEvent('storefront_order_refund_requested', { restaurantId: order.restaurantId, total: String(order.totals.total) });
        return 'requested';
    } catch (err) {
        log.error({ err, orderId: order.id }, 'refund request failed');
        await updatePayment(payment.id, {}, {
            type: 'refund_failed',
            source: 'restaurant',
            errorDescription: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
        });
        return 'failed';
    }
}

/** Test-only: drop every registered status listener. */
export function _resetOrderListeners(): void {
    listeners.length = 0;
}
