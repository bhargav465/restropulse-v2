import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from './utils/test-utils';
import Onboarding, { resetEmailVerificationState } from '../components/Onboarding';
import { restaurantAPI, accountManagerAPI, citiesAPI, authAPI } from '../api';
import { sendEmailVerificationLink, completeEmailVerification, isEmailSignInLink, getStoredVerificationEmail } from '../firebase';

// Mock API modules
vi.mock('../api', () => ({
    restaurantAPI: {
        create: vi.fn(),
    },
    accountManagerAPI: {
        getByCityAndZone: vi.fn(),
    },
    citiesAPI: {
        getAll: vi.fn(),
    },
    authAPI: {
        verifyEmail: vi.fn(),
    },
}));

// Mock Firebase email verification helpers
vi.mock('../firebase', () => ({
    sendEmailVerificationLink: vi.fn(),
    completeEmailVerification: vi.fn(),
    isEmailSignInLink: vi.fn(() => false),
    getStoredVerificationEmail: vi.fn(() => null),
}));

// Mock @vis.gl/react-google-maps -- render children directly without real Maps
vi.mock('@vis.gl/react-google-maps', () => ({
    APIProvider: ({ children }: any) => <div data-testid="api-provider">{children}</div>,
    Map: ({ children }: any) => <div data-testid="google-map">{children}</div>,
    AdvancedMarker: () => <div data-testid="marker" />,
    useMapsLibrary: () => ({}),
}));

// Ensure Google Maps API key is unset so fallback manual input renders
vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '');

const mockOnComplete = vi.fn();

/**
 * Set up firebase mocks so the component treats the current URL as a returning
 * magic-link verification and immediately enters 'verified' state.
 * Must be called BEFORE render().
 */
const mockEmailVerified = (email = 'john@test.com') => {
    (isEmailSignInLink as ReturnType<typeof vi.fn>).mockReturnValue(true);
    // After the B5 fix, completeEmailVerification returns the verified email AND the
    // Firebase ID token so the backend can independently verify ownership.
    (completeEmailVerification as ReturnType<typeof vi.fn>).mockResolvedValue({
        email,
        idToken: 'mock-firebase-id-token',
    });
};

const mockCitiesResponse = [
    { id: 'city-bangalore', name: 'Bangalore', defaultZone: 'HQ' },
    { id: 'city-delhi', name: 'Delhi', defaultZone: 'HQ' },
    { id: 'city-hyderabad', name: 'Hyderabad', defaultZone: 'HQ' },
    { id: 'city-mumbai', name: 'Mumbai', defaultZone: 'HQ' },
];

const mockManagersResponse = [
    { id: 'am1', name: 'Manager Alpha', phone: '+91 11111', email: 'a@test.com', avatar: 'https://example.com/a.jpg', city: 'Bangalore', zone: 'Indiranagar' },
    { id: 'am2', name: 'Manager Beta', phone: '+91 22222', email: 'b@test.com', avatar: 'https://example.com/b.jpg', city: 'Bangalore', zone: 'Koramangala' },
];

const mockCreateResponse = {
    restaurant: {
        id: 'r-new',
        name: 'Test Restaurant',
        cuisine: 'Italian',
        location: { address: '1 Main St', lat: 12.97, lng: 77.59, mapUrl: '' },
        accountManager: { name: '', phone: '', email: '', avatar: '' },
        integrations: { instagram: false },
    },
    token: 'new-access-token',
    refreshToken: 'new-refresh-token',
};

/**
 * Fill step 1 (About You) with valid data and click Next.
 * Requires mockEmailVerified() to have been called before render().
 * Clicks the "Confirm verification" button that appears when returning from a magic link.
 */
