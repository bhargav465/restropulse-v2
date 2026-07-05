import { RequestHandler } from 'express';
import { verifyToken } from '../services/jwt.js';

/**
 * requireAuth middleware
 * Validates the Bearer JWT in the Authorization header and populates req.user.
 * Returns 401 if the token is missing or invalid.
 */
export const requireAuth: RequestHandler = (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
    }

    const payload = verifyToken(token);

    if (!payload || payload.type !== 'access') {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
    }

    req.user = {
        userId: payload.userId,
        phone: payload.phone,
        restaurantId: payload.restaurantId,
        role: payload.role,
    };

    next();
};
