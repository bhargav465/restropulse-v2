/**
 * Rider dispatch for the restaurant (Phase 2, M4) -- mounted at /api/admin/delivery
 *
 *   GET  /settings                    dispatch settings + partners available here
 *   PUT  /settings                    save them
 *   GET  /orders/:orderId             the order's rider booking (or null) and any queued job
 *   POST /orders/:orderId/dispatch    find a rider now (queued for the dispatch worker)
 *   POST /orders/:orderId/own-rider   hand it to the restaurant's own riders
 *   POST /orders/:orderId/rider       own riders only: { status, riderName?, riderPhone? }
 *   POST /orders/:orderId/cancel      cancel the rider booking { reason } (before pickup)
 *
 * Partners are never called from here; dispatch and cancel are outbox jobs.
 * Auth: merchant JWT, OWNER or MANAGER.
 */

import express, { Request, Response } from 'express';
import { z } from 'zod';
import {
    enqueueDeliveryJob,
    findLatestDeliveryJob,
    findOrderById,
    findRestaurantById,
    findShipmentForOrder,
    insertShipment,
    mongoDeliveryStore,
    updateRestaurantDeliverySettings,
} from '@restropulse/db';
import { applyShipmentEvents, buildQuoteRequest } from '@restropulse/delivery';
import type { ApiResponse, DeliveryProviderId, Order, Restaurant, Shipment } from '@restropulse/shared';
import { canTransitionShipment, isTerminalShipment, resolveDeliverySettings } from '@restropulse/shared';
import { trackEvent } from '@restropulse/telemetry/server';
import { handle } from '../middleware/async-handler.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/require-role.js';
import { validateBody } from '../middleware/validate.js';
import { getDeliveryRegistry } from '../services/delivery/registry.js';
import { CancelShipmentBody, DeliverySettingsBody, OwnRiderStatusBody } from '../services/delivery/schemas.js';

const router = express.Router();
router.use(requireAuth, requireRole('OWNER', 'MANAGER'));

const rid = (req: Request) => req.user!.restaurantId;

/** Orders a rider can still be found for. */
const DISPATCHABLE = new Set(['RECEIVED', 'PREPARING', 'READY']);

function settingsView(restaurant: Restaurant) {
    const available = getDeliveryRegistry().list();
    const settings = resolveDeliverySettings(restaurant.deliverySettings);
    return {
        settings: { ...settings, providers: settings.providers.filter((p) => available.some((a) => a.id === p)) },
        providers: available,
    };
}

router.get('/settings', handle(async (req, res: Response<ApiResponse>) => {
    const restaurant = await findRestaurantById(rid(req));
    if (!restaurant) return res.status(404).json({ success: false, error: 'Restaurant not found' });
    res.json({ success: true, data: settingsView(restaurant) });
}));

router.put('/settings', validateBody(DeliverySettingsBody), handle(async (req, res: Response<ApiResponse>) => {
    const body = req.body as z.infer<typeof DeliverySettingsBody>;
    const registry = getDeliveryRegistry();
    const missing = body.providers.find((p) => !registry.has(p as DeliveryProviderId));
    if (missing) return res.status(400).json({ success: false, error: `${missing} isn't available yet.` });
    const settings = resolveDeliverySettings(body as never);
    const updated = await updateRestaurantDeliverySettings(rid(req), settings);
    if (!updated) return res.status(404).json({ success: false, error: 'Restaurant not found' });
    trackEvent('delivery_settings_saved', {
        restaurantId: rid(req),
        dispatchEnabled: String(settings.dispatchEnabled),
        providers: settings.providers.join(','),
    });
    res.json({ success: true, data: settingsView(updated) });
}));

async function loadDeliveryOrder(req: Request, res: Response): Promise<Order | null> {
    const id = req.params.orderId;
    const order = /^[\w-]{1,64}$/.test(id) ? await findOrderById(rid(req), id) : null;
    if (!order) {
        res.status(404).json({ success: false, error: 'Order not found' });
        return null;
    }
    if (order.orderType !== 'delivery') {
        res.status(400).json({ success: false, error: 'Only delivery orders have riders.' });
        return null;
    }
    return order;
}

async function shipmentView(order: Order) {
    const [shipment, job] = await Promise.all([
        findShipmentForOrder(order.restaurantId, order.id),
        findLatestDeliveryJob(order.restaurantId, order.id),
    ]);
    const open = job && (job.status === 'pending' || job.status === 'running');
    return {
        shipment,
        queued: open ? job.type : null,
        lastError: job?.status === 'failed' ? job.lastError ?? 'Could not reach the delivery partner.' : null,
    };
}

const isLive = (s: Shipment | null): s is Shipment => !!s && !isTerminalShipment(s.status);

router.get('/orders/:orderId', handle(async (req, res: Response<ApiResponse>) => {
    const order = await loadDeliveryOrder(req, res);
    if (!order) return;
    res.json({ success: true, data: await shipmentView(order) });
}));

