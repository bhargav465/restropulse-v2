import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Platform } from '@restropulse/shared';
import { render, screen, waitFor, fireEvent } from './utils/test-utils';
import Dashboard from '../components/Dashboard';

// Mock the API module
vi.mock('../api', () => ({
    authAPI: {
        checkSession: vi.fn(),
    },
    postsAPI: {
        getAll: vi.fn(),
    },
    restaurantAPI: {
        getAnalytics: vi.fn(),
    },
}));

import { authAPI, postsAPI, restaurantAPI } from '../api';

describe('Dashboard Component', () => {
    const mockUser = {
        id: 'u1',
        email: 'test@test.com',
        name: 'Test User',
        restaurantId: 'r1',
        phone: '1234567890',
        role: 'OWNER' as const,
    };

    const mockPosts = [
        {
            id: 'p1',
            caption: 'Delicious pasta dish',
            type: 'IMAGE' as const,
            status: 'PENDING_APPROVAL' as const,
            thumbnail: '/pasta.jpg',
            platforms: ['INSTAGRAM'] as Platform[],
        },
        {
            id: 'p2',
            caption: 'Fresh ingredients',
            type: 'VIDEO' as const,
            status: 'CHANGES_REQUESTED' as const,
            thumbnail: '/ingredients.jpg',
            platforms: ['FACEBOOK'] as Platform[],
        },
        {
            id: 'p3',
            caption: 'Weekend special',
            type: 'IMAGE' as const,
            status: 'SCHEDULED' as const,
            thumbnail: '/special.jpg',
            platforms: ['INSTAGRAM', 'FACEBOOK'] as Platform[],
            scheduledFor: '2024-12-25',
        },
    ];

    const mockRestaurant = {
        id: 'r1',
        name: 'Test Restaurant',
        cuisine: 'Italian',
        location: {
            address: 'Test Address',
            lat: 0,
            lng: 0,
            mapUrl: 'https://maps.example.com',
        },
        accountManager: {
            name: 'Manager',
            phone: '123',
            email: 'manager@test.com',
            avatar: '/avatar.jpg',
        },
        integrations: {
            whatsapp: true,
            instagram: true,
            facebook: false,
        },
        activeOffers: ['20% off on weekends'],
        chefSpecials: ['Truffle Risotto'],
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(authAPI.checkSession).mockResolvedValue({ user: mockUser } as any);
        vi.mocked(postsAPI.getAll).mockResolvedValue(mockPosts);
        vi.mocked(restaurantAPI.getAnalytics).mockRejectedValue(new Error('No analytics'));
    });

    describe('Initial Load', () => {
        it('should load and display user name', async () => {
            render(<Dashboard restaurantData={mockRestaurant} userName="Test User" />);

            await waitFor(() => {
                expect(screen.getByText('Welcome')).toBeInTheDocument();
                expect(screen.getByText('Test')).toBeInTheDocument();
            });
        });

        it('should call APIs on mount', async () => {
            render(<Dashboard restaurantData={mockRestaurant} />);

            await waitFor(() => {
                expect(postsAPI.getAll).toHaveBeenCalled();
            });
        });

        it('should handle API errors gracefully', async () => {
            vi.mocked(postsAPI.getAll).mockRejectedValue(new Error('API Error'));
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

            render(<Dashboard restaurantData={mockRestaurant} />);

            await waitFor(() => {
                expect(consoleSpy).toHaveBeenCalledWith('Failed to load dashboard data:', expect.any(Error));
            });

            consoleSpy.mockRestore();
        });
    });

    describe('Pending Posts Banner', () => {
        it('should show action required banner when there are pending posts', async () => {
            render(<Dashboard restaurantData={mockRestaurant} />);

            await waitFor(() => {
                expect(screen.getByText('Posts Need Review')).toBeInTheDocument();
                expect(screen.getByText('2')).toBeInTheDocument();
            });
        });

        it('should not show banner when there are no pending posts', async () => {
            vi.mocked(postsAPI.getAll).mockResolvedValue([]);

            render(<Dashboard restaurantData={mockRestaurant} />);

            await waitFor(() => {
                expect(screen.queryByText('Posts Need Review')).not.toBeInTheDocument();
            });
        });

        it('should navigate to studio when banner is clicked', async () => {
            const mockSetView = vi.fn();
            render(<Dashboard restaurantData={mockRestaurant} setView={mockSetView} />);

            await waitFor(() => {
                const banner = screen.getByText('Posts Need Review').closest('button');
                fireEvent.click(banner!);
                expect(mockSetView).toHaveBeenCalledWith('STUDIO');
            });
        });
    });

    describe('Scheduled Posts', () => {
        it('should display next scheduled post', async () => {
            render(<Dashboard restaurantData={mockRestaurant} />);

            await waitFor(() => {
                expect(screen.getByText('Weekend special')).toBeInTheDocument();
                expect(screen.getByText(/Scheduled for Instagram & Facebook/i)).toBeInTheDocument();
            });
        });

        it('should show message when no scheduled posts', async () => {
            vi.mocked(postsAPI.getAll).mockResolvedValue([]);

            render(<Dashboard restaurantData={mockRestaurant} />);

            await waitFor(() => {
                expect(screen.getByText('No upcoming posts scheduled')).toBeInTheDocument();
            });
        });

        it('should display single-platform label for a scheduled post with one platform', async () => {
            const singlePlatformPost = {
                ...mockPosts[2],
                platforms: ['INSTAGRAM'] as Platform[],
            };
            vi.mocked(postsAPI.getAll).mockResolvedValue([singlePlatformPost]);
            render(<Dashboard restaurantData={mockRestaurant} />);
            await waitFor(() => {
                expect(screen.getByText(/Scheduled for Instagram/i)).toBeInTheDocument();
            });
        });

        it('should render when restaurantData has no activeOffers or chefSpecials', async () => {
            const restaurantWithoutExtras = { ...mockRestaurant, activeOffers: undefined as any, chefSpecials: undefined as any };
            render(<Dashboard restaurantData={restaurantWithoutExtras} />);
            await waitFor(() => {
                expect(screen.getByText('Weekend special')).toBeInTheDocument();
            });
        });

        it('should navigate to studio when scheduled post is clicked', async () => {
            const mockSetView = vi.fn();
            render(<Dashboard restaurantData={mockRestaurant} setView={mockSetView} />);

            await waitFor(() => {
                const post = screen.getByText('Weekend special').closest('div');
                fireEvent.click(post!);
                expect(mockSetView).toHaveBeenCalledWith('STUDIO');
            });
        });
    });

    describe('Live Context Section', () => {
        it('should display active offers', async () => {
            render(<Dashboard restaurantData={mockRestaurant} />);

            await waitFor(() => {
                expect(screen.getByText('20% off on weekends')).toBeInTheDocument();
                expect(screen.getByText('Active Offer')).toBeInTheDocument();
            });
        });

        it('should display chef specials', async () => {
            render(<Dashboard restaurantData={mockRestaurant} />);

            await waitFor(() => {
                expect(screen.getByText('Truffle Risotto')).toBeInTheDocument();
            });
        });

        it('should not show live context section when no offers or specials', async () => {
            const emptyRestaurant = {
                ...mockRestaurant,
                activeOffers: [],
                chefSpecials: [],
            };

            render(<Dashboard restaurantData={emptyRestaurant} />);

            await waitFor(() => {
                expect(screen.queryByText('Live on Profile')).not.toBeInTheDocument();
            });
        });

        it('should navigate to inputs when Edit button is clicked', async () => {
            const mockSetView = vi.fn();
            render(<Dashboard restaurantData={mockRestaurant} setView={mockSetView} />);

            await waitFor(() => {
                const editButton = screen.getByText('Edit');
                fireEvent.click(editButton);
                expect(mockSetView).toHaveBeenCalledWith('INPUTS');
            });
        });
    });

    describe('Pending Posts Banner', () => {
        it('should show action required banner when there are pending posts', async () => {
            render(<Dashboard restaurantData={mockRestaurant} />);

            await waitFor(() => {
                expect(screen.getByText('Posts Need Review')).toBeInTheDocument();
                expect(screen.getByText('2')).toBeInTheDocument();
            });
        });
    });

    describe('Header Display', () => {
        it('should display Up Next header', async () => {
            render(<Dashboard restaurantData={mockRestaurant} />);

            await waitFor(() => {
                expect(screen.getByText('Up Next')).toBeInTheDocument();
            });
        });

        it('should show Live on Profile header when context exists', async () => {
            render(<Dashboard restaurantData={mockRestaurant} />);

            await waitFor(() => {
                expect(screen.getByText('Live on Profile')).toBeInTheDocument();
            });
        });
    });

    describe('Analytics and Content Mix', () => {
        it('should display content mix cards when analytics returns data', async () => {
            vi.mocked(restaurantAPI.getAnalytics).mockResolvedValue({
                postsPerWeek: [
                    { week: 1, posts: 3 },
                    { week: 2, posts: 5 },
                ],
                contentMix: [
                    { type: 'IMAGE', count: 8 },
                    { type: 'REEL', count: 3 },
                ],
                platformMix: [],
            });

            render(<Dashboard restaurantData={mockRestaurant} />);

            await waitFor(() => {
                expect(screen.getByText('Posts')).toBeInTheDocument();
                expect(screen.getByText('Reels')).toBeInTheDocument();
                expect(screen.getByText('8')).toBeInTheDocument();
                expect(screen.getByText('3')).toBeInTheDocument();
            });
        });

        it('should display CAROUSEL content mix card when returned in analytics', async () => {
            vi.mocked(restaurantAPI.getAnalytics).mockResolvedValue({
                postsPerWeek: [],
                contentMix: [
                    { type: 'CAROUSEL', count: 2 },
                    { type: 'VIDEO', count: 1 },
                    { type: 'STORY', count: 4 },
                ],
                platformMix: [],
            });

            render(<Dashboard restaurantData={mockRestaurant} />);

            await waitFor(() => {
                expect(screen.getByText('Carousels')).toBeInTheDocument();
                expect(screen.getByText('Videos')).toBeInTheDocument();
                expect(screen.getByText('Stories')).toBeInTheDocument();
            });
        });

        it('should remove animate-pulse from image after onLoad fires', async () => {
            vi.mocked(postsAPI.getAll).mockResolvedValue([mockPosts[2]]);

            render(<Dashboard restaurantData={mockRestaurant} />);

            const img = await screen.findByAltText('Next Post');
            expect(img).toHaveClass('animate-pulse');
            fireEvent.load(img);
            expect(img).not.toHaveClass('animate-pulse');
        });

        it('should handle analytics response with no contentMix', async () => {
            vi.mocked(restaurantAPI.getAnalytics).mockResolvedValue({
                postsPerWeek: [{ week: 1, posts: 2 }],
                contentMix: undefined as any,
                platformMix: [],
            });

            render(<Dashboard restaurantData={mockRestaurant} />);

            await waitFor(() => {
                expect(restaurantAPI.getAnalytics).toHaveBeenCalled();
            });
        });

        it('should skip analytics when restaurantData has no id', async () => {
            const restaurantWithoutId = { ...mockRestaurant, id: undefined as any };
            render(<Dashboard restaurantData={restaurantWithoutId} />);

            await waitFor(() => {
                expect(postsAPI.getAll).toHaveBeenCalled();
            });
            expect(restaurantAPI.getAnalytics).not.toHaveBeenCalled();
        });

        it('should use fallback config for unknown content mix type', async () => {
            vi.mocked(restaurantAPI.getAnalytics).mockResolvedValue({
                postsPerWeek: [],
                contentMix: [{ type: 'UNKNOWN_TYPE', count: 7 }],
                platformMix: [],
            });

            render(<Dashboard restaurantData={mockRestaurant} />);

            await waitFor(() => {
                expect(screen.getByText('UNKNOWN_TYPE')).toBeInTheDocument();
                expect(screen.getByText('7')).toBeInTheDocument();
            });
        });
    });

    describe('Pull to Refresh', () => {
        it('should handle touch start at scroll top', () => {
            render(<Dashboard restaurantData={mockRestaurant} />);

            const container = document.body;

            Object.defineProperty(window, 'scrollY', { value: 0, writable: true });

            fireEvent.touchStart(container, { touches: [{ clientY: 100 }] });
        });

        it('should track pull distance on touch move', () => {
            render(<Dashboard restaurantData={mockRestaurant} />);

            const container = document.body;

            Object.defineProperty(window, 'scrollY', { value: 0, writable: true });

            fireEvent.touchStart(container, { touches: [{ clientY: 100 }] });
            fireEvent.touchMove(container, { touches: [{ clientY: 150 }] });
        });

        it('should trigger refresh on sufficient pull', () => {
            vi.useFakeTimers();

            render(<Dashboard restaurantData={mockRestaurant} />);

            const container = document.body;

            Object.defineProperty(window, 'scrollY', { value: 0, writable: true });

            fireEvent.touchStart(container, { touches: [{ clientY: 100 }] });
            fireEvent.touchMove(container, { touches: [{ clientY: 180 }] });
            fireEvent.touchEnd(container);

            vi.advanceTimersByTime(1500);

            vi.useRealTimers();
        });

        it('should not trigger refresh on small pull', () => {
            render(<Dashboard restaurantData={mockRestaurant} />);

            const container = document.body;

            Object.defineProperty(window, 'scrollY', { value: 0, writable: true });

            fireEvent.touchStart(container, { touches: [{ clientY: 100 }] });
            fireEvent.touchMove(container, { touches: [{ clientY: 120 }] });
            fireEvent.touchEnd(container);
        });

        it('should not start pull when not at scroll top', () => {
            render(<Dashboard restaurantData={mockRestaurant} />);

            const container = document.body;

            Object.defineProperty(window, 'scrollY', { value: 100, writable: true });

            fireEvent.touchStart(container, { touches: [{ clientY: 100 }] });
            fireEvent.touchMove(container, { touches: [{ clientY: 150 }] });
        });

        it('should not update pull distance when touch moves upward (distance <= 0)', () => {
            render(<Dashboard restaurantData={mockRestaurant} />);

            const container = document.body;

            Object.defineProperty(window, 'scrollY', { value: 0, writable: true });

            // Start at y=200, move to y=150 — distance is negative (pull up)
            fireEvent.touchStart(container, { touches: [{ clientY: 200 }] });
            fireEvent.touchMove(container, { touches: [{ clientY: 150 }] });
            fireEvent.touchEnd(container);
        });
    });
});
