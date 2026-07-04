import { RequestHandler } from 'express';
import { verifyToken } from '../services/jwt.js';

/**
 * requireCustomerAuth middleware
 * Storefront counterpart of requireAuth: validates the Bearer JWT and requires
 * the 'customer' role (issued by the storefront register/login endpoints).
 * Merchant tokens are rejected here, and customer tokens are rejected by the
 * merchant admin routes via requireRole — the two auth domains stay distinct.
 */
export const requireCustomerAuth: RequestHandler = (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
    }

    const payload = verifyToken(token);

    if (!payload || payload.type !== 'access' || payload.role !== 'customer') {
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
