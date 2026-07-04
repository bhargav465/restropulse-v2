/**
 * Public storefront routes (v1) — mounted at /api/storefront/:slug
 *
 * Multi-tenant: every route is scoped to the restaurant resolved from the
 * URL slug. Customer-authenticated routes additionally verify the customer
 * token belongs to this restaurant.
 */

import express, { Request, Response, NextFunction } from 'express';
import { MongoServerError } from 'mongodb';
import {
    findRestaurantBySlug,
    findStorefrontContent,
    findMenuCategories,
    findMenuItems,
    findMenuItemsByIds,
    findCustomerByEmail,
    findCustomerById,
    findOrderById,
    findOrderByIdempotencyKey,
    getCustomersCollection,
    getOrdersCollection,
    getReservationsCollection,
    toApiFormat,
    toApiFormatArray,
    toObjectId,
} from '@restropulse/db';
import type {
    ApiResponse,
    Restaurant,
    Order,
    OrderType,
    OrderStatusHistoryEntry,
    Customer,
    PublicCustomer,
    CustomerAddress,
} from '@restropulse/shared';
import { handle } from '../middleware/async-handler.js';
import { requireCustomerAuth } from '../middleware/customer-auth.js';
import { simpleRateLimit } from '../middleware/simple-rate-limit.js';
import { generateCustomerTokens } from '../services/jwt.js';
import { hashPassword, verifyPassword } from '../services/password.js';
import { computeOrderTotals, OrderValidationError, RequestedOrderItem } from '../services/ordering/totals.js';
import { emitOrderingEvent } from '../services/ordering/events.js';
import { randomUUID } from 'node:crypto';
import { createLogger } from '@restropulse/telemetry/server';

const log = createLogger('storefront');

// mergeParams so :slug from the mount path is visible here
const router = express.Router({ mergeParams: true });

