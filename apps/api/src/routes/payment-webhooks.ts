/**
 * Razorpay webhook for storefront order payments (Phase 2, M2) --
 * mounted at /api/webhooks/razorpay/orders with express.raw (signature needs
 * the exact bytes).
 *
 * Handles payment.captured, order.paid, payment.failed and refund.processed.
 * Anything that isn't one of our storefront payments (subscription and credit
 * pack payments go to /api/subscriptions/webhook) is acknowledged and ignored.
 * Redeliveries are skipped by event id (payment_webhook_events).
 *
 * Setup (Bhargav, in the Razorpay dashboard): add a webhook pointing at
 * <api>/api/webhooks/razorpay/orders with the events above, using the same
 * secret as RAZORPAY_WEBHOOK_SECRET.
 */

import crypto from 'crypto';
import express, { Request, Response } from 'express';
import {
    findPaymentByProviderOrderId,
    findPaymentByProviderPaymentId,
    forgetPaymentWebhookEvent,
    recordPaymentWebhookEvent,
} from '@restropulse/db';
import { createLogger, trackEvent } from '@restropulse/telemetry/server';
import { verifyWebhookSignature } from '../services/razorpay.js';
import { confirmPayment, failPayment, settleRefund } from '../services/orders/order-service.js';

const log = createLogger('order-payments-webhook');
const router = express.Router();

const HANDLED = new Set(['payment.captured', 'order.paid', 'payment.failed', 'refund.processed']);

interface RazorpayEvent {
    event?: string;
    payload?: {
        payment?: { entity?: { id?: string; order_id?: string; error_code?: string; error_description?: string } };
        refund?: { entity?: { id?: string; payment_id?: string } };
        order?: { entity?: { id?: string } };
    };
}

function safeVerify(raw: Buffer, signature: string | undefined): boolean {
    if (!signature) return false;
    try {
        return verifyWebhookSignature(raw, signature);
    } catch {
        return false; // length mismatch, or the secret isn't configured
    }
}

router.post('/', async (req: Request, res: Response) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : '');
    if (!safeVerify(raw, req.get('x-razorpay-signature'))) {
        log.warn({}, 'order webhook signature rejected');
        return res.status(400).json({ success: false, error: 'Invalid signature' });
    }

    let event: RazorpayEvent;
    try {
        event = JSON.parse(raw.toString('utf8')) as RazorpayEvent;
    } catch {
        return res.status(400).json({ success: false, error: 'Invalid payload' });
    }
    const type = event.event ?? '';
    if (!HANDLED.has(type)) return res.json({ success: true, data: { ignored: true } });

    const eventId = req.get('x-razorpay-event-id') || crypto.createHash('sha256').update(raw).digest('hex');
    try {
        if (!(await recordPaymentWebhookEvent(eventId, 'razorpay', type))) {
            return res.json({ success: true, data: { duplicate: true } });
        }
    } catch (err) {
        log.error({ err }, 'could not record webhook event');
        return res.status(500).json({ success: false, error: 'Try again' });
    }

    try {
        const paymentEntity = event.payload?.payment?.entity;
        if (type === 'refund.processed') {
            const refund = event.payload?.refund?.entity;
            const payment = refund?.payment_id ? await findPaymentByProviderPaymentId(refund.payment_id) : null;
            if (!payment) return res.json({ success: true, data: { ignored: true } });
            await settleRefund(payment, refund?.id ?? '', eventId);
        } else {
            const providerOrderId = paymentEntity?.order_id ?? event.payload?.order?.entity?.id;
            const payment = providerOrderId ? await findPaymentByProviderOrderId(providerOrderId) : null;
            if (!payment) return res.json({ success: true, data: { ignored: true } });
            if (type === 'payment.failed') {
                await failPayment(payment, {
                    eventId,
                    ...(paymentEntity?.id ? { providerPaymentId: paymentEntity.id } : {}),
                    ...(paymentEntity?.error_code ? { errorCode: paymentEntity.error_code } : {}),
                    ...(paymentEntity?.error_description ? { errorDescription: paymentEntity.error_description.slice(0, 200) } : {}),
                });
            } else if (paymentEntity?.id) {
                await confirmPayment(payment, paymentEntity.id, 'webhook', eventId);
            }
        }
        trackEvent('storefront_payment_webhook', { type });
        return res.json({ success: true });
    } catch (err) {
        // Let Razorpay retry: forget the id so the redelivery is processed.
        log.error({ err, type }, 'order webhook handling failed');
        await forgetPaymentWebhookEvent(eventId).catch(() => undefined);
        return res.status(500).json({ success: false, error: 'Try again' });
    }
});

export default router;
