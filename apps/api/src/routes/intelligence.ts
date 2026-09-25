/**
 * Merchant admin routes for Restaurant Intelligence (v1) —
 * mounted at /api/admin/intelligence.
 * Auth: existing merchant JWT (requireAuth) + OWNER role.
 * All operations are scoped to req.user.restaurantId.
 *
 * The scan pipeline is an async in-process job (pipeline.ts): POST /scan returns
 * `{ scanId }` immediately and the UI polls GET /scan/:id. No HTTP request waits
 * on the 30–90 s pipeline (ARCHITECTURE §4, CLAUDE §10).
 *
 * Intelligence documents keep their string `_id` (matching the shared types and
 * the PR1 seed) rather than the id-remap convention used by ordering routes.
 */

import express, { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import {
    findRestaurantById,
    updateRestaurant,
    getAllCities,
    getIntelligenceScansCollection,
    getIntelligenceReportsCollection,
    getIntelligenceSnapshotsCollection,
    getCompetitorCacheCollection,
} from '@restropulse/db';
import type {
    ApiResponse,
    PlaceCandidate,
    IntelligenceNotificationsResponse,
    IntelligenceReport,
    IntelligenceReportSummary,
    IntelligenceScan,
    IntelligenceSelfMetrics,
    WatchlistEntry,
    SnapshotSource,
    CompareRow,
} from '@restropulse/shared';
import { WATCHLIST_MAX } from '@restropulse/shared';
import { MAX_REPORTS_PER_RESTAURANT } from '@restropulse/db';
import {
    getSeries,
    getFeedbackChanges,
    runDailySnapshotJob,
    resolveSelfPlaceId,
    captureSnapshot,
    type CaptureTarget,
    type SnapshotSeriesPoint,
    type FeedbackDay,
} from '../services/intelligence/snapshots.js';
import { getCompareRows, getNewOpenings, type NewOpening } from '../services/intelligence/compare.js';
import { recordZomatoManualEntry } from '../services/intelligence/zomato.js';
import { handle } from '../middleware/async-handler.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/require-role.js';
import { requireEntitlement } from '../middleware/require-entitlement.js';
import { runScanPipeline } from '../services/intelligence/pipeline.js';
import { searchPlaceCandidates } from '../services/intelligence/places.js';
import { getNotificationFeed } from '../services/intelligence/notifications.js';
import { getWatchlistDigest, type WatchlistDigestResponse } from '../services/intelligence/watchlist-digest.js';
import { draftReviewReply, type DraftReplyOutput } from '../services/intelligence/analysis.js';
import { createLogger } from '@restropulse/telemetry/server';

const log = createLogger('admin-intelligence');

const router = express.Router();

// Merchant auth for everything below (OWNER only) + trial/subscription entitlement.
router.use(requireAuth, requireRole('OWNER'), requireEntitlement);

function restaurantId(req: Request): string {
    return req.user!.restaurantId;
}

const SCAN_THROTTLE_MS = 24 * 60 * 60 * 1000;
/** A non-terminal scan untouched for this long is orphaned (pipeline is in-process; API restart kills it). */
const SCAN_STALE_MS = 10 * 60 * 1000;

/**
 * The restaurant's in-flight scan (QUEUED..SCORING), if any. First marks orphaned
 * scans FAILED so a crashed/restarted pipeline can neither be resumed forever nor
 * hold the 24h throttle.
 */
async function findActiveScan(rid: string): Promise<IntelligenceScan | null> {
    const scans = getIntelligenceScansCollection();
    await scans.updateMany(
        {
            restaurantId: rid,
            status: { $nin: ['COMPLETED', 'FAILED'] },
            updatedAt: { $lt: new Date(Date.now() - SCAN_STALE_MS) },
        },
        { $set: { status: 'FAILED', error: 'The scan was interrupted. Please run it again.', updatedAt: new Date() } },
    );
    const active = await scans.findOne(
        { restaurantId: rid, status: { $nin: ['COMPLETED', 'FAILED'] } },
        { sort: { createdAt: -1 } },
    );
    return (active as unknown as IntelligenceScan | null) ?? null;
}

/**
 * Human city name for a restaurant. `sourceCity` is a city *id* (`city-hyderabad`);
 * sending that to Google as the search text ("Bawarchi, city-hyderabad") and
 * showing it in the UI banner were both wrong. Resolve it through the cities
 * collection, falling back to a de-slugged form, then to the saved address.
 */
async function cityDisplayName(restaurant: { sourceCity?: string; location?: { address?: string } } | null): Promise<string | undefined> {
    const src = restaurant?.sourceCity;
    if (src) {
        const match = (await getAllCities().catch(() => [])).find((c) => c.id === src);
        if (match?.name) return match.name;
        const deslugged = src.replace(/^city-/, '').replace(/[-_]+/g, ' ').trim();
        if (deslugged) return deslugged.replace(/\b\w/g, (ch) => ch.toUpperCase());
    }
    return restaurant?.location?.address || undefined;
}

function selfLocationOf(restaurant: { location?: { lat?: number; lng?: number } } | null): { lat: number; lng: number } | undefined {
    const loc = restaurant?.location;
    return loc && typeof loc.lat === 'number' && typeof loc.lng === 'number' ? { lat: loc.lat, lng: loc.lng } : undefined;
}

// ============================================================
// GET /notifications — the owner's feed; POST /notifications/seen — mark read
// ============================================================

router.get('/notifications', handle(async (req: Request, res: Response<ApiResponse<IntelligenceNotificationsResponse>>) => {
    res.json({ success: true, data: await getNotificationFeed(restaurantId(req)) });
}));

router.post('/notifications/seen', handle(async (req: Request, res: Response<ApiResponse<{ seenAt: string }>>) => {
    const rid = restaurantId(req);
    const restaurant = await findRestaurantById(rid);
    const seenAt = new Date();
    await updateRestaurant(rid, {
        intelligence: { ...(restaurant?.intelligence ?? {}), notificationsSeenAt: seenAt },
    });
    res.json({ success: true, data: { seenAt: seenAt.toISOString() } });
}));

// ============================================================
// GET /watchlist/digest — tracked rivals: day/week reviews + comments
// ============================================================

router.get('/watchlist/digest', handle(async (req: Request, res: Response<ApiResponse<WatchlistDigestResponse>>) => {
    res.json({ success: true, data: await getWatchlistDigest(restaurantId(req)) });
}));

// ============================================================
// POST /reviews/draft-reply — one-tap follow-through for a review
// ============================================================

router.post('/reviews/draft-reply', handle(async (req: Request, res: Response<ApiResponse<DraftReplyOutput>>) => {
    const { text, rating, author } = (req.body ?? {}) as { text?: unknown; rating?: unknown; author?: unknown };
    if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ success: false, error: 'text is required' });
    if (typeof rating !== 'number' || rating < 1 || rating > 5) return res.status(400).json({ success: false, error: 'rating (1-5) is required' });
    const restaurant = await findRestaurantById(restaurantId(req));
    const out = await draftReviewReply({
        restaurantName: restaurant?.name ?? 'our restaurant',
        review: { text: text.trim(), rating, ...(typeof author === 'string' && author.trim() ? { author: author.trim() } : {}) },
        voice: { ...(restaurant?.cuisine ? { cuisine: restaurant.cuisine } : {}) },
    });
    res.json({ success: true, data: out });
}));

