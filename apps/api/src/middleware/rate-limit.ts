/**
 * Rate limiting shared across API instances.
 *
 * express-rate-limit's default MemoryStore counts per process, so two App
 * Service instances (or a restart) silently double or reset every limit. This
 * store keeps fixed-window counters in MongoDB (`rateLimits` collection) so a
 * limit means the same thing however many instances run.
 *
 * Design:
 * - One document per (prefix, key, window): `_id = "<prefix>:<key>:<windowStart>"`.
 *   increment() is a single atomic `$inc` upsert -- no read-modify-write race.
 * - `expireAt` drives a TTL index, so old windows clean themselves up (Mongo's
 *   TTL monitor runs about once a minute; expired-but-not-yet-deleted docs are
 *   harmless because the window is part of the _id).
 * - Fail open: if Mongo is unreachable the limiter lets the request through
 *   (`passOnStoreError`) and logs, rather than taking the API down with it.
 *
 * ASSUMPTION: fixed windows (not sliding) are acceptable. Worst case a client
 * gets ~2x the limit across a window boundary, which is fine for abuse/cost
 * backstops. The grader's per-hour budgets were sliding in-memory windows before.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { Collection } from 'mongodb';
import { rateLimit, type Options, type Store, type ClientRateLimitInfo } from 'express-rate-limit';
import { getDB } from '@restropulse/db';
import { createLogger, trackEvent } from '@restropulse/telemetry/server';
import { clientIp, clientIpKey } from '../lib/client-ip.js';

const log = createLogger('rate-limit');

export const RATE_LIMITS_COLLECTION = 'rateLimits';

export interface RateLimitDoc {
    _id: string;
    /** `<prefix>:<key>` -- lets resetKey() clear every window for a client. */
    k: string;
    hits: number;
    resetAt: Date;
    expireAt: Date;
}

export interface MongoRateLimitStoreOptions {
    /** Namespaces keys so different limiters never share counters. */
    prefix: string;
    /** Collection accessor; defaults to `rateLimits` on the shared connection. */
    getCollection?: () => Collection<RateLimitDoc>;
    /** Injected clock for tests. */
    now?: () => number;
}

export class MongoRateLimitStore implements Store {
    readonly prefix: string;
    readonly localKeys = false;
    private windowMs = 60_000;
    private readonly getCollection: () => Collection<RateLimitDoc>;
    private readonly now: () => number;
    private indexReady: Promise<void> | null = null;

    constructor(opts: MongoRateLimitStoreOptions) {
        this.prefix = opts.prefix;
        this.getCollection = opts.getCollection ?? (() => getDB().collection<RateLimitDoc>(RATE_LIMITS_COLLECTION));
        this.now = opts.now ?? Date.now;
    }

    init(options: Options): void {
        this.windowMs = options.windowMs;
    }

