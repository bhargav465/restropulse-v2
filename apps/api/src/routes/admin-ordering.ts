/**
 * Merchant admin routes for online ordering (v1) — mounted at /api/admin/ordering
 * Auth: existing merchant JWT (requireAuth) + OWNER role.
 * All operations are scoped to req.user.restaurantId.
 */

import express, { Request, Response } from 'express';
import multer from 'multer';
import {
    findRestaurantById,
    updateRestaurant,
    findMenuCategories,
    findMenuCategoryById,
    findMenuItems,
    findStorefrontContent,
    findOrderById,
    findReservationById,
    getMenuCategoriesCollection,
    getMenuItemsCollection,
    getOrdersCollection,
    getReservationsCollection,
    getStorefrontContentCollection,
    getEventsCollection,
    getCustomersCollection,
    getCampaignsCollection,
    toApiFormat,
    toApiFormatArray,
    toObjectId,
} from '@restropulse/db';
import type {
    ApiResponse,
    CampaignDiscount,
    CampaignKind,
    CampaignQueuedResponse,
    CohortId,
    CustomerCohort,
    MenuCategory,
    OrderingMenuItem,
    MenuItemAvailability,
    Order,
    Reservation,
    ReservationStatus,
    StorefrontContent,
    StorefrontVersionEntry,
} from '@restropulse/shared';
import { STOREFRONT_VERSION_HISTORY_LIMIT } from '@restropulse/shared';
import { handle } from '../middleware/async-handler.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/require-role.js';
import { isOrderStatus, canTransitionOrderStatus, ORDER_STATUS_TRANSITIONS } from '../services/ordering/status.js';
import { parseMenuCsv } from '../services/ordering/menu-csv.js';
import { emitOrderingEvent } from '../services/ordering/events.js';
import {
    buildCohorts,
    computeCohorts,
    COHORT_CATALOG,
    DROP_OFF_WINDOW_DAYS,
    type CohortEventRow,
    type CohortOrderRow,
} from '../services/ordering/cohorts.js';
import { randomUUID } from 'node:crypto';
import { createLogger } from '@restropulse/telemetry/server';

const log = createLogger('admin-ordering');

const router = express.Router();

// Merchant auth for everything below (OWNER only)
router.use(requireAuth, requireRole('OWNER'));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

const AVAILABILITIES: MenuItemAvailability[] = ['in_stock', 'out_of_stock', 'hidden'];
const RESERVATION_DECISIONS: ReservationStatus[] = ['confirmed', 'declined', 'no_show'];

function restaurantId(req: Request): string {
    return req.user!.restaurantId;
}

interface VariantOrAddonInput { id?: unknown; name?: unknown; price?: unknown }

function sanitizeVariantsOrAddons(raw: unknown): Array<{ id: string; name: string; price: number }> | null {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) return null;
    const out: Array<{ id: string; name: string; price: number }> = [];
    for (const entry of raw as VariantOrAddonInput[]) {
        const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
        const price = Number(entry?.price);
        if (!name || !Number.isFinite(price) || price < 0) return null;
        out.push({ id: typeof entry.id === 'string' && entry.id ? entry.id : randomUUID(), name, price });
    }
    return out;
}

// ============================================
// Menu: categories
// ============================================

router.get('/menu/categories', handle(async (req: Request, res: Response<ApiResponse<MenuCategory[]>>) => {
    res.json({ success: true, data: await findMenuCategories(restaurantId(req)) });
}));

router.post('/menu/categories', handle(async (req: Request, res: Response<ApiResponse<MenuCategory>>) => {
    const { name, description, sortOrder } = req.body ?? {};
    if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ success: false, error: 'Category name is required' });
    }

    const existing = await findMenuCategories(restaurantId(req));
    const doc = {
        restaurantId: restaurantId(req),
        name: name.trim(),
        ...(typeof description === 'string' && description.trim() ? { description: description.trim() } : {}),
        sortOrder: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : existing.length + 1,
        createdAt: new Date(),
        updatedAt: new Date(),
    };
    const result = await getMenuCategoriesCollection().insertOne(doc);
    res.status(201).json({ success: true, data: toApiFormat({ ...doc, _id: result.insertedId }) as unknown as MenuCategory });
}));

