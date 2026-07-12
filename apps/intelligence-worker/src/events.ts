/**
 * Event emission -- reuses the EXISTING `events` collection via the shared
 * `insertAnalyticsEvent` seam (module CLAUDE.md §12: internal signals come from
 * `events`, no new tracking infra). No new collection, no schema change.
 *
 * Event names:
 *   intelligence.scan.completed          -- one per successful weekly refresh
 *   intelligence.alert.competitor_surge  -- returning competitor gained > X reviews
 *   intelligence.alert.rating_drop       -- base rating fell >= 0.1
 *   intelligence.alert.new_competitor    -- new same-cuisine place <= 2 km
 *
 * The `alert.*` suffixes are exactly `CompetitorAlert['type']`, so an emitted
 * event name is always `intelligence.alert.${alert.type}`.
 */

import { insertAnalyticsEvent } from '@restropulse/db';
import type { CompetitorAlert, IntelligenceReport } from '@restropulse/shared';

/** Synthetic session id stamped on worker-emitted events (no HTTP session). */
export const WORKER_SESSION_ID = 'system:intelligence-worker';

export const SCAN_COMPLETED_EVENT = 'intelligence.scan.completed';

/** Build the event name for an alert -- always inside the shared union. */
export function alertEventName(type: CompetitorAlert['type']): string {
    return `intelligence.alert.${type}`;
}

/** Emit the per-refresh scan-completed event. */
export async function emitScanCompleted(
    restaurantId: string,
    report: IntelligenceReport,
): Promise<void> {
    await insertAnalyticsEvent({
        name: SCAN_COMPLETED_EVENT,
        sessionId: WORKER_SESSION_ID,
        restaurantId,
        payload: {
            reportId: report._id,
            restroScore: report.restroScore,
            ratingDelta: report.deltas?.ratingDelta,
            reviewsDelta: report.deltas?.reviewsDelta,
            restroScoreDelta: report.deltas?.restroScoreDelta,
            newCompetitorCount: report.deltas?.newCompetitors.length ?? 0,
            alertCount: report.deltas?.competitorAlerts.length ?? 0,
        },
        ts: report.generatedAt,
    });
}

/** Emit one event per alert, tagged by alert type. */
export async function emitAlertEvents(
    restaurantId: string,
    reportId: string,
    alerts: CompetitorAlert[],
    at: Date = new Date(),
): Promise<void> {
    for (const alert of alerts) {
        await insertAnalyticsEvent({
            name: alertEventName(alert.type),
            sessionId: WORKER_SESSION_ID,
            restaurantId,
            payload: {
                reportId,
                type: alert.type,
                severity: alert.severity,
                message: alert.message,
                ...(alert.competitorName ? { competitorName: alert.competitorName } : {}),
            },
            ts: at,
        });
    }
}
