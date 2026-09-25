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
    query: { name: string; city: string; placeId?: string; selfLocation?: { lat: number; lng: number } },
): Promise<void> {
    try {
        // ---- FETCHING_PLACES ----
        await setStatus(scanId, 'FETCHING_PLACES');
        // A confirmed placeId skips text search; otherwise we bias the search to the
        // restaurant's own coordinates when we have them (more reliable than name+city).
        const base = await getBaseRestaurantDetails(query.name, query.city, query.placeId, query.selfLocation);
        if (!base) {
            throw new StageError(
                `Could not find "${query.name}" on Google near your saved location. Check your restaurant name and address in your profile, then try again.`,
                502,
                'FETCHING_PLACES',
            );
        }
        // First scan without a confirmed place: remember what Google resolved so
        // the daily worker and later scans stay pinned to the same listing.
        if (!query.placeId && base.placeId) {
            const scanDoc = await getIntelligenceScansCollection().findOne({ _id: scanId as any });
            const rid = scanDoc?.restaurantId ? String(scanDoc.restaurantId) : '';
            if (rid) {
                const current = await findRestaurantById(rid).catch(() => null);
                if (current && !current.googlePlaceId) {
                    await updateRestaurant(rid, { googlePlaceId: base.placeId }).catch(() => undefined);
                }
            }
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