router.patch('/menu/categories/:id', handle(async (req: Request, res: Response<ApiResponse<MenuCategory>>) => {
    const { name, description, sortOrder } = req.body ?? {};
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) {
        if (typeof name !== 'string' || !name.trim()) {
            return res.status(400).json({ success: false, error: 'Category name cannot be empty' });
        }
        updates.name = name.trim();
    }
    if (description !== undefined) updates.description = typeof description === 'string' ? description.trim() : '';
    if (sortOrder !== undefined) {
        if (!Number.isFinite(Number(sortOrder))) {
            return res.status(400).json({ success: false, error: 'sortOrder must be a number' });
        }
        updates.sortOrder = Number(sortOrder);
    }

    const result = await getMenuCategoriesCollection().findOneAndUpdate(
        { _id: toObjectId(req.params.id) as any, restaurantId: restaurantId(req) },
        { $set: updates },
        { returnDocument: 'after' },
    );
    if (!result) {
        return res.status(404).json({ success: false, error: 'Category not found' });
    }
    res.json({ success: true, data: toApiFormat(result) as unknown as MenuCategory });
}));

router.delete('/menu/categories/:id', handle(async (req: Request, res: Response<ApiResponse>) => {
    const category = await findMenuCategoryById(restaurantId(req), req.params.id);
    if (!category) {
        return res.status(404).json({ success: false, error: 'Category not found' });
    }
    const itemCount = await getMenuItemsCollection().countDocuments({ restaurantId: restaurantId(req), categoryId: req.params.id });
    if (itemCount > 0) {
        return res.status(409).json({ success: false, error: 'Category still has items — move or delete them first' });
    }
    await getMenuCategoriesCollection().deleteOne({ _id: toObjectId(req.params.id) as any, restaurantId: restaurantId(req) });
    res.json({ success: true, message: 'Category deleted' });
}));

// Reorder categories: body { orderedIds: string[] }
router.put('/menu/categories/reorder', handle(async (req: Request, res: Response<ApiResponse>) => {
    const { orderedIds } = req.body ?? {};
    if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== 'string')) {
        return res.status(400).json({ success: false, error: 'orderedIds must be an array of category ids' });
    }
    const col = getMenuCategoriesCollection();
    await Promise.all(
        (orderedIds as string[]).map((id, index) =>
            col.updateOne(
                { _id: toObjectId(id) as any, restaurantId: restaurantId(req) },
                { $set: { sortOrder: index + 1, updatedAt: new Date() } },
            ),
        ),
    );
    res.json({ success: true, data: await findMenuCategories(restaurantId(req)) });
}));

// ============================================
// Menu: items
// ============================================

router.get('/menu/items', handle(async (req: Request, res: Response<ApiResponse<OrderingMenuItem[]>>) => {
    res.json({ success: true, data: await findMenuItems(restaurantId(req), { includeHidden: true }) });
}));

router.post('/menu/items', handle(async (req: Request, res: Response<ApiResponse<OrderingMenuItem>>) => {
    const { categoryId, name, description, price, images, isVeg, variants, addons, availability, sortOrder } = req.body ?? {};

    if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ success: false, error: 'Item name is required' });
    }
    const priceNum = Number(price);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
        return res.status(400).json({ success: false, error: 'price must be a non-negative number' });
    }
    if (typeof categoryId !== 'string' || !(await findMenuCategoryById(restaurantId(req), categoryId))) {
        return res.status(400).json({ success: false, error: 'categoryId must reference an existing category' });
    }
    const parsedVariants = sanitizeVariantsOrAddons(variants);
    const parsedAddons = sanitizeVariantsOrAddons(addons);
    if (!parsedVariants || !parsedAddons) {
        return res.status(400).json({ success: false, error: 'variants/addons must be arrays of { name, price >= 0 }' });
    }
    if (availability !== undefined && !AVAILABILITIES.includes(availability)) {
        return res.status(400).json({ success: false, error: `availability must be one of: ${AVAILABILITIES.join(', ')}` });
    }

    const doc = {
        restaurantId: restaurantId(req),
        categoryId,
        name: name.trim(),
        ...(typeof description === 'string' && description.trim() ? { description: description.trim() } : {}),
        price: priceNum,
        images: Array.isArray(images) ? (images as unknown[]).filter((u) => typeof u === 'string') : [],
        isVeg: isVeg === true,
        variants: parsedVariants,
        addons: parsedAddons,
        availability: (availability ?? 'in_stock') as MenuItemAvailability,
        sortOrder: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0,
        createdAt: new Date(),
        updatedAt: new Date(),
    };
    const result = await getMenuItemsCollection().insertOne(doc);
    res.status(201).json({ success: true, data: toApiFormat({ ...doc, _id: result.insertedId }) as unknown as OrderingMenuItem });
}));

