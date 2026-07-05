import { RequestHandler } from 'express';

/**
 * requireRole middleware factory.
 * Returns 403 if req.user.role is not in the allowed list.
 * Must be used after requireAuth.
 */
export function requireRole(...roles: string[]): RequestHandler {
    return (req, res, next) => {
        const userRole = req.user?.role;

        if (!userRole || !roles.includes(userRole)) {
            res.status(403).json({ success: false, error: 'Forbidden: insufficient role' });
            return;
        }

        next();
    };
}
