/**
 * Request validation with zod.
 *
 *   router.post('/scan', validateBody(ScanBody), handle(async (req, res) => {
 *       const { name, city } = req.body as z.infer<typeof ScanBody>;
 *   }));
 *
 * On success the parsed (coerced, trimmed, unknown-keys-stripped) value
 * replaces req.body / is stored on res.locals.query, so handlers only ever see
 * validated data. On failure the request ends with the API's standard
 * `{ success: false, error }` shape using the first issue's message, so schemas
 * should carry human-readable messages (the SPA shows `error` verbatim).
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { z } from 'zod';

export interface ValidateOptions {
    /** HTTP status on failure. Defaults to 400; some routes historically use 422. */
    status?: 400 | 422;
}

export function formatZodError(error: z.ZodError): string {
    const issue = error.issues[0];
    if (!issue) return 'Invalid request.';
    // Custom messages are written as full sentences; zod defaults get the field name prefixed.
    const path = issue.path.join('.');
    const isDefault = /^(Required|Expected .+, received .+|Invalid .+)$/.test(issue.message);
    return isDefault && path ? `${path}: ${issue.message}` : issue.message;
}

export function validateBody<S extends z.ZodTypeAny>(schema: S, opts: ValidateOptions = {}): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
        const result = schema.safeParse(req.body ?? {});
        if (!result.success) {
            res.status(opts.status ?? 400).json({ success: false, error: formatZodError(result.error) });
            return;
        }
        req.body = result.data;
        next();
    };
}

/**
 * Express 4 exposes req.query as a getter-backed object, so parsed query data
 * goes on res.locals.query rather than being written back.
 */
export function validateQuery<S extends z.ZodTypeAny>(schema: S, opts: ValidateOptions = {}): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
        const result = schema.safeParse(req.query ?? {});
        if (!result.success) {
            res.status(opts.status ?? 400).json({ success: false, error: formatZodError(result.error) });
            return;
        }
        res.locals.query = result.data;
        next();
    };
}

/**
 * Trimmed string clipped (not rejected) at `max` characters -- matches the
 * routes' existing `.trim().slice(0, max)` behaviour for free-text inputs.
 */
export const clipped = (max: number) => z.string().trim().transform((s) => s.slice(0, max));

/** Required free-text: missing, non-string or blank all fail with `message`. */
export const requiredText = (max: number, message: string) =>
    z.string({ required_error: message, invalid_type_error: message })
        .trim()
        .min(1, message)
        .transform((s) => s.slice(0, max));

/** Optional free-text: non-strings and blank strings become undefined instead of failing. */
export const optionalText = (max: number) =>
    z.preprocess((v) => (typeof v === 'string' && v.trim() ? v : undefined), clipped(max).optional());