router.patch('/menu/items/:id', handle(async (req: Request, res: Response<ApiResponse<OrderingMenuItem>>) => {
    const { categoryId, name, description, price, images, isVeg, variants, addons, availability, sortOrder } = req.body ?? {};
    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (name !== undefined) {
        if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ success: false, error: 'Item name cannot be empty' });
        updates.name = name.trim();
    }
    if (description !== undefined) updates.description = typeof description === 'string' ? description.trim() : '';
    if (price !== undefined) {
        const priceNum = Number(price);
        if (!Number.isFinite(priceNum) || priceNum < 0) return res.status(400).json({ success: false, error: 'price must be a non-negative number' });
        updates.price = priceNum;
    }
    if (categoryId !== undefined) {
        if (typeof categoryId !== 'string' || !(await findMenuCategoryById(restaurantId(req), categoryId))) {
            return res.status(400).json({ success: false, error: 'categoryId must reference an existing category' });
        }
        updates.categoryId = categoryId;
    }
    if (images !== undefined) updates.images = Array.isArray(images) ? (images as unknown[]).filter((u) => typeof u === 'string') : [];
    if (isVeg !== undefined) updates.isVeg = isVeg === true;
    if (variants !== undefined) {
        const parsed = sanitizeVariantsOrAddons(variants);
        if (!parsed) return res.status(400).json({ success: false, error: 'variants must be an array of { name, price >= 0 }' });
        updates.variants = parsed;
    }
    if (addons !== undefined) {
        const parsed = sanitizeVariantsOrAddons(addons);
        if (!parsed) return res.status(400).json({ success: false, error: 'addons must be an array of { name, price >= 0 }' });
        updates.addons = parsed;
    }
    if (availability !== undefined) {
        if (!AVAILABILITIES.includes(availability)) {
            return res.status(400).json({ success: false, error: `availability must be one of: ${AVAILABILITIES.join(', ')}` });
        }
        updates.availability = availability;
    }
    if (sortOrder !== undefined) {
        if (!Number.isFinite(Number(sortOrder))) return res.status(400).json({ success: false, error: 'sortOrder must be a number' });
        updates.sortOrder = Number(sortOrder);
    }

    const result = await getMenuItemsCollection().findOneAndUpdate(
        { _id: toObjectId(req.params.id) as any, restaurantId: restaurantId(req) },
        { $set: updates },
        { returnDocument: 'after' },
    );
    if (!result) {
        return res.status(404).json({ success: false, error: 'Menu item not found' });
    }
    res.json({ success: true, data: toApiFormat(result) as unknown as OrderingMenuItem });
}));

router.delete('/menu/items/:id', handle(async (req: Request, res: Response<ApiResponse>) => {
    const result = await getMenuItemsCollection().deleteOne({ _id: toObjectId(req.params.id) as any, restaurantId: restaurantId(req) });
    if (result.deletedCount === 0) {
        return res.status(404).json({ success: false, error: 'Menu item not found' });
    }
    res.json({ success: true, message: 'Menu item deleted' });
}));

