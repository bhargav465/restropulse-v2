/**
 * IntelligenceV2 two-bucket integration (Brief 09) — the RestroScore header band
 * + BucketSwitch + bucket-scoped content render from the [SAMPLE] fixtures with a
 * mocked client (zero backend), proving the gh-pages demo path. The v1 Overview /
 * action plan content survives, re-homed under My Restaurant.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from './utils/test-utils';
import { DEMO_INTELLIGENCE_REPORT, DEMO_INTELLIGENCE_SELF_METRICS } from '../lib/demo-fixtures-intelligence';
import { DEMO_RESTAURANT } from '../lib/demo-fixtures';

vi.mock('../api', () => ({
    intelligenceAPI: {
        getLatestReport: vi.fn().mockResolvedValue(DEMO_INTELLIGENCE_REPORT),
        getSelfMetrics: vi.fn().mockResolvedValue(DEMO_INTELLIGENCE_SELF_METRICS),
        getReport: vi.fn().mockResolvedValue(DEMO_INTELLIGENCE_REPORT),
        startScan: vi.fn().mockResolvedValue({ scanId: 's1' }),
        getScan: vi.fn().mockResolvedValue({ status: 'COMPLETED', reportId: 'r1' }),
        getReports: vi.fn().mockResolvedValue([]),
        // v2 two-bucket methods
        getWatchlist: vi.fn().mockResolvedValue({ entries: [], max: 5 }),
        putWatchlist: vi.fn().mockResolvedValue({ entries: [], max: 5 }),
        getSnapshots: vi.fn().mockResolvedValue({ target: 'self', source: 'both', granularity: 'day', points: [] }),
        getFeedbackChanges: vi.fn().mockResolvedValue({ days: [] }),
        getCompare: vi.fn().mockResolvedValue([]),
        getNewOpenings: vi.fn().mockResolvedValue([]),
        postZomatoManual: vi.fn().mockResolvedValue({ snapshotWritten: true }),
        captureNow: vi.fn().mockResolvedValue({ captured: 5 }),
    },
}));

import IntelligenceV2 from '../components/v2/IntelligenceV2';

beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage?.clear();
});

describe('IntelligenceV2 two-bucket dashboard', () => {
    test('renders the RestroScore header band + My Restaurant Overview (re-homed v1)', async () => {
        render(<IntelligenceV2 restaurantData={DEMO_RESTAURANT} />);
        await waitFor(() => expect(screen.getByText('68')).toBeInTheDocument());
        expect(screen.getByText(/Rank #4/)).toBeInTheDocument();
        // v1 Overview content survives under My Restaurant.
        expect(screen.getByText('Your action plan')).toBeInTheDocument();
        expect(screen.getByText(/How we know/i)).toBeInTheDocument();
        // Both bucket segments present.
        expect(screen.getByRole('tab', { name: 'My Restaurant' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tab', { name: 'Competition' })).toBeInTheDocument();
    });

    test('switching to the Competition bucket lands on Top Threats, then Watchlist is reachable', async () => {
        render(<IntelligenceV2 restaurantData={DEMO_RESTAURANT} />);
        await waitFor(() => expect(screen.getByText('68')).toBeInTheDocument());
        fireEvent.click(screen.getByRole('tab', { name: 'Competition' }));
        // Top Threats is the first sub-tab (Brief 10).
        await waitFor(() => expect(screen.getByRole('tab', { name: 'Competitors' })).toHaveAttribute('aria-selected', 'true'));
        fireEvent.click(screen.getByRole('tab', { name: 'Tracked Rivals' }));
        await waitFor(() => expect(screen.getByText('Your watchlist')).toBeInTheDocument());
    });

    test('My Restaurant → Daily Trends renders from the snapshot client', async () => {
        render(<IntelligenceV2 restaurantData={DEMO_RESTAURANT} />);
        await waitFor(() => expect(screen.getByText('Your action plan')).toBeInTheDocument());
        fireEvent.click(screen.getByRole('tab', { name: 'Ratings & Reviews' }));
        // Empty snapshot fixture → still mounts the trends view (no crash).
        await waitFor(() => expect(screen.getByRole('tab', { name: 'Ratings & Reviews' })).toHaveAttribute('aria-selected', 'true'));
    });

    test('action-plan deep link calls onNavigate into another bucket', async () => {
        const onNavigate = vi.fn();
        render(<IntelligenceV2 restaurantData={DEMO_RESTAURANT} onNavigate={onNavigate} />);
        await waitFor(() => expect(screen.getByText('Your action plan')).toBeInTheDocument());
        fireEvent.click(screen.getAllByText(/Open Get started →/i)[0]);
        expect(onNavigate).toHaveBeenCalled();
        expect(onNavigate.mock.calls[0][0].bucket).toBe('GET_STARTED');
    });
});