router.post('/orders/:orderId/dispatch', handle(async (req, res: Response<ApiResponse>) => {
    const order = await loadDeliveryOrder(req, res);
    if (!order) return;
    if (!DISPATCHABLE.has(order.status)) return res.status(409).json({ success: false, error: 'This order is past the point of finding a rider.' });
    if (isLive(await findShipmentForOrder(order.restaurantId, order.id))) {
        return res.status(409).json({ success: false, error: 'A rider is already booked. Cancel it first.' });
    }
    await enqueueDeliveryJob({ type: 'dispatch', restaurantId: order.restaurantId, orderId: order.id, dedupeKey: `dispatch:${order.id}` });
    trackEvent('delivery_job_enqueued', { restaurantId: order.restaurantId, type: 'dispatch', trigger: 'manual' });
    res.status(202).json({ success: true, data: await shipmentView(order) });
}));

router.post('/orders/:orderId/own-rider', handle(async (req, res: Response<ApiResponse>) => {
    const order = await loadDeliveryOrder(req, res);
    if (!order) return;
    if (!DISPATCHABLE.has(order.status)) return res.status(409).json({ success: false, error: 'This order is past the point of assigning a rider.' });
    if (isLive(await findShipmentForOrder(order.restaurantId, order.id))) {
        return res.status(409).json({ success: false, error: 'A rider is already booked. Cancel it first.' });
    }
    const restaurant = await findRestaurantById(order.restaurantId);
    const quoteReq = restaurant && buildQuoteRequest(order, restaurant);
    if (!quoteReq) return res.status(400).json({ success: false, error: 'This order has no delivery address.' });
    // The own-rider adapter makes no network calls, so booking inline is safe.
    const self = getDeliveryRegistry().get('self')!;
    const booked = await self.createShipment(quoteReq, await self.quote(quoteReq));
    await insertShipment({
        restaurantId: order.restaurantId,
        orderId: order.id,
        provider: 'self',
        providerShipmentId: booked.providerShipmentId,
        status: booked.status,
        ...(booked.carrier ? { carrier: booked.carrier } : {}),
        events: [{ status: booked.status, at: new Date().toISOString(), source: 'restaurant', note: 'Your own riders' }],
    });
    trackEvent('delivery_dispatched', { restaurantId: order.restaurantId, provider: 'self', fellBackToSelf: 'false' });
    res.status(201).json({ success: true, data: await shipmentView(order) });
}));

router.post('/orders/:orderId/rider', validateBody(OwnRiderStatusBody), handle(async (req, res: Response<ApiResponse>) => {
    const order = await loadDeliveryOrder(req, res);
    if (!order) return;
    const body = req.body as z.infer<typeof OwnRiderStatusBody>;
    const shipment = await findShipmentForOrder(order.restaurantId, order.id);
    if (!shipment || shipment.provider !== 'self') {
        return res.status(409).json({ success: false, error: 'Only orders with your own rider can be updated here.' });
    }
    if (!canTransitionShipment(shipment.status, body.status)) {
        return res.status(409).json({ success: false, error: 'That step is already done or no longer possible.' });
    }
    const rider = body.riderName || body.riderPhone
        ? { ...(body.riderName ? { name: body.riderName } : {}), ...(body.riderPhone ? { phone: body.riderPhone } : {}) }
        : undefined;
    const result = await applyShipmentEvents(mongoDeliveryStore, shipment, [{
        eventId: `self:${body.status}:${Date.now()}`,
        providerShipmentId: shipment.providerShipmentId,
        status: body.status,
        at: new Date().toISOString(),
        ...(rider ? { rider } : {}),
    }], 'restaurant');
    if (!result.applied) return res.status(409).json({ success: false, error: 'The rider booking changed. Refresh and try again.' });
    trackEvent('delivery_own_rider_update', { restaurantId: order.restaurantId, status: body.status });
    const fresh = await findOrderById(order.restaurantId, order.id);
    res.json({ success: true, data: { ...(await shipmentView(order)), orderStatus: fresh?.status ?? order.status } });
}));

router.post('/orders/:orderId/cancel', validateBody(CancelShipmentBody), handle(async (req, res: Response<ApiResponse>) => {
    const order = await loadDeliveryOrder(req, res);
    if (!order) return;
    const body = req.body as z.infer<typeof CancelShipmentBody>;
    const shipment = await findShipmentForOrder(order.restaurantId, order.id);
    if (!isLive(shipment)) return res.status(409).json({ success: false, error: 'There is no rider booking to cancel.' });
    if (!canTransitionShipment(shipment.status, 'CANCELLED')) {
        return res.status(409).json({ success: false, error: 'The rider already has the food, so the booking can no longer be cancelled.' });
    }
    await enqueueDeliveryJob({ type: 'cancel', restaurantId: order.restaurantId, orderId: order.id, reason: body.reason, dedupeKey: `cancel:${order.id}` });
    trackEvent('delivery_job_enqueued', { restaurantId: order.restaurantId, type: 'cancel', trigger: 'manual' });
    res.status(202).json({ success: true, data: await shipmentView(order) });
}));

export default router;
