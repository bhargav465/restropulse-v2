import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from './utils/test-utils';
import Landing from '../components/Landing';
import { subscriptionAPI } from '../api';

vi.mock('../api', () => ({
    subscriptionAPI: {
        getPlans: vi.fn(),
    },
}));

// Deliberately out of display order to prove the component sorts them.
const apiPlans = [
    { slug: 'premium', name: 'Premium', pricing: { monthly: 1699900, annual: 16999000, currency: 'INR' } },
    { slug: 'starter', name: 'Starter', pricing: { monthly: 299900, annual: 2999000, currency: 'INR' } },
    { slug: 'growth', name: 'Growth', pricing: { monthly: 999900, annual: 9999000, currency: 'INR' } },
];

describe('Landing', () => {
    const onStartFree = vi.fn();
    const onSelectPlan = vi.fn();
    const onLogin = vi.fn();

    const renderLanding = () =>
        render(<Landing onStartFree={onStartFree} onSelectPlan={onSelectPlan} onLogin={onLogin} />);

    beforeEach(() => {
        vi.clearAllMocks();
        (subscriptionAPI.getPlans as any).mockResolvedValue(apiPlans);
    });

    it('renders the trimmed-to-real-product hero and pillars', () => {
        renderLanding();
        expect(screen.getByText(/market & grow/i)).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /content engine/i })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /restaurant intelligence/i })).toBeInTheDocument();
        // Products that don't exist yet are clearly flagged, not sold as real.
        expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
    });

    it('routes the primary "Start free" CTA to onStartFree (no plan)', () => {
        renderLanding();
        fireEvent.click(screen.getAllByRole('button', { name: /^start free/i })[0]);
        expect(onStartFree).toHaveBeenCalledTimes(1);
        expect(onSelectPlan).not.toHaveBeenCalled();
    });

    it('has no annual / yearly billing toggle', () => {
        renderLanding();
        expect(screen.queryByRole('button', { name: /yearly/i })).not.toBeInTheDocument();
        expect(screen.queryByText(/\/ year/i)).not.toBeInTheDocument();
        expect(screen.getAllByText(/billed monthly/i).length).toBeGreaterThan(0);
    });

    it('hydrates real plan prices from the API and orders Starter, Growth, Premium', async () => {
        renderLanding();
        await waitFor(() => expect(screen.getByText('₹9,999')).toBeInTheDocument());
        expect(screen.getByText('₹2,999')).toBeInTheDocument();
        expect(screen.getByText('₹16,999')).toBeInTheDocument();
        expect(screen.getByText(/most popular/i)).toBeInTheDocument();
    });

    it('passes the chosen plan slug from the per-plan trial CTA', async () => {
        renderLanding();
        await waitFor(() => expect(screen.getByText('₹2,999')).toBeInTheDocument());
        const trialButtons = screen.getAllByRole('button', { name: /start 14-day free trial/i });
        // Cards render in order starter, growth, premium.
        fireEvent.click(trialButtons[0]);
        expect(onSelectPlan).toHaveBeenCalledWith('starter');
        fireEvent.click(trialButtons[1]);
        expect(onSelectPlan).toHaveBeenCalledWith('growth');
    });

    it('falls back to correct static real prices when the plans API fails', async () => {
        (subscriptionAPI.getPlans as any).mockRejectedValue(new Error('network down'));
        renderLanding();
        // Static fallback paints immediately with the real seeded prices.
        expect(screen.getByText('₹2,999')).toBeInTheDocument();
        expect(screen.getByText('₹9,999')).toBeInTheDocument();
        expect(screen.getByText('₹16,999')).toBeInTheDocument();
    });

    it('routes the Log in link to onLogin', () => {
        renderLanding();
        fireEvent.click(screen.getAllByRole('button', { name: /^log in$/i })[0]);
        expect(onLogin).toHaveBeenCalledTimes(1);
    });
});
