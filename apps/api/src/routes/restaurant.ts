import express, { Request, Response } from 'express';
import multer from 'multer';
import {
    findRestaurantById,
    createRestaurant,
    updateRestaurant,
    addOffer,
    removeOffer,
    addSpecial,
    removeSpecial,
    updateMenuTimestamp,
    getPostsCollection,
    getRestaurantsCollection,
    getAccountManagersByCityAndZone,
    getAllCities,
    findUserById,
    updateUser,
    createSubscription,
    toApiFormat,
    toObjectId,
} from '@restropulse/db';
import {
    ApiResponse,
    Restaurant,
    AccountManager,
    City,
    FREE_SIGNUP_CREDITS,
    RESTAURANT_PROFILE_FIELDS,
    RestaurantProfileField,
} from '@restropulse/shared';
import { handle } from '../middleware/async-handler.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/require-role.js';
import { generateTokens } from '../services/jwt.js';
import { createRazorpayCustomer, isRazorpayConfigured } from '../services/razorpay.js';
import {
    assetStore,
    isValidImageUpload,
    MAX_ASSET_BYTES,
    IMAGE_REJECT_MESSAGE,
} from '../services/assets.js';
import { createLogger } from '@restropulse/telemetry/server';

const log = createLogger('restaurant');

const router = express.Router();

// ============================================================
// Restaurant profile: whitelist sanitizer + validation (Brief 04)
// ============================================================

/**
 * Server-internal / credential fields stripped from every restaurant object
 * before it leaves the server, shared by GET /profile AND the public GET /:id
 * (single source of truth). `instagramCredentials` (the encrypted token) is the
 * genuine leak this closes; `razorpayCustomerId` is a server-internal billing
 * id. NOTE: `integrations`, `instagramConnection` (already token-free) and
 * `accountManager` are intentionally RETAINED — the merchant dashboard loads
 * `restaurantData` from GET /:id and reads them (App.tsx `metaConnected`,
 * ProfileSheet), so removing them would break existing users.
 */
const PUBLIC_STRIP_FIELDS = ['instagramCredentials', 'razorpayCustomerId'] as const;

function sanitizeRestaurantForPublic(restaurant: Restaurant): Restaurant {
    const clone: Record<string, unknown> = { ...restaurant };
    for (const field of PUBLIC_STRIP_FIELDS) delete clone[field];
    return clone as unknown as Restaurant;
}

const PROFILE_FIELD_SET = new Set<string>(RESTAURANT_PROFILE_FIELDS as readonly string[]);
const PRICE_RANGES = new Set(['budget', 'mid-range', 'upscale', 'fine-dining']);
const PINCODE_RE = /^[1-9][0-9]{5}$/;
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const FSSAI_RE = /^[0-9]{14}$/;
const EMAIL_RE = /^\S+@\S+\.\S+$/;
const ASSET_URL_RE = /^(\/api\/assets\/|https:\/\/)/;

interface ProfilePatchResult {
    set: Record<string, unknown>;
    unset: Record<string, ''>;
    errors: string[];
    /** Non-whitelisted keys that were silently dropped (warn-logged by caller). */
    blocked: string[];
}

