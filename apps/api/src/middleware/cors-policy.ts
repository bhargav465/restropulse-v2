/**
 * CORS for the API.
 *
 * The merchant dashboard calls with credentials from a known list of origins.
 * Restaurant websites run on any domain (the owner's own, <slug>.restropulse.in,
 * the sites host) and call the public, cookie-less storefront and site routes
 * from the browser, so those get an open, non-credentialed policy.
 */

import cors from 'cors';
import type { RequestHandler } from 'express';

export const PUBLIC_CORS_PREFIXES = ['/api/storefront/', '/api/sites/'];

export function corsPolicy(allowedOrigins: string[]): RequestHandler {
    const appCors = cors({ origin: allowedOrigins, credentials: true });
    const publicCors = cors({ origin: '*', credentials: false, maxAge: 600 });
    return (req, res, next) =>
        PUBLIC_CORS_PREFIXES.some((p) => req.path.startsWith(p)) ? publicCors(req, res, next) : appCors(req, res, next);
}
