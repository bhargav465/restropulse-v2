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
    getIntelligenceScansCollection,
    getIntelligenceReportsCollection,
    getEventsCollection,
    getOrdersCollection,
    getCustomersCollection,
} from '@restropulse/db';
import type {
    ApiResponse,
    IntelligenceReport,
    IntelligenceReportSummary,
    IntelligenceScan,
    IntelligenceSelfMetrics,
} from '@restropulse/shared';
import { MAX_REPORTS_PER_RESTAURANT } from '@restropulse/db';
import { handle } from '../../middleware/async-handler.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/require-role.js';
import { runScanPipeline } from '../../services/intelligence/pipeline.js';
import {
    buildCohorts,
    computeCohorts,
    DROP_OFF_WINDOW_DAYS,
    type CohortEventRow,
    type CohortOrderRow,
} from '../../services/ordering/cohorts.js';
import { createLogger } from '@restropulse/telemetry/server';

const log = createLogger('admin-intelligence');

const router = express.Router();

// Merchant auth for everything below (OWNER only).
router.use(requireAuth, requireRole('OWNER'));

function restaurantId(req: Request): string {
    return req.user!.restaurantId;
}

const SCAN_THROTTLE_MS = 24 * 60 * 60 * 1000;

// ============================================================
// POST /scan — start an async scan (async job, fire-and-forget)
// ============================================================

router.post('/scan', handle(async (req: Request, res: Response<ApiResponse<{ scanId: string }>>) => {
    const rid = restaurantId(req);
    const { name, city, force } = (req.body ?? {}) as { name?: unknown; city?: unknown; force?: unknown };

    // Defaults from the restaurant profile.
    const restaurant = await findRestaurantById(rid);
    const scanName = typeof name === 'string' && name.trim() ? name.trim() : restaurant?.name;
    const scanCity =
        typeof city === 'string' && city.trim()
            ? city.trim()
            : (restaurant?.sourceCity ?? restaurant?.location?.address);

    if (!scanName || !scanCity) {
        return res.status(400).json({
            success: false,
            error: 'name and city are required (and could not be defaulted from your restaurant profile).',
        });
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
        query: { name: scanName, city: scanCity },
        status: 'QUEUED',
        requestedBy: req.user!.userId,
        createdAt: now,
        updatedAt: now,
    };
    await getIntelligenceScansCollection().insertOne(scan as unknown as Record<string, unknown>);

    // Fire-and-forget: the pipeline writes status to the scan doc; the response
    // does not wait on it. runScanPipeline never throws (writes FAILED itself).
    void runScanPipeline(scanId, { name: scanName, city: scanCity });

    log.info({ scanId, restaurantId: rid }, 'Intelligence scan queued');
    res.status(202).json({ success: true, data: { scanId } });
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

router.get('/self-metrics', handle(async (req: Request, res: Response<ApiResponse<IntelligenceSelfMetrics>>) => {
    const rid = restaurantId(req);
    const windowStart = new Date(Date.now() - DROP_OFF_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const [eventDocs, orderDocs, customerDocs] = await Promise.all([
        getEventsCollection()
            .find({ restaurantId: rid, name: { $in: ['add_to_cart', 'begin_checkout', 'order_placed'] }, ts: { $gte: windowStart } })
            .project({ name: 1, sessionId: 1, ts: 1 })
            .toArray(),
        getOrdersCollection()
            .find({ restaurantId: rid, status: { $ne: 'CANCELLED' } })
            .project({ customerId: 1, createdAt: 1, totals: 1 })
            .toArray(),
        getCustomersCollection().find({ restaurantId: rid }).project({ _id: 1 }).toArray(),
    ]);

    // Cohorts — reuse the existing cohort service.
    const cohortCounts = computeCohorts(
        eventDocs as unknown as CohortEventRow[],
        orderDocs as unknown as CohortOrderRow[],
        customerDocs.map((c) => ({ id: String(c._id) })),
    );
    const cohorts = buildCohorts(cohortCounts).map((c) => ({ id: c.id, name: c.name, count: c.count }));

    // Order-derived metrics: repeat rate, new-vs-returning revenue, peak hours, AOV.
    type OrderRow = { customerId?: string; createdAt: string | Date; totals?: { total?: number } };
    const orders = orderDocs as unknown as OrderRow[];

    const ordersByCustomer = new Map<string, OrderRow[]>();
    for (const o of orders) {
        if (!o.customerId) continue;
        const list = ordersByCustomer.get(o.customerId) ?? [];
        list.push(o);
        ordersByCustomer.set(o.customerId, list);
    }

    let repeatCustomers = 0;
    let newRevenue = 0;
    let returningRevenue = 0;
    for (const list of ordersByCustomer.values()) {
        list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        if (list.length > 1) repeatCustomers += 1;
        list.forEach((o, idx) => {
            const total = Number(o.totals?.total ?? 0);
            if (idx === 0) newRevenue += total;
            else returningRevenue += total;
        });
    }

    const totalCustomers = ordersByCustomer.size;
    const orderCount = orders.length;
    const grossRevenue = newRevenue + returningRevenue;

    // 7×24 peak-hours matrix (local time of the server).
    const peakHours: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const o of orders) {
        const d = new Date(o.createdAt);
        if (Number.isNaN(d.getTime())) continue;
        peakHours[d.getDay()][d.getHours()] += 1;
    }

    const metrics: IntelligenceSelfMetrics = {
        orderCount,
        totalCustomers,
        repeatCustomers,
        repeatRatePct: totalCustomers > 0 ? Math.round((repeatCustomers / totalCustomers) * 100) : 0,
        avgOrderValue: orderCount > 0 ? Math.round(grossRevenue / orderCount) : 0,
        revenue: { newCustomer: Math.round(newRevenue), returningCustomer: Math.round(returningRevenue) },
        peakHours,
        cohorts,
    };
    res.json({ success: true, data: metrics });
}));

export default router;
