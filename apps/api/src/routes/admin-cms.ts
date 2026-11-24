/**
 * Restaurant CMS (Lane B, milestone 1) -- mounted at /api/admin/cms
 *
 * Menu (categories + items, CSV import), offers, and the site content
 * draft -> publish -> rollback flow. Ported from the Vercel line's
 * admin-ordering routes (menu + content halves) and rebuilt on this line's
 * conventions: zod validation on every body (P0-4), `{ success, data?, error? }`
 * responses, and every query scoped to the caller's restaurant.
 *
 * Auth: merchant JWT, OWNER or MANAGER of the restaurant in the token.
 * ASSUMPTION: platform ADMINs are not given CMS write access here; their tokens
 * carry no target restaurant. Revisit with the superadmin import.
 *
 * Every catalog write re-projects `restaurant.menu` (refreshMenuProjection) so
 * the content engine and grader keep seeing the current menu.
 */

import express, { Request, Response } from 'express';
import { z } from 'zod';
import {
    countMenuItemsInCategory,
    deleteMenuCategory,
    deleteMenuItem,
    deleteOffer,
    DuplicateMenuItemNameError,
    DuplicateOfferCodeError,
    findMenuCategories,
    findMenuCategoryById,
    findMenuItemById,
    findMenuItems,
    findOfferById,
    findOffers,
    findStorefrontContent,
    insertMenuCategory,
    insertMenuItem,
    insertOffer,
    refreshMenuProjection,
    reorderMenuCategories,
    reorderMenuItems,
    saveStorefrontDraft,
    saveStorefrontPublish,
    setMenuItemAvailability,
    updateMenuCategory,
    updateMenuItem,
    updateOffer,
    upsertMenuItemByName,
} from '@restropulse/db';
import type { ApiResponse, Offer } from '@restropulse/shared';
import type { OfferInputShape } from '../services/cms/schemas.js';
import {
    CategoryCreateBody,
    CategoryUpdateBody,
    ItemCreateBody,
    ItemUpdateBody,
    AvailabilityBody,
    ReorderBody,
    OfferCreateBody,
    OfferUpdateBody,
    OfferPreviewBody,
    ContentBody,
    RollbackBody,
    OfferScheduleError,
    toOfferInput,
} from '../services/cms/schemas.js';
import {
    computeOfferDiscount,
    describeOffer,
    isOfferLive,
    publishStorefrontDraft,
    rollbackStorefront,
    EMPTY_STOREFRONT_CONTENT,
} from '@restropulse/shared';
import { handle } from '../middleware/async-handler.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/require-role.js';
import { validateBody } from '../middleware/validate.js';
import { parseMenuCsv } from '../services/cms/menu-csv.js';
import { createLogger, trackEvent } from '@restropulse/telemetry/server';

const log = createLogger('admin-cms');
const router = express.Router();

router.use(requireAuth, requireRole('OWNER', 'MANAGER'));

function restaurantId(req: Request): string {
    return req.user!.restaurantId;
}

/** Re-project restaurant.menu; a failure is logged, never fails the merchant's write. */
async function reproject(rid: string): Promise<void> {
    try {
        await refreshMenuProjection(rid);
    } catch (err) {
        log.error({ err, restaurantId: rid }, 'menu projection refresh failed');
    }
}

const notFound = (res: Response, what: string) => res.status(404).json({ success: false, error: `${what} not found` });

// ============================================
// Menu: categories
// ============================================

router.get('/menu/categories', handle(async (req, res: Response<ApiResponse>) => {
    res.json({ success: true, data: await findMenuCategories(restaurantId(req)) });
}));

router.post('/menu/categories', validateBody(CategoryCreateBody), handle(async (req, res: Response<ApiResponse>) => {
    const body = req.body as z.infer<typeof CategoryCreateBody>;
    const rid = restaurantId(req);
    const sortOrder = body.sortOrder ?? (await findMenuCategories(rid)).length + 1;
    const category = await insertMenuCategory(rid, {
        name: body.name,
        ...(body.description ? { description: body.description } : {}),
        sortOrder,
    });
    res.status(201).json({ success: true, data: category });
}));

// Static path before /:id so "reorder" is never read as an id.
router.put('/menu/categories/reorder', validateBody(ReorderBody), handle(async (req, res: Response<ApiResponse>) => {
    const rid = restaurantId(req);
    await reorderMenuCategories(rid, (req.body as z.infer<typeof ReorderBody>).orderedIds);
    await reproject(rid);
    res.json({ success: true, data: await findMenuCategories(rid) });
}));