// ============================================================
// Action-plan progress — GET/PUT /action-plan/progress?reportId=
// ============================================================

const ACTION_PROGRESS_KEEP = 6;

router.get('/action-plan/progress', handle(async (req: Request, res: Response<ApiResponse<{ reportId: string; done: number[] }>>) => {
    const reportId = typeof req.query.reportId === 'string' ? req.query.reportId : '';
    if (!reportId) return res.status(400).json({ success: false, error: 'reportId is required' });
    const restaurant = await findRestaurantById(restaurantId(req));
    const entry = (restaurant?.intelligence?.actionProgress ?? []).find((p) => p.reportId === reportId);
    res.json({ success: true, data: { reportId, done: entry?.done ?? [] } });
}));

router.put('/action-plan/progress', handle(async (req: Request, res: Response<ApiResponse<{ reportId: string; done: number[] }>>) => {
    const rid = restaurantId(req);
    const { reportId, done } = (req.body ?? {}) as { reportId?: unknown; done?: unknown };
    if (typeof reportId !== 'string' || !reportId.trim()) {
        return res.status(400).json({ success: false, error: 'reportId is required' });
    }
    if (!Array.isArray(done) || done.some((n) => typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 20)) {
        return res.status(422).json({ success: false, error: 'done must be a list of action priorities (1–20)' });
    }
    // The report must belong to this restaurant.
    const owns = await getIntelligenceReportsCollection().findOne({ _id: reportId as any, restaurantId: rid }, { projection: { _id: 1 } });
    if (!owns) return res.status(404).json({ success: false, error: 'report not found' });

    const restaurant = await findRestaurantById(rid);
    const current = restaurant?.intelligence?.actionProgress ?? [];
    const cleaned = [...new Set(done as number[])].sort((a, b) => a - b);
    const next = [
        { reportId, done: cleaned, updatedAt: new Date() },
        ...current.filter((p) => p.reportId !== reportId),
    ].slice(0, ACTION_PROGRESS_KEEP);
    await updateRestaurant(rid, { intelligence: { ...(restaurant?.intelligence ?? {}), actionProgress: next } });
    res.json({ success: true, data: { reportId, done: cleaned } });
}));

