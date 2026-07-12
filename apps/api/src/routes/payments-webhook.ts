/**
 * Razorpay ordering-payments webhook — mounted at /api/payments/webhook.
 *
 * Signature-gated (no auth). Handler mirrors the subscriptions webhook
 * (apps/api/src/routes/subscriptions.ts): the raw request body is required for
 * HMAC verification, so server.ts mounts express.raw() for this path BEFORE the
 * JSON parser — exactly like the subscriptions webhook (a sibling raw mount).
 *
 * Reconciles ordering payments: `payment.captured` confirms the order,
 * `payment.failed` marks it PAYMENT_FAILED. All transitions are rank-safe:
 * a captured payment is never regressed and an advanced order is never rewound.
 * Unknown provider orders (e.g. subscription payments) are logged and ignored
 * with a 200 so Razorpay does not retry.
 */

import express, { Request, Response } from 'express';
import {
    findPaymentByProviderOrderId,
    findOrderById,
    getOrdersCollection,
    getPaymentsCollection,
    toObjectId,
} from '@restropulse/db';
import type { PaymentEventEntry } from '@restropulse/shared';
import { verifyWebhookSignature } from '../services/razorpay.js';
import { emitOrderingEvent } from '../services/ordering/events.js';
import { canTransitionOrderStatus } from '../services/ordering/status.js';
import { createLogger } from '@restropulse/telemetry/server';

const log = createLogger('payments-webhook');

const router = express.Router();

// POST /webhook — Razorpay ordering-payments webhook (no auth, signature verified)
router.post('/webhook', async (req: Request, res: Response) => {
    try {
        const signature = req.headers['x-razorpay-signature'] as string;
        if (!signature) {
            return res.status(400).json({ success: false, error: 'Missing signature' });
        }

        // express.raw() always yields a Buffer — HMAC must be computed over the
        // original bytes, never JSON.stringify(buffer).
        const rawBody = req.body as Buffer;

        if (!verifyWebhookSignature(rawBody, signature)) {
            return res.status(401).json({ success: false, error: 'Invalid signature' });
        }

        const event = JSON.parse(rawBody.toString('utf8'));
        const eventType = event.event as string;
        const entity = event?.payload?.payment?.entity;

        log.info({ eventType }, 'Razorpay payments webhook received');

        if (eventType !== 'payment.captured' && eventType !== 'payment.failed') {
            // Not an ordering-payment event we handle (could be subscriptions).
            return res.json({ success: true });
        }

        const providerOrderId = entity?.order_id as string | undefined;
        if (!providerOrderId) {
            return res.json({ success: true });
        }

        const payment = await findPaymentByProviderOrderId(providerOrderId);
        if (!payment) {
            // Unknown to the ordering collection — likely a subscription payment.
            log.info({ providerOrderId, eventType }, 'payments webhook: no matching ordering payment — ignoring');
            return res.json({ success: true });
        }

        const nowIso = new Date().toISOString();

        if (eventType === 'payment.captured') {
            if (payment.status !== 'captured') {
                await getPaymentsCollection().updateOne(
                    { orderId: payment.orderId, status: { $ne: 'captured' } },
                    {
                        $set: { status: 'captured', signatureVerified: true, providerPaymentId: entity.id, updatedAt: new Date() },
                        $push: { events: { at: nowIso, type: 'webhook:payment.captured', source: 'webhook', providerPaymentId: entity.id } } as any,
                    },
                );

                const order = await findOrderById(payment.orderId);
                if (order && order.status === 'PENDING_PAYMENT') {
                    const result = await getOrdersCollection().findOneAndUpdate(
                        { _id: toObjectId(order.id) as any, restaurantId: payment.restaurantId, status: 'PENDING_PAYMENT' },
                        {
                            $set: { status: 'RECEIVED', updatedAt: new Date() },
                            $push: { statusHistory: { status: 'RECEIVED', at: nowIso, note: 'Payment received' } } as any,
                        },
                        { returnDocument: 'after' },
                    );
                    if (result) {
                        emitOrderingEvent({ name: 'order_status_changed', restaurantId: payment.restaurantId, payload: { orderId: order.id, from: 'PENDING_PAYMENT', to: 'RECEIVED' } });
                        emitOrderingEvent({ name: 'order_placed', restaurantId: payment.restaurantId, customerId: order.customerId, payload: { orderId: order.id, orderType: order.orderType, total: order.totals.total, itemCount: order.items.length } });
                        emitOrderingEvent({ name: 'payment_succeeded', restaurantId: payment.restaurantId, customerId: order.customerId, payload: { orderId: order.id, total: order.totals.total, providerPaymentId: entity.id } });
                        log.info({ orderId: order.id, restaurantId: payment.restaurantId }, 'payments webhook: order confirmed via capture');
                    }
                }
            }
            return res.json({ success: true });
        }

        // eventType === 'payment.failed'
        const failEvent: PaymentEventEntry = {
            at: nowIso,
            type: 'webhook:payment.failed',
            source: 'webhook',
            ...(entity.id ? { providerPaymentId: entity.id } : {}),
            ...(entity.error_code ? { errorCode: entity.error_code } : {}),
            ...(entity.error_description ? { errorDescription: entity.error_description } : {}),
        };
        // Rank-safe: never overwrite a captured payment with a late failure event.
        await getPaymentsCollection().updateOne(
            { orderId: payment.orderId, status: { $ne: 'captured' } },
            {
                $set: { status: 'failed', updatedAt: new Date() },
                $push: { events: failEvent } as any,
            },
        );

        const failedOrder = await findOrderById(payment.orderId);
        if (
            failedOrder &&
            failedOrder.status === 'PENDING_PAYMENT' &&
            canTransitionOrderStatus('PENDING_PAYMENT', 'PAYMENT_FAILED', failedOrder.orderType)
        ) {
            const result = await getOrdersCollection().findOneAndUpdate(
                { _id: toObjectId(failedOrder.id) as any, restaurantId: payment.restaurantId, status: 'PENDING_PAYMENT' },
                {
                    $set: { status: 'PAYMENT_FAILED', updatedAt: new Date() },
                    $push: { statusHistory: { status: 'PAYMENT_FAILED', at: nowIso, note: 'Payment failed' } } as any,
                },
                { returnDocument: 'after' },
            );
            if (result) {
                emitOrderingEvent({ name: 'order_status_changed', restaurantId: payment.restaurantId, payload: { orderId: failedOrder.id, from: 'PENDING_PAYMENT', to: 'PAYMENT_FAILED' } });
                emitOrderingEvent({ name: 'payment_failed', restaurantId: payment.restaurantId, customerId: failedOrder.customerId, payload: { orderId: failedOrder.id, total: failedOrder.totals.total, ...(entity.error_code ? { errorCode: entity.error_code } : {}) } });
                log.info({ orderId: failedOrder.id, restaurantId: payment.restaurantId }, 'payments webhook: order marked payment-failed');
            }
        }

        return res.json({ success: true });
    } catch (err) {
        log.error({ err }, 'payments webhook processing failed');
        return res.status(500).json({ success: false, error: 'Webhook processing failed' });
    }
});

export default router;
