/**
 * ScanFlow poll-flow tests (INTEGRATION.md §2 PR3) — the stepper walks the
 * pipeline and completes after 3 polls; a FAILED scan shows the error + retry.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from './utils/test-utils';
import type { IntelligenceScan } from '@restropulse/shared';
import ScanFlow from '../components/v2/intelligence/ScanFlow';
import { DEMO_INTELLIGENCE_REPORT } from '../lib/demo-fixtures-intelligence';

const scan = (status: IntelligenceScan['status'], reportId?: string): IntelligenceScan =>
    ({ _id: 's1', restaurantId: 'demo-r1', query: { name: 'x', city: 'y' }, status, reportId, requestedBy: 'u1', createdAt: new Date(), updatedAt: new Date() });

describe('ScanFlow poll flow', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    test('completes after 3 polls, walking the pipeline stages', async () => {
        // Stateful poll: FETCHING_PLACES → ANALYZING → COMPLETED. Once COMPLETED
        // the component clears the interval, so getScan settles at exactly 3 calls.
        let polls = 0;
        const getScan = vi.fn().mockImplementation(async () => {
            polls += 1;
            if (polls === 1) return scan('FETCHING_PLACES');
            if (polls === 2) return scan('ANALYZING');
            return scan('COMPLETED', 'r1');
        });
        const api = {
            startScan: vi.fn().mockResolvedValue({ scanId: 's1' }),
            getScan,
            getReport: vi.fn().mockResolvedValue(DEMO_INTELLIGENCE_REPORT),
        };
        const onReport = vi.fn();

        render(<ScanFlow variant="rescan" force defaults={{ name: 'Demo', city: 'BLR' }} api={api} onReport={onReport} />);

        // Auto-start (rescan) fires on mount; the stepper shows immediately.
        await vi.advanceTimersByTimeAsync(0);
        expect(api.startScan).toHaveBeenCalledWith({ name: 'Demo', city: 'BLR', force: true });
        expect(screen.getByText(/Scanning your restaurant/i)).toBeInTheDocument();

        // Drive the 3s poll loop until it completes.
        for (let i = 0; i < 5; i += 1) await vi.advanceTimersByTimeAsync(3000);

        expect(getScan).toHaveBeenCalledTimes(3);
        expect(api.getReport).toHaveBeenCalledWith('r1');
        expect(onReport).toHaveBeenCalledWith(DEMO_INTELLIGENCE_REPORT);
    });

    test('FAILED scan shows the stage-labeled error and a retry button', async () => {
        const api = {
            startScan: vi.fn().mockResolvedValue({ scanId: 's1' }),
            getScan: vi.fn().mockResolvedValue(scan('FAILED')),
            getReport: vi.fn(),
        };
        const onReport = vi.fn();
        render(<ScanFlow variant="rescan" defaults={{ name: 'Demo', city: 'BLR' }} api={api} onReport={onReport} />);

        await vi.advanceTimersByTimeAsync(0);
        for (let i = 0; i < 3; i += 1) await vi.advanceTimersByTimeAsync(3000);

        expect(screen.getByRole('heading', { name: /Scan stopped/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Retry scan/i })).toBeInTheDocument();
        expect(onReport).not.toHaveBeenCalled();
    });
});