// ============================================================
// GET /places/search — "Is this you?" candidates before a scan
// ============================================================

router.get('/places/search', handle(async (req: Request, res: Response<ApiResponse<PlaceCandidate[]>>) => {
    const rid = restaurantId(req);
    const restaurant = await findRestaurantById(rid);
    const qName = typeof req.query.name === 'string' && req.query.name.trim() ? req.query.name.trim() : restaurant?.name;
    const qCity =
        typeof req.query.city === 'string' && req.query.city.trim() ? req.query.city.trim() : await cityDisplayName(restaurant);
    if (!qName || !qCity) {
        return res.status(400).json({ success: false, error: 'name and city are required.' });
    }
    const candidates = await searchPlaceCandidates(qName, qCity, selfLocationOf(restaurant));
    res.json({ success: true, data: candidates });
}));

// ============================================================
// POST /scan — start an async scan (async job, fire-and-forget)
// ============================================================

router.post('/scan', handle(async (req: Request, res: Response<ApiResponse<{ scanId: string }>>) => {
    const rid = restaurantId(req);
    const { name, city, force, placeId } = (req.body ?? {}) as {
        name?: unknown;
        city?: unknown;
        force?: unknown;
        placeId?: unknown;
    };

    // Defaults from the restaurant profile.
    const restaurant = await findRestaurantById(rid);
    const scanName = typeof name === 'string' && name.trim() ? name.trim() : restaurant?.name;
    const scanCity =
        typeof city === 'string' && city.trim()
            ? city.trim()
            : await cityDisplayName(restaurant);
    // Brief 10: confirmed placeId from the picker (request) → else the saved profile id.
    const scanPlaceId =
        typeof placeId === 'string' && placeId.trim()
            ? placeId.trim()
            : restaurant?.googlePlaceId;

    if (!scanName || !scanCity) {
        return res.status(400).json({
            success: false,
            error: 'name and city are required (and could not be defaulted from your restaurant profile).',
        });
    }

    // Idempotent start: a scan is already running (double click, remount, second tab)
    // -- hand back its id instead of launching a duplicate or tripping the throttle.
    const inFlight = await findActiveScan(rid);
    if (inFlight) {
        return res.status(202).json({ success: true, data: { scanId: inFlight._id } });
    }

    // 24 h throttle unless force=true (OWNER). A prior FAILED scan does not block.
    if (force !== true) {
        const cutoff = new Date(Date.now() - SCAN_THROTTLE_MS);
        const recent = await getIntelligenceScansCollection().findOne({
            restaurantId: rid,
            status: { $ne: 'FAILED' },
            createdAt: { $gte: cutoff },
        });
        if (recent) {
            return res.status(409).json({
                success: false,
                error: 'A scan already ran in the last 24 hours. Re-scan is available once per day (use force to override).',
            });
        }
    }

    const scanId = randomUUID();
    const now = new Date();
    const scan: IntelligenceScan = {
        _id: scanId,
        restaurantId: rid,
        query: { name: scanName, city: scanCity, ...(scanPlaceId ? { placeId: scanPlaceId } : {}) },
        status: 'QUEUED',
        requestedBy: req.user!.userId,
        createdAt: now,
        updatedAt: now,
    };
    await getIntelligenceScansCollection().insertOne(scan as unknown as Record<string, unknown>);

    // An explicitly confirmed place ("Is this you?") is remembered on the profile
    // so every later scan and daily check targets the same listing.
    if (typeof placeId === 'string' && placeId.trim() && placeId.trim() !== restaurant?.googlePlaceId) {
        await updateRestaurant(rid, { googlePlaceId: placeId.trim() }).catch((err) =>
            log.warn({ err, restaurantId: rid }, 'Could not persist confirmed googlePlaceId'),
        );
    }

    // Bias the Places search to the restaurant's own coordinates (from onboarding)
    // when available -- far more reliable than matching a free-text name + city.
    const selfLocation = selfLocationOf(restaurant);

    // Fire-and-forget: the pipeline writes status to the scan doc; the response
    // does not wait on it. runScanPipeline never throws (writes FAILED itself).
    void runScanPipeline(scanId, {
        name: scanName,
        city: scanCity,
        ...(scanPlaceId ? { placeId: scanPlaceId } : {}),
        ...(selfLocation ? { selfLocation } : {}),
    });

    log.info({ scanId, restaurantId: rid }, 'Intelligence scan queued');
    res.status(202).json({ success: true, data: { scanId } });
}));

