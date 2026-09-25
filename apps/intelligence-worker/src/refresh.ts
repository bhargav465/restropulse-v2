/**
 * Weekly intelligence refresh loop (ARCHITECTURE §5).
 *
 * For each active restaurant that already uses intelligence (has at least one
 * report), the loop:
 *   1. triggers a re-scan through the injectable seam (`scanRestaurant`);
 *   2. compares the two most recent reports to derive `competitorAlerts`
 *      (report-builder already fills rating/reviews/restroScore deltas +
 *      newCompetitors; the worker enriches `competitorAlerts` -- no duplicated
 *      delta logic);
 *   3. prunes each restaurant's history to the last 12 reports;
 *   4. emits `intelligence.scan.completed` + one `intelligence.alert.*` event
 *      per alert, into the existing `events` collection.
 *
 * Idempotency: a processed report is stamped `alertsEmittedAt`; the loop skips
 * reports already stamped, so re-running a cycle (or the enqueue seam returning
 * null between scans) never double-emits.
 *
 * Mirrors apps/publisher cron wiring (node-cron, Asia/Kolkata, tracedCronJob).
 */

import cron from 'node-cron';
import { getIntelligenceReportsCollection, getNearbySightingsCollection } from '@restropulse/db';
import type { CompetitorAlert, IntelligenceReport, NearbyPlaceSighting } from '@restropulse/shared';
import { createLogger, tracedCronJob } from '@restropulse/telemetry/server';
import { computeCompetitorAlerts } from './alerts.js';
import { NEW_COMPETITOR_RADIUS_KM } from './sweep.js';
import { pruneReports } from './prune.js';
import { emitAlertEvents, emitScanCompleted } from './events.js';
import { createEnqueueRescan, type RescanFn, type RescanTarget } from './rescan.js';

const log = createLogger('intelligence-refresh');

/** Weekly by default: Mondays 03:00 IST. Override with CRON_INTELLIGENCE. */
const CRON_SCHEDULE = process.env.CRON_INTELLIGENCE ?? '0 3 * * 1';

/** Report doc as stored, plus the worker's idempotency marker. */
type StoredReport = IntelligenceReport & { alertsEmittedAt?: Date };

export interface RefreshDeps {
    /** Re-scan seam; defaults to the enqueue seam (see rescan.ts). */
    scanRestaurant?: RescanFn;
    /** Clock injection for deterministic tests. */
    now?: () => Date;
}

export interface RefreshStats {
    restaurants: number;
    processed: number;
    alerts: number;
    pruned: number;
    skipped: number;
    failed: number;
}

/**
 * Active restaurants with intelligence enabled = those that already have at
 * least one intelligence report.
 * ASSUMPTION: there is no `intelligence.enabled` flag on the Restaurant record,
 * so "enabled" is inferred from having onboarded to the feature (a report
 * exists). This keeps the weekly job cheap -- it only re-scans tenants using it.
 */
