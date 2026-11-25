/**
 * Public storefront API (Phase 2, M2) -- mounted at /api/storefront
 *
 * Unauthenticated, keyed by the restaurant's slug. Customers check out as
 * guests (name + phone) and pay in cash at the counter, at the table or on
 * delivery; the order's tracking token is their proof of ownership for tracking.
 * ASSUMPTION: no customer accounts in v1 (the Vercel line's customers
 * collection is not ported); a returning-customer login can sit on top later.
 *
 *   GET  /:slug                          site config (name, ordering settings, published content)
 *   GET  /:slug/menu                     catalog + live site offers
 *   POST /:slug/quote                    price a cart (no order created)
 *   POST /:slug/orders                   checkout; Idempotency-Key header honoured
 *   GET  /:slug/orders/:id?token=        tracking
 */

import express, { Request, Response } from 'express';
import { z } from 'zod';
import {
    findMenuCategories,
    findMenuItems,
    findOrderById,
    findRestaurantBySlug,
    findSiteOffers,
    findStorefrontContent,
    findShipmentForOrder,
} from '@restropulse/db';
import type { ApiResponse, Restaurant } from '@restropulse/shared';
import { describeOffer, isOfferLive, isValidRestaurantSlug, resolveOrderingSettings, toPublicOrder, toPublicShipment } from '@restropulse/shared';
import { createLogger } from '@restropulse/telemetry/server';
import { handle } from '../middleware/async-handler.js';
import { createRateLimiter } from '../middleware/rate-limit.js';
import { validateBody } from '../middleware/validate.js';
import {
    CheckoutBody,
    QuoteBody,
    readIdempotencyKey,
} from '../services/orders/schemas.js';
import {
    checkout,
    OrderFlowError,
    priceCart,
    tokenMatches,
    type CheckoutInput,
} from '../services/orders/order-service.js';

const log = createLogger('storefront');
const router = express.Router();

// ASSUMPTION: 60 checkout-side writes per 10 minutes per IP. A busy office on
// one NAT stays well under it; card-testing scripts don't.
const writeLimiter = createRateLimiter({
    name: 'storefront-write',
    windowMs: 10 * 60_000,
    limit: 60,
    message: 'Too many attempts. Please wait a few minutes and try again.',
});

const notFound = (res: Response) => res.status(404).json({ success: false, error: 'Restaurant not found' });

/** Resolve :slug to a restaurant; responds 404 itself and returns null when missing. */
async function loadRestaurant(req: Request, res: Response): Promise<Restaurant | null> {
    const slug = String(req.params.slug ?? '').toLowerCase();
    if (!isValidRestaurantSlug(slug)) {
        notFound(res);
        return null;
    }
    const restaurant = await findRestaurantBySlug(slug);
    if (!restaurant) notFound(res);
    return restaurant;
}

function sendFlowError(res: Response, err: unknown): boolean {
    if (err instanceof OrderFlowError) {
        res.status(err.status).json({ success: false, error: err.message, code: err.code } as ApiResponse & { code: string });
        return true;
    }
    return false;
}

/** The ordering settings a customer may see. */
function publicOrdering(restaurant: Restaurant) {
    const s = resolveOrderingSettings(restaurant.ordering);
    return {
        storeOpen: s.storeOpen,
        orderTypes: {
            delivery: s.delivery.enabled,
            pickup: s.pickup.enabled,
            dineIn: s.dineIn.enabled,
        },
        delivery: { flatFee: s.delivery.flatFee, minOrder: s.delivery.minOrder, ...(s.delivery.freeAbove !== undefined ? { freeAbove: s.delivery.freeAbove } : {}) },
        taxRatePercent: s.taxRatePercent,
    };
}