const ORDER_TYPES: OrderType[] = ['delivery', 'pickup', 'dine_in'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toPublicCustomer(customer: Customer): PublicCustomer {
    const { passwordHash: _passwordHash, ...rest } = customer;
    return rest;
}

function generateOrderNumber(): string {
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    const time = Date.now().toString(36).slice(-4).toUpperCase();
    return `ORD-${time}${rand}`;
}

// ----- Slug resolution middleware -----

/** Resolves :slug to a restaurant and stores it on res.locals.restaurant. */
function restaurantMiddleware(req: Request, res: Response, next: NextFunction): void {
    const slug = req.params.slug;
    if (!slug) {
        res.status(400).json({ success: false, error: 'Storefront slug is required' });
        return;
    }
    findRestaurantBySlug(slug)
        .then((restaurant) => {
            if (!restaurant) {
                res.status(404).json({ success: false, error: 'Storefront not found' });
                return;
            }
            res.locals.restaurant = restaurant;
            next();
        })
        .catch(next);
}

router.use(restaurantMiddleware);

/** Ensures a customer token belongs to this storefront's restaurant. */
function requireSameStorefront(req: Request, res: Response, next: NextFunction): void {
    const restaurant = res.locals.restaurant as Restaurant;
    if (req.user!.restaurantId !== restaurant.id) {
        res.status(403).json({ success: false, error: 'Forbidden' });
        return;
    }
    next();
}

const customerAuth = [requireCustomerAuth, requireSameStorefront];

// ============================================
// Public: config + menu
// ============================================

// GET /api/storefront/:slug/config — published content + open state
router.get('/config', handle(async (_req: Request, res: Response<ApiResponse>) => {
    const restaurant = res.locals.restaurant as Restaurant;
    const contentDoc = await findStorefrontContent(restaurant.id);

    res.json({
        success: true,
        data: {
            restaurant: {
                id: restaurant.id,
                name: restaurant.name,
                slug: restaurant.slug,
                cuisine: restaurant.cuisine,
                storeOpen: restaurant.storeOpen === true,
                ordering: restaurant.ordering ?? null,
            },
            content: contentDoc?.published ?? null,
            storeOpen: restaurant.storeOpen === true,
        },
    });
}));

// GET /api/storefront/:slug/menu — categories + items (hidden excluded, sold-out flagged)
router.get('/menu', handle(async (_req: Request, res: Response<ApiResponse>) => {
    const restaurant = res.locals.restaurant as Restaurant;
    const [categories, items] = await Promise.all([
        findMenuCategories(restaurant.id),
        findMenuItems(restaurant.id, { includeHidden: false }),
    ]);

    const itemsByCategory = new Map<string, unknown[]>();
    for (const item of items) {
        const list = itemsByCategory.get(item.categoryId) ?? [];
        list.push({
            id: item.id,
            categoryId: item.categoryId,
            name: item.name,
            description: item.description,
            price: item.price,
            images: item.images ?? [],
            isVeg: item.isVeg,
            variants: item.variants ?? [],
            addons: item.addons ?? [],
            sortOrder: item.sortOrder,
            soldOut: item.availability === 'out_of_stock',
        });
        itemsByCategory.set(item.categoryId, list);
    }

    res.json({
        success: true,
        data: {
            categories: categories.map((c) => ({
                id: c.id,
                name: c.name,
                description: c.description,
                sortOrder: c.sortOrder,
                items: itemsByCategory.get(c.id) ?? [],
            })),
        },
    });
}));

// ============================================
// Public: analytics ingest (lightly rate-limited)
// ============================================

router.post(
    '/events',
    simpleRateLimit({ windowMs: 60_000, max: 60, name: 'storefront-events' }),
    handle(async (req: Request, res: Response<ApiResponse>) => {
        const restaurant = res.locals.restaurant as Restaurant;
        const { name, sessionId, payload, customerId } = req.body ?? {};

        if (typeof name !== 'string' || !name.trim() || typeof sessionId !== 'string' || !sessionId.trim()) {
            return res.status(400).json({ success: false, error: 'name and sessionId are required' });
        }
        if (name.length > 100 || sessionId.length > 100) {
            return res.status(400).json({ success: false, error: 'name/sessionId too long' });
        }

        emitOrderingEvent({
            name: name.trim(),
            restaurantId: restaurant.id,
            sessionId: sessionId.trim(),
            ...(typeof customerId === 'string' && customerId ? { customerId } : {}),
            ...(payload && typeof payload === 'object' ? { payload } : {}),
        });

        res.status(202).json({ success: true });
    }),
);

// ============================================
// Customer auth (register / login) — distinct from merchant auth
// ============================================

const authRateLimit = simpleRateLimit({ windowMs: 60_000, max: 20, name: 'storefront-auth' });

router.post('/auth/register', authRateLimit, handle(async (req: Request, res: Response<ApiResponse>) => {
    const restaurant = res.locals.restaurant as Restaurant;
    const { email, password, name, phone } = req.body ?? {};

    if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
        return res.status(400).json({ success: false, error: 'A valid email is required' });
    }
    if (typeof password !== 'string' || password.length < 8) {
        return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existing = await findCustomerByEmail(restaurant.id, normalizedEmail);
    if (existing) {
        return res.status(409).json({ success: false, error: 'An account with this email already exists' });
    }

    const passwordHash = await hashPassword(password);
    const doc = {
        restaurantId: restaurant.id,
        email: normalizedEmail,
        name: typeof name === 'string' ? name.trim() : undefined,
        phone: typeof phone === 'string' ? phone.trim() : undefined,
        passwordHash,
        addresses: [] as CustomerAddress[],
        role: 'customer' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    let customerId: string;
    try {
        const result = await getCustomersCollection().insertOne(doc);
        customerId = result.insertedId.toString();
    } catch (err) {
        // Unique index race: two concurrent registrations for the same email
        if (err instanceof MongoServerError && err.code === 11000) {
            return res.status(409).json({ success: false, error: 'An account with this email already exists' });
        }
        throw err;
    }

    const tokens = generateCustomerTokens(customerId, normalizedEmail, restaurant.id);

    emitOrderingEvent({ name: 'customer_registered', restaurantId: restaurant.id, customerId });

    res.status(201).json({
        success: true,
        data: {
            customer: toPublicCustomer({ ...doc, id: customerId } as unknown as Customer),
            token: tokens.accessToken,
            refreshToken: tokens.refreshToken,
        },
    });
}));

router.post('/auth/login', authRateLimit, handle(async (req: Request, res: Response<ApiResponse>) => {
    const restaurant = res.locals.restaurant as Restaurant;
    const { email, password } = req.body ?? {};

    if (typeof email !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ success: false, error: 'Email and password are required' });
    }

    const customer = await findCustomerByEmail(restaurant.id, email.toLowerCase().trim());
    const valid = customer?.passwordHash ? await verifyPassword(password, customer.passwordHash) : false;

    if (!customer || !valid) {
        emitOrderingEvent({ name: 'customer_login_failed', restaurantId: restaurant.id });
        return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    const tokens = generateCustomerTokens(customer.id, customer.email, restaurant.id);

    emitOrderingEvent({ name: 'customer_login', restaurantId: restaurant.id, customerId: customer.id });

    res.json({
        success: true,
        data: {
            customer: toPublicCustomer(customer),
            token: tokens.accessToken,
            refreshToken: tokens.refreshToken,
        },
    });
}));

// ============================================
// Customer profile + addresses (customer JWT)
// ============================================

router.get('/me', ...customerAuth, handle(async (req: Request, res: Response<ApiResponse<PublicCustomer>>) => {
    const customer = await findCustomerById(req.user!.userId);
    if (!customer) {
        return res.status(404).json({ success: false, error: 'Customer not found' });
    }
    res.json({ success: true, data: toPublicCustomer(customer) });
}));

router.get('/addresses', ...customerAuth, handle(async (req: Request, res: Response<ApiResponse<CustomerAddress[]>>) => {
    const customer = await findCustomerById(req.user!.userId);
    if (!customer) {
        return res.status(404).json({ success: false, error: 'Customer not found' });
    }
    res.json({ success: true, data: customer.addresses ?? [] });
}));

router.post('/addresses', ...customerAuth, handle(async (req: Request, res: Response<ApiResponse<CustomerAddress>>) => {
    const { label, line1, line2, city, pincode, phone } = req.body ?? {};

    if (typeof line1 !== 'string' || !line1.trim()) {
        return res.status(400).json({ success: false, error: 'line1 is required' });
    }

    const address: CustomerAddress = {
        id: randomUUID(),
        line1: line1.trim(),
        ...(typeof label === 'string' && label.trim() ? { label: label.trim() } : {}),
        ...(typeof line2 === 'string' && line2.trim() ? { line2: line2.trim() } : {}),
        ...(typeof city === 'string' && city.trim() ? { city: city.trim() } : {}),
        ...(typeof pincode === 'string' && pincode.trim() ? { pincode: pincode.trim() } : {}),
        ...(typeof phone === 'string' && phone.trim() ? { phone: phone.trim() } : {}),
    };

    const result = await getCustomersCollection().findOneAndUpdate(
        { _id: toObjectId(req.user!.userId) as any },
        { $push: { addresses: address } as any, $set: { updatedAt: new Date() } },
        { returnDocument: 'after' },
    );
    if (!result) {
        return res.status(404).json({ success: false, error: 'Customer not found' });
    }

    res.status(201).json({ success: true, data: address });
}));

// ============================================
// Orders (customer JWT)
// ============================================

router.post('/orders', ...customerAuth, handle(async (req: Request, res: Response<ApiResponse>) => {
    const restaurant = res.locals.restaurant as Restaurant;
    const customerId = req.user!.userId;
    const idempotencyKeyRaw = req.headers['idempotency-key'];
    const idempotencyKey = typeof idempotencyKeyRaw === 'string' && idempotencyKeyRaw.trim()
        ? idempotencyKeyRaw.trim()
        : undefined;

    // Idempotency: replay returns the previously created order.
    if (idempotencyKey) {
        const existing = await findOrderByIdempotencyKey(restaurant.id, idempotencyKey);
        if (existing) {
            return res.json({ success: true, data: existing, message: 'Duplicate request — returning existing order' });
        }
    }

    if (restaurant.storeOpen !== true) {
        return res.status(409).json({ success: false, error: 'The store is currently closed' });
    }

    const { items, orderType, address, notes } = req.body ?? {};

    if (!ORDER_TYPES.includes(orderType)) {
        return res.status(400).json({ success: false, error: `orderType must be one of: ${ORDER_TYPES.join(', ')}` });
    }

    const orderingSettings = restaurant.ordering ?? {};
    const typeEnabled =
        orderType === 'delivery' ? orderingSettings.delivery?.enabled !== false
        : orderType === 'pickup' ? orderingSettings.pickup?.enabled !== false
        : orderingSettings.dineIn?.enabled !== false;
    if (!typeEnabled) {
        return res.status(400).json({ success: false, error: `${orderType} orders are not available for this restaurant` });
    }

    if (orderType === 'delivery' && (typeof address !== 'object' || address === null || typeof address.line1 !== 'string' || !address.line1.trim())) {
        return res.status(400).json({ success: false, error: 'A delivery address with line1 is required for delivery orders' });
    }

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, error: 'Order must contain at least one item' });
    }

    const requested: RequestedOrderItem[] = items.map((i: Record<string, unknown>) => ({
        menuItemId: String(i?.menuItemId ?? ''),
        qty: Number(i?.qty ?? 0),
        ...(typeof i?.variantId === 'string' && i.variantId ? { variantId: i.variantId } : {}),
        ...(Array.isArray(i?.addonIds) ? { addonIds: (i.addonIds as unknown[]).map(String) } : {}),
    }));

    // Server-side price validation against the stored menu
    const menuItems = await findMenuItemsByIds(restaurant.id, requested.map((r) => r.menuItemId));

    let computed;
    try {
        computed = computeOrderTotals(requested, menuItems, {
            orderType,
            taxRatePercent: orderingSettings.taxRatePercent ?? 0,
            ...(orderingSettings.delivery
                ? { delivery: { flatFee: orderingSettings.delivery.flatFee, minOrder: orderingSettings.delivery.minOrder } }
                : {}),
        });
    } catch (err) {
        if (err instanceof OrderValidationError) {
            return res.status(400).json({ success: false, error: err.message, message: err.code });
        }
        throw err;
    }

    const customer = await findCustomerById(customerId);
    const now = new Date();
    // Payment is stubbed in v1: orders are created as PENDING_PAYMENT and
    // immediately transitioned to RECEIVED (history records both states).
    const statusHistory: OrderStatusHistoryEntry[] = [
        { status: 'PENDING_PAYMENT', at: now.toISOString(), note: 'Order created (payment stubbed in v1)' },
        { status: 'RECEIVED', at: now.toISOString(), note: 'Auto-confirmed — payment integration pending' },
    ];

    const doc = {
        restaurantId: restaurant.id,
        customerId,
        orderNumber: generateOrderNumber(),
        orderType,
        items: computed.items,
        totals: computed.totals,
        status: 'RECEIVED' as const,
        statusHistory,
        ...(orderType === 'delivery' ? { address } : {}),
        ...(typeof notes === 'string' && notes.trim() ? { notes: notes.trim() } : {}),
        customerName: customer?.name,
        customerPhone: (orderType === 'delivery' ? address?.phone : undefined) ?? customer?.phone,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        createdAt: now,
        updatedAt: now,
    };

    let order: Order;
    try {
        const result = await getOrdersCollection().insertOne(doc);
        order = { ...doc, id: result.insertedId.toString() } as unknown as Order;
    } catch (err) {
        // Idempotency race: concurrent duplicate submit hit the unique index
        if (err instanceof MongoServerError && err.code === 11000 && idempotencyKey) {
            const existing = await findOrderByIdempotencyKey(restaurant.id, idempotencyKey);
            if (existing) {
                return res.json({ success: true, data: existing, message: 'Duplicate request — returning existing order' });
            }
        }
        throw err;
    }

    emitOrderingEvent({
        name: 'order_placed',
        restaurantId: restaurant.id,
        customerId,
        payload: { orderId: order.id, orderType, total: order.totals.total, itemCount: order.items.length },
    });
    log.info({ orderId: order.id, restaurantId: restaurant.id, total: order.totals.total }, 'Order placed');

    res.status(201).json({ success: true, data: order });
}));