export async function getActiveIntelligenceRestaurantIds(): Promise<string[]> {
    const ids = await getIntelligenceReportsCollection().distinct('restaurantId');
    return ids.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

/** The week's window in ms (for "snapshot deltas since the last weekly report"). */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * ADDITIVE (Brief 08): copy the week's snapshot-loop deltas into
 * `competitorAlerts`. Reads `nearby_sightings` first-seen in the last 7 days
 * within the new-competitor radius and maps each to a `new_competitor` alert.
 *
 * v1 tenants have no sightings, so this returns `[]` and the weekly job is
 * byte-identical to what shipped; only opted-in tenants (running the daily sweep) gain
 * these alerts.
 */
async function weeklySnapshotAlerts(restaurantId: string, now: Date): Promise<CompetitorAlert[]> {
    const cutoff = new Date(now.getTime() - WEEK_MS);
    const sightings = (await getNearbySightingsCollection()
        .find({
            restaurantId,
            firstSeenAt: { $gte: cutoff },
            distanceKm: { $lte: NEW_COMPETITOR_RADIUS_KM },
        })
        .sort({ distanceKm: 1 })
        .toArray()) as unknown as NearbyPlaceSighting[];

    return sightings.map((s) => ({
        type: 'new_competitor' as const,
        severity: 'info' as const,
        message: `New nearby place "${s.name}" first seen ${s.distanceKm.toFixed(
            1,
        )} km away. Track their momentum in New Openings.`,
        competitorName: s.name,
    }));
}

async function latestReports(restaurantId: string, limit: number): Promise<StoredReport[]> {
    const docs = await getIntelligenceReportsCollection()
        .find({ restaurantId })
        .sort({ generatedAt: -1 })
        .limit(limit)
        .toArray();
    return docs as unknown as StoredReport[];
}

/**
 * Process one restaurant: trigger the re-scan, compute + persist alerts, prune,
 * and emit events. Returns the alert count (0 when skipped/first-scan).
 */
async function processRestaurant(
    restaurantId: string,
    scanRestaurant: RescanFn,
    now: Date,
    stats: RefreshStats,
): Promise<void> {
    const col = getIntelligenceReportsCollection();

    const [latest] = await latestReports(restaurantId, 1);
    if (!latest) return; // nothing to base a re-scan query on

    const target: RescanTarget = {
        restaurantId,
        name: latest.base.name,
        city: latest.base.city,
    };
    await scanRestaurant(target);

    // Re-read after the seam (in-process pipeline may have added a fresh report).
    const [current, previous] = await latestReports(restaurantId, 2);
    if (!current) return;

    if (current.alertsEmittedAt) {
        // Already processed (no new report since the last cycle) -- stay idempotent.
        stats.skipped += 1;
        return;
    }

    const reportAlerts = computeCompetitorAlerts(previous ?? null, current);

    // ADDITIVE (Brief 08): fold in the week's snapshot-loop deltas. Empty for v1
    // tenants (no sightings) → the array below is identical to what shipped.
    const snapshotAlerts = await weeklySnapshotAlerts(restaurantId, now);
    const seenNames = new Set(reportAlerts.map((a) => a.competitorName).filter(Boolean));
    const alerts = [
        ...reportAlerts,
        ...snapshotAlerts.filter((a) => !seenNames.has(a.competitorName)),
    ];

    // Enrich competitorAlerts only when deltas exist (i.e. there was a previous
    // report at build time); never fabricate a partial ReportDeltas.
    if (current.deltas) {
        current.deltas.competitorAlerts = alerts;
        await col.updateOne(
            { _id: current._id as any },
            { $set: { 'deltas.competitorAlerts': alerts, alertsEmittedAt: now } },
        );
    } else {
        await col.updateOne(
            { _id: current._id as any },
            { $set: { alertsEmittedAt: now } },
        );
    }

    stats.pruned += await pruneReports(restaurantId);
    await emitScanCompleted(restaurantId, current);
    await emitAlertEvents(restaurantId, current._id, alerts, now);

    stats.processed += 1;
    stats.alerts += alerts.length;
}

/**
 * Run one weekly refresh pass over all active restaurants. Never throws -- a
 * failure on one restaurant is logged and the loop continues.
 */
export async function runIntelligenceRefresh(deps: RefreshDeps = {}): Promise<RefreshStats> {
    const scanRestaurant = deps.scanRestaurant ?? createEnqueueRescan();
    const now = deps.now?.() ?? new Date();

    const stats: RefreshStats = {
        restaurants: 0,
        processed: 0,
        alerts: 0,
        pruned: 0,
        skipped: 0,
        failed: 0,
    };

    const restaurantIds = await getActiveIntelligenceRestaurantIds();
    stats.restaurants = restaurantIds.length;
    log.info({ restaurants: restaurantIds.length }, 'Intelligence weekly refresh started');

    for (const restaurantId of restaurantIds) {
        try {
            await processRestaurant(restaurantId, scanRestaurant, now, stats);
        } catch (error) {
            stats.failed += 1;
            log.error({ restaurantId, error: String(error) }, 'Intelligence refresh failed for restaurant');
        }
    }

    log.info(
        {
            restaurants: stats.restaurants,
            processed: stats.processed,
            alerts: stats.alerts,
            pruned: stats.pruned,
            skipped: stats.skipped,
            failed: stats.failed,
        },
        'Intelligence weekly refresh completed',
    );
    return stats;
}

/**
 * Start the weekly refresh cron. Mirrors apps/publisher startPublishingCron.
 */
export function startIntelligenceRefreshCron(): void {
    cron.schedule(
        CRON_SCHEDULE,
        async () => {
            await tracedCronJob('intelligence-refresh', () => runIntelligenceRefresh());
        },
        { timezone: 'Asia/Kolkata' },
    );

    log.info({ schedule: CRON_SCHEDULE }, 'Cron job scheduled: intelligence weekly refresh');
}

/** Manually trigger a refresh pass (admin/testing). */
export async function triggerManualRefresh(): Promise<RefreshStats> {
    log.info('Manual intelligence refresh triggered');
    return runIntelligenceRefresh();
}