// Quick availability toggle: body { availability }
router.patch('/menu/items/:id/availability', handle(async (req: Request, res: Response<ApiResponse<OrderingMenuItem>>) => {
    const { availability } = req.body ?? {};
    if (!AVAILABILITIES.includes(availability)) {
        return res.status(400).json({ success: false, error: `availability must be one of: ${AVAILABILITIES.join(', ')}` });
    }
    const result = await getMenuItemsCollection().findOneAndUpdate(
        { _id: toObjectId(req.params.id) as any, restaurantId: restaurantId(req) },
        { $set: { availability, updatedAt: new Date() } },
        { returnDocument: 'after' },
    );
    if (!result) {
        return res.status(404).json({ success: false, error: 'Menu item not found' });
    }
    res.json({ success: true, data: toApiFormat(result) as unknown as OrderingMenuItem });
}));

// Reorder items within a category: body { categoryId, orderedIds }
router.put('/menu/items/reorder', handle(async (req: Request, res: Response<ApiResponse>) => {
    const { orderedIds } = req.body ?? {};
    if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== 'string')) {
        return res.status(400).json({ success: false, error: 'orderedIds must be an array of item ids' });
    }
    const col = getMenuItemsCollection();
    await Promise.all(
        (orderedIds as string[]).map((id, index) =>
            col.updateOne(
                { _id: toObjectId(id) as any, restaurantId: restaurantId(req) },
                { $set: { sortOrder: index + 1, updatedAt: new Date() } },
            ),
        ),
    );
    res.json({ success: true, message: 'Items reordered' });
}));

// ============================================
// Menu: CSV bulk upload (multipart field "file")
// ============================================