/** Validates a single provided (non-null) profile field. Returns an error string, or null when valid. */
function validateProfileField(field: RestaurantProfileField, value: unknown): string | null {
    switch (field) {
        case 'name':
        case 'legalName':
        case 'cuisine':
        case 'description':
        case 'phone':
        case 'website':
            if (typeof value !== 'string') return `${field} must be a string`;
            if ((field === 'name' || field === 'cuisine') && value.trim().length === 0) return `${field} cannot be empty`;
            return null;
        case 'email':
            if (typeof value !== 'string' || !EMAIL_RE.test(value)) return 'email must be a valid email address';
            return null;
        case 'priceRange':
            if (typeof value !== 'string' || !PRICE_RANGES.has(value)) return 'priceRange must be one of budget, mid-range, upscale, fine-dining';
            return null;
        case 'cuisineTags':
            if (!Array.isArray(value) || value.length > 10) return 'cuisineTags must be an array of up to 10 tags';
            for (const tag of value) {
                if (typeof tag !== 'string' || tag.trim().length < 1 || tag.trim().length > 30) return 'each cuisine tag must be 1–30 characters';
            }
            return null;
        case 'activeOffers':
        case 'chefSpecials':
            if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) return `${field} must be an array of strings`;
            return null;
        case 'gstin':
            if (typeof value !== 'string' || !GSTIN_RE.test(value)) return 'gstin must be a valid 15-character GSTIN';
            return null;
        case 'fssaiLicense':
            if (typeof value !== 'string' || !FSSAI_RE.test(value)) return 'fssaiLicense must be a 14-digit number';
            return null;
        case 'logoUrl':
        case 'coverImageUrl':
            if (typeof value !== 'string' || !ASSET_URL_RE.test(value)) return `${field} must start with /api/assets/ or https://`;
            return null;
        case 'address': {
            if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'address must be an object';
            const a = value as Record<string, unknown>;
            if (typeof a.line1 !== 'string' || a.line1.trim().length === 0) return 'address.line1 is required';
            if (typeof a.city !== 'string' || a.city.trim().length === 0) return 'address.city is required';
            if (typeof a.state !== 'string' || a.state.trim().length === 0) return 'address.state is required';
            if (typeof a.pincode !== 'string' || !PINCODE_RE.test(a.pincode)) return 'address.pincode must be a valid 6-digit PIN code';
            return null;
        }
        case 'location':
        case 'operatingHours':
        case 'serviceOptions':
            if (typeof value !== 'object' || value === null || Array.isArray(value)) return `${field} must be an object`;
            return null;
        default:
            return null;
    }
}

/**
 * Keeps only whitelisted profile keys (blocked keys silently dropped + reported
 * for a warn log). Provided `null` on a field → `$unset`; other provided values
 * are validated. Single source: `RESTAURANT_PROFILE_FIELDS` in @restropulse/shared.
 */
function sanitizeProfilePatch(body: unknown): ProfilePatchResult {
    const set: Record<string, unknown> = {};
    const unset: Record<string, ''> = {};
    const errors: string[] = [];
    const blocked: string[] = [];

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        return { set, unset, errors, blocked };
    }

    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
        if (!PROFILE_FIELD_SET.has(key)) {
            blocked.push(key);
            continue;
        }
        const field = key as RestaurantProfileField;
        if (value === null) {
            unset[field] = '';
            continue;
        }
        const error = validateProfileField(field, value);
        if (error) errors.push(error);
        else set[field] = value;
    }

    return { set, unset, errors, blocked };
}

/** Applies a sanitized profile patch with proper $set/$unset semantics. */
async function applyProfilePatch(
    id: string,
    set: Record<string, unknown>,
    unset: Record<string, ''>,
): Promise<Restaurant | null> {
    const col = getRestaurantsCollection();
    const update: Record<string, unknown> = { $set: { ...set, updatedAt: new Date() } };
    if (Object.keys(unset).length > 0) update.$unset = unset;
    const result = await col.findOneAndUpdate(
        { _id: toObjectId(id) as any },
        update,
        { returnDocument: 'after' },
    );
    return toApiFormat(result) as Restaurant | null;
}

// Logo/cover uploads: in-memory, 5 MB cap (mirrors admin-ordering CSV pattern).
const assetUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_ASSET_BYTES } });

