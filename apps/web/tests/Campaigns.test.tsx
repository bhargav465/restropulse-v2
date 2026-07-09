import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from './utils/test-utils';
import type { CustomerCohort } from '@restropulse/shared';
import Campaigns from '../components/ordering/Campaigns';

// Mock the API module
vi.mock('../api', () => ({
    orderingAdminAPI: {
        getCohorts: vi.fn(),
        sendCampaign: vi.fn(),
    },
}));

import { orderingAdminAPI } from '../api';

const mockCohorts: CustomerCohort[] = [
    { id: 'drop_off_cart', name: 'Drop-off carts', emoji: '🛒', count: 34, description: 'Carted but never ordered.' },
    { id: 'non_transacted', name: 'Non-transacted signups', emoji: '👋', count: 58, description: 'Signed up, no orders yet.' },
    { id: 'lapsed_30d', name: 'Lapsed 30-day', emoji: '💤', count: 21, description: 'No order in 30 days.' },
];

describe('Campaigns Component', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(orderingAdminAPI.getCohorts).mockResolvedValue(mockCohorts);
        vi.mocked(orderingAdminAPI.sendCampaign).mockResolvedValue({
            campaignId: 'camp-1',
            status: 'QUEUED',
            audienceCount: 34,
        });
    });

    it('renders cohort cards with name, emoji, count, description and the compliance note', async () => {
        render(<Campaigns />);

        await waitFor(() => {
            expect(screen.getByText('Drop-off carts')).toBeInTheDocument();
        });
        expect(screen.getByText('Non-transacted signups')).toBeInTheDocument();
        expect(screen.getByText('Lapsed 30-day')).toBeInTheDocument();
        expect(screen.getByText('34')).toBeInTheDocument();
        expect(screen.getByText('58')).toBeInTheDocument();
        expect(screen.getByText('21')).toBeInTheDocument();
        expect(screen.getByText('Carted but never ordered.')).toBeInTheDocument();
        expect(screen.getByText(/Messages go only to opted-in customers/)).toBeInTheDocument();
        // One nudge + one discount action per cohort
        expect(screen.getAllByRole('button', { name: /Send WhatsApp nudge/ })).toHaveLength(3);
        expect(screen.getAllByRole('button', { name: /Send discount offer/ })).toHaveLength(3);
    });

    it('queues a WhatsApp nudge and shows the success toast + last-sent timestamp', async () => {
        render(<Campaigns />);
        await waitFor(() => expect(screen.getByText('Drop-off carts')).toBeInTheDocument());

        fireEvent.click(screen.getAllByRole('button', { name: /Send WhatsApp nudge/ })[0]);

        await waitFor(() => {
            expect(orderingAdminAPI.sendCampaign).toHaveBeenCalledWith({
                cohortId: 'drop_off_cart',
                kind: 'whatsapp_nudge',
            });
        });
        expect(await screen.findByText('Queued for 34 customers ✅')).toBeInTheDocument();
        expect(screen.getByText(/Last sent/)).toBeInTheDocument();
    });

    it('opens the inline discount form and sends a validated discount offer', async () => {
        render(<Campaigns />);
        await waitFor(() => expect(screen.getByText('Drop-off carts')).toBeInTheDocument());

        // Open the inline form on the first cohort
        fireEvent.click(screen.getAllByRole('button', { name: /Send discount offer/ })[0]);

        const pct = screen.getByLabelText('% off');
        const code = screen.getByLabelText('Code');
        const expiry = screen.getByLabelText('Expiry (days)');
        fireEvent.change(pct, { target: { value: '20' } });
        fireEvent.change(code, { target: { value: 'comeback20' } });
        fireEvent.change(expiry, { target: { value: '5' } });

        fireEvent.click(screen.getByRole('button', { name: /Queue discount offer/ }));

        await waitFor(() => {
            expect(orderingAdminAPI.sendCampaign).toHaveBeenCalledWith({
                cohortId: 'drop_off_cart',
                kind: 'discount_offer',
                discount: { percentOff: 20, code: 'COMEBACK20', expiryDays: 5 },
            });
        });
        expect(await screen.findByText('Queued for 34 customers ✅')).toBeInTheDocument();
    });

    it('disables the discount submit while the form is invalid', async () => {
        render(<Campaigns />);
        await waitFor(() => expect(screen.getByText('Drop-off carts')).toBeInTheDocument());

        fireEvent.click(screen.getAllByRole('button', { name: /Send discount offer/ })[0]);
        fireEvent.change(screen.getByLabelText('% off'), { target: { value: '0' } });

        expect(screen.getByRole('button', { name: /Queue discount offer/ })).toBeDisabled();
        expect(orderingAdminAPI.sendCampaign).not.toHaveBeenCalled();
    });

    it('shows an error state with retry when cohorts fail to load', async () => {
        vi.mocked(orderingAdminAPI.getCohorts).mockRejectedValueOnce(new Error('boom'));
        render(<Campaigns />);

        expect(await screen.findByText(/boom/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /try again/i }));
        await waitFor(() => expect(screen.getByText('Drop-off carts')).toBeInTheDocument());
    });
});
