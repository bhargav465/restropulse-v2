import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from './utils/test-utils';
import OrdersFeed from '../components/ordering/OrdersFeed';
import { Order } from '@restropulse/shared';

// Mock the API module
vi.mock('../api', () => ({
    orderingAdminAPI: {
        getOrders: vi.fn(),
        updateOrderStatus: vi.fn(),
        setStoreOpen: vi.fn(),
    },
}));

import { orderingAdminAPI } from '../api';

const makeOrder = (overrides: Partial<Order> = {}): Order => ({
    id: 'o1',
    restaurantId: 'r1',
    customerId: 'c1',
    orderNumber: 'ORD-K3X9F2',
    orderType: 'delivery',
    items: [
        { menuItemId: 'm1', name: 'Paneer Tikka', qty: 2, unitPrice: 250, lineTotal: 500 },
    ],
    totals: { subtotal: 500, tax: 25, deliveryFee: 40, discount: 0, total: 565 },
    status: 'RECEIVED',
    statusHistory: [],
    customerName: 'Asha',
    createdAt: '2026-07-01T12:00:00.000Z',
    updatedAt: '2026-07-01T12:00:00.000Z',
    ...overrides,
});

describe('OrdersFeed Component', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(orderingAdminAPI.getOrders).mockResolvedValue([]);
    });

    it('should show loading state initially, then the empty state', async () => {
        render(<OrdersFeed initialStoreOpen={true} />);

        expect(screen.getByText('Loading orders…')).toBeInTheDocument();
        await waitFor(() => {
            expect(screen.getByText('No orders yet')).toBeInTheDocument();
        });
    });

    it('should show an error state with retry when the feed fails to load', async () => {
        vi.mocked(orderingAdminAPI.getOrders).mockRejectedValueOnce(new Error('Network down'));
        render(<OrdersFeed initialStoreOpen={true} />);

        await waitFor(() => {
            expect(screen.getByText('Network down')).toBeInTheDocument();
        });

        // Retry reloads the feed (second call resolves to [])
        fireEvent.click(screen.getByText('Try again'));
        await waitFor(() => {
            expect(screen.getByText('No orders yet')).toBeInTheDocument();
        });
    });

    it('should render orders with only the valid next-status transition buttons', async () => {
        vi.mocked(orderingAdminAPI.getOrders).mockResolvedValue([makeOrder()]);
        render(<OrdersFeed initialStoreOpen={true} />);

        await waitFor(() => {
            expect(screen.getByText('ORD-K3X9F2')).toBeInTheDocument();
        });

        // RECEIVED → PREPARING or CANCELLED only
        expect(screen.getByText('Mark Preparing')).toBeInTheDocument();
        expect(screen.getByText('Cancel order')).toBeInTheDocument();
        expect(screen.queryByText('Mark Ready')).not.toBeInTheDocument();
        expect(screen.queryByText('Mark Completed')).not.toBeInTheDocument();
    });

    it('should not offer READY → COMPLETED for delivery orders (must go out for delivery)', async () => {
        vi.mocked(orderingAdminAPI.getOrders).mockResolvedValue([makeOrder({ status: 'READY', orderType: 'delivery' })]);
        render(<OrdersFeed initialStoreOpen={true} />);

        await waitFor(() => {
            expect(screen.getByText('Mark Out for Delivery')).toBeInTheDocument();
        });
        expect(screen.queryByText('Mark Completed')).not.toBeInTheDocument();
    });

    it('should offer READY → COMPLETED for pickup orders and call the API on click', async () => {
        const order = makeOrder({ status: 'READY', orderType: 'pickup' });
        vi.mocked(orderingAdminAPI.getOrders).mockResolvedValue([order]);
        vi.mocked(orderingAdminAPI.updateOrderStatus).mockResolvedValue({ ...order, status: 'COMPLETED' });
        render(<OrdersFeed initialStoreOpen={true} />);

        await waitFor(() => {
            expect(screen.getByText('Mark Completed')).toBeInTheDocument();
        });
        expect(screen.queryByText('Mark Out for Delivery')).not.toBeInTheDocument();

        fireEvent.click(screen.getByText('Mark Completed'));
        await waitFor(() => {
            expect(orderingAdminAPI.updateOrderStatus).toHaveBeenCalledWith('o1', 'COMPLETED');
        });
        // Badge shows the new status ("Completed" also appears as a filter <option>)
        expect(screen.getAllByText('Completed').length).toBeGreaterThan(1);
    });

    it('should toggle the store open state', async () => {
        vi.mocked(orderingAdminAPI.setStoreOpen).mockResolvedValue(false);
        render(<OrdersFeed initialStoreOpen={true} />);

        expect(screen.getByText('Store Open')).toBeInTheDocument();
        fireEvent.click(screen.getByText('Store Open'));

        await waitFor(() => {
            expect(orderingAdminAPI.setStoreOpen).toHaveBeenCalledWith(false);
            expect(screen.getByText('Store Closed')).toBeInTheDocument();
        });
    });

    it('should reload the feed with a status filter', async () => {
        render(<OrdersFeed initialStoreOpen={true} />);
        await waitFor(() => {
            expect(orderingAdminAPI.getOrders).toHaveBeenCalledWith(undefined);
        });

        fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'PREPARING' } });
        await waitFor(() => {
            expect(orderingAdminAPI.getOrders).toHaveBeenCalledWith({ status: 'PREPARING' });
        });
    });
});