const completeStep1 = async () => {
    fireEvent.change(screen.getByPlaceholderText(/Arjun Mehta/i), { target: { value: 'John' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /Confirm email verification/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Confirm email verification/i }));
    await waitFor(() => expect(screen.getByText(/Email verified/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));
    await waitFor(() => expect(screen.getByRole('heading', { name: /Your Restaurant/i })).toBeInTheDocument());
};

/** Fill step 2 (Your Restaurant, fallback) and click Next */
const completeStep2 = async () => {
    // Wait for cities to populate from API
    await waitFor(() => {
        expect(screen.getByText('Select city')).toBeInTheDocument();
    });
    // Open city dropdown
    fireEvent.click(screen.getByText('Select city'));

    // Select city from options
    await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Bangalore' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Bangalore' }));

    // Fill restaurant name and cuisine
    fireEvent.change(screen.getByPlaceholderText(/The Spice Lounge/i), { target: { value: 'My Restaurant' } });
    fireEvent.change(screen.getByPlaceholderText(/Modern Indian Fusion/i), { target: { value: 'Italian' } });
    // Fill address (fallback mode)
    fireEvent.change(screen.getByPlaceholderText(/Indiranagar, Bangalore/i), { target: { value: '1 Main St' } });
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));
    await waitFor(() => expect(screen.getByRole('heading', { name: /Account Manager/i })).toBeInTheDocument());
};