// ============================================================
// GET /scan/active — the in-flight scan (or null) so the UI can resume polling
// after a navigation/refresh. Must be declared before /scan/:id.
// ============================================================

router.get('/scan/active', handle(async (req: Request, res: Response<ApiResponse<IntelligenceScan | null>>) => {
    res.json({ success: true, data: await findActiveScan(restaurantId(req)) });
}));

// ============================================================
// GET /scan/:id — poll status (+ reportId when COMPLETED)
// ============================================================

router.get('/scan/:id', handle(async (req: Request, res: Response<ApiResponse<IntelligenceScan>>) => {
    const scan = await getIntelligenceScansCollection().findOne({
        _id: req.params.id as any,
        restaurantId: restaurantId(req),
    });
    if (!scan) {
        return res.status(404).json({ success: false, error: 'Scan not found' });
    }
    res.json({ success: true, data: scan as unknown as IntelligenceScan });
}));

// ============================================================
// GET /reports — last 12 summaries (id, restroScore, generatedAt, deltas)
// ============================================================

router.get('/reports', handle(async (req: Request, res: Response<ApiResponse<IntelligenceReportSummary[]>>) => {
    const docs = await getIntelligenceReportsCollection()
        .find({ restaurantId: restaurantId(req) })
        .sort({ generatedAt: -1 })
        .limit(MAX_REPORTS_PER_RESTAURANT)
        .toArray();

    const summaries: IntelligenceReportSummary[] = (docs as unknown as IntelligenceReport[]).map((r) => ({
        id: r._id,
        restroScore: r.restroScore,
        generatedAt: r.generatedAt,
        ...(r.deltas ? { deltas: r.deltas } : {}),
    }));
    res.json({ success: true, data: summaries });
}));

// ============================================================
// GET /reports/latest — convenience for tab load
// ============================================================

router.get('/reports/latest', handle(async (req: Request, res: Response<ApiResponse<IntelligenceReport | null>>) => {
    const doc = await getIntelligenceReportsCollection()
        .find({ restaurantId: restaurantId(req) })
        .sort({ generatedAt: -1 })
        .limit(1)
        .toArray();
    res.json({ success: true, data: (doc[0] as unknown as IntelligenceReport) ?? null });
}));

// ============================================================
// GET /reports/:id — full report
// ============================================================

router.get('/reports/:id', handle(async (req: Request, res: Response<ApiResponse<IntelligenceReport>>) => {
    const doc = await getIntelligenceReportsCollection().findOne({
        _id: req.params.id as any,
        restaurantId: restaurantId(req),
    });
    if (!doc) {
        return res.status(404).json({ success: false, error: 'Report not found' });
    }
    res.json({ success: true, data: doc as unknown as IntelligenceReport });
}));

