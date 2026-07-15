/**
 * Super-admin (platform owner) routes — mounted at /api/super.
 * Auth: merchant JWT + ADMIN role. Accounts whose email matches
 * SUPER_ADMIN_EMAIL are auto-promoted to ADMIN at login (see routes/auth.ts).
 *
 * Controls:
 *   - every restaurant on the platform (open/close, suspend)
 *   - platform-wide feature flags (enforced on storefront routes)
 *   - landing-page content (settings + pricing plans, stored in the landing
 *     site's own database: DB `LANDING_DB_NAME` on the same Mongo cluster)
 */
import express, { Request, Response } from 'express';
import { MongoClient, type Db } from 'mongodb';
import {
    getRestaurantsCollection,
    getMenuItemsCollection,
    getOrdersCollection,
    updateRestaurant,
    MONGO_CLIENT_OPTIONS,
} from '@restropulse/db';
import type { ApiResponse, PlatformFlags } from '@restropulse/shared';
import { handle } from '../middleware/async-handler.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/require-role.js';
import { getPlatformFlags, setPlatformFlags } from '../services/platform-flags.js';
import { createLogger } from '@restropulse/telemetry/server';

const log = createLogger('super');
const router = express.Router();

router.use(requireAuth);
router.use(requireRole('ADMIN'));

// ============================================
// Restaurants (all tenants)
// ============================================

router.get('/restaurants', handle(async (_req: Request, res: Response<ApiResponse>) => {
    const [restaurants, itemCounts, orderStats] = await Promise.all([
        getRestaurantsCollection()
            .find({})
            .project({ name: 1, slug: 1, cuisine: 1, storeOpen: 1, suspended: 1, createdAt: 1 })
            .sort({ createdAt: -1 })
            .limit(500)
            .toArray(),
        getMenuItemsCollection().aggregate([
            { $group: { _id: '$restaurantId', count: { $sum: 1 } } },
        ]).toArray(),
        getOrdersCollection().aggregate([
            { $match: { status: { $ne: 'CANCELLED' } } },
            { $group: { _id: '$restaurantId', orders: { $sum: 1 }, revenue: { $sum: { $ifNull: ['$totals.total', 0] } } } },
        ]).toArray(),
    ]);

    const items = new Map(itemCounts.map((r) => [String(r._id), r.count as number]));
    const orders = new Map(orderStats.map((r) => [String(r._id), { orders: r.orders as number, revenue: r.revenue as number }]));

    res.json({
        success: true,
        data: restaurants.map((r) => {
            const id = String(r._id);
            return {
                id,
                name: r.name,
                slug: r.slug ?? null,
                cuisine: r.cuisine ?? '',
                storeOpen: r.storeOpen === true,
                suspended: r.suspended === true,
                createdAt: r.createdAt ?? null,
                menuItems: items.get(id) ?? 0,
                orders: orders.get(id)?.orders ?? 0,
                revenue: orders.get(id)?.revenue ?? 0,
            };
        }),
    });
}));

router.patch('/restaurants/:id', handle(async (req: Request, res: Response<ApiResponse>) => {
    const { storeOpen, suspended } = (req.body ?? {}) as { storeOpen?: unknown; suspended?: unknown };
    const updates: Record<string, boolean> = {};
    if (storeOpen !== undefined) {
        if (typeof storeOpen !== 'boolean') return res.status(400).json({ success: false, error: 'storeOpen must be a boolean' });
        updates.storeOpen = storeOpen;
    }
    if (suspended !== undefined) {
        if (typeof suspended !== 'boolean') return res.status(400).json({ success: false, error: 'suspended must be a boolean' });
        updates.suspended = suspended;
    }
    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ success: false, error: 'Nothing to update' });
    }
    const restaurant = await updateRestaurant(req.params.id, updates as never);
    if (!restaurant) return res.status(404).json({ success: false, error: 'Restaurant not found' });
    log.info({ restaurantId: req.params.id, updates }, 'super: restaurant updated');
    res.json({ success: true, data: { id: req.params.id, storeOpen: restaurant.storeOpen === true, suspended: restaurant.suspended === true } });
}));

// ============================================
// Platform feature flags
// ============================================

router.get('/flags', handle(async (_req: Request, res: Response<ApiResponse<PlatformFlags>>) => {
    res.json({ success: true, data: await getPlatformFlags() });
}));

router.put('/flags', handle(async (req: Request, res: Response<ApiResponse<PlatformFlags>>) => {
    const body = (req.body ?? {}) as Partial<PlatformFlags>;
    const flags = await setPlatformFlags(body);
    log.info({ flags }, 'super: platform flags updated');
    res.json({ success: true, data: flags });
}));

// ============================================
// Landing page content (separate DB on the same cluster)
// ============================================