describe('Onboarding Component', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetEmailVerificationState();
        (localStorage.getItem as any).mockReturnValue(null);
        (citiesAPI.getAll as any).mockResolvedValue(mockCitiesResponse);
        (accountManagerAPI.getByCityAndZone as any).mockResolvedValue([]);
        (authAPI.verifyEmail as any).mockResolvedValue(undefined);
        // Default: not returning from a magic link
        (isEmailSignInLink as ReturnType<typeof vi.fn>).mockReturnValue(false);
        (completeEmailVerification as ReturnType<typeof vi.fn>).mockResolvedValue(null);
        (sendEmailVerificationLink as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '');
    });

    // --- Step 1: About You (name + email) ---

    it('should render step 1 with name and email fields', () => {
        render(<Onboarding onComplete={mockOnComplete} />);

        expect(screen.getByText(/Welcome to RestroPulse/i)).toBeInTheDocument();
        expect(screen.getByPlaceholderText(/Arjun Mehta/i)).toBeInTheDocument();
        expect(screen.getByPlaceholderText(/arjun@example\.com/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Verify/i })).toBeInTheDocument();
    });

    it('should disable Next button when fields are incomplete', () => {
        render(<Onboarding onComplete={mockOnComplete} />);

        const nextBtn = screen.getByRole('button', { name: /Next/i });
        expect(nextBtn).toBeDisabled();

        // Only name filled
        fireEvent.change(screen.getByPlaceholderText(/Arjun Mehta/i), { target: { value: 'John' } });
        expect(nextBtn).toBeDisabled();

        // Name + valid email format, but email NOT verified — still disabled
        fireEvent.change(screen.getByPlaceholderText(/arjun@example\.com/i), { target: { value: 'john@test.com' } });
        expect(nextBtn).toBeDisabled();
    });

    it('should enable Next button with valid name and verified email', async () => {
        mockEmailVerified();
        render(<Onboarding onComplete={mockOnComplete} />);

        fireEvent.change(screen.getByPlaceholderText(/Arjun Mehta/i), { target: { value: 'John Doe' } });
        await waitFor(() => expect(screen.getByRole('button', { name: /Confirm email verification/i })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Confirm email verification/i }));
        await waitFor(() => expect(screen.getByText(/Email verified/i)).toBeInTheDocument());
        expect(screen.getByRole('button', { name: /Next/i })).not.toBeDisabled();
    });

    // --- Step Navigation ---

    it('should navigate from step 1 to step 2 (Your Restaurant)', async () => {
        mockEmailVerified();
        render(<Onboarding onComplete={mockOnComplete} />);
        await completeStep1();

        expect(screen.getByRole('heading', { name: /Your Restaurant/i })).toBeInTheDocument();
    });

    it('should navigate back from step 2 to step 1', async () => {
        mockEmailVerified();
        render(<Onboarding onComplete={mockOnComplete} />);
        await completeStep1();

        fireEvent.click(screen.getByRole('button', { name: /Back/i }));

        await waitFor(() => {
            expect(screen.getByText(/Welcome to RestroPulse/i)).toBeInTheDocument();
        });
    });

    it('should not show Back button on step 1', () => {
        render(<Onboarding onComplete={mockOnComplete} />);
        expect(screen.queryByRole('button', { name: /Back/i })).not.toBeInTheDocument();
    });

    // --- Step 2: Your Restaurant (city + name + cuisine + address) ---

    it('should show city dropdown, restaurant fields, and manual address input on step 2', async () => {
        mockEmailVerified();
        render(<Onboarding onComplete={mockOnComplete} />);
        await completeStep1();

        expect(screen.getByText('Select city')).toBeInTheDocument(); // city select
        expect(screen.getByPlaceholderText(/The Spice Lounge/i)).toBeInTheDocument();
        expect(screen.getByPlaceholderText(/Modern Indian Fusion/i)).toBeInTheDocument();
        expect(screen.getByPlaceholderText(/Indiranagar, Bangalore/i)).toBeInTheDocument();
        expect(screen.getByText(/Google Maps API key not configured/i)).toBeInTheDocument();

        fireEvent.click(screen.getByText('Select city'));
        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Bangalore' })).toBeInTheDocument();
        });
        fireEvent.click(screen.getByRole('button', { name: 'Bangalore' }));

        await waitFor(() => {
            expect(accountManagerAPI.getByCityAndZone).toHaveBeenCalledWith('Bangalore', undefined);
        });
    });

    it('should disable Next on step 2 until all fields are filled', async () => {
        mockEmailVerified();
        render(<Onboarding onComplete={mockOnComplete} />);
        await completeStep1();

        expect(screen.getByText('Select city')).toBeInTheDocument();

        fireEvent.click(screen.getByText('Select city'));
        const bangaloreOption = screen.getByRole('button', { name: 'Bangalore' });
        fireEvent.click(bangaloreOption);

        const nextBtn = screen.getByRole('button', { name: /Next/i });
        expect(nextBtn).toBeDisabled();

        // City + restaurant name
        fireEvent.change(screen.getByPlaceholderText(/The Spice Lounge/i), { target: { value: 'My Rest' } });
        expect(nextBtn).toBeDisabled();

        // City + restaurant name + cuisine (no address yet)
        fireEvent.change(screen.getByPlaceholderText(/Modern Indian Fusion/i), { target: { value: 'Italian' } });
        expect(nextBtn).toBeDisabled();

        // All filled
        fireEvent.change(screen.getByPlaceholderText(/Indiranagar, Bangalore/i), { target: { value: '1 Main St' } });
        await waitFor(() => expect(nextBtn).not.toBeDisabled());
    });

    // --- Step 3: Account Manager ---

    it('should show city label and fetch managers on step 3', async () => {
        (accountManagerAPI.getByCityAndZone as any).mockResolvedValue(mockManagersResponse);

        mockEmailVerified();
        render(<Onboarding onComplete={mockOnComplete} />);
        await completeStep1();
        await completeStep2();

        // City label should be visible (read-only)
        expect(screen.getByText(/Showing managers in/i)).toBeInTheDocument();
        expect(screen.getByText('Bangalore')).toBeInTheDocument();

        await waitFor(() => {
            expect(accountManagerAPI.getByCityAndZone).toHaveBeenCalledWith('Bangalore', undefined);
        });
    });

    it('should show manager cards on step 3', async () => {
        (accountManagerAPI.getByCityAndZone as any).mockResolvedValue(mockManagersResponse);

        mockEmailVerified();
        render(<Onboarding onComplete={mockOnComplete} />);
        await completeStep1();
        await completeStep2();

        await waitFor(() => {
            expect(screen.getByText('Manager Alpha')).toBeInTheDocument();
            expect(screen.getByText('Manager Beta')).toBeInTheDocument();
        });
    });

    it('should show "no managers" message when none found', async () => {
        (accountManagerAPI.getByCityAndZone as any).mockResolvedValue([]);

        mockEmailVerified();
        render(<Onboarding onComplete={mockOnComplete} />);
        await completeStep1();
        await completeStep2();

        await waitFor(() => {
            expect(screen.getByText(/No account managers available/i)).toBeInTheDocument();
        });
    });

    it('should disable Get Started when no manager is selected', async () => {
        (accountManagerAPI.getByCityAndZone as any).mockResolvedValue(mockManagersResponse);

        mockEmailVerified();
        render(<Onboarding onComplete={mockOnComplete} />);
        await completeStep1();
        await completeStep2();

        await waitFor(() => expect(screen.getByText('Manager Alpha')).toBeInTheDocument());

        // Get Started should be disabled since no manager is selected
        expect(screen.getByRole('button', { name: /Get Started/i })).toBeDisabled();
    });

    it('should auto-select when only one manager is returned', async () => {
        const singleManager = [mockManagersResponse[0]];
        (accountManagerAPI.getByCityAndZone as any).mockResolvedValue(singleManager);

        mockEmailVerified();
        render(<Onboarding onComplete={mockOnComplete} />);
        await completeStep1();
        await completeStep2();

        // Manager should be auto-selected, so Get Started should be enabled
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /Get Started/i })).not.toBeDisabled();
        });
    });

    // --- Submission ---

    it('should submit form with email and selected manager, then call onComplete', async () => {
        (accountManagerAPI.getByCityAndZone as any).mockResolvedValue(mockManagersResponse);
        (restaurantAPI.create as any).mockResolvedValue(mockCreateResponse);

        mockEmailVerified();
        render(<Onboarding onComplete={mockOnComplete} />);

        // Step 1 - About You
        fireEvent.change(screen.getByPlaceholderText(/Arjun Mehta/i), { target: { value: 'John' } });
        await waitFor(() => expect(screen.getByRole('button', { name: /Confirm email verification/i })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Confirm email verification/i }));
        await waitFor(() => expect(screen.getByText(/Email verified/i)).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Next/i }));
        await waitFor(() => expect(screen.getByRole('heading', { name: /Your Restaurant/i })).toBeInTheDocument());

        // Step 2 - Your Restaurant
        await waitFor(() => expect(screen.getByText('Select city')).toBeInTheDocument());
        fireEvent.click(screen.getByText('Select city'));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Bangalore' })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: 'Bangalore' }));
        fireEvent.change(screen.getByPlaceholderText(/The Spice Lounge/i), { target: { value: 'Test Restaurant' } });
        fireEvent.change(screen.getByPlaceholderText(/Modern Indian Fusion/i), { target: { value: 'Italian' } });
        fireEvent.change(screen.getByPlaceholderText(/Indiranagar, Bangalore/i), { target: { value: '1 Main St' } });
        fireEvent.click(screen.getByRole('button', { name: /Next/i }));
        await waitFor(() => expect(screen.getByRole('heading', { name: /Account Manager/i })).toBeInTheDocument());

        // Step 3 -- select a manager (mandatory now)
        await waitFor(() => expect(screen.getByText('Manager Alpha')).toBeInTheDocument());
        fireEvent.click(screen.getByText('Manager Alpha'));

        fireEvent.click(screen.getByRole('button', { name: /Get Started/i }));

        await waitFor(() => {
            expect(restaurantAPI.create).toHaveBeenCalledWith({
                userName: 'John',
                email: 'john@test.com',
                name: 'Test Restaurant',
                cuisine: 'Italian',
                location: { address: '1 Main St', lat: 0, lng: 0, mapUrl: '' },
                accountManager: {
                    name: 'Manager Alpha',
                    phone: '+91 11111',
                    email: 'a@test.com',
                    avatar: 'https://example.com/a.jpg',
                },
            });
        });

        await waitFor(() => {
            expect(localStorage.setItem).toHaveBeenCalledWith('rp_token', 'new-access-token');
            expect(localStorage.setItem).toHaveBeenCalledWith('rp_refresh_token', 'new-refresh-token');
            expect(localStorage.setItem).toHaveBeenCalledWith('rp_restaurant_id', 'r-new');
            expect(mockOnComplete).toHaveBeenCalledWith(mockCreateResponse.restaurant);
        });
    });

    it('should show error message on submission failure', async () => {
        (restaurantAPI.create as any).mockRejectedValue(new Error('Server error'));
        (accountManagerAPI.getByCityAndZone as any).mockResolvedValue(mockManagersResponse);

        mockEmailVerified();
        render(<Onboarding onComplete={mockOnComplete} />);
        await completeStep1();
        await completeStep2();

        // Select a manager (mandatory)
        await waitFor(() => expect(screen.getByText('Manager Alpha')).toBeInTheDocument());
        fireEvent.click(screen.getByText('Manager Alpha'));

        fireEvent.click(screen.getByRole('button', { name: /Get Started/i }));

        await waitFor(() => {
            expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
        });

        expect(mockOnComplete).not.toHaveBeenCalled();
    });

    it('should show loading state during submission', async () => {
        // Make create hang
        (restaurantAPI.create as any).mockImplementation(() => new Promise(() => { }));
        (accountManagerAPI.getByCityAndZone as any).mockResolvedValue(mockManagersResponse);

        mockEmailVerified();
        render(<Onboarding onComplete={mockOnComplete} />);
        await completeStep1();
        await completeStep2();

        // Select a manager (mandatory)
        await waitFor(() => expect(screen.getByText('Manager Alpha')).toBeInTheDocument());
        fireEvent.click(screen.getByText('Manager Alpha'));

        fireEvent.click(screen.getByRole('button', { name: /Get Started/i }));

        await waitFor(() => {
            expect(screen.getByText(/Setting up.../i)).toBeInTheDocument();
        });
    });

    // --- Step indicator ---

    it('should render step indicator with correct labels', () => {
        render(<Onboarding onComplete={mockOnComplete} />);

        expect(screen.getByText('About You')).toBeInTheDocument();
        expect(screen.getByText('Your Restaurant')).toBeInTheDocument();
        expect(screen.getByText('Account Manager')).toBeInTheDocument();
    });

    // --- Zone selection (step 3) ---

    it('should filter managers when a zone is selected', async () => {
        // Return managers with two different zones
        (accountManagerAPI.getByCityAndZone as any).mockResolvedValue(mockManagersResponse);

        mockEmailVerified();
        render(<Onboarding onComplete={mockOnComplete} />);
        await completeStep1();
        await completeStep2();

        // Zone dropdown should be populated with zones from managers response
        await waitFor(() => {
            expect(accountManagerAPI.getByCityAndZone).toHaveBeenCalledWith('Bangalore', undefined);
        });

        // Managers have two zones: Indiranagar and Koramangala
        // Selecting a zone triggers fetchManagers with that zone
        (accountManagerAPI.getByCityAndZone as any).mockResolvedValue([mockManagersResponse[0]]);

        // Open the Zone select
        const zoneSelect = screen.getByText('All zones');
        fireEvent.click(zoneSelect);

        // Wait for the zone options to appear
        await waitFor(() => {
            expect(screen.getByText('Indiranagar')).toBeInTheDocument();
        });

        // Select "Indiranagar" zone
        fireEvent.click(screen.getByRole('button', { name: 'Indiranagar' }));

        // fetchManagers should be called with the zone
        await waitFor(() => {
            expect(accountManagerAPI.getByCityAndZone).toHaveBeenCalledWith('Bangalore', 'Indiranagar');
        });
    });

    it('should auto-select zone when only one zone exists', async () => {
        // Return managers all in the same zone so uniqueZones.length === 1
        const singleZoneManagers = [
            { ...mockManagersResponse[0], zone: 'Indiranagar' },
            { id: 'am3', name: 'Manager Gamma', phone: '+91 33333', email: 'c@test.com', avatar: '', city: 'Bangalore', zone: 'Indiranagar' },
        ];
        (accountManagerAPI.getByCityAndZone as any).mockResolvedValue(singleZoneManagers);

        mockEmailVerified();
        render(<Onboarding onComplete={mockOnComplete} />);
        await completeStep1();
        await completeStep2();

        await waitFor(() => {
            expect(screen.getByText('Manager Alpha')).toBeInTheDocument();
        });

        // With one zone, zone should be auto-selected (displayed in the CustomSelect)
        await waitFor(() => {
            expect(screen.getByText('Indiranagar')).toBeInTheDocument();
        });
    });

    // --- handlePlaceSelect with city (Google Maps path) ---

    it('should render Google Maps address input when API key is set', async () => {
        vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-api-key');

        mockEmailVerified();
        render(<Onboarding onComplete={mockOnComplete} />);
        await completeStep1();

        // With the API key set, APIProvider should be rendered
        await waitFor(() => {
            expect(screen.getByTestId('api-provider')).toBeInTheDocument();
        });

        vi.unstubAllEnvs();
    });

    // --- handlePlaceSelect with city extraction ---

    it('should set city from place select result when city is empty', async () => {
        // Mock PlacesAutocompleteInput to call onSelect with a city
        vi.mock('../components/PlacesAutocompleteInput', () => ({
            PlacesAutocompleteInput: ({ onSelect }: any) => (
                <button
                    data-testid="places-autocomplete"
                    onClick={() => onSelect({ address: '123 Main St', lat: 12.97, lng: 77.59, city: 'Bangalore' })}
                >
                    Select Address
                </button>
            ),
        }));

        vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-api-key');

        mockEmailVerified();
        render(<Onboarding onComplete={mockOnComplete} />);
        await completeStep1();

        await waitFor(() => {
            expect(screen.getByTestId('api-provider')).toBeInTheDocument();
        });

        // Click the mocked places input to trigger onSelect with city
        const placesBtn = screen.queryByTestId('places-autocomplete');
        if (placesBtn) {
            fireEvent.click(placesBtn);

            // After selecting place with city, managers should be fetched for that city
            await waitFor(() => {
                expect(accountManagerAPI.getByCityAndZone).toHaveBeenCalledWith('Bangalore', undefined);
            });
        }

        vi.unstubAllEnvs();
    });

    // --- Manager deselection (toggle) ---

    it('should deselect manager when clicking the selected manager again', async () => {
        (accountManagerAPI.getByCityAndZone as any).mockResolvedValue(mockManagersResponse);

        mockEmailVerified();
        render(<Onboarding onComplete={mockOnComplete} />);
        await completeStep1();
        await completeStep2();

        await waitFor(() => expect(screen.getByText('Manager Alpha')).toBeInTheDocument());

        // Select manager
        fireEvent.click(screen.getByText('Manager Alpha'));
        await waitFor(() => {
            // Get Started should now be enabled
            expect(screen.getByRole('button', { name: /Get Started/i })).not.toBeDisabled();
        });

        // Deselect the same manager
        fireEvent.click(screen.getByText('Manager Alpha'));

        // Get Started should be disabled again
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /Get Started/i })).toBeDisabled();
        });
    });

    // --- Cities API error ---

    it('should handle citiesAPI error gracefully', async () => {
        (citiesAPI.getAll as any).mockRejectedValue(new Error('Network error'));

        render(<Onboarding onComplete={mockOnComplete} />);

        // Should still render step 1 without crashing
        await waitFor(() => {
            expect(screen.getByText(/Welcome to RestroPulse/i)).toBeInTheDocument();
        });
    });

    // --- Manager avatar fallback ---

    it('should show avatar icon fallback when manager has no avatar', async () => {
        const managersNoAvatar = [
            { id: 'am1', name: 'No Avatar Manager', phone: '+91 11111', email: 'a@test.com', avatar: '', city: 'Bangalore', zone: 'Indiranagar' },
        ];
        (accountManagerAPI.getByCityAndZone as any).mockResolvedValue(managersNoAvatar);

        mockEmailVerified();
        render(<Onboarding onComplete={mockOnComplete} />);
        await completeStep1();
        await completeStep2();

        await waitFor(() => {
            expect(screen.getByText('No Avatar Manager')).toBeInTheDocument();
        });
        // Avatar img should not be rendered; instead the icon div
        expect(screen.queryByAltText('No Avatar Manager')).not.toBeInTheDocument();
    });

    // --- Email Verification ---

    it('should render email input and Verify button on step 1', () => {
        render(<Onboarding onComplete={mockOnComplete} />);
        expect(screen.getByPlaceholderText(/arjun@example\.com/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Verify/i })).toBeInTheDocument();
    });

    it('should send verification email on Verify click', async () => {
        render(<Onboarding onComplete={mockOnComplete} />);
        fireEvent.change(screen.getByPlaceholderText(/arjun@example\.com/i), { target: { value: 'test@email.com' } });
        fireEvent.click(screen.getByRole('button', { name: /Verify/i }));
        await waitFor(() => {
            expect(sendEmailVerificationLink).toHaveBeenCalledWith('test@email.com');
            expect(screen.getByText(/Verification email sent/i)).toBeInTheDocument();
        });
    });

    it('should show countdown instead of Resend button immediately after sending', async () => {
        render(<Onboarding onComplete={mockOnComplete} />);
        fireEvent.change(screen.getByPlaceholderText(/arjun@example\.com/i), { target: { value: 'test@email.com' } });
        fireEvent.click(screen.getByRole('button', { name: /Verify/i }));
        await waitFor(() => {
            expect(screen.getByText(/Resend in/i)).toBeInTheDocument();
            expect(screen.queryByText(/Resend verification email/i)).not.toBeInTheDocument();
        });
    });

    it('should show link_ready state when returning from magic link (before confirm)', async () => {
        mockEmailVerified('verified@email.com');
        render(<Onboarding onComplete={mockOnComplete} />);
        await waitFor(() => {
            expect(screen.getByText(/Verification link ready/i)).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /Confirm email verification/i })).toBeInTheDocument();
        });
    });

    it('should show verified state after clicking confirm on magic link return', async () => {
        mockEmailVerified('verified@email.com');
        render(<Onboarding onComplete={mockOnComplete} />);
        await waitFor(() => expect(screen.getByRole('button', { name: /Confirm email verification/i })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Confirm email verification/i }));
        await waitFor(() => {
            expect(screen.getByText(/Email verified/i)).toBeInTheDocument();
        });
    });

    it('should call authAPI.verifyEmail with the Firebase ID token after clicking confirm on magic link return', async () => {
        mockEmailVerified('verified@email.com');
        render(<Onboarding onComplete={mockOnComplete} />);
        await waitFor(() => expect(screen.getByRole('button', { name: /Confirm email verification/i })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Confirm email verification/i }));
        await waitFor(() => expect(screen.getByText(/Email verified/i)).toBeInTheDocument());
        // B5 fix: backend receives the Firebase ID token, NOT the bare email
        expect(authAPI.verifyEmail).toHaveBeenCalledWith('mock-firebase-id-token');
    });

    it('should show error when verification fails after clicking confirm', async () => {
        (isEmailSignInLink as ReturnType<typeof vi.fn>).mockReturnValue(true);
        (completeEmailVerification as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Link expired'));
        render(<Onboarding onComplete={mockOnComplete} />);
        await waitFor(() => expect(screen.getByRole('button', { name: /Confirm email verification/i })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Confirm email verification/i }));
        await waitFor(() => {
            expect(screen.getByText(/Email verification failed/i)).toBeInTheDocument();
        });
    });

    it('should prepopulate email from localStorage when returning from magic link', async () => {
        (isEmailSignInLink as ReturnType<typeof vi.fn>).mockReturnValue(true);
        (getStoredVerificationEmail as ReturnType<typeof vi.fn>).mockReturnValue('stored@email.com');
        (completeEmailVerification as ReturnType<typeof vi.fn>).mockResolvedValue('stored@email.com');
        render(<Onboarding onComplete={mockOnComplete} />);
        await waitFor(() => {
            const emailInput = screen.getByPlaceholderText(/arjun@example\.com/i) as HTMLInputElement;
            expect(emailInput.value).toBe('stored@email.com');
        });
    });

    it('should prepopulate name from localStorage when returning from magic link', async () => {
        (isEmailSignInLink as ReturnType<typeof vi.fn>).mockReturnValue(true);
        (localStorage.getItem as any).mockImplementation((key: string) =>
            key === 'rp_onboarding_name' ? 'Stored Name' : null
        );
        (completeEmailVerification as ReturnType<typeof vi.fn>).mockResolvedValue('test@email.com');
        render(<Onboarding onComplete={mockOnComplete} />);
        await waitFor(() => {
            const nameInput = screen.getByPlaceholderText(/Arjun Mehta/i) as HTMLInputElement;
            expect(nameInput.value).toBe('Stored Name');
        });
    });

    it('should show confirming email in link_ready card when email is prepopulated', async () => {
        (isEmailSignInLink as ReturnType<typeof vi.fn>).mockReturnValue(true);
        (getStoredVerificationEmail as ReturnType<typeof vi.fn>).mockReturnValue('user@example.com');
        (completeEmailVerification as ReturnType<typeof vi.fn>).mockResolvedValue('user@example.com');
        render(<Onboarding onComplete={mockOnComplete} />);
        await waitFor(() => {
            expect(screen.getByText(/Confirming: user@example\.com/i)).toBeInTheDocument();
        });
    });

    it('should reset emailStatus to idle when user edits email after sending', async () => {
        render(<Onboarding onComplete={mockOnComplete} />);
        fireEvent.change(screen.getByPlaceholderText(/arjun@example\.com/i), { target: { value: 'first@email.com' } });
        fireEvent.click(screen.getByRole('button', { name: /Verify/i }));
        await waitFor(() => expect(screen.getByText(/Verification email sent/i)).toBeInTheDocument());

        // User changes the email — status resets, Verify button reappears
        fireEvent.change(screen.getByPlaceholderText(/arjun@example\.com/i), { target: { value: 'second@email.com' } });
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /Verify/i })).toBeInTheDocument();
            expect(screen.queryByText(/Verification email sent/i)).not.toBeInTheDocument();
        });
    });

    it('should show error for invalid email format on Verify click', async () => {
        render(<Onboarding onComplete={mockOnComplete} />);
        fireEvent.change(screen.getByPlaceholderText(/arjun@example\.com/i), { target: { value: 'notanemail' } });
        fireEvent.click(screen.getByRole('button', { name: /Verify/i }));
        await waitFor(() => {
            expect(screen.getByText(/Please enter a valid email address/i)).toBeInTheDocument();
            expect(sendEmailVerificationLink).not.toHaveBeenCalled();
        });
    });

    it('should disable name input while in link_ready state', async () => {
        mockEmailVerified();
        render(<Onboarding onComplete={mockOnComplete} />);
        await waitFor(() => expect(screen.getByRole('button', { name: /Confirm email verification/i })).toBeInTheDocument());
        const nameInput = screen.getByPlaceholderText(/Arjun Mehta/i);
        expect(nameInput).toBeDisabled();
    });

    it('should disable email input while in link_ready state', async () => {
        mockEmailVerified();
        render(<Onboarding onComplete={mockOnComplete} />);
        await waitFor(() => expect(screen.getByRole('button', { name: /Confirm email verification/i })).toBeInTheDocument());
        const emailInput = screen.getByPlaceholderText(/arjun@example\.com/i);
        expect(emailInput).toBeDisabled();
    });

    it('should disable email input while verified', async () => {
        mockEmailVerified();
        render(<Onboarding onComplete={mockOnComplete} />);
        await waitFor(() => expect(screen.getByRole('button', { name: /Confirm email verification/i })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Confirm email verification/i }));
        await waitFor(() => expect(screen.getByText(/Email verified/i)).toBeInTheDocument());
        const emailInput = screen.getByPlaceholderText(/arjun@example\.com/i);
        expect(emailInput).toBeDisabled();
    });

});
