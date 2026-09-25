/**
 * Public grader routes — NO auth. This is the lead-generation funnel:
 * anonymous restaurant owners scan themselves, see a blurred report, and
 * unlock it with a promo code (which is where we capture the lead).
 *
 * Cost guardrails: each scan costs real Places calls, so scans are
 * rate-limited per IP (in-memory — adequate for one instance; revisit if the
 * API ever scales out) and the pipeline never calls Claude.
 */

import express, { Request, Response } from 'express';
import { handle } from '../middleware/async-handler.js';
import { runGraderScan, unlockGraderScan, type GraderResult } from '../services/intelligence/grader.js';
import { searchPlaceCandidates } from '../services/intelligence/places.js';
import type { PlaceCandidate } from '@restropulse/shared';
import { createLogger, trackEvent } from '@restropulse/telemetry/server';

const log = createLogger('grader');
const router = express.Router();

// Per-IP sliding-hour limiters (in-memory — adequate for one instance; revisit
// if the API ever scales out). Scans are the expensive call; suggest fires per
// (debounced) keystroke and photo per image load, so they get looser budgets.
function makeLimiter(maxPerHour: number) {
    const hits = new Map<string, number[]>();
    return (ip: string): boolean => {
        const now = Date.now();
        const windowStart = now - 3600_000;
        const list = (hits.get(ip) ?? []).filter((t) => t > windowStart);
        if (list.length >= maxPerHour) {
            hits.set(ip, list);
            return true;
        }
        list.push(now);
        hits.set(ip, list);
        return false;
    };
}
// 5/hr in production keeps Places costs bounded; local dev gets room to test.
const rateLimited = makeLimiter(process.env.NODE_ENV === 'production' ? 5 : 100);
const unlockLimited = makeLimiter(60); // Backstop abuse of unlock endpoint (lead-capture spam)
const suggestLimited = makeLimiter(120);
const photoLimited = makeLimiter(300);

// Daily circuit-breaker (global, not per-IP) — backstop against distributed
// scraping that rotates IPs to evade per-IP limits. Resets at midnight UTC.
let dailyScanCount = 0;
let lastDayReset = new Date().toDateString();
function checkDailyCircuitBreaker(): boolean {
    const today = new Date().toDateString();
    if (today !== lastDayReset) {
        dailyScanCount = 0;
        lastDayReset = today;
    }
    const limit = process.env.NODE_ENV === 'production' ? 500 : 10000; // Arbitrary high ceiling for dev
    return ++dailyScanCount > limit;
}

function clientIp(req: Request): string {
    return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
}

interface ApiResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
}

router.post('/scan', handle(async (req: Request, res: Response<ApiResponse<GraderResult>>) => {
    const ip = clientIp(req);
    if (rateLimited(ip)) {
        log.warn({ ip }, 'Per-IP scan rate limit exceeded');
        trackEvent('grader_rate_limit_trip', { limitType: 'per-ip', endpoint: '/scan' });
        return res.status(429).json({ success: false, error: 'Too many scans from this connection — try again in an hour.' });
    }
    if (checkDailyCircuitBreaker()) {
        log.error({}, 'Daily scan circuit-breaker tripped — too many scans today');
        trackEvent('grader_circuit_breaker_trip', { limitType: 'daily', endpoint: '/scan' });
        return res.status(503).json({ success: false, error: 'Service temporarily unavailable. Please try again later.' });
    }
    const { name, city, placeId } = (req.body ?? {}) as { name?: unknown; city?: unknown; placeId?: unknown };
    if (typeof name !== 'string' || !name.trim() || typeof city !== 'string' || !city.trim()) {
        return res.status(400).json({ success: false, error: 'Restaurant name and city are required.' });
    }
    const cleanPlaceId = typeof placeId === 'string' && placeId.trim() ? placeId.trim().slice(0, 100) : undefined;
    const result = await runGraderScan(name.trim().slice(0, 120), city.trim().slice(0, 80), cleanPlaceId);
    if (!result) {
        return res.status(404).json({ success: false, error: `We couldn't find "${name.trim()}" on Google in ${city.trim()}. Try the exact name from your Google listing.` });
    }
    log.info({ scanId: result.scanId, score: result.score, problems: result.problems.length }, 'Grader scan completed');
    // The locked response hides the details the unlock reveals — the numbers the
    // teaser needs stay (score, loss, counts, top problem, top-3 board).
    res.json({
        success: true,
        data: {
            ...result,
            problems: result.problems.slice(0, 4),
            leaderboard: result.leaderboard.slice(0, 4),
            searches: result.searches.map((s, i) => (i === 0 ? s : { ...s, topResult: '••••••', yourPosition: s.yourPosition })),
            // Teaser keeps pillar grades but not the checks inside them, and
            // holds back the new-openings intel entirely — that's the unlock.
            pillars: result.pillars.map((p) => ({ ...p, checks: [] })),
            likelyNew: [],
        },
    });
}));

