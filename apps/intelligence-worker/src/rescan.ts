/**
 * Re-scan seam.
 *
 * The scan pipeline (FETCHING_PLACES → ANALYZING → SCORING → COMPLETED) lives
 * in `apps/api/src/services/intelligence/` (PR2). `apps/api` is an *application*
 * workspace, not a library package -- its package.json has no `exports` map and
 * `main` is `dist/server.js`, which boots Express. So `runScanPipeline` is NOT
 * importable cross-app the way `@restropulse/publishing` is importable by the
 * publisher worker (that logic already lives in a shared package).
 *
 * Per INTEGRATION.md §2 / the PR4 brief, we therefore inject the re-scan as a
 * seam and ship a documented default that uses the cross-process seam already
 * in the codebase: enqueue an `intelligence_scans` job exactly the way the
 * admin route does (`requestedBy: 'system:intelligence-worker'`). Cache
 * (competitor_cache, 7-day TTL) makes the re-scan cheap.
 *
 * `RescanFn` returns the freshly-produced report when the scan runs in-process
 * (the eventual state, once the pipeline is promoted to a shared
 * `@restropulse/intelligence` package -- see docs/NEXT.md), or `null` when the
 * scan is only enqueued. The weekly loop reads the reports collection as the
 * source of truth either way, so alert/delta/prune logic is identical.
 */

import { randomUUID } from 'node:crypto';
import { getIntelligenceScansCollection } from '@restropulse/db';
import type { IntelligenceReport, IntelligenceScan } from '@restropulse/shared';

/** Restaurant identity + last known scan query, passed to the seam. */
export interface RescanTarget {
    restaurantId: string;
    name: string;
    city: string;
}

/**
 * Produce (or trigger) a fresh report for one restaurant. Returns the new
 * report when it is generated synchronously, otherwise `null` (enqueued).
 */
export type RescanFn = (target: RescanTarget) => Promise<IntelligenceReport | null>;

/** requestedBy value stamped on worker-enqueued scans. */
export const WORKER_REQUESTED_BY = 'system:intelligence-worker';

/**
 * Default seam: enqueue a QUEUED scan job (the documented cross-process seam,
 * parallel to `POST /api/admin/intelligence/scan`). Returns `null` -- the API
 * pipeline produces the report out of band; the weekly loop picks it up on the
 * next cycle from the reports collection.
 */
export function createEnqueueRescan(): RescanFn {
    return async ({ restaurantId, name, city }: RescanTarget): Promise<null> => {
        const now = new Date();
        const scan: IntelligenceScan = {
            _id: randomUUID(),
            restaurantId,
            query: { name, city },
            status: 'QUEUED',
            requestedBy: WORKER_REQUESTED_BY,
            createdAt: now,
            updatedAt: now,
        };
        await getIntelligenceScansCollection().insertOne(scan as unknown as Record<string, unknown>);
        return null;
    };
}
