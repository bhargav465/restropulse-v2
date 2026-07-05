import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from './utils/test-utils';
import FunnelAnalytics from '../components/ordering/FunnelAnalytics';

// Mock the API module
vi.mock('../api', () => ({
    orderingAdminAPI: {
        getAnalyticsSummary: vi.fn(),
    },
}));

import { orderingAdminAPI } from '../api';

const summary = (events: Array<{ name: string; count: number; uniqueSessions: number }>) => ({
    from: '2026-06-27T00:00:00.000Z',
    to: '2026-07-04T00:00:00.000Z',
    events,
});

describe('FunnelAnalytics Component', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should show a loading state, then render all funnel steps with counts', async () => {
        vi.mocked(orderingAdminAPI.getAnalyticsSummary).mockResolvedValue(summary([
            { name: 'menu_view', count: 120, uniqueSessions: 80 },
            { name: 'item_view', count: 90, uniqueSessions: 60 },
            { name: 'add_to_cart', count: 40, uniqueSessions: 30 },
            { name: 'order_placed', count: 10, uniqueSessions: 10 },
        ]));
        render(<FunnelAnalytics />);

        expect(screen.getByText('Loading funnel…')).toBeInTheDocument();

        await waitFor(() => {
            expect(screen.getByText('Menu viewed')).toBeInTheDocument();
        });
        expect(screen.getByText('Item viewed')).toBeInTheDocument();
        expect(screen.getByText('Added to cart')).toBeInTheDocument();
        expect(screen.getByText('Checkout started')).toBeInTheDocument();
        expect(screen.getByText('Login prompted')).toBeInTheDocument();
        expect(screen.getByText('Order placed')).toBeInTheDocument();
        expect(screen.getByText('120')).toBeInTheDocument();
        expect(screen.getByText('10')).toBeInTheDocument();
    });

    it('should show the empty state when there are no events in range', async () => {
        vi.mocked(orderingAdminAPI.getAnalyticsSummary).mockResolvedValue(summary([]));
        render(<FunnelAnalytics />);

        await waitFor(() => {
            expect(screen.getByText('No events in this range')).toBeInTheDocument();
        });
    });

    it('should show an error state when the summary fails to load', async () => {
        vi.mocked(orderingAdminAPI.getAnalyticsSummary).mockRejectedValue(new Error('Boom'));
        render(<FunnelAnalytics />);

        await waitFor(() => {
            expect(screen.getByText('Boom')).toBeInTheDocument();
        });
        expect(screen.getByText('Try again')).toBeInTheDocument();
    });

    it('should refetch when the date range changes', async () => {
        vi.mocked(orderingAdminAPI.getAnalyticsSummary).mockResolvedValue(summary([]));
        render(<FunnelAnalytics />);

        await waitFor(() => {
            expect(orderingAdminAPI.getAnalyticsSummary).toHaveBeenCalledTimes(1);
        });

        fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-06-01' } });
        await waitFor(() => {
            expect(orderingAdminAPI.getAnalyticsSummary).toHaveBeenCalledTimes(2);
        });
        const [from] = vi.mocked(orderingAdminAPI.getAnalyticsSummary).mock.calls[1];
        // Timezone-independent: compare against the same local-midnight conversion
        expect(from).toBe(new Date('2026-06-01T00:00:00').toISOString());
    });
});
