import express, { Request, Response } from 'express';
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
    getAccountManagersByCityAndZone,
    getAllCities,
    findUserById,
    updateUser,
    createSubscription,
} from '@restropulse/db';
import { ApiResponse, Restaurant, AccountManager, City, FREE_SIGNUP_CREDITS } from '@restropulse/shared';
import { handle } from '../middleware/async-handler.js';
import { requireAuth } from '../middleware/auth.js';
import { generateTokens } from '../services/jwt.js';
import { createRazorpayCustomer, isRazorpayConfigured } from '../services/razorpay.js';
import { createLogger } from '@restropulse/telemetry/server';

const log = createLogger('restaurant');

const router = express.Router();

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

// Get restaurant by ID (public read)
router.get('/:id', handle(async (req: Request, res: Response<ApiResponse<Restaurant>>) => {
    const { id } = req.params;
    const restaurant = await findRestaurantById(id);

    if (restaurant) {
        res.json({
            success: true,
            data: restaurant
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

// Update restaurant
router.put('/:id', requireAuth, handle(async (req: Request, res: Response<ApiResponse<Restaurant>>) => {
    const { id } = req.params;

    if (req.user!.restaurantId !== id) {
        return res.status(403).json({
            success: false,
            error: 'Forbidden'
        });
    }

    const restaurant = await updateRestaurant(id, req.body);

    if (restaurant) {
        res.json({
            success: true,
            data: restaurant,
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