router.get('/:slug', handle(async (req, res: Response<ApiResponse>) => {
    const restaurant = await loadRestaurant(req, res);
    if (!restaurant) return;
    const content = await findStorefrontContent(restaurant.id);
    res.json({
        success: true,
        data: {
            restaurant: {
                id: restaurant.id,
                name: restaurant.name,
                cuisine: restaurant.cuisine,
                slug: restaurant.slug,
                ...(restaurant.phone ? { phone: restaurant.phone } : {}),
                ...(restaurant.location?.address ? { address: restaurant.location.address } : {}),
            },
            ordering: publicOrdering(restaurant),
            content: content?.published ?? null,
        },
    });
}));

router.get('/:slug/menu', handle(async (req, res: Response<ApiResponse>) => {
    const restaurant = await loadRestaurant(req, res);
    if (!restaurant) return;
    const now = new Date();
    const [categories, items, offers] = await Promise.all([
        findMenuCategories(restaurant.id),
        findMenuItems(restaurant.id),
        findSiteOffers(restaurant.id),
    ]);
    res.json({
        success: true,
        data: {
            categories: categories.map(({ id, name, description, sortOrder }) => ({ id, name, description, sortOrder })),
            items: items.map(({ restaurantId: _r, createdAt: _c, updatedAt: _u, ...item }) => item),
            offers: offers
                .filter((o) => isOfferLive(o, now))
                .map((o) => ({
                    id: o.id,
                    title: o.title,
                    ...(o.description ? { description: o.description } : {}),
                    summary: describeOffer(o),
                    ...(o.code ? { code: o.code } : {}),
                    ...(o.bannerImage ? { bannerImage: o.bannerImage } : {}),
                })),
        },
    });
}));

router.post('/:slug/quote', writeLimiter, validateBody(QuoteBody), handle(async (req, res: Response<ApiResponse>) => {
    const restaurant = await loadRestaurant(req, res);
    if (!restaurant) return;
    try {
        const priced = await priceCart(restaurant, req.body as CheckoutInput);
        res.json({ success: true, data: priced });
    } catch (err) {
        if (!sendFlowError(res, err)) throw err;
    }
}));

router.post('/:slug/orders', writeLimiter, validateBody(CheckoutBody), handle(async (req, res: Response<ApiResponse>) => {
    const restaurant = await loadRestaurant(req, res);
    if (!restaurant) return;
    const key = readIdempotencyKey(req.get('Idempotency-Key') ?? undefined);
    if (key === null) {
        return res.status(400).json({ success: false, error: 'Idempotency-Key must be 8 to 100 visible characters.' });
    }
    try {
        const result = await checkout(restaurant, req.body as z.infer<typeof CheckoutBody> as CheckoutInput, key);
        res.status(result.created ? 201 : 200).json({
            success: true,
            data: {
                order: toPublicOrder(result.order),
                // The customer keeps this to track the order; it is shown once, here.
                trackingToken: result.order.trackingToken,
            },
        });
    } catch (err) {
        if (!sendFlowError(res, err)) throw err;
    }
}));

/** Load the order for a customer call; 404 unless the token matches (no existence leak). */
async function loadCustomerOrder(req: Request, res: Response, token: unknown) {
    const restaurant = await loadRestaurant(req, res);
    if (!restaurant) return null;
    const order = /^[\w-]{1,64}$/.test(req.params.id) ? await findOrderById(restaurant.id, req.params.id) : null;
    if (!order || !tokenMatches(order, token)) {
        res.status(404).json({ success: false, error: 'Order not found' });
        return null;
    }
    return order;
}

router.get('/:slug/orders/:id', handle(async (req, res: Response<ApiResponse>) => {
    const order = await loadCustomerOrder(req, res, req.query.token);
    if (!order) return;
    // Rider progress for delivery orders (Phase 2, M4); never the rider's phone.
    const shipment = order.orderType === 'delivery' ? await findShipmentForOrder(order.restaurantId, order.id) : null;
    res.json({ success: true, data: { order: toPublicOrder(order), delivery: shipment ? toPublicShipment(shipment) : null } });
}));

export default router;
