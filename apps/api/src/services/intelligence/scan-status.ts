/**
 * Intelligence scan status machine (server-side owner).
 *
 * Mirrors `ScanStatus` from @restropulse/shared verbatim. The web mirror lives at
 * `apps/web/components/intelligence/sections/scan-status.ts` (added in PR3) — per the
 * module CLAUDE.md §10 rule these two files change together or not at all.
 *
 * Linear happy path:
 *   QUEUED → FETCHING_PLACES → ANALYZING → SCORING → COMPLETED
 * Any non-terminal stage may transition to FAILED. COMPLETED and FAILED are
 * terminal. Pure functions — unit tested in tests/unit/intelligence-scan-status.test.ts.
 */

import type { ScanStatus } from '@restropulse/shared';

/** Allowed forward transitions per status. */
export const SCAN_STATUS_TRANSITIONS: Record<ScanStatus, ScanStatus[]> = {
    QUEUED: ['FETCHING_PLACES', 'FAILED'],
    FETCHING_PLACES: ['ANALYZING', 'FAILED'],
    ANALYZING: ['SCORING', 'FAILED'],
    SCORING: ['COMPLETED', 'FAILED'],
    COMPLETED: [],
    FAILED: [],
};

/** The stages the pipeline advances through, in order (excludes terminals). */
export const SCAN_STAGE_ORDER: ScanStatus[] = ['QUEUED', 'FETCHING_PLACES', 'ANALYZING', 'SCORING'];

export const SCAN_STATUSES: ScanStatus[] = Object.keys(SCAN_STATUS_TRANSITIONS) as ScanStatus[];

export function isScanStatus(value: unknown): value is ScanStatus {
    return typeof value === 'string' && (SCAN_STATUSES as string[]).includes(value);
}

/** True when `status` is terminal (no further transitions). */
export function isTerminalScanStatus(status: ScanStatus): boolean {
    return SCAN_STATUS_TRANSITIONS[status].length === 0;
}

/** Validates a scan status transition against the machine. */
export function canTransitionScanStatus(from: ScanStatus, to: ScanStatus): boolean {
    return SCAN_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}