router.patch('/menu/categories/:id', validateBody(CategoryUpdateBody), handle(async (req, res: Response<ApiResponse>) => {
    const rid = restaurantId(req);
    const updated = await updateMenuCategory(rid, req.params.id, req.body as z.infer<typeof CategoryUpdateBody>);
    if (!updated) return notFound(res, 'Category');
    await reproject(rid);
    res.json({ success: true, data: updated });
}));

router.delete('/menu/categories/:id', handle(async (req, res: Response<ApiResponse>) => {
    const rid = restaurantId(req);
    if (!(await findMenuCategoryById(rid, req.params.id))) return notFound(res, 'Category');
    if ((await countMenuItemsInCategory(rid, req.params.id)) > 0) {
        return res.status(409).json({ success: false, error: 'This category still has items. Move or delete them first.' });
    }
    await deleteMenuCategory(rid, req.params.id);
    res.json({ success: true, message: 'Category deleted' });
}));

// ============================================
// Menu: items
// ============================================

router.get('/menu/items', handle(async (req, res: Response<ApiResponse>) => {
    res.json({ success: true, data: await findMenuItems(restaurantId(req), { includeHidden: true }) });
}));

async function categoryExists(rid: string, categoryId: string): Promise<boolean> {
    return (await findMenuCategoryById(rid, categoryId)) !== null;
}

router.post('/menu/items', validateBody(ItemCreateBody), handle(async (req, res: Response<ApiResponse>) => {
    const rid = restaurantId(req);
    const body = req.body as z.infer<typeof ItemCreateBody>;
    if (!(await categoryExists(rid, body.categoryId))) {
        return res.status(400).json({ success: false, error: 'Pick a category that exists.' });
    }
    try {
        const item = await insertMenuItem(rid, body);
        await reproject(rid);
        res.status(201).json({ success: true, data: item });
    } catch (err) {
        if (err instanceof DuplicateMenuItemNameError) return res.status(409).json({ success: false, error: 'An item with this name already exists.' });
        throw err;
    }
}));

router.put('/menu/items/reorder', validateBody(ReorderBody), handle(async (req, res: Response<ApiResponse>) => {
    const rid = restaurantId(req);
    await reorderMenuItems(rid, (req.body as z.infer<typeof ReorderBody>).orderedIds);
    await reproject(rid);
    res.json({ success: true, message: 'Items reordered' });
}));

router.patch('/menu/items/:id', validateBody(ItemUpdateBody), handle(async (req, res: Response<ApiResponse>) => {
    const rid = restaurantId(req);
    const body = req.body as z.infer<typeof ItemUpdateBody>;
    if (body.categoryId !== undefined && !(await categoryExists(rid, body.categoryId))) {
        return res.status(400).json({ success: false, error: 'Pick a category that exists.' });
    }
    try {
        const item = await updateMenuItem(rid, req.params.id, body);
        if (!item) return notFound(res, 'Menu item');
        await reproject(rid);
        res.json({ success: true, data: item });
    } catch (err) {
        if (err instanceof DuplicateMenuItemNameError) return res.status(409).json({ success: false, error: 'An item with this name already exists.' });
        throw err;
    }
}));

router.patch('/menu/items/:id/availability', validateBody(AvailabilityBody), handle(async (req, res: Response<ApiResponse>) => {
    const rid = restaurantId(req);
    const item = await setMenuItemAvailability(rid, req.params.id, (req.body as z.infer<typeof AvailabilityBody>).availability);
    if (!item) return notFound(res, 'Menu item');
    await reproject(rid);
    res.json({ success: true, data: item });
}));

router.delete('/menu/items/:id', handle(async (req, res: Response<ApiResponse>) => {
    const rid = restaurantId(req);
    if (!(await deleteMenuItem(rid, req.params.id))) return notFound(res, 'Menu item');
    await reproject(rid);
    res.json({ success: true, message: 'Menu item deleted' });
}));

// ============================================
// Menu: CSV bulk import
// Body is the raw CSV (Content-Type: text/csv), up to 2 MB. No multipart
// dependency: the admin reads the file client-side and posts its text.
// ============================================

