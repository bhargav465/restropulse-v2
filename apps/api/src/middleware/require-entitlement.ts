import { RequestHandler } from 'express';
import { findActiveSubscription } from '@restropulse/db';
import { isEntitled } from '../lib/entitlement.js';

/**
 * requireEntitlement middleware.
 *
 * Gates the paid features (Content Engine, Restaurant Intelligence, Strategy)
 * behind either an active paid subscription or an in-progress free trial.
 * Returns 403 with code 'UPGRADE_REQUIRED' when the restaurant is neither
 * trialing nor subscribed, so the frontend can route to the paywall.
 *
 * Must be used after requireAuth.
 */
export const requireEntitlement: RequestHandler = async (req, res, next) => {
    try {
        const restaurantId = req.user!.restaurantId;
        const subscription = await findActiveSubscription(restaurantId);

        if (!isEntitled(subscription)) {
            res.status(403).json({
                success: false,
                error: 'Your free trial has ended. Subscribe to a plan to keep using this feature.',
                code: 'UPGRADE_REQUIRED',
            });
            return;
        }

        next();
    } catch (error) {
        next(error);
    }
};
