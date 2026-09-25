/**
 * Stage-labeled error for the intelligence scan pipeline.
 *
 * Ported from the predecessor (RESTROGRADECLAUSDETEST) `StageError` pattern:
 *  - 503 → missing/misconfigured server config (GOOGLE_MAPS_API_KEY / ANTHROPIC_API_KEY,
 *          Places API not enabled).
 *  - 502 → an upstream dependency (Google Places, Anthropic, the merchant's website)
 *          failed or returned an unusable response.
 *
 * The `message` is always user-safe (no secrets, no stack detail) and gets written
 * verbatim to `intelligence_scans.error` when a stage fails. `stage` labels which
 * pipeline stage raised it, so the UI can show "AI analysis failed" etc.
 */

import type { ScanStatus } from '@restropulse/shared';

export type StageErrorStatus = 502 | 503;

export class StageError extends Error {
    readonly status: StageErrorStatus;
    readonly stage?: ScanStatus;

    constructor(message: string, status: StageErrorStatus = 502, stage?: ScanStatus) {
        super(message);
        this.name = 'StageError';
        this.status = status;
        this.stage = stage;
    }
}

/** Human-readable stage label used in the user-safe error message. */
export const STAGE_LABELS: Record<ScanStatus, string> = {
    QUEUED: 'Queued',
    FETCHING_PLACES: 'Finding you on Google',
    ANALYZING: 'AI analysis',
    SCORING: 'Scoring',
    COMPLETED: 'Completed',
    FAILED: 'Failed',
};
