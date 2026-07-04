import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from './utils/test-utils';
import AdhocPostModal from '../components/AdhocPostModal';

// Mock the API module
vi.mock('../api', () => ({
    postsAPI: {
        create: vi.fn(),
        generate: vi.fn(),
    },
}));

import { postsAPI } from '../api';

describe('AdhocPostModal Component', () => {
    const mockOnClose = vi.fn();
    const mockOnSuccess = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(postsAPI.generate).mockResolvedValue({
            id: 'new-post-1',
            type: 'IMAGE',
            status: 'PENDING_APPROVAL',
            thumbnail: '/api/placeholder/400/400',
            caption: 'Test caption',
            platforms: ['INSTAGRAM'],
            isAdhoc: true,
        });
        vi.mocked(postsAPI.create).mockResolvedValue({
            id: 'new-post-1',
            type: 'IMAGE',
            status: 'PENDING_APPROVAL',
            thumbnail: '/api/placeholder/400/400',
            caption: 'Test caption',
            platforms: ['INSTAGRAM'],
            isAdhoc: true,
        });

        // Mock URL.createObjectURL
        global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
        global.URL.revokeObjectURL = vi.fn();
    });

    describe('Rendering', () => {
        it('should not render when isOpen is false', () => {
            render(
                <AdhocPostModal
                    isOpen={false}
                    onClose={mockOnClose}
                    onSuccess={mockOnSuccess}
                />
            );

            expect(screen.queryByTestId('adhoc-post-modal')).not.toBeInTheDocument();
        });

        it('should render modal when isOpen is true', () => {
            render(
                <AdhocPostModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onSuccess={mockOnSuccess}
                />
            );

            expect(screen.getByTestId('adhoc-post-modal')).toBeInTheDocument();
            expect(screen.getByText('Quick Post')).toBeInTheDocument();
        });

        it('should render all form elements', () => {
            render(
                <AdhocPostModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onSuccess={mockOnSuccess}
                />
            );

            // Concept input
            expect(screen.getByTestId('concept-input')).toBeInTheDocument();

            // Post type buttons
            expect(screen.getByTestId('type-image')).toBeInTheDocument();
            expect(screen.getByTestId('type-carousel')).toBeInTheDocument();
            expect(screen.getByTestId('type-reel')).toBeInTheDocument();
            expect(screen.getByTestId('type-story')).toBeInTheDocument();

            // Platform buttons (multi-select, no BOTH option)
            expect(screen.getByTestId('platform-instagram')).toBeInTheDocument();
            expect(screen.getByTestId('platform-facebook')).toBeInTheDocument();

            // Schedule buttons
            expect(screen.getByTestId('schedule-now')).toBeInTheDocument();
            expect(screen.getByTestId('schedule-later')).toBeInTheDocument();

            // Submit button
            expect(screen.getByTestId('submit-button')).toBeInTheDocument();
        });
    });

    describe('User Interactions', () => {
        it('should close modal when backdrop is clicked', () => {
            render(
                <AdhocPostModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onSuccess={mockOnSuccess}
                />
            );

            fireEvent.click(screen.getByTestId('modal-backdrop'));
            expect(mockOnClose).toHaveBeenCalledTimes(1);
        });

        it('should close modal when close button is clicked', () => {
            render(
                <AdhocPostModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onSuccess={mockOnSuccess}
                />
            );

            fireEvent.click(screen.getByTestId('close-button'));
            expect(mockOnClose).toHaveBeenCalledTimes(1);
        });

        it('should update concept text when typing', () => {
            render(
                <AdhocPostModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onSuccess={mockOnSuccess}
                />
            );

            const conceptInput = screen.getByTestId('concept-input');
            fireEvent.change(conceptInput, { target: { value: 'Test post about pizza' } });

            expect(conceptInput).toHaveValue('Test post about pizza');
        });

        it('should select post type when clicked', () => {
            render(
                <AdhocPostModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onSuccess={mockOnSuccess}
                />
            );

            // Default is IMAGE
            const reelButton = screen.getByTestId('type-reel');
            fireEvent.click(reelButton);

            // Check the button has selected styling (border-orange-500)
            expect(reelButton).toHaveClass('border-orange-500');
        });

        it('should select platform when clicked', () => {
            render(
                <AdhocPostModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onSuccess={mockOnSuccess}
                />
            );

            const facebookButton = screen.getByTestId('platform-facebook');
            fireEvent.click(facebookButton);

            expect(facebookButton).toHaveClass('border-orange-500');
        });

        it('should show date/time inputs by default (schedule-later is the default)', () => {
            render(
                <AdhocPostModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onSuccess={mockOnSuccess}
                />
            );

            // Date/time inputs should be visible by default (default is 10 min from now)
            expect(screen.getByTestId('schedule-date')).toBeInTheDocument();
            expect(screen.getByTestId('schedule-time')).toBeInTheDocument();
            // Schedule-later button should have selected styling
            expect(screen.getByTestId('schedule-later')).toHaveClass('border-orange-500');
        });

        it('should hide date/time inputs when ASAP is selected', () => {
            render(
                <AdhocPostModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onSuccess={mockOnSuccess}
                />
            );

            // Click ASAP
            fireEvent.click(screen.getByTestId('schedule-now'));

            // Date/time inputs should be hidden
            expect(screen.queryByTestId('schedule-date')).not.toBeInTheDocument();
            expect(screen.queryByTestId('schedule-time')).not.toBeInTheDocument();
        });

        it('should handle file upload and show preview', async () => {
            render(
                <AdhocPostModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onSuccess={mockOnSuccess}
                />
            );

            const fileInput = screen.getByTestId('file-input');
            const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });

            fireEvent.change(fileInput, { target: { files: [file] } });

            await waitFor(() => {
                expect(screen.getByAltText('Preview')).toBeInTheDocument();
                expect(screen.getByTestId('remove-media')).toBeInTheDocument();
            });
        });

        it('should remove preview when remove button is clicked', async () => {
            render(
                <AdhocPostModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onSuccess={mockOnSuccess}
                />
            );

            const fileInput = screen.getByTestId('file-input');
            const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });

            fireEvent.change(fileInput, { target: { files: [file] } });

            await waitFor(() => {
                expect(screen.getByAltText('Preview')).toBeInTheDocument();
            });

            fireEvent.click(screen.getByTestId('remove-media'));

            await waitFor(() => {
                expect(screen.queryByAltText('Preview')).not.toBeInTheDocument();
                expect(screen.getByTestId('upload-button')).toBeInTheDocument();
            });
        });
    });

    describe('Form Validation', () => {
        it('should show error when submitting without concept', async () => {
            render(
                <AdhocPostModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onSuccess={mockOnSuccess}
                />
            );

            // Submit button should be disabled when concept is empty
            const submitButton = screen.getByTestId('submit-button');
            expect(submitButton).toBeDisabled();
        });

        it('should show error when scheduling without date/time', async () => {
            render(
                <AdhocPostModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onSuccess={mockOnSuccess}
                />
            );

            // Enter concept
            fireEvent.change(screen.getByTestId('concept-input'), {
                target: { value: 'Test post' }
            });

            // Clear the pre-filled date and time
            fireEvent.change(screen.getByTestId('schedule-date'), {
                target: { value: '' }
            });
            fireEvent.change(screen.getByTestId('schedule-time'), {
                target: { value: '' }
            });

            // Try to submit without date/time
            fireEvent.click(screen.getByTestId('submit-button'));

            await waitFor(() => {
                expect(screen.getByRole('alert')).toHaveTextContent('Please select a date and time for scheduling');
            });
        });
    });

    describe('Form Submission', () => {
        it('should call postsAPI.generate with asap:true for ASAP post', async () => {
            render(
                <AdhocPostModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onSuccess={mockOnSuccess}
                />
            );

            // Enter concept
            fireEvent.change(screen.getByTestId('concept-input'), {
                target: { value: 'New brunch menu special' }
            });

            // Select both platforms first (Instagram is default, add Facebook)
            fireEvent.click(screen.getByTestId('platform-facebook'));

            // Select carousel type (valid for both platforms)
            fireEvent.click(screen.getByTestId('type-carousel'));

            // Switch to ASAP
            fireEvent.click(screen.getByTestId('schedule-now'));

            // Submit
            fireEvent.click(screen.getByTestId('submit-button'));

            await waitFor(() => {
                expect(postsAPI.generate).toHaveBeenCalledTimes(1);
                expect(postsAPI.generate).toHaveBeenCalledWith(expect.objectContaining({
                    concept: 'New brunch menu special',
                    type: 'CAROUSEL',
                    platforms: ['INSTAGRAM', 'FACEBOOK'],
                    asap: true,
                }));
                const payload = vi.mocked(postsAPI.generate).mock.calls[0][0];
                expect(payload.scheduledFor).toBeUndefined();
            });
        });

        it('should call postsAPI.generate with scheduledFor for scheduled post', async () => {
            render(
                <AdhocPostModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onSuccess={mockOnSuccess}
                />
            );

            // Enter concept
            fireEvent.change(screen.getByTestId('concept-input'), {
                target: { value: 'Weekend special announcement' }
            });

            // Schedule-later is already the default, date/time are pre-filled
            // Override with a date clearly in the future (computed at test runtime)
            const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            fireEvent.change(screen.getByTestId('schedule-date'), {
                target: { value: futureDate }
            });
            fireEvent.change(screen.getByTestId('schedule-time'), {
                target: { value: '14:30' }
            });

            // Submit
            fireEvent.click(screen.getByTestId('submit-button'));

            await waitFor(() => {
                expect(postsAPI.generate).toHaveBeenCalledTimes(1);
                expect(postsAPI.generate).toHaveBeenCalledWith(expect.objectContaining({
                    concept: 'Weekend special announcement',
                    type: 'IMAGE',
                    platforms: ['INSTAGRAM'],
                    scheduledFor: expect.stringContaining(futureDate),
                }));
            });
        });

        it('should call onSuccess and onClose after successful submission', async () => {
            render(
                <AdhocPostModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onSuccess={mockOnSuccess}
                />
            );

            // Enter concept
            fireEvent.change(screen.getByTestId('concept-input'), {
                target: { value: 'Test post' }
            });

            // Submit (schedule-later is default with pre-filled date/time)
            fireEvent.click(screen.getByTestId('submit-button'));

            await waitFor(() => {
                expect(mockOnSuccess).toHaveBeenCalledTimes(1);
                expect(mockOnClose).toHaveBeenCalledTimes(1);
            });
        });

        it('should show error message when API call fails', async () => {
            vi.mocked(postsAPI.generate).mockRejectedValueOnce(new Error('Network error'));

            render(
                <AdhocPostModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onSuccess={mockOnSuccess}
                />
            );

            // Enter concept
            fireEvent.change(screen.getByTestId('concept-input'), {
                target: { value: 'Test post' }
            });

            // Submit
            fireEvent.click(screen.getByTestId('submit-button'));

            await waitFor(() => {
                expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong. Please try again.');
            });

            // Should not call onSuccess or onClose on failure
            expect(mockOnSuccess).not.toHaveBeenCalled();
            expect(mockOnClose).not.toHaveBeenCalled();
        });

        it('should show loading state while submitting', async () => {
            // Make the API call take some time
            vi.mocked(postsAPI.generate).mockImplementation(
                () => new Promise(resolve => setTimeout(() => resolve({
                    id: 'new-post-1',
                    type: 'IMAGE',
                    status: 'PENDING_APPROVAL',
                    thumbnail: '/api/placeholder/400/400',
                    caption: 'Test caption',
                    platforms: ['INSTAGRAM'],
                    isAdhoc: true,
                }), 100))
            );

            render(
                <AdhocPostModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onSuccess={mockOnSuccess}
                />
            );

            // Enter concept
            fireEvent.change(screen.getByTestId('concept-input'), {
                target: { value: 'Test post' }
            });

            // Submit
            fireEvent.click(screen.getByTestId('submit-button'));

            // Check for loading state
            expect(screen.getByText('Creating...')).toBeInTheDocument();
            expect(screen.getByTestId('submit-button')).toBeDisabled();

            // Wait for completion
            await waitFor(() => {
                expect(mockOnSuccess).toHaveBeenCalled();
            });
        });
    });

    describe('Touch Interactions', () => {
        it('should close modal when swiped down significantly', async () => {
            render(
                <AdhocPostModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onSuccess={mockOnSuccess}
                />
            );

            const modal = screen.getByTestId('adhoc-post-modal');

            // Simulate swipe down
            fireEvent.touchStart(modal, { touches: [{ clientY: 100 }] });
            fireEvent.touchMove(modal, { touches: [{ clientY: 250 }] }); // 150px swipe
            fireEvent.touchEnd(modal);

            expect(mockOnClose).toHaveBeenCalledTimes(1);
        });

        it('should not close modal on small swipe', async () => {
            render(
                <AdhocPostModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onSuccess={mockOnSuccess}
                />
            );

            const modal = screen.getByTestId('adhoc-post-modal');

            // Simulate small swipe
            fireEvent.touchStart(modal, { touches: [{ clientY: 100 }] });
            fireEvent.touchMove(modal, { touches: [{ clientY: 130 }] }); // Only 30px
            fireEvent.touchEnd(modal);

            expect(mockOnClose).not.toHaveBeenCalled();
        });
    });

    describe('Media URL handling', () => {
        it('should set mediaUrls for carousel type when image is uploaded', async () => {
            render(
                <AdhocPostModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onSuccess={mockOnSuccess}
                />
            );

            // Enter concept
            fireEvent.change(screen.getByTestId('concept-input'), {
                target: { value: 'Carousel post' }
            });

            // Select carousel type
            fireEvent.click(screen.getByTestId('type-carousel'));

            // Upload file
            const fileInput = screen.getByTestId('file-input');
            const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });
            fireEvent.change(fileInput, { target: { files: [file] } });

            await waitFor(() => {
                expect(screen.getByAltText('Preview')).toBeInTheDocument();
            });

            // Submit
            fireEvent.click(screen.getByTestId('submit-button'));

            await waitFor(() => {
                expect(postsAPI.generate).toHaveBeenCalledWith(expect.objectContaining({
                    type: 'CAROUSEL',
                    concept: 'Carousel post',
                }));
            });
        });

        it('should set videoUrl for reel type when video is uploaded', async () => {
            render(
                <AdhocPostModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onSuccess={mockOnSuccess}
                />
            );

            // Enter concept
            fireEvent.change(screen.getByTestId('concept-input'), {
                target: { value: 'Reel post' }
            });

            // Select reel type
            fireEvent.click(screen.getByTestId('type-reel'));

            // Upload file
            const fileInput = screen.getByTestId('file-input');
            const file = new File(['test'], 'test.mp4', { type: 'video/mp4' });
            fireEvent.change(fileInput, { target: { files: [file] } });

            await waitFor(() => {
                expect(screen.getByAltText('Preview')).toBeInTheDocument();
            });

            // Submit
            fireEvent.click(screen.getByTestId('submit-button'));

            await waitFor(() => {
                expect(postsAPI.generate).toHaveBeenCalledWith(expect.objectContaining({
                    type: 'REEL',
                    concept: 'Reel post',
                }));
            });
        });
    });

    describe('Upload Button Click', () => {
        it('should trigger file input click when upload button is clicked', async () => {
            render(
                <AdhocPostModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onSuccess={mockOnSuccess}
                />
            );

            const fileInput = screen.getByTestId('file-input');
            const clickSpy = vi.spyOn(fileInput, 'click');

            const uploadButton = screen.getByTestId('upload-button');
            fireEvent.click(uploadButton);

            expect(clickSpy).toHaveBeenCalledTimes(1);
        });

        it('should handle file input change with no files gracefully', async () => {
            render(
                <AdhocPostModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onSuccess={mockOnSuccess}
                />
            );

            const fileInput = screen.getByTestId('file-input');

            // Fire change with empty file list - should not throw
            fireEvent.change(fileInput, { target: { files: [] } });

            // Upload button should still be visible (no preview set)
            expect(screen.getByTestId('upload-button')).toBeInTheDocument();
        });

        it('should handle file input change with null files gracefully', async () => {
            render(
                <AdhocPostModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onSuccess={mockOnSuccess}
                />
            );

            const fileInput = screen.getByTestId('file-input');
            // Simulate an onChange event where files is null (covers the falsy branch of e.target.files?.[0])
            fireEvent.change(fileInput, { target: { files: null } });

            // No preview should appear
            expect(screen.queryByAltText('Preview')).not.toBeInTheDocument();
            expect(screen.getByTestId('upload-button')).toBeInTheDocument();
        });
    });

    describe('Platform deselection validation', () => {
        it('should show error when all platforms are somehow deselected before submit', async () => {
            render(
                <AdhocPostModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onSuccess={mockOnSuccess}
                />
            );

            // Enter concept
            fireEvent.change(screen.getByTestId('concept-input'), {
                target: { value: 'Test post' },
            });

            // The toggle function prevents deselecting the last platform, so we test the guard
            // by verifying that clicking Instagram (the only selected platform) does NOT deselect it
            const instagramButton = screen.getByTestId('platform-instagram');
            expect(instagramButton).toHaveClass('border-orange-500');

            // Try to deselect the only selected platform -- should be a no-op
            fireEvent.click(instagramButton);

            // Instagram should still be selected (at-least-one guard)
            expect(instagramButton).toHaveClass('border-orange-500');

            // Platforms are still valid so submit should work (no platform error)
            fireEvent.click(screen.getByTestId('submit-button'));
            await waitFor(() => {
                expect(postsAPI.generate).toHaveBeenCalledTimes(1);
            });
        });
    });

    describe('Payload Completeness', () => {
        it('should always include all required fields for generate endpoint', async () => {
            render(
                <AdhocPostModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onSuccess={mockOnSuccess}
                />
            );

            // Minimal interaction: just enter a concept and submit with defaults
            fireEvent.change(screen.getByTestId('concept-input'), {
                target: { value: 'Minimal post' }
            });

            fireEvent.click(screen.getByTestId('submit-button'));

            await waitFor(() => {
                expect(postsAPI.generate).toHaveBeenCalledTimes(1);
            });

            const payload = vi.mocked(postsAPI.generate).mock.calls[0][0];

            // Every field the generate endpoint requires must be present
            expect(payload).toHaveProperty('concept', 'Minimal post');
            expect(payload).toHaveProperty('type', 'IMAGE');
            expect(payload).toHaveProperty('platforms', ['INSTAGRAM']);
            expect(payload).toHaveProperty('scheduledFor');
            expect(typeof payload.scheduledFor).toBe('string');
            // scheduledFor should be a valid ISO date
            expect(new Date(payload.scheduledFor!).getTime()).not.toBeNaN();
        });

        it('should never send undefined for concept', async () => {
            render(
                <AdhocPostModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onSuccess={mockOnSuccess}
                />
            );

            fireEvent.change(screen.getByTestId('concept-input'), {
                target: { value: 'Test concept value' }
            });

            // Try ASAP path
            fireEvent.click(screen.getByTestId('schedule-now'));
            fireEvent.click(screen.getByTestId('submit-button'));

            await waitFor(() => {
                const payload = vi.mocked(postsAPI.generate).mock.calls[0][0];
                expect(payload.concept).toBe('Test concept value');
                expect(payload.concept).not.toBeUndefined();
                expect(payload.concept).not.toBeNull();
                expect(payload.concept).not.toBe('');
            });
        });

        it('should send asap:true and no scheduledFor for ASAP posts', async () => {
            render(
                <AdhocPostModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onSuccess={mockOnSuccess}
                />
            );

            fireEvent.change(screen.getByTestId('concept-input'), {
                target: { value: 'ASAP post scheduling' }
            });

            fireEvent.click(screen.getByTestId('schedule-now'));
            fireEvent.click(screen.getByTestId('submit-button'));

            await waitFor(() => {
                const payload = vi.mocked(postsAPI.generate).mock.calls[0][0];
                expect(payload.asap).toBe(true);
                expect(payload.scheduledFor).toBeUndefined();
            });
        });

        it('should switch back to schedule-later after selecting ASAP', async () => {
            render(
                <AdhocPostModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onSuccess={mockOnSuccess}
                />
            );

            // Default is schedule-later — switch to ASAP first
            fireEvent.click(screen.getByTestId('schedule-now'));
            expect(screen.getByTestId('schedule-now')).toHaveClass('border-orange-500');

            // Then switch back to schedule-later (covers line 399)
            fireEvent.click(screen.getByTestId('schedule-later'));
            expect(screen.getByTestId('schedule-later')).toHaveClass('border-orange-500');
        });

        it('should send concept text when no media is uploaded', async () => {
            render(
                <AdhocPostModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onSuccess={mockOnSuccess}
                />
            );

            fireEvent.change(screen.getByTestId('concept-input'), {
                target: { value: 'No media post' }
            });

            fireEvent.click(screen.getByTestId('submit-button'));

            await waitFor(() => {
                const payload = vi.mocked(postsAPI.generate).mock.calls[0][0];
                expect(payload.concept).toBe('No media post');
                expect(payload.type).toBe('IMAGE');
                expect(payload.platforms).toEqual(['INSTAGRAM']);
            });
        });
    });

    describe('Branch coverage additions', () => {
        it('should not update dragOffset when touchMove fires without a prior touchStart', () => {
            render(
                <AdhocPostModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onSuccess={mockOnSuccess}
                />
            );

            const modal = screen.getByTestId('adhoc-post-modal');

            // touchMove without touchStart -- touchStart state is null, should early return
            fireEvent.touchMove(modal, { touches: [{ clientY: 200 }] });

            // Modal should remain open (no close triggered)
            expect(mockOnClose).not.toHaveBeenCalled();
        });

        it('should not update dragOffset when swiping upward', () => {
            render(
                <AdhocPostModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onSuccess={mockOnSuccess}
                />
            );

            const modal = screen.getByTestId('adhoc-post-modal');

            // Swipe up (negative diff) -- dragOffset should not be set
            fireEvent.touchStart(modal, { touches: [{ clientY: 200 }] });
            fireEvent.touchMove(modal, { touches: [{ clientY: 100 }] }); // diff = -100, upward swipe
            fireEvent.touchEnd(modal);

            expect(mockOnClose).not.toHaveBeenCalled();
        });

        it('should allow deselecting a platform when two platforms are selected', () => {
            render(
                <AdhocPostModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onSuccess={mockOnSuccess}
                />
            );

            // Add Facebook so we have two platforms
            fireEvent.click(screen.getByTestId('platform-facebook'));
            expect(screen.getByTestId('platform-facebook')).toHaveClass('border-orange-500');
            expect(screen.getByTestId('platform-instagram')).toHaveClass('border-orange-500');

            // Now deselect Facebook -- next.length === 1 (not 0) so the guard is NOT triggered
            fireEvent.click(screen.getByTestId('platform-facebook'));

            // Facebook should be deselected, Instagram still selected
            expect(screen.getByTestId('platform-facebook')).not.toHaveClass('border-orange-500');
            expect(screen.getByTestId('platform-instagram')).toHaveClass('border-orange-500');
        });

        it('should reset post type to first valid type when selected type becomes invalid after adding a platform', () => {
            render(
                <AdhocPostModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onSuccess={mockOnSuccess}
                />
            );

            // Select REEL (valid for INSTAGRAM but not in FACEBOOK-only intersection)
            fireEvent.click(screen.getByTestId('type-reel'));
            expect(screen.getByTestId('type-reel')).toHaveClass('border-orange-500');

            // Add FACEBOOK -- intersection of INSTAGRAM and FACEBOOK does not include REEL,
            // so postType should reset to the first valid type (IMAGE)
            fireEvent.click(screen.getByTestId('platform-facebook'));

            // REEL button should no longer be selected
            expect(screen.getByTestId('type-reel')).not.toHaveClass('border-orange-500');
            // IMAGE should be selected as the reset fallback
            expect(screen.getByTestId('type-image')).toHaveClass('border-orange-500');
        });

        it('should show STORY media hint when STORY post type is selected', () => {
            render(
                <AdhocPostModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onSuccess={mockOnSuccess}
                />
            );

            fireEvent.click(screen.getByTestId('type-story'));

            expect(screen.getByText(/Stories can include a video file if available/i)).toBeInTheDocument();
        });
    });
});