// ============================================================
// GET /self-metrics — internal analytics from events/orders (no new tracking)
// ============================================================

router.get('/self-metrics', handle(async (_req: Request, res: Response<ApiResponse<IntelligenceSelfMetrics>>) => {
    // Intentionally stubbed. the reference derived these from its Ordering system
    // (orders/events/cohorts), which this app does not have. Returns an
    // empty-but-valid shape so the "My Restaurant" overview renders gracefully.
    // Wire real data if/when an ordering or analytics source exists here.
    const metrics: IntelligenceSelfMetrics = {
        orderCount: 0,
        totalCustomers: 0,
        repeatCustomers: 0,
        repeatRatePct: 0,
        avgOrderValue: 0,
        revenue: { newCustomer: 0, returningCustomer: 0 },
        peakHours: Array.from({ length: 7 }, () => Array(24).fill(0)),
        cohorts: [],
    };
    res.json({ success: true, data: metrics });
}));

// ============================================================
// Intelligence — two-bucket dashboard (Brief 07, additive)
// All routes below inherit merchant JWT + OWNER (router.use above).
// ============================================================

function todayStr(): string {
    return new Date().toISOString().slice(0, 10);
}

/** Resolve a `target` query param ('self'|placeId) to a targetPlaceId, or reject. */
async function resolveSnapshotTarget(
    rid: string,
    target: string,
): Promise<{ ok: true; placeId: string; isSelf: boolean } | { ok: false }> {
    if (!target || target === 'self') {
        return { ok: true, placeId: await resolveSelfPlaceId(rid), isSelf: true };
    }
    const restaurant = await findRestaurantById(rid);
    const inWatchlist = (restaurant?.intelligence?.watchlist ?? []).some((w) => w.placeId === target);
    if (inWatchlist) return { ok: true, placeId: target, isSelf: false };
    return { ok: false };
}

/**
 * Which of the given placeIds are "known" (present in competitor_cache or in any
 * of this restaurant's reports). Used to validate PUT /watchlist additions.
 */
async function knownPlaceIds(rid: string, placeIds: string[]): Promise<Set<string>> {
    const known = new Set<string>();
    if (placeIds.length === 0) return known;

    const cached = await getCompetitorCacheCollection()
        .find({ placeId: { $in: placeIds } })
        .project({ placeId: 1 })
        .toArray();
    for (const c of cached) known.add(c.placeId as string);

    const remaining = placeIds.filter((p) => !known.has(p));
    if (remaining.length > 0) {
        const reports = await getIntelligenceReportsCollection()
            .find({ restaurantId: rid })
            .project({ 'competitors.placeId': 1 })
            .toArray();
        for (const r of reports as unknown as Array<{ competitors?: Array<{ placeId: string }> }>) {
            for (const c of r.competitors ?? []) {
                if (remaining.includes(c.placeId)) known.add(c.placeId);
            }
        }
    }
    return known;
}

// ---- GET /watchlist ----
router.get('/watchlist', handle(async (req: Request, res: Response<ApiResponse<{ entries: WatchlistEntry[]; max: number }>>) => {
    const restaurant = await findRestaurantById(restaurantId(req));
    res.json({
        success: true,
        data: { entries: restaurant?.intelligence?.watchlist ?? [], max: WATCHLIST_MAX },
    });
}));