router.post('/unlock', handle(async (req: Request, res: Response<ApiResponse<GraderResult>>) => {
    const ip = clientIp(req);
    if (unlockLimited(ip)) {
        log.warn({ ip }, 'Per-IP unlock rate limit exceeded');
        trackEvent('grader_rate_limit_trip', { limitType: 'per-ip', endpoint: '/unlock' });
        return res.status(429).json({ success: false, error: 'Too many unlock attempts — please wait before trying again.' });
    }
    const { scanId, promoCode, phone, email, name } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof scanId !== 'string' || typeof promoCode !== 'string' || !promoCode.trim()) {
        return res.status(400).json({ success: false, error: 'scanId and promoCode are required.' });
    }
    // The lead IS the product of this page: at least one way to reach them.
    const cleanPhone = typeof phone === 'string' && phone.trim() ? phone.trim().slice(0, 20) : undefined;
    const cleanEmail = typeof email === 'string' && /.+@.+\..+/.test(email.trim()) ? email.trim().slice(0, 120) : undefined;
    if (!cleanPhone && !cleanEmail) {
        return res.status(422).json({ success: false, error: 'Enter a phone number or email so we can send your report.' });
    }
    const out = await unlockGraderScan(scanId, promoCode, {
        ...(cleanPhone ? { phone: cleanPhone } : {}),
        ...(cleanEmail ? { email: cleanEmail } : {}),
        ...(typeof name === 'string' && name.trim() ? { name: name.trim().slice(0, 80) } : {}),
    });
    if (!out.ok) return res.status(422).json({ success: false, error: out.error });
    log.info({ scanId }, 'Grader report unlocked (lead captured)');
    res.json({ success: true, data: out.result });
}));

/**
 * Autocomplete for the grader form: name (+ optional city) -> up to 5 listings
 * with name, address, rating and a photo reference, so the owner picks their
 * exact restaurant instead of hoping text search guesses right.
 */
router.get('/suggest', handle(async (req: Request, res: Response<ApiResponse<PlaceCandidate[]>>) => {
    const ip = clientIp(req);
    if (suggestLimited(ip)) {
        return res.status(429).json({ success: false, error: 'Too many searches — slow down a little.' });
    }
    const name = typeof req.query.name === 'string' ? req.query.name.trim().slice(0, 120) : '';
    const city = typeof req.query.city === 'string' ? req.query.city.trim().slice(0, 80) : '';
    if (name.length < 2) {
        return res.json({ success: true, data: [] });
    }
    const candidates = await searchPlaceCandidates(name, city, undefined, 10, 'IN');
    res.json({ success: true, data: candidates });
}));

/**
 * Photo proxy: turns a Places photo resource name into the actual image via a
 * 302 to Google's short-lived photoUri. Keeps the Maps API key server-side.
 */
const PHOTO_REF = /^places\/[\w-]+\/photos\/[\w.=-]+$/;
router.get('/photo', handle(async (req: Request, res: Response) => {
    const ip = clientIp(req);
    if (photoLimited(ip)) return res.status(429).end();
    const ref = typeof req.query.ref === 'string' ? req.query.ref.trim() : '';
    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!PHOTO_REF.test(ref) || !key) return res.status(404).end();
    try {
        const r = await fetch(
            `https://places.googleapis.com/v1/${ref}/media?maxWidthPx=800&skipHttpRedirect=true&key=${key}`,
        );
        const json = (await r.json()) as { photoUri?: string };
        if (!r.ok || !json.photoUri) return res.status(404).end();
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.redirect(302, json.photoUri);
    } catch {
        res.status(404).end();
    }
}));

/**
 * Static-map proxy for the scan screen: coordinates -> a map tile with a pin.
 * Separate Google product from Place photos, so it works even while the key's
 * project lacks the photo/review SKUs.
 */
router.get('/staticmap', handle(async (req: Request, res: Response) => {
    if (photoLimited(clientIp(req))) return res.status(429).end();
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || !key) {
        return res.status(404).end();
    }
    try {
        const url =
            `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=16&size=640x320&scale=2` +
            `&markers=color:0x7C3AED%7C${lat},${lng}&key=${key}`;
        const r = await fetch(url);
        if (!r.ok) {
            log.warn({ upstream: r.status, body: (await r.text()).slice(0, 300) }, 'Static Maps request failed — is Maps Static API enabled for this key?');
            return res.status(404).end();
        }
        const buf = Buffer.from(await r.arrayBuffer());
        res.setHeader('Content-Type', r.headers.get('content-type') ?? 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.end(buf);
    } catch {
        res.status(404).end();
    }
}));

/**
 * Admin-gated: retrieve captured leads. Supports pagination for operator review.
 * Note: This route is NOT protected by requireAuth in this file. The deploy workflow
 * should mount this router behind API-level auth + admin role checking middleware.
 */
router.get('/leads', handle(async (req: Request, res: Response<ApiResponse<{ total: number; skip: number; limit: number; leads: unknown[] }>>) => {
    const skip = Math.max(0, Number(req.query.skip ?? 0));
    const limit = Math.min(1000, Number(req.query.limit ?? 50));
    const { getGraderLeads } = await import('../services/intelligence/grader.js');
    try {
        const col = getGraderLeads();
        const total = await col.countDocuments();
        const leads = await col
            .find({})
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .toArray();
        res.json({ success: true, data: { total, skip, limit, leads } });
    } catch (err) {
        log.error({ err }, 'Failed to fetch grader leads');
        res.status(500).json({ success: false, error: 'Failed to fetch leads.' });
    }
}));

export default router;