router.post(
    '/menu/import',
    express.text({ type: ['text/csv', 'text/plain', 'application/csv'], limit: '2mb' }),
    handle(async (req, res: Response<ApiResponse>) => {
        if (typeof req.body !== 'string' || !req.body.trim()) {
            return res.status(400).json({ success: false, error: 'Send the CSV file as the request body (Content-Type: text/csv).' });
        }
        let parsed;
        try {
            parsed = parseMenuCsv(req.body);
        } catch (err) {
            return res.status(400).json({ success: false, error: err instanceof Error ? err.message : 'Invalid CSV' });
        }

        const rid = restaurantId(req);
        const categoryIdByName = new Map((await findMenuCategories(rid)).map((c) => [c.name.toLowerCase(), c.id]));
        let created = 0;
        let updated = 0;

        for (const row of parsed.rows) {
            let categoryId = categoryIdByName.get(row.category.toLowerCase());
            if (!categoryId) {
                const category = await insertMenuCategory(rid, { name: row.category, sortOrder: categoryIdByName.size + 1 });
                categoryId = category.id;
                categoryIdByName.set(row.category.toLowerCase(), categoryId);
            }
            const outcome = await upsertMenuItemByName(
                rid,
                row.name,
                {
                    categoryId,
                    price: row.price,
                    isVeg: row.isVeg,
                    availability: row.availability,
                    ...(row.description !== undefined ? { description: row.description } : {}),
                    ...(row.images.length > 0 ? { images: row.images } : {}),
                    ...(row.variants.length > 0 ? { variants: row.variants } : {}),
                    ...(row.addons.length > 0 ? { addons: row.addons } : {}),
                    ...(row.sortOrder !== undefined ? { sortOrder: row.sortOrder } : {}),
                },
                {
                    ...(row.sortOrder === undefined ? { sortOrder: 0 } : {}),
                    ...(row.images.length === 0 ? { images: [] } : {}),
                    ...(row.variants.length === 0 ? { variants: [] } : {}),
                    ...(row.addons.length === 0 ? { addons: [] } : {}),
                },
            );
            if (outcome === 'created') created += 1;
            else updated += 1;
        }

        if (parsed.rows.length > 0) await reproject(rid);
        trackEvent('cms_menu_csv_imported', { restaurantId: rid, created: String(created), updated: String(updated), failed: String(parsed.errors.length) });
        log.info({ restaurantId: rid, created, updated, failed: parsed.errors.length }, 'Menu CSV import complete');
        res.json({ success: true, data: { created, updated, failed: parsed.errors.length, errors: parsed.errors } });
    }),
);

// ============================================
// Offers
// ============================================

function withSummary(offer: Offer, now: Date) {
    return { ...offer, summary: describeOffer(offer), live: isOfferLive(offer, now) };
}

router.get('/offers', handle(async (req, res: Response<ApiResponse>) => {
    const now = new Date();
    const includeArchived = req.query.includeArchived === 'true';
    const offers = await findOffers(restaurantId(req), { includeArchived });
    res.json({ success: true, data: offers.map((o) => withSummary(o, now)) });
}));

/** Catalog ids referenced by a scope must belong to this restaurant. */
async function scopeError(rid: string, scope: OfferInputShape['scope'] | undefined): Promise<string | null> {
    if (!scope || scope.kind === 'all') return null;
    if (scope.kind === 'categories') {
        const known = new Set((await findMenuCategories(rid)).map((c) => c.id));
        return scope.categoryIds.every((id) => known.has(id)) ? null : 'One of the chosen categories no longer exists.';
    }
    const known = new Set((await findMenuItems(rid, { includeHidden: true })).map((i) => i.id));
    return scope.itemIds.every((id) => known.has(id)) ? null : 'One of the chosen items no longer exists.';
}

router.post('/offers', validateBody(OfferCreateBody), handle(async (req, res: Response<ApiResponse>) => {
    const rid = restaurantId(req);
    const input = toOfferInput(req.body as z.infer<typeof OfferCreateBody>) as OfferInputShape;
    const problem = await scopeError(rid, input.scope);
    if (problem) return res.status(400).json({ success: false, error: problem });
    try {
        const offer = await insertOffer(rid, input);
        res.status(201).json({ success: true, data: withSummary(offer, new Date()) });
    } catch (err) {
        if (err instanceof DuplicateOfferCodeError) return res.status(409).json({ success: false, error: err.message });
        throw err;
    }
}));

