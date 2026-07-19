/**
 * Async, in-process scan pipeline (v1). The route creates a QUEUED scan and
 * fires `runScanPipeline(scanId)` WITHOUT awaiting it — no HTTP request ever
 * blocks on the 30–90 s pipeline. The worker (PR4) will take this over.
 *
 * Stages advance `intelligence_scans.status` verbatim through the status
 * machine (scan-status.ts):
 *   QUEUED → FETCHING_PLACES → ANALYZING → SCORING → COMPLETED | FAILED
 *
 * Any stage failure sets the scan FAILED with a user-safe, stage-labeled
 * message. StageErrors carry their own message; anything else degrades to a
 * generic stage message (no internals leak).
 */

import { randomUUID } from 'node:crypto';
import {
    getIntelligenceReportsCollection,
    getIntelligenceScansCollection,
    findRestaurantById,
    updateRestaurant,
} from '@restropulse/db';
import type { IntelligenceReport, ScanStatus } from '@restropulse/shared';
import { WATCHLIST_MAX } from '@restropulse/shared';
import { createLogger } from '@restropulse/telemetry/server';
import { StageError, STAGE_LABELS } from './errors.js';
import { getBaseRestaurantDetails, getNearbyRestaurants } from './places.js';
import { fetchWebsiteSEO } from './seo.js';
import { analyzeCompetition, classifyCuisines } from './analysis.js';
import { assembleReport } from './report-builder.js';
import type { CompactRow } from './prompts.js';

const log = createLogger('intelligence-pipeline');

async function setStatus(scanId: string, status: ScanStatus, extra: Record<string, unknown> = {}): Promise<void> {
    await getIntelligenceScansCollection().updateOne(
        { _id: scanId as any },
        { $set: { status, updatedAt: new Date(), ...extra } },
    );
}

function compact(rows: Array<{ name: string; rating: number; totalRatings: number; distanceKm?: number; priceLevel?: number }>): CompactRow[] {
    return rows.map((r) => ({
        name: r.name,
        rating: r.rating,
        reviews: r.totalRatings,
        ...(r.distanceKm !== undefined ? { distanceKm: r.distanceKm } : {}),
        ...(r.priceLevel !== undefined ? { priceLevel: r.priceLevel } : {}),
    }));
}

/**
 * Run the full scan pipeline for an existing QUEUED scan. Resolves when the scan
 * reaches a terminal state; never throws (failures are written to the scan doc).
 */
export async function runScanPipeline(
    scanId: string,
    query: { name: string; city: string; placeId?: string },
): Promise<void> {
    try {
        // ---- FETCHING_PLACES ----
        await setStatus(scanId, 'FETCHING_PLACES');
        // Brief 10: a confirmed placeId skips text-search disambiguation.
        const base = await getBaseRestaurantDetails(query.name, query.city, query.placeId);
        if (!base) {
            throw new StageError(
                `Could not find "${query.name}" in ${query.city} on Google. Check the name and city and try again.`,
                502,
                'FETCHING_PLACES',
            );
        }
        const competitors = await getNearbyRestaurants(base.location);
        if (competitors.length === 0) {
            throw new StageError(
                'No nearby restaurants were found to compare against. Try a broader city name.',
                502,
                'FETCHING_PLACES',
            );
        }

        // SEO fetch only needs the base website — start it now, resolve before scoring.
        const seoPromise = fetchWebsiteSEO(base.website, base.name, query.city);

        // ---- ANALYZING ----
        await setStatus(scanId, 'ANALYZING');
        const classification = await classifyCuisines(
            { name: base.name, city: query.city },
            compact(competitors),
        );

        const baseCuisineLower = classification.baseCuisine.toLowerCase();
        const topCompetitors = [...competitors].sort((a, b) => b.threatScore - a.threatScore).slice(0, 5);
        const sameCuisineRows = competitors
            .filter((c) => (classification.lookup(c.name) ?? '').toLowerCase() === baseCuisineLower && c.distanceKm <= 5)
            .slice(0, 8);

        const analysis = await analyzeCompetition({
            base: {
                name: base.name,
                city: query.city,
                cuisine: classification.baseCuisine,
                rating: base.rating,
                reviews: base.totalRatings,
            },
            topCompetitors: compact(topCompetitors),
            sameCuisineRows: compact(sameCuisineRows),
        });

        const seo = await seoPromise;

        // ---- SCORING + COMPLETED ----
        await setStatus(scanId, 'SCORING');
        const scan = await getIntelligenceScansCollection().findOne({
            _id: scanId as any,
        });

        const previous = (await getIntelligenceReportsCollection()
            .find({ restaurantId: scan?.restaurantId })
            .sort({ generatedAt: -1 })
            .limit(1)
            .toArray())[0] as unknown as IntelligenceReport | undefined;

        const reportId = randomUUID();
        const report = assembleReport({
            reportId,
            scanId,
            restaurantId: String(scan?.restaurantId ?? ''),
            city: query.city,
            base,
            competitors,
            classification,
            analysis,
            seo,
            previous: previous ?? null,
            generatedAt: new Date(),
        });

        await getIntelligenceReportsCollection().insertOne(report as unknown as Record<string, unknown>);
        await setStatus(scanId, 'COMPLETED', { reportId });
        log.info({ scanId, reportId, restaurantId: report.restaurantId }, 'Intelligence scan completed');

        // Auto-track the top-5 threats: fill EMPTY watchlist slots with the
        // report's topCompetitors so daily snapshots start accumulating for
        // them. Never removes or overwrites the merchant's own picks, and the
        // organic nearby-competitor list in the report is untouched.
        try {
            const restaurant = await findRestaurantById(report.restaurantId);
            const current = restaurant?.intelligence?.watchlist ?? [];
            if (current.length < WATCHLIST_MAX) {
                const have = new Set(current.map((w) => w.placeId));
                const additions = (report.topCompetitors ?? [])
                    .filter((c) => c.placeId && !have.has(c.placeId))
                    .slice(0, WATCHLIST_MAX - current.length)
                    .map((c) => ({ placeId: c.placeId, name: c.name, addedAt: new Date() }));
                if (additions.length > 0) {
                    await updateRestaurant(report.restaurantId, {
                        intelligence: {
                            ...(restaurant?.intelligence ?? {}),
                            watchlist: [...current, ...additions],
                        },
                    } as never);
                    log.info({ restaurantId: report.restaurantId, added: additions.length }, 'Watchlist auto-filled with top competitors');
                }
            }
        } catch (autoErr) {
            log.warn({ err: autoErr }, 'Watchlist autofill failed (non-fatal)');
        }
    } catch (err) {
        const stage = err instanceof StageError ? err.stage : undefined;
        const label = stage ? STAGE_LABELS[stage] : 'Scan';
        const message =
            err instanceof StageError
                ? err.message
                : `${label} failed unexpectedly — please try again.`;
        log.error({ scanId, err }, 'Intelligence scan failed');
        await setStatus(scanId, 'FAILED', { error: message }).catch(() => undefined);
    }
}