router.post('/menu/import', upload.single('file'), handle(async (req: Request, res: Response<ApiResponse>) => {
    if (!req.file) {
        return res.status(400).json({ success: false, error: 'CSV file is required (multipart field "file")' });
    }

    let parsed;
    try {
        parsed = parseMenuCsv(req.file.buffer);
    } catch (err) {
        return res.status(400).json({ success: false, error: err instanceof Error ? err.message : 'Invalid CSV' });
    }

    const rid = restaurantId(req);
    const categoriesCol = getMenuCategoriesCollection();
    const itemsCol = getMenuItemsCollection();

    // Resolve/create categories by name (case-insensitive)
    const existingCategories = await findMenuCategories(rid);
    const categoryIdByName = new Map(existingCategories.map((c) => [c.name.toLowerCase(), c.id]));

    let created = 0;
    let updated = 0;

    for (const row of parsed.rows) {
        let categoryId = categoryIdByName.get(row.category.toLowerCase());
        if (!categoryId) {
            const catDoc = {
                restaurantId: rid,
                name: row.category,
                sortOrder: categoryIdByName.size + 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            const inserted = await categoriesCol.insertOne(catDoc);
            categoryId = inserted.insertedId.toString();
            categoryIdByName.set(row.category.toLowerCase(), categoryId);
        }

        // Upsert by (restaurantId, name) — CSV rows update existing items of the same name
        const setFields: Record<string, unknown> = {
            categoryId,
            price: row.price,
            isVeg: row.isVeg,
            availability: row.availability,
            updatedAt: new Date(),
            ...(row.description !== undefined ? { description: row.description } : {}),
            ...(row.images.length > 0 ? { images: row.images } : {}),
            ...(row.variants.length > 0 ? { variants: row.variants } : {}),
            ...(row.addons.length > 0 ? { addons: row.addons } : {}),
            ...(row.sortOrder !== undefined ? { sortOrder: row.sortOrder } : {}),
        };
        const result = await itemsCol.updateOne(
            { restaurantId: rid, name: row.name },
            {
                $set: setFields,
                $setOnInsert: {
                    restaurantId: rid,
                    name: row.name,
                    createdAt: new Date(),
                    ...(row.sortOrder === undefined ? { sortOrder: 0 } : {}),
                    ...(row.images.length === 0 ? { images: [] } : {}),
                    ...(row.variants.length === 0 ? { variants: [] } : {}),
                    ...(row.addons.length === 0 ? { addons: [] } : {}),
                },
            },
            { upsert: true },
        );
        if (result.upsertedCount > 0) created += 1;
        else updated += 1;
    }

    emitOrderingEvent({ name: 'menu_csv_imported', restaurantId: rid, payload: { created, updated, failed: parsed.errors.length } });
    log.info({ restaurantId: rid, created, updated, failed: parsed.errors.length }, 'Menu CSV import complete');

    res.json({
        success: true,
        data: {
            created,
            updated,
            failed: parsed.errors.length,
            errors: parsed.errors,
        },
    });
}));

// ============================================
// Orders feed + status transitions
// ============================================

router.get('/orders', handle(async (req: Request, res: Response<ApiResponse<Order[]>>) => {
    const { status, from, to } = req.query;
    const filter: Record<string, unknown> = { restaurantId: restaurantId(req) };

    if (status !== undefined) {
        if (!isOrderStatus(status)) {
            return res.status(400).json({ success: false, error: 'Invalid status filter' });
        }
        filter.status = status;
    }
    const createdAt: Record<string, Date> = {};
    if (typeof from === 'string' && !Number.isNaN(Date.parse(from))) createdAt.$gte = new Date(from);
    if (typeof to === 'string' && !Number.isNaN(Date.parse(to))) createdAt.$lte = new Date(to);
    if (Object.keys(createdAt).length > 0) filter.createdAt = createdAt;

    const limit = Math.min(Number(req.query.limit) || 100, 200);
    const docs = await getOrdersCollection().find(filter).sort({ createdAt: -1 }).limit(limit).toArray();
    res.json({ success: true, data: toApiFormatArray(docs) as Order[] });
}));

router.patch('/orders/:id/status', handle(async (req: Request, res: Response<ApiResponse<Order>>) => {
    const { status, note } = req.body ?? {};
    if (!isOrderStatus(status)) {
        return res.status(400).json({ success: false, error: 'Invalid order status' });
    }

    const order = await findOrderById(req.params.id);
    if (!order || order.restaurantId !== restaurantId(req)) {
        return res.status(404).json({ success: false, error: 'Order not found' });
    }

    if (!canTransitionOrderStatus(order.status, status, order.orderType)) {
        const allowed = ORDER_STATUS_TRANSITIONS[order.status];
        return res.status(409).json({
            success: false,
            error: `Cannot transition order from ${order.status} to ${status}. Allowed: ${allowed.length > 0 ? allowed.join(', ') : 'none'}`,
        });
    }

    const historyEntry = {
        status,
        at: new Date().toISOString(),
        ...(typeof note === 'string' && note.trim() ? { note: note.trim() } : {}),
    };
    const result = await getOrdersCollection().findOneAndUpdate(
        { _id: toObjectId(req.params.id) as any, restaurantId: restaurantId(req), status: order.status },
        { $set: { status, updatedAt: new Date() }, $push: { statusHistory: historyEntry } as any },
        { returnDocument: 'after' },
    );
    if (!result) {
        return res.status(409).json({ success: false, error: 'Order status changed concurrently — reload and retry' });
    }

    emitOrderingEvent({
        name: 'order_status_changed',
        restaurantId: restaurantId(req),
        payload: { orderId: req.params.id, from: order.status, to: status },
    });

    res.json({ success: true, data: toApiFormat(result) as unknown as Order });
}));

// Store open/close toggle: body { open: boolean }
router.patch('/store', handle(async (req: Request, res: Response<ApiResponse>) => {
    const { open } = req.body ?? {};
    if (typeof open !== 'boolean') {
        return res.status(400).json({ success: false, error: 'open must be a boolean' });
    }
    const restaurant = await updateRestaurant(restaurantId(req), { storeOpen: open });
    if (!restaurant) {
        return res.status(404).json({ success: false, error: 'Restaurant not found' });
    }
    emitOrderingEvent({ name: 'store_toggled', restaurantId: restaurantId(req), payload: { open } });
    res.json({ success: true, data: { storeOpen: restaurant.storeOpen === true } });
}));

// ============================================
// Reservations (list, confirm/decline)
// ============================================

router.get('/reservations', handle(async (req: Request, res: Response<ApiResponse<Reservation[]>>) => {
    const { status, date } = req.query;
    const filter: Record<string, unknown> = { restaurantId: restaurantId(req) };
    if (typeof status === 'string' && status) {
        if (!['pending', 'confirmed', 'declined', 'no_show'].includes(status)) {
            return res.status(400).json({ success: false, error: 'Invalid status filter' });
        }
        filter.status = status;
    }
    if (typeof date === 'string' && date) filter.date = date;

    const docs = await getReservationsCollection().find(filter).sort({ date: 1, time: 1 }).limit(200).toArray();
    res.json({ success: true, data: toApiFormatArray(docs) as Reservation[] });
}));

router.patch('/reservations/:id', handle(async (req: Request, res: Response<ApiResponse<Reservation>>) => {
    const { status } = req.body ?? {};
    if (!RESERVATION_DECISIONS.includes(status)) {
        return res.status(400).json({ success: false, error: `status must be one of: ${RESERVATION_DECISIONS.join(', ')}` });
    }

    const reservation = await findReservationById(restaurantId(req), req.params.id);
    if (!reservation) {
        return res.status(404).json({ success: false, error: 'Reservation not found' });
    }

    const result = await getReservationsCollection().findOneAndUpdate(
        { _id: toObjectId(req.params.id) as any, restaurantId: restaurantId(req) },
        { $set: { status, updatedAt: new Date() } },
        { returnDocument: 'after' },
    );

    emitOrderingEvent({
        name: `reservation_${status}`,
        restaurantId: restaurantId(req),
        payload: { reservationId: req.params.id },
    });

    res.json({ success: true, data: toApiFormat(result) as unknown as Reservation });
}));

// ============================================
// Storefront content editor (draft / publish / rollback)
// ============================================

const EMPTY_CONTENT: StorefrontContent = { heroImages: [] };

router.get('/content/draft', handle(async (req: Request, res: Response<ApiResponse>) => {
    const doc = await findStorefrontContent(restaurantId(req));
    res.json({
        success: true,
        data: {
            draft: doc?.draft ?? EMPTY_CONTENT,
            publishedVersion: doc?.publishedVersion ?? null,
            versions: (doc?.versions ?? []).map((v) => ({ version: v.version, publishedAt: v.publishedAt })),
        },
    });
}));

router.put('/content/draft', handle(async (req: Request, res: Response<ApiResponse>) => {
    const draft = req.body?.draft ?? req.body;
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
        return res.status(400).json({ success: false, error: 'draft must be an object' });
    }
    const content: StorefrontContent = {
        ...draft,
        heroImages: Array.isArray((draft as StorefrontContent).heroImages)
            ? (draft as StorefrontContent).heroImages.filter((u) => typeof u === 'string')
            : [],
    };

    await getStorefrontContentCollection().updateOne(
        { restaurantId: restaurantId(req) },
        {
            $set: { draft: content, updatedAt: new Date() },
            $setOnInsert: { restaurantId: restaurantId(req), versions: [] },
        },
        { upsert: true },
    );
    res.json({ success: true, data: { draft: content } });
}));

