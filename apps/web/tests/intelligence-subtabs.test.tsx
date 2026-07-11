/**
 * Sub-tab render smoke tests (INTEGRATION.md §2 PR3) — each of the five
 * Intelligence sub-tabs renders from the [SAMPLE] fixture with zero backend.
 */
import { describe, test, expect, vi } from 'vitest';
import { render, screen } from './utils/test-utils';
import { DEMO_INTELLIGENCE_REPORT, DEMO_INTELLIGENCE_SELF_METRICS } from '../lib/demo-fixtures-intelligence';
import Overview from '../components/v2/intelligence/Overview';
import Competitors from '../components/v2/intelligence/Competitors';
import Reviews from '../components/v2/intelligence/Reviews';
import SearchSEO from '../components/v2/intelligence/SearchSEO';
import YourMetrics from '../components/v2/intelligence/YourMetrics';

const noop = vi.fn();

describe('Intelligence sub-tabs render from the [SAMPLE] fixture', () => {
    test('Overview — narrative, action plan, deep-link CTA', () => {
        render(<Overview report={DEMO_INTELLIGENCE_REPORT} onNavigate={noop} />);
        expect(screen.getByText('Your action plan')).toBeInTheDocument();
        expect(screen.getByText(/Publish a custom-domain ordering website/)).toBeInTheDocument();
        // At least one "Act on this" style CTA
        expect(screen.getAllByText(/→/).length).toBeGreaterThan(0);
    });

    test('Competitors — radar, table and a competitor row', () => {
        render(<Competitors report={DEMO_INTELLIGENCE_REPORT} />);
        expect(screen.getByText('Threat radar')).toBeInTheDocument();
        expect(screen.getAllByText(/Meghana Foods/).length).toBeGreaterThan(0);
        expect(screen.getByText(/All competitors \(12\)/)).toBeInTheDocument();
    });

    test('Reviews — rating vs area, recent reviews, sentiment', () => {
        render(<Reviews report={DEMO_INTELLIGENCE_REPORT} onNavigate={noop} />);
        expect(screen.getByText('Your rating')).toBeInTheDocument();
        expect(screen.getByText(/Best butter chicken in Indiranagar/)).toBeInTheDocument();
        expect(screen.getByText('Competitor sentiment')).toBeInTheDocument();
    });

    test('Search & SEO — checklists, simulated rankings, keyword chips', () => {
        render(<SearchSEO report={DEMO_INTELLIGENCE_REPORT} onNavigate={noop} />);
        expect(screen.getByText('Google profile')).toBeInTheDocument();
        expect(screen.getByText('Local search rankings')).toBeInTheDocument();
        expect(screen.getByText(/butter chicken indiranagar/)).toBeInTheDocument();
    });

    test('Your Metrics — repeat rate, revenue split, peak hours', () => {
        render(<YourMetrics metrics={DEMO_INTELLIGENCE_SELF_METRICS} onNavigate={noop} />);
        expect(screen.getByText('Repeat rate')).toBeInTheDocument();
        expect(screen.getByText('New vs returning revenue')).toBeInTheDocument();
        expect(screen.getByText('Peak hours')).toBeInTheDocument();
    });
});

describe('Search & SEO keyword draft deep-links into Content Engine', () => {
    test('clicking a keyword "→ Draft post" navigates to Content with the keyword', () => {
        const onNavigate = vi.fn();
        render(<SearchSEO report={DEMO_INTELLIGENCE_REPORT} onNavigate={onNavigate} />);
        const draftButtons = screen.getAllByText(/Draft post/);
        draftButtons[0].click();
        expect(onNavigate).toHaveBeenCalled();
        const target = onNavigate.mock.calls[0][0];
        expect(target.bucket).toBe('CONTENT');
        expect(target.params.keyword).toBeTruthy();
    });
});