// Create restaurant (onboarding)
router.post('/', requireAuth, handle(async (req: Request, res: Response<ApiResponse>) => {
    const userId = req.user!.userId;

    const user = await findUserById(userId);
    if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' });
    }

    if (!user.emailVerified) {
        return res.status(403).json({ success: false, error: 'Email must be verified before creating a restaurant' });
    }

    if (user.restaurantId && user.restaurantId !== '') {
        return res.status(400).json({ success: false, error: 'User already has a restaurant' });
    }

    const { name, cuisine, location, accountManager, userName, email } = req.body;

    if (!name || !cuisine) {
        return res.status(400).json({ success: false, error: 'Restaurant name and cuisine are required' });
    }

    // Update user name and email if provided
    if (userName || email) {
        const userUpdate: Record<string, string> = {};
        if (userName) userUpdate.name = userName;
        if (email) userUpdate.email = email;
        await updateUser(userId, userUpdate);
    }

    const restaurant = await createRestaurant({
        name,
        cuisine,
        location: location || { address: '', lat: 0, lng: 0, mapUrl: '' },
        accountManager: accountManager || { name: '', phone: '', email: '', avatar: '' },
        integrations: { instagram: false },
    });

    // Link restaurant to user
    await updateUser(userId, { restaurantId: restaurant.id });

    // Create subscription doc with free signup credits (no active plan)
    await createSubscription({
        restaurantId: restaurant.id,
        status: 'NONE',
        credits: FREE_SIGNUP_CREDITS,
    });

    // Create Razorpay customer early so it's available for future subscriptions
    if (isRazorpayConfigured()) {
        const updatedUser = await findUserById(userId);
        if (updatedUser?.email) {
            try {
                const rzpCustomer = await createRazorpayCustomer(updatedUser.name, updatedUser.email, updatedUser.phone);
                await updateUser(userId, { razorpayCustomerId: rzpCustomer.id });
            } catch (err) {
                log.warn({ err, userId }, 'Failed to create Razorpay customer at onboarding — will retry at subscribe time');
            }
        }
    }

    // Issue fresh tokens with the new restaurantId
    const tokens = generateTokens(userId, req.user!.phone, restaurant.id, 'OWNER');

    res.status(201).json({
        success: true,
        data: {
            restaurant,
            token: tokens.accessToken,
            refreshToken: tokens.refreshToken,
        },
    });
}));

// Get all cities
router.get('/cities', requireAuth, handle(async (req: Request, res: Response<ApiResponse<City[]>>) => {
    const cities = await getAllCities();
    res.json({ success: true, data: cities });
}));

// Get account managers by city/zone
router.get('/account-managers', requireAuth, handle(async (req: Request, res: Response<ApiResponse<AccountManager[]>>) => {
    const city = req.query.city as string;
    if (!city) {
        return res.status(400).json({ success: false, error: 'City query parameter is required' });
    }

    const zone = req.query.zone as string | undefined;
    const managers = await getAccountManagersByCityAndZone(city, zone);

    res.json({ success: true, data: managers });
}));

// ============================================================
// Restaurant profile (OWNER) — MUST be registered BEFORE `/:id`
// or Express routes `/profile` and `/assets` into the `:id` param.
// ============================================================

// Get own restaurant profile (business facts + read-only ordering context)
router.get('/profile', requireAuth, requireRole('OWNER'), handle(async (req: Request, res: Response<ApiResponse<Restaurant>>) => {
    const rid = req.user!.restaurantId;
    if (!rid) {
        return res.status(404).json({ success: false, error: 'Restaurant not found' });
    }
    const restaurant = await findRestaurantById(rid);
    if (!restaurant) {
        return res.status(404).json({ success: false, error: 'Restaurant not found' });
    }
    res.json({ success: true, data: sanitizeRestaurantForPublic(restaurant) });
}));

// Update own restaurant profile (partial; whitelist + field validation)
router.patch('/profile', requireAuth, requireRole('OWNER'), handle(async (req: Request, res: Response<ApiResponse<Restaurant>>) => {
    const rid = req.user!.restaurantId;
    if (!rid) {
        return res.status(404).json({ success: false, error: 'Restaurant not found' });
    }

    const { set, unset, errors, blocked } = sanitizeProfilePatch(req.body);
    if (blocked.length > 0) {
        log.warn({ restaurantId: rid, blocked }, 'PATCH /profile ignored non-whitelisted keys');
    }
    if (errors.length > 0) {
        return res.status(400).json({ success: false, error: errors[0] });
    }
    if (Object.keys(set).length === 0 && Object.keys(unset).length === 0) {
        return res.status(400).json({ success: false, error: 'No valid profile fields in request' });
    }

    const updated = await applyProfilePatch(rid, set, unset);
    if (!updated) {
        return res.status(404).json({ success: false, error: 'Restaurant not found' });
    }
    res.json({ success: true, data: sanitizeRestaurantForPublic(updated), message: 'Profile updated successfully' });
}));

