/**
 * Intelligence scan-status mirror guard (module CLAUDE.md §10).
 *
 * The web mirror (components/v2/intelligence/scan-status.ts) and the api owner
 * (apps/api/src/services/intelligence/scan-status.ts) must stay identical on
 * SCAN_STATUS_TRANSITIONS / SCAN_STAGE_ORDER. Both are asserted against the SAME
 * canonical literal here (cross-app imports break tsc rootDir) — change the
 * machine in one place and this test fails until both are updated.
 */
import { describe, test, expect } from 'vitest';
import type { ScanStatus } from '@restropulse/shared';
import {
    SCAN_STATUS_TRANSITIONS,
    SCAN_STAGE_ORDER,
    canTransitionScanStatus,
    isTerminalScanStatus,
    stageState,
} from '../components/v2/intelligence/scan-status';

const CANONICAL_SCAN_STATUS_TRANSITIONS: Record<ScanStatus, ScanStatus[]> = {
    QUEUED: ['FETCHING_PLACES', 'FAILED'],
    FETCHING_PLACES: ['ANALYZING', 'FAILED'],
    ANALYZING: ['SCORING', 'FAILED'],
    SCORING: ['COMPLETED', 'FAILED'],
    COMPLETED: [],
    FAILED: [],
};

describe('intelligence scan-status mirror', () => {
    test('web SCAN_STATUS_TRANSITIONS equals the canonical table', () => {
        expect(SCAN_STATUS_TRANSITIONS).toEqual(CANONICAL_SCAN_STATUS_TRANSITIONS);
    });

    test('stage order is the four non-terminal stages, in order', () => {
        expect(SCAN_STAGE_ORDER).toEqual(['QUEUED', 'FETCHING_PLACES', 'ANALYZING', 'SCORING']);
    });

    test('COMPLETED and FAILED are terminal', () => {
        expect(isTerminalScanStatus('COMPLETED')).toBe(true);
        expect(isTerminalScanStatus('FAILED')).toBe(true);
        expect(isTerminalScanStatus('QUEUED')).toBe(false);
    });

    test('only forward transitions are allowed', () => {
        expect(canTransitionScanStatus('QUEUED', 'FETCHING_PLACES')).toBe(true);
        expect(canTransitionScanStatus('SCORING', 'COMPLETED')).toBe(true);
        expect(canTransitionScanStatus('QUEUED', 'SCORING')).toBe(false);
        expect(canTransitionScanStatus('COMPLETED', 'FAILED')).toBe(false);
    });

    test('stageState classifies done/active/pending, COMPLETED marks all done', () => {
        expect(stageState('QUEUED', 'ANALYZING')).toBe('done');
        expect(stageState('ANALYZING', 'ANALYZING')).toBe('active');
        expect(stageState('SCORING', 'ANALYZING')).toBe('pending');
        expect(stageState('SCORING', 'COMPLETED')).toBe('done');
    });
});