    /** Lazily create the TTL index once per process; failures are logged, not thrown. */
    private ensureIndexes(col: Collection<RateLimitDoc>): Promise<void> {
        if (!this.indexReady) {
            this.indexReady = Promise.all([
                col.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0, name: 'rateLimits_ttl' }),
                col.createIndex({ k: 1 }, { name: 'rateLimits_k' }),
            ])
                .then(() => undefined)
                .catch((err: unknown) => {
                    this.indexReady = null; // retry on a later request
                    log.warn({ err }, 'rateLimits index creation failed; counters still work, cleanup may lag');
                });
        }
        return this.indexReady;
    }

    private window(key: string): { id: string; k: string; resetAt: Date; expireAt: Date } {
        const now = this.now();
        const windowStart = now - (now % this.windowMs);
        const k = `${this.prefix}:${key}`;
        const resetAt = new Date(windowStart + this.windowMs);
        // Keep the doc one extra window past reset so get() near the boundary still reads it.
        const expireAt = new Date(windowStart + 2 * this.windowMs);
        return { id: `${k}:${windowStart}`, k, resetAt, expireAt };
    }

    async get(key: string): Promise<ClientRateLimitInfo | undefined> {
        const { id } = this.window(key);
        const doc = await this.getCollection().findOne({ _id: id });
        return doc ? { totalHits: doc.hits, resetTime: doc.resetAt } : undefined;
    }

    async increment(key: string): Promise<ClientRateLimitInfo> {
        const col = this.getCollection();
        void this.ensureIndexes(col);
        const { id, k, resetAt, expireAt } = this.window(key);
        const doc = await col.findOneAndUpdate(
            { _id: id },
            { $inc: { hits: 1 }, $setOnInsert: { k, resetAt, expireAt } },
            { upsert: true, returnDocument: 'after' },
        );
        return { totalHits: doc?.hits ?? 1, resetTime: doc?.resetAt ?? resetAt };
    }

    async decrement(key: string): Promise<void> {
        const { id } = this.window(key);
        await this.getCollection().updateOne({ _id: id, hits: { $gt: 0 } }, { $inc: { hits: -1 } });
    }

    async resetKey(key: string): Promise<void> {
        await this.getCollection().deleteMany({ k: `${this.prefix}:${key}` });
    }
}

export interface LimiterOptions {
    /** Unique per limiter; becomes the Mongo key prefix and the telemetry tag. */
    name: string;
    windowMs: number;
    limit: number;
    /** Message for the 429 body (ApiResponse shape). */
    message: string;
    /** Skip predicate, e.g. health checks or webhooks. */
    skip?: (req: Request) => boolean;
    /** Override the store (tests use MemoryStore). Defaults to MongoRateLimitStore. */
    store?: Store;
    /**
     * Extra side effect when the limit trips, e.g. a route's existing telemetry
     * event. Runs in addition to the generic `api_rate_limit_trip` event.
     */
    onTrip?: (req: Request) => void;
}

/**
 * Build a limiter that responds with the API's `{ success: false, error }`
 * shape, emits standard RateLimit-* headers, keys on the normalised client IP
 * and records a telemetry event when it trips.
 */
export function createRateLimiter(opts: LimiterOptions): RequestHandler {
    return rateLimit({
        windowMs: opts.windowMs,
        limit: opts.limit,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        keyGenerator: clientIpKey,
        // We normalise the IP ourselves (Azure appends ports to X-Forwarded-For),
        // so the built-in IP-shape validation would only produce noise.
        validate: { ip: false, keyGeneratorIpFallback: false },
        passOnStoreError: true,
        store: opts.store ?? new MongoRateLimitStore({ prefix: opts.name }),
        skip: opts.skip ? (req: Request) => opts.skip!(req) : undefined,
        handler: (req: Request, res: Response, _next: NextFunction) => {
            log.warn({ limiter: opts.name, ip: clientIp(req), path: req.path }, 'Rate limit exceeded');
            trackEvent('api_rate_limit_trip', { limiter: opts.name, path: req.baseUrl + req.path });
            opts.onTrip?.(req);
            res.status(429).json({ success: false, error: opts.message });
        },
    });
}

/** Paths that must never be throttled: payment-provider webhooks retry on 429. */
const UNLIMITED_PATHS = ['/api/subscriptions/webhook'];

/**
 * Global per-IP budget for every /api route.
 * ASSUMPTION: 300 requests/minute/IP. The SPA's busiest screen (intelligence
 * dashboard while a scan polls) stays well under 60/min; this only catches
 * scripts. Tune via the constant, not per route.
 */
export const GLOBAL_API_LIMIT_PER_MINUTE = 300;

export function createGlobalApiLimiter(store?: Store): RequestHandler {
    return createRateLimiter({
        name: 'api',
        windowMs: 60_000,
        limit: GLOBAL_API_LIMIT_PER_MINUTE,
        message: 'Too many requests -- please slow down and try again in a minute.',
        skip: (req) => UNLIMITED_PATHS.some((p) => req.originalUrl.startsWith(p)),
        store,
    });
}
