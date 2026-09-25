import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from './utils/test-utils';
import Layout from '../components/Layout';
import { ViewState } from '@restropulse/shared';

describe('Layout Component', () => {
    const mockSetView = vi.fn();
    const mockOnCreatePost = vi.fn();
    const mockOnProfileOpen = vi.fn();
    const mockChildren = <div>Test Content</div>;

    const defaultProps = {
        currentView: 'INTELLIGENCE' as ViewState,
        setView: mockSetView,
        title: 'Dashboard',
        restaurantName: 'Test Restaurant',
        userInitials: 'AM',
        pendingCount: 0,
        onCreatePost: mockOnCreatePost,
        onProfileOpen: mockOnProfileOpen,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render children content', () => {
        render(<Layout {...defaultProps}>{mockChildren}</Layout>);
        expect(screen.getByText('Test Content')).toBeInTheDocument();
    });

    it('should display the restaurant name in header', () => {
        render(<Layout {...defaultProps}>{mockChildren}</Layout>);
        expect(screen.getByText('Test Restaurant')).toBeInTheDocument();
        expect(screen.getByText('R')).toBeInTheDocument(); // Logo
    });

    it('should display the current title', () => {
        render(<Layout {...defaultProps} currentView="STUDIO" title="Content Studio">{mockChildren}</Layout>);
        // Scope to the header: the desktop sidebar also renders a "Content Studio" nav label.
        const header = screen.getByRole('banner');
        const titleElement = within(header).getByText((content, element) => {
            return element?.textContent === 'Content Studio';
        });
        expect(titleElement).toBeInTheDocument();
    });

    it('should render all navigation items', () => {
        render(<Layout {...defaultProps}>{mockChildren}</Layout>);
        // Scope to the bottom (Primary) nav; the desktop sidebar duplicates some labels.
        const primaryNav = screen.getByRole('navigation', { name: 'Primary' });
        expect(within(primaryNav).getByText('Insights')).toBeInTheDocument();
        expect(within(primaryNav).getByText('Studio')).toBeInTheDocument();
        expect(within(primaryNav).getByText('Updates')).toBeInTheDocument();
        expect(within(primaryNav).getByText('Strategy')).toBeInTheDocument();
    });

    it('should highlight the active navigation item', () => {
        render(<Layout {...defaultProps}>{mockChildren}</Layout>);
        const primaryNav = screen.getByRole('navigation', { name: 'Primary' });
        const insightsButton = within(primaryNav).getByText('Insights').closest('button');
        const studioButton = within(primaryNav).getByText('Studio').closest('button');

        expect(insightsButton).toHaveClass('text-orange-600');
        expect(studioButton).toHaveClass('text-slate-400');
    });

    it('should call setView when Insights nav item is clicked', () => {
        render(<Layout {...defaultProps} currentView="STUDIO" title="Studio">{mockChildren}</Layout>);
        const primaryNav = screen.getByRole('navigation', { name: 'Primary' });
        const insightsButton = within(primaryNav).getByText('Insights').closest('button');
        fireEvent.click(insightsButton!);
        expect(mockSetView).toHaveBeenCalledWith('INTELLIGENCE');
    });

    it('should call setView when Studio nav item is clicked', () => {
        render(<Layout {...defaultProps}>{mockChildren}</Layout>);
        const primaryNav = screen.getByRole('navigation', { name: 'Primary' });
        const studioButton = within(primaryNav).getByText('Studio').closest('button');
        fireEvent.click(studioButton!);
        expect(mockSetView).toHaveBeenCalledWith('STUDIO');
    });

    it('should call setView when Strategy nav item is clicked', () => {
        render(<Layout {...defaultProps}>{mockChildren}</Layout>);
        const primaryNav = screen.getByRole('navigation', { name: 'Primary' });
        const strategyButton = within(primaryNav).getByText('Strategy').closest('button');
        fireEvent.click(strategyButton!);
        expect(mockSetView).toHaveBeenCalledWith('STRATEGY');
    });

    it('should call setView when Updates nav item is clicked (updatesSection enabled)', () => {
        render(<Layout {...defaultProps} featureFlags={{ updatesSection: true, deleteAccount: false, topupCredits: false }}>{mockChildren}</Layout>);
        const primaryNav = screen.getByRole('navigation', { name: 'Primary' });
        const updatesButton = within(primaryNav).getByText('Updates').closest('button');
        fireEvent.click(updatesButton!);
        expect(mockSetView).toHaveBeenCalledWith('INPUTS');
    });

    it('should show Updates as disabled when featureFlags.updatesSection is falsy', () => {
        render(<Layout {...defaultProps}>{mockChildren}</Layout>);
        const primaryNav = screen.getByRole('navigation', { name: 'Primary' });
        const updatesButton = within(primaryNav).getByText('Updates').closest('button');
        expect(updatesButton).toBeNull();
        expect(within(primaryNav).getByText('Soon')).toBeInTheDocument();
    });

    it('should show [+] button only on STUDIO view', () => {
        const { rerender } = render(<Layout {...defaultProps}>{mockChildren}</Layout>);
        expect(screen.queryByLabelText('Create post')).not.toBeInTheDocument();

        rerender(<Layout {...defaultProps} currentView="STUDIO" title="Content Studio">{mockChildren}</Layout>);
        expect(screen.getByLabelText('Create post')).toBeInTheDocument();
    });

    it('should call onCreatePost when [+] button is clicked', () => {
        render(<Layout {...defaultProps} currentView="STUDIO" title="Content Studio">{mockChildren}</Layout>);
        fireEvent.click(screen.getByLabelText('Create post'));
        expect(mockOnCreatePost).toHaveBeenCalledOnce();
    });

    it('should render user avatar with initials', () => {
        render(<Layout {...defaultProps}>{mockChildren}</Layout>);
        expect(screen.getByText('AM')).toBeInTheDocument();
    });

    it('should call onProfileOpen when avatar is clicked', () => {
        render(<Layout {...defaultProps}>{mockChildren}</Layout>);
        fireEvent.click(screen.getByLabelText('Profile'));
        expect(mockOnProfileOpen).toHaveBeenCalledOnce();
    });

    it('should show bell badge when pendingCount > 0', () => {
        render(<Layout {...defaultProps} pendingCount={3}>{mockChildren}</Layout>);
        const bell = screen.getByLabelText(/Notifications/);
        const badge = bell.querySelector('[data-testid="notification-badge"]');
        expect(badge).toBeInTheDocument();
        expect(badge).toHaveTextContent('3');
    });

    it('should not show bell badge when pendingCount is 0', () => {
        render(<Layout {...defaultProps} pendingCount={0}>{mockChildren}</Layout>);
        const bell = screen.getByLabelText('Notifications');
        const badge = bell.querySelector('[data-testid="notification-badge"]');
        expect(badge).not.toBeInTheDocument();
    });

    it('should handle all ViewState values correctly', () => {
        const views: ViewState[] = ['DASHBOARD', 'STUDIO', 'INPUTS', 'STRATEGY'];

        views.forEach(view => {
            const { unmount } = render(
                <Layout {...defaultProps} currentView={view} title={view}>{mockChildren}</Layout>
            );
            expect(screen.getByText('Test Content')).toBeInTheDocument();
            unmount();
        });
    });

    it('should have proper header structure', () => {
        render(<Layout {...defaultProps}>{mockChildren}</Layout>);
        const header = screen.getByRole('banner');
        expect(header).toBeInTheDocument();
        expect(header).toHaveClass('sticky');
    });

    it('should have proper navigation structure', () => {
        render(<Layout {...defaultProps}>{mockChildren}</Layout>);
        // Desktop sidebar adds a second nav; target the bottom (Primary) nav.
        const nav = screen.getByRole('navigation', { name: 'Primary' });
        expect(nav).toBeInTheDocument();
        expect(nav).toHaveClass('fixed', 'bottom-0');
    });

    it('should show disabled create post button in STUDIO view when onCreatePost is not provided', () => {
        const propsWithoutCreatePost = {
            ...defaultProps,
            currentView: 'STUDIO' as ViewState,
            title: 'Content Studio',
            onCreatePost: undefined,
        };
        render(<Layout {...propsWithoutCreatePost}>{mockChildren}</Layout>);

        const createButton = screen.getByLabelText('Create post');
        expect(createButton).toBeInTheDocument();
        expect(createButton).toBeDisabled();
        expect(createButton).toHaveClass('bg-slate-200');
    });
});
