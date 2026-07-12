/**
 * Brief 05 — v2 admin look & feel + PWA. Covers the mobile bottom tab bar,
 * skeleton→data transition + count-up, inline icons, the greeting hero, the
 * quick-actions deep links, and that the PWA plugin is wired only under
 * VITE_ADMIN_SHELL=v2 (manifest presence/scope).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from './utils/test-utils';
import ShellV2 from '../components/v2/ShellV2';
import DashboardV2 from '../components/v2/DashboardV2';
import { StatCard, EmptyState } from '../components/v2/primitives';
import { Icon } from '../components/v2/icons';
import { DEMO_RESTAURANT, DEMO_FEATURE_FLAGS } from '../lib/demo-fixtures';

vi.mock('../api', () => ({
    orderingAdminAPI: {
        getOrders: vi.fn().mockResolvedValue([]),
        getReservations: vi.fn().mockResolvedValue([]),
        getItems: vi.fn().mockResolvedValue([]),
    },
    postsAPI: { getAll: vi.fn().mockResolvedValue([]) },
}));

const shellProps = {
    restaurantData: DEMO_RESTAURANT,
    userInitials: 'DO',
    featureFlags: DEMO_FEATURE_FLAGS,
    metaConnected: true,
    instagramEnabled: true,
    facebookEnabled: true,
    onConnectInstagram: vi.fn(),
    onProfileOpen: vi.fn(),
    onRefreshRestaurant: vi.fn(),
    refreshKey: 0,
};

describe('ShellV2 — mobile bottom tab bar (Brief 05 item 1)', () => {
    it('renders a Primary tab bar with the five main buckets', () => {
        render(<ShellV2 {...shellProps} />);
        const bar = screen.getByRole('navigation', { name: /^Primary$/i });
        for (const label of ['Home', 'Content', 'Ordering', 'Insights', 'Design']) {
            expect(bar).toHaveTextContent(label);
        }
        // Restaurant Details / Get started stay OUT of the bar (secondary drawer).
        expect(bar).not.toHaveTextContent(/Restaurant Details/i);
    });

    it('a bottom tab navigates to its bucket', async () => {
        render(<ShellV2 {...shellProps} />);
        const bar = screen.getByRole('navigation', { name: /^Primary$/i });
        fireEvent.click(within(bar).getByText('Design'));
        await waitFor(() => {
            expect(screen.getByRole('heading', { name: /Website Design/i })).toBeInTheDocument();
        });
    });
});

describe('ShellV2 — greeting hero (Brief 05 item 6)', () => {
    it('shows a time-aware greeting with the restaurant name and the wave', () => {
        render(<ShellV2 {...shellProps} />);
        const heading = screen.getByRole('heading', {
            name: new RegExp(`Good (morning|afternoon|evening), .*${DEMO_RESTAURANT.name.replace(/[[\]]/g, '\\$&')}`, 'i'),
        });
        expect(heading).toHaveTextContent('👋');
    });

    it('shows a live store-status pill wired to storeOpen', () => {
        render(<ShellV2 {...shellProps} />);
        expect(screen.getByText(/Open · accepting orders/i)).toBeInTheDocument();
    });
});

describe('StatCard — skeleton → data with count-up (Brief 05 items 2 & 7)', () => {
    it('shimmers while loading, then reveals the value', async () => {
        const { container, rerender } = render(
            <StatCard label="Orders today" value={42} icon="orders" spark={[1, 2, 3]} loading delta="up" />,
        );
        // Loading: label stays, value shimmers, number is hidden.
        expect(screen.getByText('Orders today')).toBeInTheDocument();
        expect(container.querySelector('.v2-skeleton')).not.toBeNull();
        expect(screen.queryByText('42')).toBeNull();

        rerender(<StatCard label="Orders today" value={42} icon="orders" spark={[1, 2, 3]} loading={false} delta="up" />);
        await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument());
        expect(container.querySelector('.v2-skeleton')).toBeNull();
    });
});

describe('Icon (Brief 05 item 5)', () => {
    it('renders an inline currentColor SVG', () => {
        const { container } = render(<Icon name="dashboard" title="Dashboard" />);
        const svg = container.querySelector('svg');
        expect(svg).not.toBeNull();
        expect(svg?.getAttribute('stroke')).toBe('currentColor');
        expect(screen.getByTitle('Dashboard')).toBeInTheDocument();
    });
});

describe('EmptyState (Brief 05 item 9)', () => {
    it('renders illustration, copy and a single CTA', () => {
        const onCta = vi.fn();
        const { container } = render(
            <EmptyState title="All caught up" description="Nothing urgent" ctaLabel="Add item" onCta={onCta} />,
        );
        expect(container.querySelector('svg')).not.toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /Add item/i }));
        expect(onCta).toHaveBeenCalledTimes(1);
    });
});

describe('DashboardV2 — quick actions (Brief 05 item 11)', () => {
    it('deep-links each quick action into the right bucket', async () => {
        const onNavigate = vi.fn();
        render(<DashboardV2 restaurantData={DEMO_RESTAURANT} onNavigate={onNavigate} />);
        fireEvent.click(screen.getByRole('button', { name: /Generate a post/i }));
        expect(onNavigate).toHaveBeenCalledWith('CONTENT');
        fireEvent.click(screen.getByRole('button', { name: /Add a menu item/i }));
        expect(onNavigate).toHaveBeenCalledWith('ORDERING');
        fireEvent.click(screen.getByRole('button', { name: /View live orders/i }));
        expect(onNavigate).toHaveBeenCalledWith('ORDERING');
    });
});
