/**
 * IntelligenceV2 bucket integration — the RestroScore header band + sub-tab
 * router render from the [SAMPLE] fixture with a mocked client (zero backend),
 * proving the gh-pages demo path (CLAUDE.md §6, INTEGRATION.md §4).
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
    },
}));

import IntelligenceV2 from '../components/v2/IntelligenceV2';

describe('IntelligenceV2', () => {
    beforeEach(() => vi.clearAllMocks());

    test('renders the RestroScore header band and Overview from the fixture', async () => {
        render(<IntelligenceV2 restaurantData={DEMO_RESTAURANT} />);
        await waitFor(() => expect(screen.getByText('68')).toBeInTheDocument());
        // Rank + grade from the fixture
        expect(screen.getByText(/Rank #4/)).toBeInTheDocument();
        expect(screen.getByText('Your action plan')).toBeInTheDocument();
        // Provenance legend present
        expect(screen.getByText(/How we know/i)).toBeInTheDocument();
    });

    test('switches to the Competitors sub-tab', async () => {
        render(<IntelligenceV2 restaurantData={DEMO_RESTAURANT} />);
        await waitFor(() => expect(screen.getByText('68')).toBeInTheDocument());
        fireEvent.click(screen.getByRole('tab', { name: /Competitors/i }));
        expect(screen.getByText('Threat radar')).toBeInTheDocument();
    });

    test('action-plan deep link calls onNavigate into another bucket', async () => {
        const onNavigate = vi.fn();
        render(<IntelligenceV2 restaurantData={DEMO_RESTAURANT} onNavigate={onNavigate} />);
        await waitFor(() => expect(screen.getByText('Your action plan')).toBeInTheDocument());
        // The review-replies / profile-description actions deep-link to Get-started.
        fireEvent.click(screen.getAllByText(/Open Get started →/i)[0]);
        expect(onNavigate).toHaveBeenCalled();
        expect(onNavigate.mock.calls[0][0].bucket).toBe('GET_STARTED');
    });
});