// Publish: copy draft → published, push a version entry (history capped)
router.post('/content/publish', handle(async (req: Request, res: Response<ApiResponse>) => {
    const doc = await findStorefrontContent(restaurantId(req));
    if (!doc || !doc.draft) {
        return res.status(400).json({ success: false, error: 'No draft content to publish' });
    }

    const nextVersion = (doc.publishedVersion ?? 0) + 1;
    const entry: StorefrontVersionEntry = {
        version: nextVersion,
        publishedAt: new Date().toISOString(),
        content: doc.draft,
    };

    await getStorefrontContentCollection().updateOne(
        { restaurantId: restaurantId(req) },
        {
            $set: { published: doc.draft, publishedVersion: nextVersion, updatedAt: new Date() },
            $push: { versions: { $each: [entry], $slice: -STOREFRONT_VERSION_HISTORY_LIMIT } } as any,
        },
    );

    emitOrderingEvent({ name: 'content_published', restaurantId: restaurantId(req), payload: { version: nextVersion } });

    res.json({ success: true, data: { publishedVersion: nextVersion } });
}));

// Rollback: body { version } (defaults to previous version). Restores that
// snapshot as both draft and published, recorded as a new version.
router.post('/content/rollback', handle(async (req: Request, res: Response<ApiResponse>) => {
    const doc = await findStorefrontContent(restaurantId(req));
    if (!doc || doc.versions.length === 0) {
        return res.status(400).json({ success: false, error: 'No version history to roll back to' });
    }

    const requested = req.body?.version;
    let target: StorefrontVersionEntry | undefined;
    if (requested !== undefined) {
        target = doc.versions.find((v) => v.version === Number(requested));
        if (!target) {
            return res.status(404).json({ success: false, error: `Version ${requested} not found in history` });
        }
    } else {
        // Previous version (the one before the currently published)
        target = [...doc.versions].reverse().find((v) => v.version !== doc.publishedVersion);
        if (!target) {
            return res.status(400).json({ success: false, error: 'No earlier version to roll back to' });
        }
    }

    const nextVersion = (doc.publishedVersion ?? 0) + 1;
    const entry: StorefrontVersionEntry = {
        version: nextVersion,
        publishedAt: new Date().toISOString(),
        content: target.content,
    };

    await getStorefrontContentCollection().updateOne(
        { restaurantId: restaurantId(req) },
        {
            $set: { draft: target.content, published: target.content, publishedVersion: nextVersion, updatedAt: new Date() },
            $push: { versions: { $each: [entry], $slice: -STOREFRONT_VERSION_HISTORY_LIMIT } } as any,
        },
    );

    emitOrderingEvent({
        name: 'content_rolled_back',
        restaurantId: restaurantId(req),
        payload: { restoredVersion: target.version, publishedVersion: nextVersion },
    });

    res.json({ success: true, data: { restoredFromVersion: target.version, publishedVersion: nextVersion } });
}));