router.get('/orders', ...customerAuth, handle(async (req: Request, res: Response<ApiResponse<Order[]>>) => {
    const restaurant = res.locals.restaurant as Restaurant;
    const docs = await getOrdersCollection()
        .find({ restaurantId: restaurant.id, customerId: req.user!.userId })
        .sort({ createdAt: -1 })
        .limit(50)
        .toArray();
    res.json({ success: true, data: toApiFormatArray(docs) as Order[] });
}));

// Order tracking: customer JWT OR orderNumber+phone match (no auth).
// Registered before GET /orders/:id so "track" is not swallowed by :id.
router.get('/orders/:id/track', handle(async (req: Request, res: Response<ApiResponse>) => {
    const restaurant = res.locals.restaurant as Restaurant;
    const order = await findOrderById(req.params.id);

    if (!order || order.restaurantId !== restaurant.id) {
        return res.status(404).json({ success: false, error: 'Order not found' });
    }

    // Option 1: customer JWT that owns this order
    let authorized = false;
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
        const { verifyToken } = await import('../services/jwt.js');
        const payload = verifyToken(token);
        if (payload && payload.type === 'access' && payload.role === 'customer' && payload.userId === order.customerId) {
            authorized = true;
        }
    }

    // Option 2: orderNumber + phone match (query params)
    if (!authorized) {
        const { orderNumber, phone } = req.query;
        if (
            typeof orderNumber === 'string' && orderNumber === order.orderNumber &&
            typeof phone === 'string' && phone.trim() && order.customerPhone &&
            phone.replace(/\s/g, '') === order.customerPhone.replace(/\s/g, '')
        ) {
            authorized = true;
        }
    }

    if (!authorized) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    res.json({
        success: true,
        data: {
            orderNumber: order.orderNumber,
            status: order.status,
            orderType: order.orderType,
            statusHistory: order.statusHistory,
            placedAt: order.createdAt,
        },
    });
}));

