import { describe, it, expect } from 'vitest';
import {
    SCAN_STATUS_TRANSITIONS,
    SCAN_STATUSES,
    canTransitionScanStatus,
    isScanStatus,
    isTerminalScanStatus,
} from '../../src/services/intelligence/scan-status.js';
import type { ScanStatus } from '@restropulse/shared';

describe('scan status machine', () => {
    it('covers exactly the ScanStatus union', () => {
        expect(SCAN_STATUSES.sort()).toEqual(
            (['QUEUED', 'FETCHING_PLACES', 'ANALYZING', 'SCORING', 'COMPLETED', 'FAILED'] as ScanStatus[]).sort(),
        );
    });

    it('allows the linear happy path', () => {
        expect(canTransitionScanStatus('QUEUED', 'FETCHING_PLACES')).toBe(true);
        expect(canTransitionScanStatus('FETCHING_PLACES', 'ANALYZING')).toBe(true);
        expect(canTransitionScanStatus('ANALYZING', 'SCORING')).toBe(true);
        expect(canTransitionScanStatus('SCORING', 'COMPLETED')).toBe(true);
    });

    it('allows any non-terminal stage to fail', () => {
        for (const s of ['QUEUED', 'FETCHING_PLACES', 'ANALYZING', 'SCORING'] as ScanStatus[]) {
            expect(canTransitionScanStatus(s, 'FAILED')).toBe(true);
        }
    });

    it('rejects stage skips and backward moves', () => {
        expect(canTransitionScanStatus('QUEUED', 'ANALYZING')).toBe(false);
        expect(canTransitionScanStatus('QUEUED', 'SCORING')).toBe(false);
        expect(canTransitionScanStatus('QUEUED', 'COMPLETED')).toBe(false);
        expect(canTransitionScanStatus('FETCHING_PLACES', 'SCORING')).toBe(false);
        expect(canTransitionScanStatus('ANALYZING', 'FETCHING_PLACES')).toBe(false);
        expect(canTransitionScanStatus('SCORING', 'ANALYZING')).toBe(false);
    });

    it('treats COMPLETED and FAILED as terminal', () => {
        expect(isTerminalScanStatus('COMPLETED')).toBe(true);
        expect(isTerminalScanStatus('FAILED')).toBe(true);
        expect(SCAN_STATUS_TRANSITIONS.COMPLETED).toEqual([]);
        expect(SCAN_STATUS_TRANSITIONS.FAILED).toEqual([]);
        for (const to of SCAN_STATUSES) {
            expect(canTransitionScanStatus('COMPLETED', to)).toBe(false);
            expect(canTransitionScanStatus('FAILED', to)).toBe(false);
        }
    });

    it('validates status strings', () => {
        expect(isScanStatus('ANALYZING')).toBe(true);
        expect(isScanStatus('DONE')).toBe(false);
        expect(isScanStatus(42)).toBe(false);
    });
});
