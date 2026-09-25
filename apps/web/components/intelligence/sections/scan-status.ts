/**
 * Intelligence scan status machine — WEB MIRROR.
 *
 * This file is the byte-for-byte mirror of the server owner at
 * `apps/api/src/services/intelligence/scan-status.ts` on
 * `SCAN_STATUS_TRANSITIONS` / `SCAN_STAGE_ORDER`. Per the module CLAUDE.md §10
 * rule these two files change together or not at all — the guard test
 * `tests/intelligence-scan-status-mirror.test.ts` asserts this table equals the
 * canonical literal (same enforcement pattern as the order-status mirror).
 *
 * Linear happy path:
 *   QUEUED → FETCHING_PLACES → ANALYZING → SCORING → COMPLETED
 * Any non-terminal stage may transition to FAILED. COMPLETED and FAILED are
 * terminal.
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

/**
 * Friendly, owner-facing labels for the stepper (DESIGN §2). Terminal states
 * are labeled too so the stepper header can announce completion / failure.
 */
export const SCAN_STAGE_LABELS: Record<ScanStatus, string> = {
    QUEUED: 'Queued',
    FETCHING_PLACES: 'Finding you on Google',
    ANALYZING: 'AI competitor analysis',
    SCORING: 'Scoring your restaurant',
    COMPLETED: 'Done',
    FAILED: 'Something went wrong',
};

/** One-line description shown under the active stage in the stepper. */
export const SCAN_STAGE_HINTS: Record<ScanStatus, string> = {
    QUEUED: 'Warming up the scan…',
    FETCHING_PLACES: 'Pulling your Google profile and nearby restaurants.',
    ANALYZING: 'Reading competitors and writing your action plan.',
    SCORING: 'Grading your six RestroScore pillars.',
    COMPLETED: 'Your report is ready.',
    FAILED: 'The scan stopped before it finished.',
};

/**
 * Progress helper for the stepper: for a given current status, classify each
 * ordered stage as done / active / pending. COMPLETED marks every stage done.
 */
export function stageState(stage: ScanStatus, current: ScanStatus): 'done' | 'active' | 'pending' {
    if (current === 'COMPLETED') return 'done';
    const stageIdx = SCAN_STAGE_ORDER.indexOf(stage);
    const currentIdx = SCAN_STAGE_ORDER.indexOf(current);
    if (currentIdx < 0) return 'pending';
    if (stageIdx < currentIdx) return 'done';
    if (stageIdx === currentIdx) return 'active';
    return 'pending';
}
