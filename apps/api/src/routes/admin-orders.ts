/**
 * Restaurant order management (Phase 2, M2) -- mounted at /api/admin/orders
 *
 *   GET  /                 feed (?status=active|all|<STATUS>, ?since, ?limit)
 *   GET  /settings         ordering settings + site address (slug)
 *   PUT  /settings         save them (slug must be unique)
 *   GET  /:id              one order
 *   POST /:id/status       { to, note? }   validated against the status machine
 *   POST /:id/cancel       { reason, refund? }  refunds paid online orders by default
 *
 * Auth: merchant JWT, OWNER or MANAGER (same as /api/admin/cms).
 */

import express, { Request, Response } from 'express';
import { z } from 'zod';
import {
    DuplicateRestaurantSlugError,
    findOrderById,
    findOrders,
    findShipmentsForOrders,
    findRestaurantById,
    updateRestaurantOrdering,
} from '@restropulse/db';
import type { ApiResponse, OrderStatus, Restaurant, Shipment } from '@restropulse/shared';
import {
    ACTIVE_ORDER_STATUSES,
    isOrderStatus,
    resolveOrderingSettings,
    slugifyRestaurantName,
} from '@restropulse/shared';
import { trackEvent } from '@restropulse/telemetry/server';
import { handle } from '../middleware/async-handler.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/require-role.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { isRazorpayConfigured } from '../services/razorpay.js';
import { CancelBody, FeedQuery, OrderingSettingsBody, StatusBody } from '../services/orders/schemas.js';
import { advanceOrder, cancelOrder, OrderFlowError } from '../services/orders/order-service.js';

const router = express.Router();

router.use(requireAuth, requireRole('OWNER', 'MANAGER'));

const rid = (req: Request) => req.user!.restaurantId;

function sendFlowError(res: Response, err: unknown): boolean {
    if (err instanceof OrderFlowError) {
        res.status(err.status).json({ success: false, error: err.message, code: err.code } as ApiResponse & { code: string });
        return true;
    }
    return false;
}

/** The customer's tracking token and checkout key stay out of the dashboard. */
const strip = <T extends { trackingToken?: string; idempotencyKey?: string }>({ trackingToken: _t, idempotencyKey: _k, ...o }: T) => o;

/** Statuses for the feed's ?status filter. "active" = the kitchen's open orders. */
function statusFilter(raw: string | undefined): OrderStatus[] | undefined | null {
    if (!raw || raw === 'all') return undefined;
    if (raw === 'active') return [...ACTIVE_ORDER_STATUSES];
    const parts = raw.split(',').map((s) => s.trim().toUpperCase());
    return parts.every(isOrderStatus) ? (parts as OrderStatus[]) : null;
}

router.get('/', validateQuery(FeedQuery), handle(async (req, res: Response<ApiResponse>) => {
    const q = res.locals.query as z.infer<typeof FeedQuery>;
    const statuses = statusFilter(q.status);
    if (statuses === null) return res.status(400).json({ success: false, error: 'Unknown status filter.' });
    const orders = await findOrders(rid(req), {
        ...(statuses ? { statuses } : {}),
        ...(q.since ? { since: new Date(q.since) } : {}),
        ...(q.limit ? { limit: q.limit } : {}),
    });
    // Rider status for delivery orders, so the board can show it without a call per order.
    const deliveryIds = orders.filter((o) => o.orderType === 'delivery').map((o) => o.id);
    const shipments = new Map<string, Shipment>((await findShipmentsForOrders(rid(req), deliveryIds)).map((s) => [s.orderId, s]));
    const withDelivery = orders.map((o) => {
        const s = shipments.get(o.id);
        return { ...strip(o), ...(s ? { delivery: { status: s.status, provider: s.provider, ...(s.carrier ? { carrier: s.carrier } : {}) } } : {}) };
    });
    // serverTime is the next poll's ?since (the dashboard's clock may drift).
    res.json({ success: true, data: { orders: withDelivery, serverTime: new Date().toISOString() } });
}));

function settingsView(restaurant: Restaurant) {
    return {
        slug: restaurant.slug ?? null,
        suggestedSlug: restaurant.slug ?? slugifyRestaurantName(restaurant.name ?? ''),
        ordering: resolveOrderingSettings(restaurant.ordering),
        onlinePaymentsAvailable: isRazorpayConfigured(),
    };
}

router.get('/settings', handle(async (req, res: Response<ApiResponse>) => {
    const restaurant = await findRestaurantById(rid(req));
    if (!restaurant) return res.status(404).json({ success: false, error: 'Restaurant not found' });
    res.json({ success: true, data: settingsView(restaurant) });
}));

router.put('/settings', validateBody(OrderingSettingsBody), handle(async (req, res: Response<ApiResponse>) => {
    const body = req.body as z.infer<typeof OrderingSettingsBody>;
    const restaurant = await findRestaurantById(rid(req));
    if (!restaurant) return res.status(404).json({ success: false, error: 'Restaurant not found' });
    const o = body.ordering;
    if (o.storeOpen) {
        const slug = body.slug ?? restaurant.slug;
        if (!slug) return res.status(400).json({ success: false, error: 'Choose a web address before opening for orders.' });
        if (!o.delivery.enabled && !o.pickup.enabled && !o.dineIn.enabled) {
            return res.status(400).json({ success: false, error: 'Turn on delivery, pickup or dine-in before opening for orders.' });
        }
        if (!o.cashAccepted && !isRazorpayConfigured()) {
            return res.status(400).json({ success: false, error: "Online payments aren't set up yet. Accept cash to open for orders." });
        }
    }
    try {
        const updated = await updateRestaurantOrdering(rid(req), {
            ordering: o,
            ...(body.slug !== undefined ? { slug: body.slug } : {}),
        });
        if (!updated) return res.status(404).json({ success: false, error: 'Restaurant not found' });
        trackEvent('storefront_settings_saved', { restaurantId: rid(req), storeOpen: String(o.storeOpen) });
        res.json({ success: true, data: settingsView(updated) });
    } catch (err) {
        if (err instanceof DuplicateRestaurantSlugError) {
            return res.status(409).json({ success: false, error: 'That web address is taken. Try another.' });
        }
        throw err;
    }
}));

async function loadOrder(req: Request, res: Response) {
    const order = /^[\w-]{1,64}$/.test(req.params.id) ? await findOrderById(rid(req), req.params.id) : null;
    if (!order) res.status(404).json({ success: false, error: 'Order not found' });
    return order;
}

router.get('/:id', handle(async (req, res: Response<ApiResponse>) => {
    const order = await loadOrder(req, res);
    if (!order) return;
    res.json({ success: true, data: strip(order) });
}));

router.post('/:id/status', validateBody(StatusBody), handle(async (req, res: Response<ApiResponse>) => {
    const order = await loadOrder(req, res);
    if (!order) return;
    const body = req.body as z.infer<typeof StatusBody>;
    try {
        const moved = await advanceOrder(order, body.to as OrderStatus, body.note);
        res.json({ success: true, data: strip(moved) });
    } catch (err) {
        if (!sendFlowError(res, err)) throw err;
    }
}));

router.post('/:id/cancel', validateBody(CancelBody), handle(async (req, res: Response<ApiResponse>) => {
    const order = await loadOrder(req, res);
    if (!order) return;
    const body = req.body as z.infer<typeof CancelBody>;
    try {
        const result = await cancelOrder(order, body.reason, body.refund ?? true);
        res.json({ success: true, data: { order: strip(result.order), refund: result.refund } });
    } catch (err) {
        if (!sendFlowError(res, err)) throw err;
    }
}));

export default router;
