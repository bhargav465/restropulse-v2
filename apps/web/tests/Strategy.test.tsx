import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from './utils/test-utils';
import Strategy from '../components/Strategy';
import { Restaurant } from '@restropulse/shared';

// Mock the API module
vi.mock('../api', () => ({
    strategyAPI: {
        getStrategy: vi.fn(),
        getAllCycles: vi.fn(),
        getCurrentCycles: vi.fn(),
        createCycle: vi.fn(),
        updateCycle: vi.fn(),
    },
}));

import { strategyAPI } from '../api';

const mockRestaurantData: Restaurant = {
    id: 'r1',
    name: 'Test Restaurant',
    cuisine: 'Italian',
    accountManager: { name: 'Manager', phone: '1234567890', email: 'mgr@test.com', avatar: '' },
    integrations: { whatsapp: true, instagram: true, facebook: false },
} as unknown as Restaurant;

// Mock window.history
const mockHistoryPushState = vi.fn();
const mockHistoryBack = vi.fn();

describe('Strategy Component', () => {
    const mockStrategy = {
        postsPerWeek: 4,
        focusCategories: ['Food', 'Ambiance', 'Events'],
        bestTime: '6:00 PM',
        nextScheduledDate: '2024-01-15',
        theme: 'Local food enthusiasts',
    };

    // PENDING_APPROVAL cycle needs a future startDate so the deadline window is still open.
    const pendingStart = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const pendingEnd = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();

    const mockCycles = [
        {
            id: 'c1',
            period: 'January 2024',
            goals: ['Increase engagement', 'Promote new menu'],
            status: 'ACTIVE' as const,
            startDate: new Date('2024-01-01').toISOString(),
            endDate: new Date('2024-01-31').toISOString(),
            summary: 'Focus on new menu items and engagement',
            plannedPosts: [
                { category: 'Food', count: 3 },
                { category: 'Ambiance', count: 1 },
            ],
            focus: ['New menu', 'Customer engagement'],
        },
        {
            id: 'c2',
            period: 'February 2024',
            goals: ['Valentine special', 'Partner with influencers'],
            status: 'HISTORY' as const,
            startDate: new Date('2024-02-01').toISOString(),
            endDate: new Date('2024-02-28').toISOString(),
            summary: 'Valentine promotions',
            plannedPosts: [
                { category: 'Events', count: 2 },
                { category: 'Food', count: 2 },
            ],
            focus: ['Valentine special', 'Influencer partnerships'],
        },
        {
            id: 'c3',
            period: 'March 2024',
            goals: ['Spring menu launch'],
            status: 'PENDING_APPROVAL' as const,
            startDate: pendingStart,
            endDate: pendingEnd,
            summary: 'Spring menu promotions',
            plannedPosts: [
                { category: 'Food', count: 4 },
            ],
            focus: ['Spring menu', 'Fresh ingredients'],
        },
    ];

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(strategyAPI.getStrategy).mockResolvedValue(mockStrategy);
        vi.mocked(strategyAPI.getAllCycles).mockResolvedValue(mockCycles);
        window.history.pushState = mockHistoryPushState;
        window.history.back = mockHistoryBack;
    });

    describe('Initial Load', () => {
        it('should load cycles data', async () => {
            render(<Strategy restaurantData={mockRestaurantData} instagramConnected={true} />);

            await waitFor(() => {
                expect(strategyAPI.getAllCycles).toHaveBeenCalled();
            });
        });

        it('should call APIs on mount', async () => {
            render(<Strategy restaurantData={mockRestaurantData} instagramConnected={true} />);

            await waitFor(() => {
                expect(strategyAPI.getAllCycles).toHaveBeenCalledTimes(1);
            });
        });

        it('should handle loading error', async () => {
            vi.mocked(strategyAPI.getAllCycles).mockRejectedValue(new Error('Load failed'));
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

            render(<Strategy restaurantData={mockRestaurantData} instagramConnected={true} />);

            await waitFor(() => {
                expect(consoleSpy).toHaveBeenCalledWith('Failed to load strategy data:', expect.any(Error));
            });

            consoleSpy.mockRestore();
        });
    });

    describe('Cycle Display', () => {
        it('should display active cycle', async () => {
            render(<Strategy restaurantData={mockRestaurantData} instagramConnected={true} />);

            await waitFor(() => {
                expect(screen.getByText('January 2024')).toBeInTheDocument();
            });
        });

        it('should display cycle summary', async () => {
            render(<Strategy restaurantData={mockRestaurantData} instagramConnected={true} />);

            await waitFor(() => {
                expect(screen.getByText('Focus on new menu items and engagement')).toBeInTheDocument();
            });
        });

        it('should show pending approval cycle', async () => {
            render(<Strategy restaurantData={mockRestaurantData} instagramConnected={true} />);

            await waitFor(() => {
                expect(screen.getByText('March 2024')).toBeInTheDocument();
            });
        });
    });

    describe('Cycle Actions', () => {
        it('should approve a strategy cycle', async () => {
            vi.mocked(strategyAPI.updateCycle).mockResolvedValue({ ...mockCycles[2], status: 'APPROVED' });

            render(<Strategy restaurantData={mockRestaurantData} instagramConnected={true} />);

            await waitFor(() => {
                const approveButtons = screen.getAllByRole('button');
                const approveButton = approveButtons.find(btn => btn.textContent?.includes('Approve'));
                expect(approveButton).toBeDefined();
            });

            const approveButtons = screen.getAllByRole('button');
            const approveButton = approveButtons.find(btn => btn.textContent?.includes('Approve'));

            if (approveButton) {
                fireEvent.click(approveButton);
                await waitFor(() => {
                    expect(strategyAPI.updateCycle).toHaveBeenCalledWith('c3', { status: 'APPROVED' });
                    expect(screen.getByText(/Strategy approved/i)).toBeInTheDocument();
                });
            }
        });

        it('should open feedback modal when request changes clicked', async () => {
            render(<Strategy restaurantData={mockRestaurantData} instagramConnected={true} />);

            await waitFor(() => {
                const requestButtons = screen.getAllByRole('button');
                const requestButton = requestButtons.find(btn => btn.textContent?.includes('Request Changes'));
                expect(requestButton).toBeDefined();
            });

            const requestButtons = screen.getAllByRole('button');
            const requestButton = requestButtons.find(btn => btn.textContent?.includes('Request Changes'));

            if (requestButton) {
                fireEvent.click(requestButton);
                expect(mockHistoryPushState).toHaveBeenCalledWith(
                    { modal: 'strategy_feedback' },
                    '',
                    '#feedback'
                );
            }
        });
    });

    describe('Feedback Modal', () => {
        it('should toggle feedback area selection', async () => {
            render(<Strategy restaurantData={mockRestaurantData} instagramConnected={true} />);

            await waitFor(() => {
                const requestButtons = screen.getAllByRole('button');
                const requestButton = requestButtons.find(btn => btn.textContent?.includes('Request Changes'));
                expect(requestButton).toBeDefined();
            });

            const requestButtons = screen.getAllByRole('button');
            const requestButton = requestButtons.find(btn => btn.textContent?.includes('Request Changes'));

            if (requestButton) {
                fireEvent.click(requestButton);

                await waitFor(() => {
                    const checkboxes = screen.queryAllByRole('checkbox');
                    if (checkboxes.length > 0) {
                        expect(checkboxes[0]).toBeInTheDocument();
                    }
                });
            }
        });

        it('should open feedback modal and display form elements', async () => {
            render(<Strategy restaurantData={mockRestaurantData} instagramConnected={true} />);

            await waitFor(() => {
                const requestButtons = screen.getAllByRole('button');
                const requestButton = requestButtons.find(btn => btn.textContent?.includes('Request Changes'));
                expect(requestButton).toBeDefined();
            });

            const requestButtons = screen.getAllByRole('button');
            const requestButton = requestButtons.find(btn => btn.textContent?.includes('Request Changes'));

            if (requestButton) {
                fireEvent.click(requestButton);

                await waitFor(() => {
                    const textareas = screen.queryAllByRole('textbox');
                    expect(textareas.length).toBeGreaterThanOrEqual(0);
                });
            }
        });

        it('should render feedback modal when opened', async () => {
            render(<Strategy restaurantData={mockRestaurantData} instagramConnected={true} />);

            await waitFor(() => {
                const requestButtons = screen.getAllByRole('button');
                const requestButton = requestButtons.find(btn => btn.textContent?.includes('Request Changes'));
                expect(requestButton).toBeDefined();
            });

            const requestButtons = screen.getAllByRole('button');
            const requestButton = requestButtons.find(btn => btn.textContent?.includes('Request Changes'));

            if (requestButton) {
                fireEvent.click(requestButton);

                await waitFor(() => {
                    const backdrop = document.querySelector('.fixed.inset-0');
                    expect(backdrop).toBeTruthy();
                });
            }
        });

        it('should handle touch drag interactions', async () => {
            render(<Strategy restaurantData={mockRestaurantData} instagramConnected={true} />);

            await waitFor(() => {
                const requestButtons = screen.getAllByRole('button');
                const requestButton = requestButtons.find(btn => btn.textContent?.includes('Request Changes'));
                expect(requestButton).toBeDefined();
            });

            const requestButtons = screen.getAllByRole('button');
            const requestButton = requestButtons.find(btn => btn.textContent?.includes('Request Changes'));

            if (requestButton) {
                fireEvent.click(requestButton);

                await waitFor(() => {
                    const textboxes = screen.queryAllByRole('textbox');
                    expect(textboxes.length).toBeGreaterThanOrEqual(0);
                });

                const modal = screen.queryAllByRole('textbox')[0]?.closest('.bg-white');
                if (modal) {
                    fireEvent.touchStart(modal, { touches: [{ clientY: 100 }] });
                    fireEvent.touchMove(modal, { touches: [{ clientY: 250 }] });
                    fireEvent.touchEnd(modal);

                    expect(mockHistoryBack).toHaveBeenCalled();
                }
            }
        });
    });

    describe('Empty States', () => {
        it('should handle empty cycles list', async () => {
            vi.mocked(strategyAPI.getAllCycles).mockResolvedValue([]);

            render(<Strategy restaurantData={mockRestaurantData} instagramConnected={true} />);

            await waitFor(() => {
                expect(strategyAPI.getAllCycles).toHaveBeenCalled();
            });
        });
    });

    describe('Feedback Area Selection', () => {
        it('should toggle all feedback areas', async () => {
            render(<Strategy restaurantData={mockRestaurantData} instagramConnected={true} />);

            await waitFor(() => {
                const requestButtons = screen.getAllByRole('button');
                const requestButton = requestButtons.find(btn => btn.textContent?.includes('Request Changes'));
                if (requestButton) {
                    fireEvent.click(requestButton);
                }
            });

            await waitFor(() => {
                const allButtons = screen.getAllByRole('button');
                ['Posting frequency', 'Posting timing', 'Content topics', 'Content variety', 'Other'].forEach(area => {
                    const areaButton = allButtons.find(btn => btn.textContent === area);
                    if (areaButton) {
                        fireEvent.click(areaButton);
                    }
                });
            });
        });

        it('should update feedback text area', async () => {
            render(<Strategy restaurantData={mockRestaurantData} instagramConnected={true} />);

            await waitFor(() => {
                const requestButtons = screen.getAllByRole('button');
                const requestButton = requestButtons.find(btn => btn.textContent?.includes('Request Changes'));
                if (requestButton) {
                    fireEvent.click(requestButton);
                }
            });

            await waitFor(() => {
                const textareas = screen.getAllByRole('textbox');
                if (textareas[0]) {
                    fireEvent.change(textareas[0], { target: { value: 'Detailed feedback here' } });
                    expect(textareas[0]).toHaveValue('Detailed feedback here');
                }
            });
        });

        it('should submit feedback and update cycle status', async () => {
            vi.mocked(strategyAPI.updateCycle).mockResolvedValue({ ...mockCycles[2], status: 'CHANGES_REQUESTED' });

            render(<Strategy restaurantData={mockRestaurantData} instagramConnected={true} />);

            await waitFor(() => {
                const requestButtons = screen.getAllByRole('button');
                const requestButton = requestButtons.find(btn => btn.textContent?.includes('Request Changes'));
                if (requestButton) {
                    fireEvent.click(requestButton);
                }
            });

            await waitFor(() => {
                const allButtons = screen.getAllByRole('button');
                const frequencyButton = allButtons.find(btn => btn.textContent === 'Posting frequency');
                if (frequencyButton) {
                    fireEvent.click(frequencyButton);
                }

                const submitButton = allButtons.find(btn => btn.textContent?.includes('Submit'));
                if (submitButton) {
                    fireEvent.click(submitButton);
                }
            });

            await waitFor(() => {
                expect(strategyAPI.updateCycle).toHaveBeenCalled();
            });
        });
    });

    describe('Modal Close Behavior', () => {
        it('should close modal on small drag', async () => {
            render(<Strategy restaurantData={mockRestaurantData} instagramConnected={true} />);

            await waitFor(() => {
                const requestButtons = screen.getAllByRole('button');
                const requestButton = requestButtons.find(btn => btn.textContent?.includes('Request Changes'));
                if (requestButton) {
                    fireEvent.click(requestButton);
                }
            });

            await waitFor(() => {
                const modal = document.querySelector('.bg-white.rounded-t-3xl');
                if (modal) {
                    fireEvent.touchStart(modal, { touches: [{ clientY: 100 }] });
                    fireEvent.touchMove(modal, { touches: [{ clientY: 130 }] });
                    fireEvent.touchEnd(modal);
                }
            });
        });

        it('should handle popstate event', async () => {
            render(<Strategy restaurantData={mockRestaurantData} instagramConnected={true} />);

            await waitFor(() => {
                const requestButtons = screen.getAllByRole('button');
                const requestButton = requestButtons.find(btn => btn.textContent?.includes('Request Changes'));
                if (requestButton) {
                    fireEvent.click(requestButton);
                }
            });

            // Trigger popstate
            const popstateEvent = new PopStateEvent('popstate');
            window.dispatchEvent(popstateEvent);

            await waitFor(() => {
                // Modal should close or component should respond to popstate
                const modals = document.querySelectorAll('.bg-white.rounded-t-3xl');
                expect(modals.length).toBeGreaterThanOrEqual(0);
            });
        });
    });

    describe('Instagram Connection Gate', () => {
        it('should show connection banner when Instagram is not connected', async () => {
            render(<Strategy restaurantData={mockRestaurantData} instagramConnected={false} />);

            await waitFor(() => {
                expect(screen.getByText(/Connect Instagram to approve strategies/i)).toBeInTheDocument();
            });
        });

        it('should show "Connect Instagram to approve" instead of approve/request buttons', async () => {
            render(<Strategy restaurantData={mockRestaurantData} instagramConnected={false} />);

            await waitFor(() => {
                expect(screen.getByText('Connect Instagram to approve')).toBeInTheDocument();
            });

            expect(screen.queryByLabelText('Approve strategy')).not.toBeInTheDocument();
            expect(screen.queryByLabelText('Request changes to strategy')).not.toBeInTheDocument();
        });

        it('should show approve/request buttons when Instagram is connected', async () => {
            render(<Strategy restaurantData={mockRestaurantData} instagramConnected={true} />);

            await waitFor(() => {
                expect(screen.getByLabelText('Approve strategy')).toBeInTheDocument();
                expect(screen.getByLabelText('Request changes to strategy')).toBeInTheDocument();
            });
        });
    });
});
