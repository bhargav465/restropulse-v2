/**
 * Express middleware for structured request logging and error handling.
 *
 * Replaces the manual console.log middleware in apps/api/src/server.ts
 * and enhances the error handler with structured context.
 */

import type { Request, Response, NextFunction } from 'express';
import { createLogger } from './logger.js';
import type pino from 'pino';

let log: pino.Logger | null = null;
function getLog(): pino.Logger {
    if (!log) log = createLogger('http');
    return log;
}

/**
 * Request logging middleware.
 * Logs method, path, status code, and duration for every request.
 * Excludes health checks and static asset requests to reduce noise.
 */
export function requestLoggingMiddleware() {
    return (req: Request, res: Response, next: NextFunction) => {
        // Skip noisy endpoints
        if (req.path === '/health' || req.path.startsWith('/content/')) {
            return next();
        }

        const start = Date.now();

        res.on('finish', () => {
            const duration = Date.now() - start;
            const level = res.statusCode >= 500 ? 'error'
                : res.statusCode >= 400 ? 'warn'
                    : 'info';

            getLog()[level]({
                method: req.method,
                path: req.path,
                statusCode: res.statusCode,
                durationMs: duration,
                userId: (req as RequestWithUser).user?.userId,
                restaurantId: (req as RequestWithUser).user?.restaurantId,
            }, `${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
        });

        next();
    };
}

/**
 * Error handler middleware.
 * Must be registered AFTER all route handlers.
 * Logs the full error with request context, returns sanitized response.
 */
export function errorHandlerMiddleware() {
    // Express requires all 4 params to identify this as an error handler
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    return (err: Error, req: Request, res: Response, _next: NextFunction) => {
        getLog().error({
            err,
            method: req.method,
            path: req.path,
            userId: (req as RequestWithUser).user?.userId,
            restaurantId: (req as RequestWithUser).user?.restaurantId,
        }, 'Unhandled request error');

        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: process.env.NODE_ENV === 'development' ? err.message : undefined,
        });
    };
}

interface RequestWithUser extends Request {
    user?: {
        userId?: string;
        restaurantId?: string;
    };
}