let landingClient: Promise<MongoClient> | null = null;
async function landingDb(): Promise<Db> {
    if (!landingClient) {
        const uri = process.env.MONGODB_URI;
        if (!uri) throw new Error('MONGODB_URI not configured');
        landingClient = new MongoClient(uri, MONGO_CLIENT_OPTIONS).connect().catch((err) => {
            landingClient = null;
            throw err;
        });
    }
    const client = await landingClient;
    // Same DB as the main app by default — the Atlas user is scoped to it.
    // Collections used: settings / plans / pages / assets (no collisions with
    // the app's collections; GridFS uses assets.files / assets.chunks).
    return client.db(process.env.LANDING_DB_NAME || process.env.MONGODB_DB_NAME || 'restropulse-dev');
}

const DEFAULT_LANDING_SETTINGS = {
    currencySymbol: '₹',
    adminDemoUrl: 'https://restropulse-admin.vercel.app',
    yearlyMonthsCharged: 10,
};

router.get('/landing/content', handle(async (_req: Request, res: Response<ApiResponse>) => {
    const db = await landingDb();
    const [settings, plans] = await Promise.all([
        db.collection('settings').findOne({ _id: 'landing' as never }),
        db.collection('plans').find({}).sort({ order: 1 }).toArray(),
    ]);
    res.json({
        success: true,
        data: {
            settings: settings
                ? { currencySymbol: settings.currencySymbol, adminDemoUrl: settings.adminDemoUrl, yearlyMonthsCharged: settings.yearlyMonthsCharged }
                : DEFAULT_LANDING_SETTINGS,
            plans: plans.map(({ _id, ...p }) => p),
        },
    });
}));

router.put('/landing/settings', handle(async (req: Request, res: Response<ApiResponse>) => {
    const { currencySymbol, adminDemoUrl, yearlyMonthsCharged } = (req.body ?? {}) as Record<string, unknown>;
    const update: Record<string, unknown> = {};
    if (currencySymbol !== undefined) {
        if (typeof currencySymbol !== 'string' || currencySymbol.length > 4) return res.status(400).json({ success: false, error: 'Invalid currencySymbol' });
        update.currencySymbol = currencySymbol;
    }
    if (adminDemoUrl !== undefined) {
        if (typeof adminDemoUrl !== 'string' || !/^https?:\/\//.test(adminDemoUrl)) return res.status(400).json({ success: false, error: 'adminDemoUrl must be a URL' });
        update.adminDemoUrl = adminDemoUrl;
    }
    if (yearlyMonthsCharged !== undefined) {
        const n = Number(yearlyMonthsCharged);
        if (!Number.isInteger(n) || n < 1 || n > 12) return res.status(400).json({ success: false, error: 'yearlyMonthsCharged must be 1-12' });
        update.yearlyMonthsCharged = n;
    }
    const db = await landingDb();
    await db.collection('settings').updateOne(
        { _id: 'landing' as never },
        { $set: { ...update, updatedAt: new Date() } },
        { upsert: true },
    );
    log.info({ update }, 'super: landing settings updated');
    const settings = await db.collection('settings').findOne({ _id: 'landing' as never });
    res.json({ success: true, data: settings });
}));

router.put('/landing/plans', handle(async (req: Request, res: Response<ApiResponse>) => {
    const plans = req.body?.plans;
    if (!Array.isArray(plans) || plans.length === 0 || plans.length > 10) {
        return res.status(400).json({ success: false, error: 'plans must be a non-empty array (max 10)' });
    }
    const cleaned = [];
    for (const [i, p] of plans.entries()) {
        if (!p || typeof p !== 'object') return res.status(400).json({ success: false, error: `plans[${i}] must be an object` });
        const { id, name, tagline, monthlyPrice, featured, badge, order, active, cta, features } = p as Record<string, unknown>;
        if (typeof id !== 'string' || !/^[a-z0-9-]{2,30}$/.test(id)) return res.status(400).json({ success: false, error: `plans[${i}].id invalid` });
        if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ success: false, error: `plans[${i}].name required` });
        const price = Number(monthlyPrice);
        if (!Number.isFinite(price) || price < 0) return res.status(400).json({ success: false, error: `plans[${i}].monthlyPrice invalid` });
        cleaned.push({
            id,
            name: name.trim(),
            tagline: typeof tagline === 'string' ? tagline : '',
            monthlyPrice: price,
            featured: featured === true,
            ...(typeof badge === 'string' && badge.trim() ? { badge: badge.trim() } : {}),
            order: Number.isInteger(Number(order)) ? Number(order) : i + 1,
            active: active !== false,
            cta: typeof cta === 'string' && cta.trim() ? cta.trim() : 'Start free trial',
            features: Array.isArray(features) ? features.filter((f) => typeof f === 'string').slice(0, 20) : [],
        });
    }
    const db = await landingDb();
    const col = db.collection('plans');
    await col.deleteMany({});
    await col.insertMany(cleaned.map((p) => ({ ...p, updatedAt: new Date() })));
    log.info({ count: cleaned.length }, 'super: landing plans replaced');
    res.json({ success: true, data: { plans: cleaned } });
}));

export default router;