router.patch('/offers/:id', validateBody(OfferUpdateBody), handle(async (req, res: Response<ApiResponse>) => {
    const rid = restaurantId(req);
    const existing = await findOfferById(rid, req.params.id);
    if (!existing) return notFound(res, 'Offer');
    let updates;
    try {
        updates = toOfferInput(req.body as z.infer<typeof OfferUpdateBody>, existing);
    } catch (err) {
        if (err instanceof OfferScheduleError) return res.status(400).json({ success: false, error: err.message });
        throw err;
    }
    const problem = await scopeError(rid, updates.scope);
    if (problem) return res.status(400).json({ success: false, error: problem });
    try {
        const offer = await updateOffer(rid, req.params.id, updates);
        if (!offer) return notFound(res, 'Offer');
        res.json({ success: true, data: withSummary(offer, new Date()) });
    } catch (err) {
        if (err instanceof DuplicateOfferCodeError) return res.status(409).json({ success: false, error: err.message });
        throw err;
    }
}));

router.delete('/offers/:id', handle(async (req, res: Response<ApiResponse>) => {
    if (!(await deleteOffer(restaurantId(req), req.params.id))) return notFound(res, 'Offer');
    res.json({ success: true, message: 'Offer deleted' });
}));

/**
 * "What would this offer take off a sample order?" -- prices are resolved from
 * the catalog server-side; the client sends only item ids and quantities.
 */
router.post('/offers/:id/preview', validateBody(OfferPreviewBody), handle(async (req, res: Response<ApiResponse>) => {
    const rid = restaurantId(req);
    const offer = await findOfferById(rid, req.params.id);
    if (!offer) return notFound(res, 'Offer');
    const body = req.body as z.infer<typeof OfferPreviewBody>;
    const lines = [];
    for (const line of body.lines) {
        const item = await findMenuItemById(rid, line.menuItemId);
        if (!item) return res.status(400).json({ success: false, error: 'One of the preview items no longer exists.' });
        lines.push({ menuItemId: item.id, categoryId: item.categoryId, lineTotal: item.price * line.qty });
    }
    const at = body.at ? new Date(body.at) : new Date();
    const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
    const result = computeOfferDiscount(offer, { lines, deliveryFee: body.deliveryFee, now: at });
    res.json({ success: true, data: { subtotal, ...result } });
}));

// ============================================
// Site content: draft / publish / rollback
// ============================================

router.get('/content', handle(async (req, res: Response<ApiResponse>) => {
    const doc = await findStorefrontContent(restaurantId(req));
    res.json({
        success: true,
        data: {
            draft: doc?.draft ?? EMPTY_STOREFRONT_CONTENT,
            published: doc?.published ?? null,
            publishedVersion: doc?.publishedVersion ?? null,
            publishedAt: doc?.publishedAt ?? null,
            versions: (doc?.versions ?? []).map((v) => ({ version: v.version, publishedAt: v.publishedAt })),
        },
    });
}));

router.put('/content/draft', validateBody(ContentBody), handle(async (req, res: Response<ApiResponse>) => {
    const doc = await saveStorefrontDraft(restaurantId(req), req.body as z.infer<typeof ContentBody>);
    res.json({ success: true, data: { draft: doc.draft } });
}));

router.post('/content/publish', handle(async (req, res: Response<ApiResponse>) => {
    const rid = restaurantId(req);
    const doc = await findStorefrontContent(rid);
    if (!doc) return res.status(400).json({ success: false, error: 'Save a draft before publishing.' });
    const result = publishStorefrontDraft(doc);
    const saved = await saveStorefrontPublish(rid, doc.publishedVersion, result);
    if (!saved) return res.status(409).json({ success: false, error: 'Someone else just published. Reload and try again.' });
    trackEvent('cms_site_published', { restaurantId: rid, version: String(result.publishedVersion) });
    res.json({ success: true, data: { publishedVersion: result.publishedVersion, publishedAt: result.publishedAt } });
}));

router.post('/content/rollback', validateBody(RollbackBody), handle(async (req, res: Response<ApiResponse>) => {
    const rid = restaurantId(req);
    const doc = await findStorefrontContent(rid);
    const version = (req.body as z.infer<typeof RollbackBody>).version;
    const result = doc ? rollbackStorefront(doc, version) : null;
    if (!doc || !result) return notFound(res, `Version ${version}`);
    const saved = await saveStorefrontPublish(rid, doc.publishedVersion, result);
    if (!saved) return res.status(409).json({ success: false, error: 'Someone else just published. Reload and try again.' });
    trackEvent('cms_site_rolled_back', { restaurantId: rid, from: String(version), version: String(result.publishedVersion) });
    res.json({ success: true, data: { publishedVersion: result.publishedVersion, publishedAt: result.publishedAt, restoredFrom: version } });
}));

export default router;
