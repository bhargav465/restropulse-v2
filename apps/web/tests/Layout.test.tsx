import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from './utils/test-utils';
import Layout from '../components/Layout';
import { ViewState } from '@restropulse/shared';

describe('Layout Component', () => {
    const mockSetView = vi.fn();
    const mockOnCreatePost = vi.fn();
    const mockOnProfileOpen = vi.fn();
    const mockChildren = <div>Test Content</div>;

    const defaultProps = {
        currentView: 'DASHBOARD' as ViewState,
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
        const titleElement = screen.getByText((content, element) => {
            return element?.textContent === 'Content Studio';
        });
        expect(titleElement).toBeInTheDocument();
    });

    it('should render all navigation items', () => {
        render(<Layout {...defaultProps}>{mockChildren}</Layout>);
        expect(screen.getByText('Home')).toBeInTheDocument();
        expect(screen.getByText('Studio')).toBeInTheDocument();
        expect(screen.getByText('Updates')).toBeInTheDocument();
        expect(screen.getByText('Strategy')).toBeInTheDocument();
    });

    it('should highlight the active navigation item', () => {
        render(<Layout {...defaultProps}>{mockChildren}</Layout>);
        const homeButton = screen.getByText('Home').closest('button');
        const studioButton = screen.getByText('Studio').closest('button');

        expect(homeButton).toHaveClass('text-orange-600');
        expect(studioButton).toHaveClass('text-slate-400');
    });

    it('should call setView when Home nav item is clicked', () => {
        render(<Layout {...defaultProps} currentView="STUDIO" title="Studio">{mockChildren}</Layout>);
        const homeButton = screen.getByText('Home').closest('button');
        fireEvent.click(homeButton!);
        expect(mockSetView).toHaveBeenCalledWith('DASHBOARD');
    });

    it('should call setView when Studio nav item is clicked', () => {
        render(<Layout {...defaultProps}>{mockChildren}</Layout>);
        const studioButton = screen.getByText('Studio').closest('button');
        fireEvent.click(studioButton!);
        expect(mockSetView).toHaveBeenCalledWith('STUDIO');
    });

    it('should call setView when Strategy nav item is clicked', () => {
        render(<Layout {...defaultProps}>{mockChildren}</Layout>);
        const strategyButton = screen.getByText('Strategy').closest('button');
        fireEvent.click(strategyButton!);
        expect(mockSetView).toHaveBeenCalledWith('STRATEGY');
    });

    it('should call setView when Updates nav item is clicked (updatesSection enabled)', () => {
        render(<Layout {...defaultProps} featureFlags={{ updatesSection: true, deleteAccount: false, topupCredits: false }}>{mockChildren}</Layout>);
        const updatesButton = screen.getByText('Updates').closest('button');
        fireEvent.click(updatesButton!);
        expect(mockSetView).toHaveBeenCalledWith('INPUTS');
    });

    it('should show Updates as disabled when featureFlags.updatesSection is falsy', () => {
        render(<Layout {...defaultProps}>{mockChildren}</Layout>);
        const updatesButton = screen.getByText('Updates').closest('button');
        expect(updatesButton).toBeNull();
        expect(screen.getByText('Soon')).toBeInTheDocument();
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
        const bell = screen.getByLabelText('Notifications');
        const badge = bell.querySelector('.bg-red-500');
        expect(badge).toBeInTheDocument();
    });

    it('should not show bell badge when pendingCount is 0', () => {
        render(<Layout {...defaultProps} pendingCount={0}>{mockChildren}</Layout>);
        const bell = screen.getByLabelText('Notifications');
        const badge = bell.querySelector('.bg-red-500');
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
        const nav = screen.getByRole('navigation');
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