// ---- PUT /watchlist (replace-style) ----
router.put('/watchlist', handle(async (req: Request, res: Response<ApiResponse<{ entries: WatchlistEntry[]; max: number }>>) => {
    const rid = restaurantId(req);
    const body = (req.body ?? {}) as { entries?: unknown };

    if (!Array.isArray(body.entries)) {
        return res.status(422).json({ success: false, error: 'entries must be an array' });
    }
    if (body.entries.length > WATCHLIST_MAX) {
        return res.status(422).json({ success: false, error: `Watchlist exceeds the maximum of ${WATCHLIST_MAX} competitors.` });
    }

    const raw = body.entries as Array<{ placeId?: unknown; name?: unknown; zomatoUrl?: unknown }>;
    const placeIds: string[] = [];
    for (const e of raw) {
        if (typeof e?.placeId !== 'string' || e.placeId.trim() === '') {
            return res.status(422).json({ success: false, error: 'each entry needs a placeId' });
        }
        placeIds.push(e.placeId);
    }

    // Duplicates → 422.
    if (new Set(placeIds).size !== placeIds.length) {
        return res.status(422).json({ success: false, error: 'watchlist contains duplicate placeIds' });
    }

    // Every placeId must be known to competitor_cache or a prior report.
    const known = await knownPlaceIds(rid, placeIds);
    const unknown = placeIds.filter((p) => !known.has(p));
    if (unknown.length > 0) {
        return res.status(422).json({ success: false, error: `unknown placeId(s): ${unknown.join(', ')}` });
    }

    const existing = (await findRestaurantById(rid))?.intelligence?.watchlist ?? [];
    const addedAtByPlace = new Map(existing.map((w) => [w.placeId, w.addedAt]));

    const entries: WatchlistEntry[] = raw.map((e) => ({
        placeId: e.placeId as string,
        name: typeof e.name === 'string' && e.name.trim() ? e.name.trim() : (e.placeId as string),
        addedAt: addedAtByPlace.get(e.placeId as string) ?? new Date(),
        ...(typeof e.zomatoUrl === 'string' && e.zomatoUrl.trim() ? { zomatoUrl: e.zomatoUrl.trim() } : {}),
    }));

    const restaurant = await findRestaurantById(rid);
    await updateRestaurant(rid, {
        intelligence: { ...(restaurant?.intelligence ?? {}), watchlist: entries },
    });

    res.json({ success: true, data: { entries, max: WATCHLIST_MAX } });
}));

// ---- GET /snapshots ----
router.get('/snapshots', handle(async (req: Request, res: Response<ApiResponse<{ target: string; source: string; granularity: string; points: SnapshotSeriesPoint[] }>>) => {
    const rid = restaurantId(req);
    const q = req.query as Record<string, string | undefined>;
    const target = q.target ?? 'self';
    const source = (q.source ?? 'both') as SnapshotSource | 'both';
    const granularity = (q.granularity ?? 'day') as 'day' | 'month';

    if (!['google', 'zomato', 'both'].includes(source)) {
        return res.status(400).json({ success: false, error: 'source must be google, zomato, or both' });
    }
    if (!['day', 'month'].includes(granularity)) {
        return res.status(400).json({ success: false, error: 'granularity must be day or month' });
    }

    const resolved = await resolveSnapshotTarget(rid, target);
    if (!resolved.ok) {
        return res.status(422).json({ success: false, error: 'target is not in your watchlist' });
    }

    const points = await getSeries(rid, {
        targetPlaceId: resolved.placeId,
        source,
        from: q.from,
        to: q.to,
        granularity,
    });
    res.json({ success: true, data: { target, source, granularity, points } });
}));

// ---- GET /feedback-changes (self only) ----
router.get('/feedback-changes', handle(async (req: Request, res: Response<ApiResponse<{ days: FeedbackDay[] }>>) => {
    const rid = restaurantId(req);
    const q = req.query as Record<string, string | undefined>;
    const to = q.to ?? todayStr();
    // Default window: trailing 30 days.
    const from = q.from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const data = await getFeedbackChanges(rid, from, to);
    res.json({ success: true, data });
}));

// ---- GET /compare ----
router.get('/compare', handle(async (req: Request, res: Response<ApiResponse<CompareRow[]>>) => {
    const rid = restaurantId(req);
    const q = req.query as Record<string, string | undefined>;
    const granularity = (q.granularity ?? 'day') as 'day' | 'month';

    if (granularity === 'day') {
        const date = q.date ?? todayStr();
        const rows = await getCompareRows(rid, { granularity: 'day', date });
        return res.json({ success: true, data: rows });
    }
    if (granularity === 'month') {
        const month = q.month ?? todayStr().slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(month)) {
            return res.status(400).json({ success: false, error: 'month must be YYYY-MM' });
        }
        const rows = await getCompareRows(rid, { granularity: 'month', month });
        return res.json({ success: true, data: rows });
    }
    return res.status(400).json({ success: false, error: 'granularity must be day or month' });
}));