// ============================================
// Analytics summary (funnel counts by event name for a date range)
// ============================================

router.get('/analytics/summary', handle(async (req: Request, res: Response<ApiResponse>) => {
    const { from, to } = req.query;
    const now = new Date();
    const fromDate = typeof from === 'string' && !Number.isNaN(Date.parse(from))
        ? new Date(from)
        : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const toDate = typeof to === 'string' && !Number.isNaN(Date.parse(to)) ? new Date(to) : now;

    const results = await getEventsCollection().aggregate([
        { $match: { restaurantId: restaurantId(req), ts: { $gte: fromDate, $lte: toDate } } },
        {
            $group: {
                _id: '$name',
                count: { $sum: 1 },
                sessions: { $addToSet: '$sessionId' },
            },
        },
        {
            $project: {
                _id: 0,
                name: '$_id',
                count: 1,
                uniqueSessions: { $size: '$sessions' },
            },
        },
        { $sort: { count: -1 } },
    ]).toArray();

    res.json({
        success: true,
        data: {
            from: fromDate.toISOString(),
            to: toDate.toISOString(),
            events: results,
        },
    });
}));


// ============================================
// Growth campaigns: cohorts + queued sends
// ============================================
//
// Cohort math is a pure function (services/ordering/cohorts.ts) fed from the
// events / orders / customers collections. POST /campaigns only records the
// intent (status QUEUED) and emits an analytics event — the actual WhatsApp
// delivery worker is a documented seam in docs/NEXT.md.

