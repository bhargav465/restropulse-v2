import { RequestHandler } from 'express';

/**
 * Lightweight in-memory fixed-window rate limiter (per IP + route).
 * Good enough for v1 single-instance deployments; swap for a shared store
 * (Redis) if the API is ever scaled horizontally.
 */
export function simpleRateLimit(options: { windowMs: number; max: number; name: string }): RequestHandler {
    const hits = new Map<string, { count: number; resetAt: number }>();

    return (req, res, next) => {
        const now = Date.now();
        const key = `${options.name}:${req.ip ?? 'unknown'}`;
        const entry = hits.get(key);

        if (!entry || entry.resetAt <= now) {
            hits.set(key, { count: 1, resetAt: now + options.windowMs });
            // Opportunistic cleanup to keep the map bounded.
            if (hits.size > 10_000) {
                for (const [k, v] of hits) {
                    if (v.resetAt <= now) hits.delete(k);
                }
            }
            next();
            return;
        }

        entry.count += 1;
        if (entry.count > options.max) {
            res.status(429).json({ success: false, error: 'Too many requests, please slow down' });
            return;
        }

        next();
    };
}