router.get('/orders/:id', ...customerAuth, handle(async (req: Request, res: Response<ApiResponse<Order>>) => {
    const restaurant = res.locals.restaurant as Restaurant;
    const order = await findOrderById(req.params.id);

    if (!order || order.restaurantId !== restaurant.id || order.customerId !== req.user!.userId) {
        return res.status(404).json({ success: false, error: 'Order not found' });
    }

    res.json({ success: true, data: order });
}));

// ============================================
// Reservations (public — writes pending)
// ============================================

router.post(
    '/reservations',
    simpleRateLimit({ windowMs: 60_000, max: 10, name: 'storefront-reservations' }),
    handle(async (req: Request, res: Response<ApiResponse>) => {
        const restaurant = res.locals.restaurant as Restaurant;
        const { date, time, partySize, name, phone, email, notes } = req.body ?? {};

        const errors: string[] = [];
        if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push('date must be YYYY-MM-DD');
        if (typeof time !== 'string' || !/^\d{2}:\d{2}$/.test(time)) errors.push('time must be HH:mm');
        const size = Number(partySize);
        if (!Number.isInteger(size) || size < 1 || size > 100) errors.push('partySize must be a positive integer');
        if (typeof name !== 'string' || !name.trim()) errors.push('name is required');
        if (typeof phone !== 'string' || !phone.trim()) errors.push('phone is required');

        if (errors.length > 0) {
            return res.status(400).json({ success: false, error: errors.join('; ') });
        }

        const now = new Date();
        const doc = {
            restaurantId: restaurant.id,
            date,
            time,
            partySize: size,
            name: (name as string).trim(),
            phone: (phone as string).trim(),
            ...(typeof email === 'string' && email.trim() ? { email: email.trim() } : {}),
            ...(typeof notes === 'string' && notes.trim() ? { notes: notes.trim() } : {}),
            status: 'pending' as const,
            createdAt: now,
            updatedAt: now,
        };
        const result = await getReservationsCollection().insertOne(doc);

        emitOrderingEvent({
            name: 'reservation_requested',
            restaurantId: restaurant.id,
            payload: { reservationId: result.insertedId.toString(), date, time, partySize: size },
        });

        res.status(201).json({ success: true, data: toApiFormat({ ...doc, _id: result.insertedId }) });
    }),
);

export default router;