router.get('/cohorts', handle(async (req: Request, res: Response<ApiResponse<CustomerCohort[]>>) => {
    const rid = restaurantId(req);
    const windowStart = new Date(Date.now() - DROP_OFF_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const [eventDocs, orderDocs, customerDocs] = await Promise.all([
        getEventsCollection()
            .find({ restaurantId: rid, name: { $in: ['add_to_cart', 'begin_checkout', 'order_placed'] }, ts: { $gte: windowStart } })
            .project({ name: 1, sessionId: 1, ts: 1 })
            .toArray(),
        getOrdersCollection()
            .find({ restaurantId: rid, status: { $ne: 'CANCELLED' } })
            .project({ customerId: 1, createdAt: 1 })
            .toArray(),
        getCustomersCollection().find({ restaurantId: rid }).project({ _id: 1 }).toArray(),
    ]);

    const counts = computeCohorts(
        eventDocs as unknown as CohortEventRow[],
        orderDocs as unknown as CohortOrderRow[],
        customerDocs.map((c) => ({ id: String(c._id) })),
    );
    res.json({ success: true, data: buildCohorts(counts) });
}));

const CAMPAIGN_KINDS: CampaignKind[] = ['whatsapp_nudge', 'discount_offer'];

router.post('/campaigns', handle(async (req: Request, res: Response<ApiResponse<CampaignQueuedResponse>>) => {
    const { cohortId, kind, discount } = (req.body ?? {}) as { cohortId?: unknown; kind?: unknown; discount?: Partial<CampaignDiscount> };

    if (!COHORT_CATALOG.some((c) => c.id === cohortId)) {
        return res.status(400).json({ success: false, error: `cohortId must be one of: ${COHORT_CATALOG.map((c) => c.id).join(', ')}` });
    }
    if (!CAMPAIGN_KINDS.includes(kind as CampaignKind)) {
        return res.status(400).json({ success: false, error: `kind must be one of: ${CAMPAIGN_KINDS.join(', ')}` });
    }

    let parsedDiscount: CampaignDiscount | undefined;
    if (kind === 'discount_offer') {
        const percentOff = Number(discount?.percentOff);
        const expiryDays = Number(discount?.expiryDays);
        const code = typeof discount?.code === 'string' ? discount.code.trim().toUpperCase() : '';
        if (!Number.isFinite(percentOff) || percentOff < 1 || percentOff > 100) {
            return res.status(400).json({ success: false, error: 'discount.percentOff must be between 1 and 100' });
        }
        if (!code || !/^[A-Z0-9_-]{3,20}$/.test(code)) {
            return res.status(400).json({ success: false, error: 'discount.code must be 3–20 chars (letters, numbers, - or _)' });
        }
        if (!Number.isInteger(expiryDays) || expiryDays < 1 || expiryDays > 90) {
            return res.status(400).json({ success: false, error: 'discount.expiryDays must be an integer between 1 and 90' });
        }
        parsedDiscount = { percentOff, code, expiryDays };
    }

    const rid = restaurantId(req);

    // Snapshot the audience size at queue time.
    const windowStart = new Date(Date.now() - DROP_OFF_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const [eventDocs, orderDocs, customerDocs] = await Promise.all([
        getEventsCollection()
            .find({ restaurantId: rid, name: { $in: ['add_to_cart', 'begin_checkout', 'order_placed'] }, ts: { $gte: windowStart } })
            .project({ name: 1, sessionId: 1, ts: 1 })
            .toArray(),
        getOrdersCollection()
            .find({ restaurantId: rid, status: { $ne: 'CANCELLED' } })
            .project({ customerId: 1, createdAt: 1 })
            .toArray(),
        getCustomersCollection().find({ restaurantId: rid }).project({ _id: 1 }).toArray(),
    ]);
    const counts = computeCohorts(
        eventDocs as unknown as CohortEventRow[],
        orderDocs as unknown as CohortOrderRow[],
        customerDocs.map((c) => ({ id: String(c._id) })),
    );
    const audienceCount = counts[cohortId as CohortId];

    const doc = {
        restaurantId: rid,
        cohortId: cohortId as CohortId,
        kind: kind as CampaignKind,
        ...(parsedDiscount ? { discount: parsedDiscount } : {}),
        audienceCount,
        status: 'QUEUED' as const,
        createdAt: new Date(),
    };
    const result = await getCampaignsCollection().insertOne(doc);

    emitOrderingEvent({
        name: 'campaign_queued',
        restaurantId: rid,
        payload: { campaignId: result.insertedId.toString(), cohortId, kind, audienceCount },
    });
    log.info({ restaurantId: rid, cohortId, kind, audienceCount }, 'Campaign queued');

    res.status(201).json({
        success: true,
        data: { campaignId: result.insertedId.toString(), status: 'QUEUED', audienceCount },
    });
}));

export default router;