// Upload a logo/cover image → GridFS. Client then PATCHes logoUrl/coverImageUrl.
router.post(
    '/assets',
    requireAuth,
    requireRole('OWNER'),
    (req: Request, res: Response, next) => {
        assetUpload.single('file')(req, res, (err: unknown) => {
            if (err) {
                if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(413).json({ success: false, error: IMAGE_REJECT_MESSAGE });
                }
                return res.status(400).json({ success: false, error: IMAGE_REJECT_MESSAGE });
            }
            next();
        });
    },
    handle(async (req: Request, res: Response<ApiResponse>) => {
        const rid = req.user!.restaurantId;
        if (!rid) {
            return res.status(403).json({ success: false, error: 'Forbidden' });
        }
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'Image file is required (multipart field "file")' });
        }
        if (!isValidImageUpload(req.file.originalname, req.file.mimetype)) {
            return res.status(400).json({ success: false, error: IMAGE_REJECT_MESSAGE });
        }

        const kindRaw = (req.body?.kind ?? req.query?.kind) as string | undefined;
        const kind: 'logo' | 'cover' = kindRaw === 'cover' ? 'cover' : 'logo';

        const assetId = await assetStore.put(req.file.buffer, {
            filename: req.file.originalname,
            contentType: req.file.mimetype,
            metadata: { restaurantId: rid, kind },
        });

        res.status(201).json({
            success: true,
            data: {
                assetId,
                url: `/api/assets/${assetId}`,
                contentType: req.file.mimetype,
                size: req.file.size,
            },
        });
    }),
);

// Get restaurant by ID (public read — sanitized: no server-internal credentials)
router.get('/:id', handle(async (req: Request, res: Response<ApiResponse<Restaurant>>) => {
    const { id } = req.params;
    const restaurant = await findRestaurantById(id);

    if (restaurant) {
        res.json({
            success: true,
            data: sanitizeRestaurantForPublic(restaurant),
        });
    } else {
        res.status(404).json({
            success: false,
            error: 'Restaurant not found'
        });
    }
}));

// Get analytics for a restaurant (computed from posts)
router.get('/:id/analytics', requireAuth, handle(async (req: Request, res: Response<ApiResponse>) => {
    const { id } = req.params;

    if (req.user!.restaurantId !== id) {
        return res.status(403).json({
            success: false,
            error: 'Forbidden'
        });
    }

    const postsCol = getPostsCollection();

    const [postsPerWeek, contentMix, platformMix] = await Promise.all([
        postsCol.aggregate([
            { $match: { restaurantId: id } },
            { $addFields: { scheduledDate: { $toDate: '$scheduledFor' } } },
            { $group: { _id: { $isoWeek: '$scheduledDate' }, posts: { $sum: 1 } } },
            { $sort: { _id: -1 } },
            { $limit: 5 },
            { $project: { _id: 0, week: '$_id', posts: 1 } }
        ]).toArray(),
        postsCol.aggregate([
            { $match: { restaurantId: id } },
            { $group: { _id: '$type', count: { $sum: 1 } } },
            { $project: { _id: 0, type: '$_id', count: 1 } }
        ]).toArray(),
        postsCol.aggregate([
            { $match: { restaurantId: id } },
            { $group: { _id: '$platform', count: { $sum: 1 } } },
            { $project: { _id: 0, platform: '$_id', count: 1 } }
        ]).toArray()
    ]);

    res.json({
        success: true,
        data: { postsPerWeek, contentMix, platformMix }
    });
}));

