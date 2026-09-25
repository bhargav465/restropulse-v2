import { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Wraps an async route handler and forwards any thrown errors to Express's
 * next() error handler. Eliminates the try/catch/500 boilerplate in every route.
 */
export const handle = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
    (req, res, next) => fn(req, res).catch(next);
