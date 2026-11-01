/**
 * HTTP security headers for the JSON API (helmet).
 *
 * The API is called cross-origin by the SPA (Static Web Apps origin), and some
 * responses are loaded by the browser as subresources rather than via fetch:
 * `/content/*` placeholder media, `/api/grader/photo` (302 to a Google photo)
 * and `/api/grader/staticmap`. Two helmet defaults would break those:
 *
 * - Cross-Origin-Resource-Policy defaults to `same-origin`, which blocks
 *   `<img src="https://api...">` from the web origin. Set to `cross-origin`.
 * - Cross-Origin-Embedder/Opener policies are page-level concerns; harmless on
 *   JSON, left at helmet defaults where they do not affect subresources.
 *
 * Content-Security-Policy is locked down to `default-src 'none'`: the API never
 * serves HTML that should run script, so nothing legitimate is lost and an
 * injected HTML error page cannot execute anything.
 */

import helmet from 'helmet';
import type { RequestHandler } from 'express';

export function securityHeaders(): RequestHandler {
    return helmet({
        contentSecurityPolicy: {
            useDefaults: false,
            directives: {
                defaultSrc: ["'none'"],
                frameAncestors: ["'none'"],
                baseUri: ["'none'"],
                formAction: ["'none'"],
            },
        },
        crossOriginResourcePolicy: { policy: 'cross-origin' },
        // HSTS: App Service terminates TLS; one year, subdomains, matching the web app.
        strictTransportSecurity: { maxAge: 31_536_000, includeSubDomains: true },
        referrerPolicy: { policy: 'no-referrer' },
    });
}
