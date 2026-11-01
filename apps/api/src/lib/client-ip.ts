import type { Request } from 'express';
import { ipKeyGenerator } from 'express-rate-limit';

/**
 * Normalise a client address for rate-limit keys and logs.
 *
 * Azure App Service's front end appends the client port to X-Forwarded-For
 * ("203.0.113.7:51234"), so with `trust proxy` the raw req.ip changes on every
 * connection and a per-IP limit would never trip. Strip the port from IPv4
 * ("a.b.c.d:port") and bracketed IPv6 ("[::1]:port") forms, and drop the
 * IPv4-mapped IPv6 prefix so "::ffff:1.2.3.4" and "1.2.3.4" share a key.
 */
export function normalizeIp(raw: string | undefined | null): string {
    if (!raw) return 'unknown';
    let ip = raw.trim();
    const v4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(ip);
    if (v4WithPort) ip = v4WithPort[1];
    const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(ip);
    if (bracketed) ip = bracketed[1];
    if (ip.toLowerCase().startsWith('::ffff:') && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip.slice(7))) {
        ip = ip.slice(7);
    }
    return ip || 'unknown';
}

/** Client address for a request. Relies on `app.set('trust proxy', 1)` in server.ts. */
export function clientIp(req: Request): string {
    return normalizeIp(req.ip ?? req.socket?.remoteAddress);
}

/**
 * Rate-limit key: the normalised IP, with IPv6 collapsed to its /56 subnet
 * (express-rate-limit's helper) so one host cannot rotate through its block.
 */
export function clientIpKey(req: Request): string {
    const ip = clientIp(req);
    return ip === 'unknown' ? ip : ipKeyGenerator(ip);
}
