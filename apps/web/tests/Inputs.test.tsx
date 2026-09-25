import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from './utils/test-utils';
import Inputs from '../components/Inputs';
import { Restaurant } from '@restropulse/shared';

// Mock the API module
vi.mock('../api', () => ({
    restaurantAPI: {
        updateOffers: vi.fn(),
        updateSpecials: vi.fn(),
        updateMenu: vi.fn(),
    },
}));

import { restaurantAPI } from '../api';

// Mock window.history
const mockHistoryPushState = vi.fn();
const mockHistoryBack = vi.fn();

describe('Inputs Component', () => {
    const mockOnRefresh = vi.fn();

    const mockRestaurant: Restaurant = {
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
            instagram: true,
        },
        activeOffers: ['Summer Special', 'Happy Hour'],
        chefSpecials: ['Truffle Pasta'],
        menuLastUpdated: '2024-01-15',
    };

    beforeEach(() => {
        vi.clearAllMocks();
        window.history.pushState = mockHistoryPushState;
        window.history.back = mockHistoryBack;
        vi.mocked(restaurantAPI.updateOffers).mockResolvedValue(undefined as any);
        vi.mocked(restaurantAPI.updateSpecials).mockResolvedValue(undefined as any);
        vi.mocked(restaurantAPI.updateMenu).mockResolvedValue(undefined as any);
    });

    describe('Rendering', () => {
        it('should render the main heading and description', () => {
            render(<Inputs restaurantData={mockRestaurant} onRefresh={mockOnRefresh} />);

            expect(screen.getByText('Update Us')).toBeInTheDocument();
            expect(screen.getByText(/Keep your AI content engine smart/i)).toBeInTheDocument();
        });

        it('should render all action buttons', () => {
            render(<Inputs restaurantData={mockRestaurant} onRefresh={mockOnRefresh} />);

            expect(screen.getByText('Upcoming Offers')).toBeInTheDocument();
            expect(screen.getAllByText("Chef's Specials").length).toBeGreaterThan(0);
            expect(screen.getAllByText('Update Menu').length).toBeGreaterThan(0);
            expect(screen.getByText('Captured Moments')).toBeInTheDocument();
        });

        it('should show active offers in Active Context section', () => {
            render(<Inputs restaurantData={mockRestaurant} onRefresh={mockOnRefresh} />);

            expect(screen.getByText('Summer Special')).toBeInTheDocument();
            expect(screen.getByText('Happy Hour')).toBeInTheDocument();
            expect(screen.getByText('2/3')).toBeInTheDocument();
        });

        it('should show chef specials in Active Context section', () => {
            render(<Inputs restaurantData={mockRestaurant} onRefresh={mockOnRefresh} />);

            expect(screen.getByText('Truffle Pasta')).toBeInTheDocument();
            expect(screen.getByText('1/3')).toBeInTheDocument();
        });

        it('should show menu last updated date', () => {
            render(<Inputs restaurantData={mockRestaurant} onRefresh={mockOnRefresh} />);

            expect(screen.getByText(/Last updated:/i)).toBeInTheDocument();
            expect(screen.getByText(/1\/15\/2024/i)).toBeInTheDocument();
        });

        it('should show message when no active offers', () => {
            const emptyRestaurant = { ...mockRestaurant, activeOffers: [] };
            render(<Inputs restaurantData={emptyRestaurant} onRefresh={mockOnRefresh} />);

            expect(screen.getByText('No active offers set.')).toBeInTheDocument();
        });

        it('should show message when no chef specials', () => {
            const emptyRestaurant = { ...mockRestaurant, chefSpecials: [] };
            render(<Inputs restaurantData={emptyRestaurant} onRefresh={mockOnRefresh} />);

            expect(screen.getByText('No special highlighted.')).toBeInTheDocument();
        });

        it('should show message when no menu uploaded', () => {
            const emptyRestaurant = { ...mockRestaurant, menuLastUpdated: undefined };
            render(<Inputs restaurantData={emptyRestaurant} onRefresh={mockOnRefresh} />);

            expect(screen.getByText('No menu uploaded.')).toBeInTheDocument();
        });

        it('should show Full label when offers are at maximum', () => {
            const fullRestaurant = {
                ...mockRestaurant,
                activeOffers: ['Offer 1', 'Offer 2', 'Offer 3'],
            };
            render(<Inputs restaurantData={fullRestaurant} onRefresh={mockOnRefresh} />);

            expect(screen.getByText(/Full \(3\/3\)/i)).toBeInTheDocument();
        });

        it('should disable Captured Moments button with Coming Soon label', () => {
            render(<Inputs restaurantData={mockRestaurant} onRefresh={mockOnRefresh} />);

            const capturedButton = screen.getByText('Captured Moments').closest('button');
            expect(capturedButton).toBeDisabled();
            expect(screen.getByText('Coming Soon')).toBeInTheDocument();
        });
    });

    describe('Modal Interactions', () => {
        it('should show notice when trying to add a 4th offer (max 3)', () => {
            const restaurantWith3Offers = {
                ...mockRestaurant,
                activeOffers: ['Offer 1', 'Offer 2', 'Offer 3'],
            };
            render(<Inputs restaurantData={restaurantWith3Offers} onRefresh={mockOnRefresh} />);

            const offersButton = screen.getByText('Upcoming Offers').closest('button');
            fireEvent.click(offersButton!);

            expect(screen.queryByText('Add New Offer')).not.toBeInTheDocument();
            expect(screen.getByText(/You can have up to 3 active offers/i)).toBeInTheDocument();
        });

        it('should show notice when trying to add a 4th special (max 3)', () => {
            const restaurantWith3Specials = {
                ...mockRestaurant,
                chefSpecials: ['Special 1', 'Special 2', 'Special 3'],
            };
            render(<Inputs restaurantData={restaurantWith3Specials} onRefresh={mockOnRefresh} />);

            const buttons = screen.getAllByRole('button');
            const specialsButton = buttons.find(btn =>
                btn.textContent?.includes("Chef's Specials") &&
                btn.textContent?.includes('Highlight')
            );
            expect(specialsButton).toBeDefined();
            fireEvent.click(specialsButton!);

            expect(screen.queryByText("Add Chef's Special")).not.toBeInTheDocument();
            expect(screen.getByText(/You can have up to 3 chef/i)).toBeInTheDocument();
        });

        it('should open offers modal when button is clicked', () => {
            render(<Inputs restaurantData={mockRestaurant} onRefresh={mockOnRefresh} />);

            const offersButton = screen.getByText('Upcoming Offers').closest('button');
            fireEvent.click(offersButton!);

            expect(screen.getByText('Add New Offer')).toBeInTheDocument();
            expect(mockHistoryPushState).toHaveBeenCalledWith({ level: 'modal', id: 'offers' }, '', '#offers');
        });

        it('should open specials modal when button is clicked', () => {
            render(<Inputs restaurantData={mockRestaurant} onRefresh={mockOnRefresh} />);

            const buttons = screen.getAllByRole('button');
            const specialsButton = buttons.find(btn =>
                btn.textContent?.includes("Chef's Specials") &&
                btn.textContent?.includes('Highlight this weekend')
            );

            if (specialsButton) {
                fireEvent.click(specialsButton);
                expect(screen.getByText("Add Chef's Special")).toBeInTheDocument();
                expect(mockHistoryPushState).toHaveBeenCalledWith({ level: 'modal', id: 'special' }, '', '#special');
            }
        });

        it('should open menu modal when button is clicked', () => {
            render(<Inputs restaurantData={mockRestaurant} onRefresh={mockOnRefresh} />);

            const buttons = screen.getAllByRole('button');
            const menuButton = buttons.find(btn =>
                btn.textContent?.includes('Update Menu') &&
                btn.textContent?.includes('new menu')
            );

            if (menuButton) {
                fireEvent.click(menuButton);
                expect(mockHistoryPushState).toHaveBeenCalledWith({ level: 'modal', id: 'menu' }, '', '#menu');
            }
        });

        it('should not open offers modal when at maximum capacity', () => {
            const fullRestaurant = {
                ...mockRestaurant,
                activeOffers: ['Offer 1', 'Offer 2', 'Offer 3'],
            };

            render(<Inputs restaurantData={fullRestaurant} onRefresh={mockOnRefresh} />);

            const offersButton = screen.getByText('Upcoming Offers').closest('button');
            fireEvent.click(offersButton!);

            expect(screen.getByText(/You can have up to 3 active offers/i)).toBeInTheDocument();
            expect(screen.queryByText('Add New Offer')).not.toBeInTheDocument();
        });

        it('should not open specials modal when at maximum capacity', () => {
            const fullRestaurant = {
                ...mockRestaurant,
                chefSpecials: ['Special 1', 'Special 2', 'Special 3'],
            };

            render(<Inputs restaurantData={fullRestaurant} onRefresh={mockOnRefresh} />);

            const buttons = screen.getAllByRole('button');
            const specialsButton = buttons.find(btn =>
                btn.textContent?.includes("Chef's Specials") &&
                btn.textContent?.includes('Highlight')
            );

            if (specialsButton) {
                fireEvent.click(specialsButton);

                expect(screen.getByText(/You can have up to 3 chef's specials/i)).toBeInTheDocument();
            }
        });
    });

    describe('Form Interactions', () => {
        it('should allow typing in offer input field', async () => {
            render(<Inputs restaurantData={mockRestaurant} onRefresh={mockOnRefresh} />);

            const offersButton = screen.getByText('Upcoming Offers').closest('button');
            fireEvent.click(offersButton!);

            const input = screen.getByPlaceholderText('e.g. 20% Off on Pasta');
            fireEvent.change(input, { target: { value: 'New Offer' } });

            expect(input).toHaveValue('New Offer');
        });

        it('should allow typing in special input field', () => {
            render(<Inputs restaurantData={mockRestaurant} onRefresh={mockOnRefresh} />);

            const buttons = screen.getAllByRole('button');
            const specialsButton = buttons.find(btn =>
                btn.textContent?.includes("Chef's Specials") &&
                btn.textContent?.includes('Highlight')
            );

            if (specialsButton) {
                fireEvent.click(specialsButton);

                const input = screen.getByPlaceholderText('e.g. Truffle Risotto');
                fireEvent.change(input, { target: { value: 'New Special' } });

                expect(input).toHaveValue('New Special');
            }
        });

        it('should submit offer and call API', async () => {
            render(<Inputs restaurantData={mockRestaurant} onRefresh={mockOnRefresh} />);

            const offersButton = screen.getByText('Upcoming Offers').closest('button');
            fireEvent.click(offersButton!);

            const input = screen.getByPlaceholderText('e.g. 20% Off on Pasta');
            fireEvent.change(input, { target: { value: 'Flash Sale' } });

            const submitButton = screen.getByRole('button', { name: /Add Offer/i });
            fireEvent.click(submitButton);

            await waitFor(() => {
                expect(restaurantAPI.updateOffers).toHaveBeenCalledWith('r1', 'ADD', 'Flash Sale');
                expect(mockOnRefresh).toHaveBeenCalled();
                expect(screen.queryByText('Add New Offer')).not.toBeInTheDocument();
            });
        });

        it('should submit special and call API', async () => {
            render(<Inputs restaurantData={mockRestaurant} onRefresh={mockOnRefresh} />);

            const buttons = screen.getAllByRole('button');
            const specialsButton = buttons.find(btn =>
                btn.textContent?.includes("Chef's Specials") &&
                btn.textContent?.includes('Highlight')
            );

            if (specialsButton) {
                fireEvent.click(specialsButton);

                const input = screen.getByPlaceholderText('e.g. Truffle Risotto');
                fireEvent.change(input, { target: { value: 'Lobster Thermidor' } });

                const submitButton = screen.getByRole('button', { name: /Add Special/i });
                fireEvent.click(submitButton);

                await waitFor(() => {
                    expect(restaurantAPI.updateSpecials).toHaveBeenCalledWith('r1', 'ADD', 'Lobster Thermidor');
                    expect(mockOnRefresh).toHaveBeenCalled();
                    expect(screen.queryByText("Add Chef's Special")).not.toBeInTheDocument();
                });
            }
        });

        it('should submit menu update and call API', async () => {
            render(<Inputs restaurantData={mockRestaurant} onRefresh={mockOnRefresh} />);

            const buttons = screen.getAllByRole('button');
            const menuButton = buttons.find(btn =>
                btn.textContent?.includes('Update Menu') &&
                btn.textContent?.includes('new menu')
            );

            if (menuButton) {
                fireEvent.click(menuButton);

                const allButtons = screen.getAllByRole('button');
                const submitButton = allButtons.find(btn => btn.textContent === 'Update Menu');

                if (submitButton) {
                    fireEvent.click(submitButton);

                    await waitFor(() => {
                        expect(restaurantAPI.updateMenu).toHaveBeenCalledWith('r1');
                        expect(mockOnRefresh).toHaveBeenCalled();
                        expect(screen.queryByText('Upload Menu File')).not.toBeInTheDocument();
                    });
                }
            }
        });

        it('should use default value when input is empty', async () => {
            render(<Inputs restaurantData={mockRestaurant} onRefresh={mockOnRefresh} />);

            const offersButton = screen.getByText('Upcoming Offers').closest('button');
            fireEvent.click(offersButton!);

            const submitButton = screen.getByRole('button', { name: /Add Offer/i });
            fireEvent.click(submitButton);

            await waitFor(() => {
                expect(restaurantAPI.updateOffers).toHaveBeenCalledWith('r1', 'ADD', 'New Offer');
            });
        });

        it('should handle API error when adding offer', async () => {
            vi.mocked(restaurantAPI.updateOffers).mockRejectedValueOnce(new Error('API Error'));
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

            render(<Inputs restaurantData={mockRestaurant} onRefresh={mockOnRefresh} />);

            const offersButton = screen.getByText('Upcoming Offers').closest('button');
            fireEvent.click(offersButton!);

            const submitButton = screen.getByRole('button', { name: /Add Offer/i });
            fireEvent.click(submitButton);

            await waitFor(() => {
                expect(consoleSpy).toHaveBeenCalledWith('Failed to update:', expect.any(Error));
                expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
            });

            consoleSpy.mockRestore();
        });
    });

    describe('Delete Functionality', () => {
        it('should show confirm dialog when delete button is clicked', () => {
            render(<Inputs restaurantData={mockRestaurant} onRefresh={mockOnRefresh} />);

            const offerDeleteButton = screen.getByRole('button', { name: 'Delete offer 1' });
            fireEvent.click(offerDeleteButton!);

            expect(screen.getByText('Remove this item?')).toBeInTheDocument();
            expect(screen.getByText('This will remove it immediately.')).toBeInTheDocument();
        });

        it('should delete an offer after confirming', async () => {
            render(<Inputs restaurantData={mockRestaurant} onRefresh={mockOnRefresh} />);

            const offerDeleteButton = screen.getByRole('button', { name: 'Delete offer 1' });
            fireEvent.click(offerDeleteButton!);

            const confirmButton = screen.getByRole('button', { name: 'Remove' });
            fireEvent.click(confirmButton);

            await waitFor(() => {
                expect(restaurantAPI.updateOffers).toHaveBeenCalledWith('r1', 'DELETE', 0);
                expect(mockOnRefresh).toHaveBeenCalled();
            });
        });

        it('should cancel delete when cancel is clicked', () => {
            render(<Inputs restaurantData={mockRestaurant} onRefresh={mockOnRefresh} />);

            const offerDeleteButton = screen.getByRole('button', { name: 'Delete offer 1' });
            fireEvent.click(offerDeleteButton!);

            const cancelButton = screen.getByRole('button', { name: 'Cancel' });
            fireEvent.click(cancelButton);

            expect(screen.queryByText('Remove this item?')).not.toBeInTheDocument();
            expect(restaurantAPI.updateOffers).not.toHaveBeenCalled();
        });

        it('should delete a special after confirming', async () => {
            render(<Inputs restaurantData={mockRestaurant} onRefresh={mockOnRefresh} />);

            const specialDeleteButton = screen.getByRole('button', { name: 'Delete special 1' });
            fireEvent.click(specialDeleteButton!);

            const confirmButton = screen.getByRole('button', { name: 'Remove' });
            fireEvent.click(confirmButton);

            await waitFor(() => {
                expect(restaurantAPI.updateSpecials).toHaveBeenCalledWith('r1', 'DELETE', 0);
                expect(mockOnRefresh).toHaveBeenCalled();
            });
        });

        it('should close modal when backdrop is clicked', async () => {
            render(<Inputs restaurantData={mockRestaurant} onRefresh={mockOnRefresh} />);

            // Open offers modal
            const offersButton = screen.getByText('Upcoming Offers').closest('button');
            fireEvent.click(offersButton!);
            expect(screen.getByText('Add New Offer')).toBeInTheDocument();

            // Click the backdrop (absolute inset-0 div)
            const backdrop = document.querySelector('.fixed.inset-0 .absolute.inset-0') as HTMLElement;
            fireEvent.click(backdrop);

            // Backdrop click closes the modal directly via onClose
            expect(screen.queryByText('Add New Offer')).not.toBeInTheDocument();
        });

        it('should close modal via popstate (covers closeModal)', async () => {
            render(<Inputs restaurantData={mockRestaurant} onRefresh={mockOnRefresh} />);

            // Open offers modal
            const offersButton = screen.getByText('Upcoming Offers').closest('button');
            fireEvent.click(offersButton!);
            expect(screen.getByText('Add New Offer')).toBeInTheDocument();

            // Fire popstate (simulates back button navigation) — calls onClose=closeModal
            fireEvent(window, new PopStateEvent('popstate', {}));

            await waitFor(() => {
                expect(screen.queryByText('Add New Offer')).not.toBeInTheDocument();
            });
        });

        it('should select file in menu modal (covers onChange handler)', async () => {
            render(<Inputs restaurantData={mockRestaurant} onRefresh={mockOnRefresh} />);

            // Open menu modal
            const menuButton = screen.getAllByText('Update Menu')[0].closest('button')!;
            fireEvent.click(menuButton);

            await waitFor(() => expect(screen.getByText('Upload Menu File')).toBeInTheDocument());

            // Simulate file selection
            const fileInput = screen.getByLabelText('Upload Menu File');
            const testFile = new File(['menu content'], 'menu.pdf', { type: 'application/pdf' });
            Object.defineProperty(fileInput, 'files', { value: [testFile] });
            fireEvent.change(fileInput);

            await waitFor(() => {
                expect(screen.getByText('menu.pdf')).toBeInTheDocument();
            });
        });

        it('should handle delete error gracefully', async () => {
            vi.mocked(restaurantAPI.updateOffers).mockRejectedValueOnce(new Error('Delete failed'));
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

            render(<Inputs restaurantData={mockRestaurant} onRefresh={mockOnRefresh} />);

            const offerDeleteButton = screen.getByRole('button', { name: 'Delete offer 1' });
            fireEvent.click(offerDeleteButton!);

            const confirmButton = screen.getByRole('button', { name: 'Remove' });
            fireEvent.click(confirmButton);

            await waitFor(() => {
                expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
            });

            consoleSpy.mockRestore();
        });
    });
});