// ---- GET /new-openings ----
router.get('/new-openings', handle(async (req: Request, res: Response<ApiResponse<NewOpening[]>>) => {
    const rid = restaurantId(req);
    const q = req.query as Record<string, string | undefined>;

    let radiusKm = q.radiusKm !== undefined ? Number(q.radiusKm) : 5;
    if (!Number.isFinite(radiusKm) || radiusKm <= 0) radiusKm = 5;
    if (radiusKm > 10) radiusKm = 10; // hard cap

    const sinceDays = q.sinceDays !== undefined ? Number(q.sinceDays) : 30;
    if (![30, 60, 90].includes(sinceDays)) {
        return res.status(400).json({ success: false, error: 'sinceDays must be one of 30, 60, 90' });
    }

    const data = await getNewOpenings(rid, radiusKm, sinceDays);
    res.json({ success: true, data });
}));

// ---- POST /zomato-manual ----
router.post('/zomato-manual', handle(async (req: Request, res: Response<ApiResponse<{ snapshotWritten: boolean }>>) => {
    const rid = restaurantId(req);
    const body = (req.body ?? {}) as { target?: unknown; rating?: unknown; reviewCount?: unknown; photoCount?: unknown };

    const target = typeof body.target === 'string' && body.target.trim() ? body.target.trim() : 'self';
    const rating = Number(body.rating);
    const reviewCount = Number(body.reviewCount);
    const photoCount = Number(body.photoCount);

    if (!Number.isFinite(rating) || rating < 0 || rating > 5) {
        return res.status(422).json({ success: false, error: 'rating must be between 0 and 5' });
    }
    if (!Number.isInteger(reviewCount) || reviewCount < 0) {
        return res.status(422).json({ success: false, error: 'reviewCount must be a non-negative integer' });
    }
    if (!Number.isInteger(photoCount) || photoCount < 0) {
        return res.status(422).json({ success: false, error: 'photoCount must be a non-negative integer' });
    }

    // Resolve the target placeId (self shares the Google self placeId).
    let captureTarget: CaptureTarget;
    if (target === 'self') {
        const restaurant = await findRestaurantById(rid);
        captureTarget = {
            placeId: await resolveSelfPlaceId(rid),
            isSelf: true,
            name: restaurant?.name ?? 'Your restaurant',
            zomatoUrl: restaurant?.intelligence?.selfZomatoUrl,
        };
    } else {
        const restaurant = await findRestaurantById(rid);
        const entry = (restaurant?.intelligence?.watchlist ?? []).find((w) => w.placeId === target);
        if (!entry) {
            return res.status(422).json({ success: false, error: 'target is not in your watchlist' });
        }
        captureTarget = { placeId: entry.placeId, isSelf: false, name: entry.name, zomatoUrl: entry.zomatoUrl };
    }

    await recordZomatoManualEntry(rid, captureTarget.placeId, { rating, reviewCount, photoCount });
    const snap = await captureSnapshot(rid, captureTarget, 'zomato', todayStr());
    res.json({ success: true, data: { snapshotWritten: snap !== null } });
}));

// ---- POST /snapshots/capture (OWNER, 1/hour rate-limit) ----
const CAPTURE_RATE_LIMIT_MS = 60 * 60 * 1000;

router.post('/snapshots/capture', handle(async (req: Request, res: Response<ApiResponse<{ captured: number }>>) => {
    const rid = restaurantId(req);

    // 1/hour: reject if any self snapshot was captured within the last hour.
    const recent = await getIntelligenceSnapshotsCollection().findOne({
        restaurantId: rid,
        isSelf: true,
        capturedAt: { $gte: new Date(Date.now() - CAPTURE_RATE_LIMIT_MS) },
    });
    if (recent) {
        return res.status(429).json({ success: false, error: 'A refresh already ran in the last hour. Try again later.' });
    }

    const written = await runDailySnapshotJob(rid, todayStr());
    log.info({ restaurantId: rid, captured: written.length }, 'Intelligence manual capture');
    res.json({ success: true, data: { captured: written.length } });
}));

export default router;