// Update restaurant (HARDENED — same whitelist + validation as PATCH /profile;
// closes the NEXT.md §10 mass-assignment item. Legacy v1 sends only whitelisted
// fields, so it keeps working.)
router.put('/:id', requireAuth, handle(async (req: Request, res: Response<ApiResponse<Restaurant>>) => {
    const { id } = req.params;

    if (req.user!.restaurantId !== id) {
        return res.status(403).json({
            success: false,
            error: 'Forbidden'
        });
    }

    const { set, unset, errors, blocked } = sanitizeProfilePatch(req.body);
    if (blocked.length > 0) {
        log.warn({ restaurantId: id, blocked }, 'PUT /:id ignored non-whitelisted keys');
    }
    if (errors.length > 0) {
        return res.status(400).json({ success: false, error: errors[0] });
    }

    // Fold null-clears into $set: null to preserve legacy updateRestaurant behavior.
    const updates: Record<string, unknown> = { ...set };
    for (const key of Object.keys(unset)) updates[key] = null;

    const restaurant = await updateRestaurant(id, updates);

    if (restaurant) {
        res.json({
            success: true,
            data: sanitizeRestaurantForPublic(restaurant),
            message: 'Restaurant updated successfully'
        });
    } else {
        res.status(404).json({
            success: false,
            error: 'Restaurant not found'
        });
    }
}));

// Update offers
router.patch('/:id/offers', requireAuth, handle(async (req: Request, res: Response<ApiResponse<Restaurant>>) => {
    const { id } = req.params;

    if (req.user!.restaurantId !== id) {
        return res.status(403).json({
            success: false,
            error: 'Forbidden'
        });
    }

    const { action, payload } = req.body;

    // Validate action
    if (!action || (action !== 'ADD' && action !== 'DELETE')) {
        return res.status(400).json({
            success: false,
            error: 'Invalid action. Must be ADD or DELETE'
        });
    }

    let restaurant: Restaurant | null = null;

    if (action === 'ADD') {
        if (typeof payload !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'Payload must be a string for ADD action'
            });
        }
        restaurant = await addOffer(id, payload);
    }

    if (action === 'DELETE') {
        if (typeof payload !== 'number') {
            return res.status(400).json({
                success: false,
                error: 'Payload must be a number for DELETE action'
            });
        }
        restaurant = await removeOffer(id, payload);
    }

    if (restaurant) {
        res.json({
            success: true,
            data: restaurant,
            message: 'Offers updated successfully'
        });
    } else {
        res.status(404).json({
            success: false,
            error: 'Restaurant not found'
        });
    }
}));

// Update chef specials
router.patch('/:id/specials', requireAuth, handle(async (req: Request, res: Response<ApiResponse<Restaurant>>) => {
    const { id } = req.params;

    if (req.user!.restaurantId !== id) {
        return res.status(403).json({
            success: false,
            error: 'Forbidden'
        });
    }

    const { action, payload } = req.body;

    // Validate action
    if (!action || (action !== 'ADD' && action !== 'DELETE')) {
        return res.status(400).json({
            success: false,
            error: 'Invalid action. Must be ADD or DELETE'
        });
    }

    let restaurant: Restaurant | null = null;

    if (action === 'ADD') {
        if (typeof payload !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'Payload must be a string for ADD action'
            });
        }
        restaurant = await addSpecial(id, payload);
    }

    if (action === 'DELETE') {
        if (typeof payload !== 'number') {
            return res.status(400).json({
                success: false,
                error: 'Payload must be a number for DELETE action'
            });
        }
        restaurant = await removeSpecial(id, payload);
    }

    if (restaurant) {
        res.json({
            success: true,
            data: restaurant,
            message: 'Chef specials updated successfully'
        });
    } else {
        res.status(404).json({
            success: false,
            error: 'Restaurant not found'
        });
    }
}));

// Update menu timestamp
router.patch('/:id/menu', requireAuth, handle(async (req: Request, res: Response<ApiResponse<Restaurant>>) => {
    const { id } = req.params;

    if (req.user!.restaurantId !== id) {
        return res.status(403).json({
            success: false,
            error: 'Forbidden'
        });
    }

    const restaurant = await updateMenuTimestamp(id);

    if (restaurant) {
        res.json({
            success: true,
            data: restaurant,
            message: 'Menu updated successfully'
        });
    } else {
        res.status(404).json({
            success: false,
            error: 'Restaurant not found'
        });
    }
}));

export default router;
