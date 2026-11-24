/**
 * Delivery partner webhooks (Phase 2, M4) -- mounted at
 * /api/webhooks/delivery/:provider with express.raw (signatures are over the
 * exact bytes).
 *
 * Each partner verifies and parses its own payload into canonical events.
 * Every event is recorded once (provider + eventId, unique) so redeliveries
 * are skipped; when applying an event fails, its receipt is removed and we
 * answer 500 so the partner sends it again.
 */

import express, { Request, Response } from 'express';
import {
    findShipmentByProviderId,
    forgetDeliveryWebhookEvent,
    mongoDeliveryStore,
    recordDeliveryWebhookEvent,
} from '@restropulse/db';
import { applyShipmentEvents } from '@restropulse/delivery';
import { isDeliveryProviderId } from '@restropulse/shared';
import { createLogger, trackEvent } from '@restropulse/telemetry/server';
import { getDeliveryRegistry } from '../services/delivery/registry.js';

const log = createLogger('delivery-webhook');
const router = express.Router();

function lowerHeaders(req: Request): Record<string, string | undefined> {
    const out: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(req.headers)) out[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
    return out;
}

router.post('/:provider', async (req: Request, res: Response) => {
    const id = req.params.provider;
    const provider = isDeliveryProviderId(id) ? getDeliveryRegistry().get(id) : undefined;
    if (!provider) return res.status(404).json({ success: false, error: 'Unknown delivery partner' });

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    if (!provider.verifyWebhook({ headers: lowerHeaders(req), rawBody })) {
        log.warn({ provider: provider.id }, 'delivery webhook signature rejected');
        return res.status(401).json({ success: false, error: 'Invalid signature' });
    }

    const counts = { received: 0, applied: 0, duplicates: 0, unknown: 0 };
    for (const event of provider.parseWebhook(rawBody)) {
        counts.received += 1;
        let recorded = false;
        try {
            if (!(await recordDeliveryWebhookEvent(provider.id, event.eventId))) {
                counts.duplicates += 1;
                continue;
            }
            recorded = true;
            const shipment = await findShipmentByProviderId(provider.id, event.providerShipmentId);
            if (!shipment) {
                counts.unknown += 1;
                log.warn({ provider: provider.id, eventId: event.eventId }, 'delivery webhook for an unknown shipment');
                continue;
            }
            const result = await applyShipmentEvents(mongoDeliveryStore, shipment, [event], 'provider');
            counts.applied += result.applied;
        } catch (err) {
            log.error({ err, provider: provider.id, eventId: event.eventId }, 'delivery webhook event failed');
            if (recorded) await forgetDeliveryWebhookEvent(provider.id, event.eventId).catch(() => undefined);
            return res.status(500).json({ success: false, error: 'Try again' });
        }
    }
    trackEvent('delivery_webhook_received', { provider: provider.id, received: String(counts.received), applied: String(counts.applied) });
    res.json({ success: true, data: counts });
});

export default router;
