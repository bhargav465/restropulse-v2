/**
 * Demo-parity test (repo rule 2 / INTEGRATION.md §2 PR3).
 *
 * api.ts declares `export const intelligenceAPI: typeof realIntelligenceAPI`,
 * which is the compiler-enforced guarantee that the demo twin matches the real
 * client's shape. This runtime test backstops it: outside demo mode
 * (VITE_DEMO_MODE unset in the test env) `../api` resolves to the REAL client,
 * so comparing its method surface to the demo twin catches any drift.
 */
import { describe, test, expect } from 'vitest';
import { intelligenceAPI as realClient } from '../api';
import { intelligenceAPI as demoClient } from '../demo-api';

const EXPECTED_METHODS = [
    'startScan', 'getScan', 'getReports', 'getReport', 'getLatestReport', 'getSelfMetrics',
    // v2 two-bucket dashboard (Brief 09)
    'getWatchlist', 'putWatchlist', 'getSnapshots', 'getFeedbackChanges', 'getCompare',
    'getNewOpenings', 'postZomatoManual', 'captureNow',
];

describe('intelligenceAPI demo parity', () => {
    test('real client exposes exactly the expected methods', () => {
        expect(Object.keys(realClient).sort()).toEqual([...EXPECTED_METHODS].sort());
    });

    test('demo twin exposes the same method surface as the real client', () => {
        expect(Object.keys(demoClient).sort()).toEqual(Object.keys(realClient).sort());
        for (const key of Object.keys(realClient)) {
            expect(typeof (demoClient as Record<string, unknown>)[key]).toBe('function');
        }
    });
});
