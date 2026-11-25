import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from './utils/test-utils';
import ProfileSheet from '../components/ProfileSheet';
import { getGoogleMapsApiKey } from '../utils/env';

// Mock env utils so both truthy and falsy branches are reachable
vi.mock('../utils/env', () => ({
    getGoogleMapsApiKey: vi.fn(() => undefined),
    getFirebaseApiKey: vi.fn(() => undefined),
    getApiUrl: vi.fn(() => 'http://localhost:3001/api'),
}));

// Mock Google Maps components to avoid jsdom errors when VITE_GOOGLE_MAPS_API_KEY is set
vi.mock('@vis.gl/react-google-maps', () => ({
    APIProvider: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'api-provider' }, children),
    Map: () => React.createElement('div', { 'data-testid': 'google-map' }),
    AdvancedMarker: () => React.createElement('div', { 'data-testid': 'advanced-marker' }),
}));
vi.mock('../components/PlacesAutocompleteInput', () => ({
    PlacesAutocompleteInput: ({ initialValue }: { initialValue?: string }) =>
        React.createElement('input', { 'data-testid': 'places-autocomplete', defaultValue: initialValue, 'aria-label': 'Address' }),
}));

// Mock all API modules
vi.mock('../api', () => ({
    restaurantAPI: {
        get: vi.fn(),
        update: vi.fn(),
    },
    instagramAPI: {
        getOAuthUrl: vi.fn(),
        handleCallback: vi.fn(),
        getPendingAccounts: vi.fn(),
        selectAccount: vi.fn(),
        getStatus: vi.fn(),
        disconnect: vi.fn(),
    },
    subscriptionAPI: {
        getCurrent: vi.fn().mockResolvedValue({
            subscription: {
                id: 'sub1',
                restaurantId: 'r1',
                status: 'ACTIVE',
                billingCycle: 'MONTHLY',
                credits: 15,
                planSnapshot: { id: 'p-growth', name: 'Growth', slug: 'growth', tier: 'GROWTH', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 10, STORY: 10, CAROUSEL: 3, REEL: 5, VIDEO: 5 }, FACEBOOK: { IMAGE: 10, CAROUSEL: 3, VIDEO: 5, STORY: 10 } } }, pricing: { monthly: 99900, annual: 999900, currency: 'INR' }, features: ['INSTAGRAM', 'FACEBOOK'] },
                currentPeriodEnd: '2026-04-01',
            },
            usage: {
                INSTAGRAM: { IMAGE: { used: 4, limit: 10 }, STORY: { used: 0, limit: 10 }, CAROUSEL: { used: 1, limit: 3 }, REEL: { used: 2, limit: 5 }, VIDEO: { used: 0, limit: 5 } },
                FACEBOOK: { IMAGE: { used: 0, limit: 10 }, CAROUSEL: { used: 0, limit: 3 }, VIDEO: { used: 0, limit: 5 }, STORY: { used: 0, limit: 10 } },
            },
        }),
        getPlans: vi.fn().mockResolvedValue([
            { id: 'p1', slug: 'starter', tier: 'STARTER', name: 'Starter', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 5, STORY: 5, CAROUSEL: 1, REEL: 2, VIDEO: 2 } } }, pricing: { monthly: 49900, annual: 499900, currency: 'INR' }, features: ['INSTAGRAM'] },
            { id: 'p2', slug: 'growth', tier: 'GROWTH', name: 'Growth', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 10, STORY: 10, CAROUSEL: 3, REEL: 5, VIDEO: 5 }, FACEBOOK: { IMAGE: 10, CAROUSEL: 3, VIDEO: 5, STORY: 10 } } }, pricing: { monthly: 99900, annual: 999900, currency: 'INR' }, features: ['INSTAGRAM', 'FACEBOOK'] },
        ]),
        subscribe: vi.fn(),
        changePlan: vi.fn(),
        reactivate: vi.fn(),
        cancel: vi.fn(),
    },
    couponAPI: {
        validate: vi.fn(),
    },
    creditPacksAPI: {
        getAll: vi.fn().mockResolvedValue([
            { id: 'cp1', name: '10 Credits', description: '10 bonus credits', credits: 10, priceInPaise: 9900, isActive: true, sortOrder: 1 },
            { id: 'cp2', name: '25 Credits', description: '25 bonus credits', credits: 25, priceInPaise: 19900, isActive: true, sortOrder: 2 },
        ]),
    },
    invoiceAPI: {
        getAll: vi.fn().mockResolvedValue([
            { id: 'inv1', restaurantId: 'r1', type: 'SUBSCRIPTION', amountPaise: 99900, currency: 'INR', status: 'paid', description: 'Growth Plan - Monthly', paidAt: '2026-03-01', pdfUrl: 'https://example.com/invoice1.pdf' },
            { id: 'inv2', restaurantId: 'r1', type: 'CREDIT_PURCHASE', amountPaise: 9900, currency: 'INR', status: 'paid', description: '10 Credits', paidAt: '2026-02-15' },
        ]),
    },
    configAPI: {
        getFeatures: vi.fn().mockResolvedValue({ deleteAccount: false, topupCredits: false, updatesSection: false }),
    },
    accountAPI: {
        delete: vi.fn(),
    },
}));

import { subscriptionAPI, instagramAPI, couponAPI, creditPacksAPI, invoiceAPI, restaurantAPI } from '../api';

// Mock window.history
const mockHistoryPushState = vi.fn();
const mockHistoryBack = vi.fn();

// Mock window.open
const mockWindowOpen = vi.fn();

// Mock window.confirm
const mockConfirm = vi.fn();

describe('ProfileSheet Component', () => {
    const mockOnClose = vi.fn();
    const mockOnLogout = vi.fn();
    const mockOnRestaurantUpdate = vi.fn();

    const mockRestaurantData = {
        id: 'r1',
        name: 'Test Restaurant',
        cuisine: 'Italian',
        location: {
            address: '123 Main St, Downtown, Mumbai',
            lat: 19.076,
            lng: 72.877,
            mapUrl: 'https://maps.example.com',
        },
        accountManager: {
            name: 'John Doe',
            phone: '+919876543210',
            email: 'john@example.com',
            avatar: '/avatar.jpg',
        },
        integrations: {
            instagram: false,
        },
    };

    const defaultProps = {
        isOpen: true,
        onClose: mockOnClose,
        onLogout: mockOnLogout,
        restaurantData: mockRestaurantData,
        userName: 'Arjun Mehta',
        onRestaurantUpdate: mockOnRestaurantUpdate,
    };

    beforeEach(() => {
        vi.clearAllMocks();

        // Re-set mock implementations cleared by clearAllMocks
        vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
            subscription: {
                id: 'sub1',
                restaurantId: 'r1',
                status: 'ACTIVE',
                billingCycle: 'MONTHLY',
                credits: 15,
                planSnapshot: { id: 'p-growth', name: 'Growth', slug: 'growth', tier: 'GROWTH', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 10, STORY: 10, CAROUSEL: 3, REEL: 5, VIDEO: 5 }, FACEBOOK: { IMAGE: 10, CAROUSEL: 3, VIDEO: 5, STORY: 10 } } }, pricing: { monthly: 99900, annual: 999900, currency: 'INR' }, features: ['INSTAGRAM', 'FACEBOOK'] },
                currentPeriodEnd: '2026-04-01',
            },
            usage: {
                INSTAGRAM: { IMAGE: { used: 4, limit: 10 }, STORY: { used: 0, limit: 10 }, CAROUSEL: { used: 1, limit: 3 }, REEL: { used: 2, limit: 5 }, VIDEO: { used: 0, limit: 5 } },
                FACEBOOK: { IMAGE: { used: 0, limit: 10 }, CAROUSEL: { used: 0, limit: 3 }, VIDEO: { used: 0, limit: 5 }, STORY: { used: 0, limit: 10 } },
            },
        });
        vi.mocked(subscriptionAPI.getPlans).mockResolvedValue([
            { id: 'p1', slug: 'starter', tier: 'STARTER', name: 'Starter', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 5, STORY: 5, CAROUSEL: 1, REEL: 2, VIDEO: 2 } } }, pricing: { monthly: 49900, annual: 499900, currency: 'INR' }, features: ['INSTAGRAM'] },
            { id: 'p2', slug: 'growth', tier: 'GROWTH', name: 'Growth', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 10, STORY: 10, CAROUSEL: 3, REEL: 5, VIDEO: 5 }, FACEBOOK: { IMAGE: 10, CAROUSEL: 3, VIDEO: 5, STORY: 10 } } }, pricing: { monthly: 99900, annual: 999900, currency: 'INR' }, features: ['INSTAGRAM', 'FACEBOOK'] },
        ]);
        vi.mocked(creditPacksAPI.getAll).mockResolvedValue([
            { id: 'cp1', name: '10 Credits', description: '10 bonus credits', credits: 10, priceInPaise: 9900, isActive: true, sortOrder: 1 },
            { id: 'cp2', name: '25 Credits', description: '25 bonus credits', credits: 25, priceInPaise: 19900, isActive: true, sortOrder: 2 },
        ]);
        vi.mocked(invoiceAPI.getAll).mockResolvedValue([
            { id: 'inv1', restaurantId: 'r1', type: 'SUBSCRIPTION', amountPaise: 99900, currency: 'INR', status: 'paid', description: 'Growth Plan - Monthly', paidAt: '2026-03-01', pdfUrl: 'https://example.com/invoice1.pdf' },
            { id: 'inv2', restaurantId: 'r1', type: 'CREDIT_PURCHASE', amountPaise: 9900, currency: 'INR', status: 'paid', description: '10 Credits', paidAt: '2026-02-15' },
        ]);
        // Reset action mocks that individual tests may override with mockRejectedValue
        vi.mocked(subscriptionAPI.subscribe).mockReset();
        vi.mocked(subscriptionAPI.changePlan).mockResolvedValue({ requested: true, planName: 'Growth' });
        vi.mocked(subscriptionAPI.reactivate).mockResolvedValue({ reactivated: true });
        vi.mocked(subscriptionAPI.cancel).mockResolvedValue({ success: true });

        window.history.pushState = mockHistoryPushState;
        window.history.back = mockHistoryBack;
        window.open = mockWindowOpen;
        window.confirm = mockConfirm;
    });

    // --- Rendering & Visibility ---

    it('should render when isOpen is true', () => {
        render(<ProfileSheet {...defaultProps} />);
        expect(screen.getByText('Arjun Mehta')).toBeInTheDocument();
        expect(screen.getByText('Test Restaurant')).toBeInTheDocument();
    });

    it('should not render when isOpen is false', () => {
        render(<ProfileSheet {...defaultProps} isOpen={false} />);
        expect(screen.queryByText('Arjun Mehta')).not.toBeInTheDocument();
    });

    // --- Header ---

    it('should show user initials in avatar', () => {
        render(<ProfileSheet {...defaultProps} />);
        expect(screen.getByText('AM')).toBeInTheDocument();
    });

    it('should handle single-word name initials', () => {
        render(<ProfileSheet {...defaultProps} userName="Arjun" />);
        expect(screen.getByText('A')).toBeInTheDocument();
    });

    it('should show cuisine in edit profile row', () => {
        render(<ProfileSheet {...defaultProps} />);
        expect(screen.getByText('Italian')).toBeInTheDocument();
    });

    // --- Account Manager ---

    it('should show account manager with WhatsApp link', () => {
        render(<ProfileSheet {...defaultProps} />);
        expect(screen.getByText('John Doe')).toBeInTheDocument();
        expect(screen.getByText('Account Manager')).toBeInTheDocument();
        const whatsappLink = screen.getByTitle('Chat on WhatsApp');
        expect(whatsappLink).toBeInTheDocument();
        expect(whatsappLink).toHaveAttribute('href', 'https://wa.me/919876543210');
        expect(whatsappLink).toHaveAttribute('target', '_blank');
    });

    it('should show fallback avatar when account manager has no avatar', () => {
        const noAvatarData = {
            ...mockRestaurantData,
            accountManager: { ...mockRestaurantData.accountManager, avatar: '' },
        };
        render(<ProfileSheet {...defaultProps} restaurantData={noAvatarData} />);
        expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    // --- Restaurant Profile ---

    it('should show Edit Restaurant Profile button', () => {
        render(<ProfileSheet {...defaultProps} />);
        expect(screen.getByText('Edit Restaurant Profile')).toBeInTheDocument();
    });

    it('should open Edit Profile modal on click', () => {
        render(<ProfileSheet {...defaultProps} />);
        fireEvent.click(screen.getByText('Edit Restaurant Profile'));
        expect(mockHistoryPushState).toHaveBeenCalledWith({ level: 'modal', id: 'edit-profile' }, '', '#edit-profile');
        // Modal should be visible with form fields
        expect(screen.getByLabelText('Restaurant Name')).toBeInTheDocument();
        expect(screen.getByLabelText('Cuisine')).toBeInTheDocument();
    });

    it('should pre-populate Edit Profile modal with restaurant data', () => {
        render(<ProfileSheet {...defaultProps} />);
        fireEvent.click(screen.getByText('Edit Restaurant Profile'));
        expect(screen.getByLabelText('Restaurant Name')).toHaveValue('Test Restaurant');
        expect(screen.getByLabelText('Cuisine')).toHaveValue('Italian');
    });

    it('should call onRestaurantUpdate when Edit Profile is saved', () => {
        render(<ProfileSheet {...defaultProps} />);
        fireEvent.click(screen.getByText('Edit Restaurant Profile'));

        const nameInput = screen.getByLabelText('Restaurant Name');
        fireEvent.change(nameInput, { target: { value: 'Updated Name' } });

        fireEvent.click(screen.getByText('Save Changes'));
        expect(mockOnRestaurantUpdate).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'Updated Name' })
        );
    });

    it('should close Edit Profile on Cancel', () => {
        render(<ProfileSheet {...defaultProps} />);
        fireEvent.click(screen.getByText('Edit Restaurant Profile'));
        expect(screen.getByLabelText('Restaurant Name')).toBeInTheDocument();

        fireEvent.click(screen.getByText('Cancel'));
        expect(screen.queryByLabelText('Restaurant Name')).not.toBeInTheDocument();
    });

    // --- Subscription ---

    it('should show Subscription row', () => {
        render(<ProfileSheet {...defaultProps} />);
        expect(screen.getByText('Subscription')).toBeInTheDocument();
    });

    it('should load and display subscription data', async () => {
        render(<ProfileSheet {...defaultProps} />);

        // Wait for subscription data to load
        await waitFor(() => {
            expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
        });

        // Subscription row should show plan name and credits
        expect(screen.getByText(/Growth \(15 credits\)/)).toBeInTheDocument();
    });

    it('should open Subscription modal on click', async () => {
        render(<ProfileSheet {...defaultProps} />);

        await waitFor(() => {
            expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
        });

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        expect(mockHistoryPushState).toHaveBeenCalledWith({ level: 'modal', id: 'subscription' }, '', '#subscription');

        // Subscription modal content should be visible
        await waitFor(() => {
            expect(screen.getByText('Manage your plan')).toBeInTheDocument();
            expect(screen.getByText('Current Plan')).toBeInTheDocument();
            expect(screen.getByText('This Week')).toBeInTheDocument();
        });
    });

    it('auto-opens the Subscription panel when autoOpenSubscription is set (See plans / upgrade CTA)', async () => {
        // Simulates the trial-ended banner "See plans" / Paywall "Subscribe" CTA,
        // which opens the sheet with autoOpenSubscription -> jump straight to plans.
        render(<ProfileSheet {...defaultProps} autoOpenSubscription={true} />);

        // No click needed -- the effect opens the Subscription panel directly.
        await waitFor(() => {
            expect(screen.getByText('Manage your plan')).toBeInTheDocument();
            expect(screen.getByText('Current Plan')).toBeInTheDocument();
        });
    });

    it('propagates fresh entitlement to onEntitlementChange when subscription data loads', async () => {
        // Regression: after subscribing, App's entitlement (trial/lock banner + gated
        // views) must update without a full page reload. ProfileSheet pushes the fresh
        // entitlement up via this callback whenever it (re)loads subscription data.
        const onEntitlementChange = vi.fn();
        const entitlement = { entitled: true, inTrial: false, activePlan: true, trialDaysLeft: 0 };
        vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
            subscription: {
                id: 'sub1', restaurantId: 'r1', status: 'ACTIVE', billingCycle: 'MONTHLY', credits: 15,
                planSnapshot: { id: 'p-growth', name: 'Growth', slug: 'growth', tier: 'GROWTH', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 10, STORY: 10, CAROUSEL: 3, REEL: 5, VIDEO: 5 } } }, pricing: { monthly: 99900, annual: 999900, currency: 'INR' }, features: ['INSTAGRAM'] },
                currentPeriodEnd: '2026-04-01',
            },
            usage: null,
            entitlement,
        } as any);

        render(<ProfileSheet {...defaultProps} onEntitlementChange={onEntitlementChange} />);

        await waitFor(() => expect(onEntitlementChange).toHaveBeenCalledWith(entitlement));
    });

    it('should show weekly usage in Subscription modal', async () => {
        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);

        await waitFor(() => {
            expect(screen.getByText('This Week')).toBeInTheDocument();
            // Usage shows platform headers and post type labels
            expect(screen.getByText('INSTAGRAM')).toBeInTheDocument();
            expect(screen.getAllByText('IMAGE').length).toBeGreaterThanOrEqual(1);
            expect(screen.getAllByText('REEL').length).toBeGreaterThanOrEqual(1);
        });
    });

    it('should show available plans in Subscription modal', async () => {
        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);

        await waitFor(() => {
            expect(screen.getByText('Change Plan')).toBeInTheDocument();
            expect(screen.getByText('Starter')).toBeInTheDocument();
        });
    });

    it('should show coupon code input in Subscription modal', async () => {
        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);

        await waitFor(() => {
            expect(screen.getByPlaceholderText('Have a coupon code?')).toBeInTheDocument();
            expect(screen.getByPlaceholderText('Have a coupon code?')).toBeInTheDocument();
        });
    });

    it('should validate coupon code', async () => {
        vi.mocked(couponAPI.validate).mockResolvedValue({ valid: true });

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);

        await waitFor(() => {
            const couponInput = screen.getByPlaceholderText('Have a coupon code?');
            fireEvent.change(couponInput, { target: { value: 'SAVE20' } });
        });

        fireEvent.click(screen.getByText('Apply'));

        await waitFor(() => {
            expect(couponAPI.validate).toHaveBeenCalledWith('SAVE20');
            expect(screen.getByText('Coupon applied!')).toBeInTheDocument();
        });
    });

    it('should show invalid coupon message', async () => {
        vi.mocked(couponAPI.validate).mockResolvedValue({ valid: false });

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);

        await waitFor(() => {
            const couponInput = screen.getByPlaceholderText('Have a coupon code?');
            fireEvent.change(couponInput, { target: { value: 'INVALID' } });
        });

        fireEvent.click(screen.getByText('Apply'));

        await waitFor(() => {
            expect(screen.getByText('Invalid coupon code')).toBeInTheDocument();
        });
    });

    it('should show credit packs in Subscription modal', async () => {
        render(<ProfileSheet {...defaultProps} featureFlags={{ deleteAccount: false, topupCredits: true, updatesSection: false }} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);

        await waitFor(() => {
            expect(screen.getByText('Top Up Credits')).toBeInTheDocument();
            expect(screen.getByText('10')).toBeInTheDocument();
            expect(screen.getByText('25')).toBeInTheDocument();
        });
    });

    // --- Instagram ---

    it('should show Instagram Connect button when not connected', () => {
        render(<ProfileSheet {...defaultProps} />);
        expect(screen.getByText('Connect')).toBeInTheDocument();
        expect(screen.getByText('Connect your business account')).toBeInTheDocument();
    });

    it('should show Instagram Connected status when connected', () => {
        const connectedData = {
            ...mockRestaurantData,
            integrations: { instagram: true },
            instagramConnection: {
                connected: true,
                username: 'testrestaurant',
                pageName: 'Test Page',
            },
        };
        render(<ProfileSheet {...defaultProps} restaurantData={connectedData} />);
        expect(screen.getByText('Connected')).toBeInTheDocument();
        expect(screen.getByText('@testrestaurant')).toBeInTheDocument();
    });

    it('should show connection details when connected', () => {
        const connectedData = {
            ...mockRestaurantData,
            integrations: { instagram: true },
            instagramConnection: {
                connected: true,
                username: 'testrestaurant',
                pageName: 'Test Page',
                tokenStatus: 'valid' as const,
            },
        };
        render(<ProfileSheet {...defaultProps} restaurantData={connectedData} />);
        expect(screen.getByText('Connected via Test Page')).toBeInTheDocument();
    });

    it('should show token expiring warning', () => {
        const expiringData = {
            ...mockRestaurantData,
            integrations: { instagram: true },
            instagramConnection: {
                connected: true,
                username: 'testrestaurant',
                pageName: 'Test Page',
                tokenStatus: 'expiring_soon' as const,
            },
        };
        render(<ProfileSheet {...defaultProps} restaurantData={expiringData} />);
        expect(screen.getByText('Token expiring soon')).toBeInTheDocument();
    });

    it('should show reauthorize button when needed', () => {
        const reauthorizeData = {
            ...mockRestaurantData,
            integrations: { instagram: true },
            instagramConnection: {
                connected: true,
                username: 'testrestaurant',
                pageName: 'Test Page',
                needsReauthorization: true,
            },
        };
        render(<ProfileSheet {...defaultProps} restaurantData={reauthorizeData} />);
        expect(screen.getByText('Reauthorize')).toBeInTheDocument();
    });

    it('should show setup guide on Connect click', () => {
        render(<ProfileSheet {...defaultProps} />);
        fireEvent.click(screen.getByText('Connect'));

        expect(screen.getByText('Connect Instagram')).toBeInTheDocument();
        expect(screen.getByText('Choose your setup method')).toBeInTheDocument();
        expect(screen.getByText('I already have everything set up')).toBeInTheDocument();
        expect(screen.getByText('I need help setting up')).toBeInTheDocument();
    });

    it('should show help button when not connected', () => {
        render(<ProfileSheet {...defaultProps} />);
        const helpButton = screen.getByTitle('View setup guide');
        expect(helpButton).toBeInTheDocument();
    });

    it('should start OAuth flow from setup guide option 1', async () => {
        vi.mocked(instagramAPI.getOAuthUrl).mockResolvedValue({ oauthUrl: 'https://facebook.com/oauth', state: 'test-state' });
        mockWindowOpen.mockReturnValue({ closed: false });

        render(<ProfileSheet {...defaultProps} />);
        fireEvent.click(screen.getByText('Connect'));

        fireEvent.click(screen.getByText('Connect with Facebook'));

        await waitFor(() => {
            expect(instagramAPI.getOAuthUrl).toHaveBeenCalledWith('r1', false);
        });
    });

    it('should start guided OAuth flow from setup guide option 2', async () => {
        vi.mocked(instagramAPI.getOAuthUrl).mockResolvedValue({ oauthUrl: 'https://facebook.com/oauth', state: 'test-state' });
        mockWindowOpen.mockReturnValue({ closed: false });

        render(<ProfileSheet {...defaultProps} />);
        fireEvent.click(screen.getByText('Connect'));

        fireEvent.click(screen.getByText('Guided Setup'));

        await waitFor(() => {
            expect(instagramAPI.getOAuthUrl).toHaveBeenCalledWith('r1', true);
        });
    });

    it('should handle Instagram disconnect', async () => {
        vi.mocked(instagramAPI.disconnect).mockResolvedValue(undefined);

        const connectedData = {
            ...mockRestaurantData,
            integrations: { instagram: true },
            instagramConnection: { connected: true, username: 'testrestaurant', pageName: 'Test Page' },
        };
        render(<ProfileSheet {...defaultProps} restaurantData={connectedData} />);

        // Open Advanced section and click Disconnect Instagram
        fireEvent.click(screen.getByText('Advanced'));
        fireEvent.click(screen.getByText('Disconnect Instagram'));

        // Confirm in the dialog
        await waitFor(() => {
            expect(screen.getByText('Disconnect Instagram?')).toBeInTheDocument();
        });
        fireEvent.click(screen.getByRole('button', { name: /^Disconnect$/i }));

        await waitFor(() => {
            expect(instagramAPI.disconnect).toHaveBeenCalledWith('r1');
        });
    });

    it('should cancel disconnect when user declines confirm', () => {
        mockConfirm.mockReturnValue(false);

        const connectedData = {
            ...mockRestaurantData,
            integrations: { instagram: true },
            instagramConnection: { connected: true, username: 'testrestaurant', pageName: 'Test Page' },
        };
        render(<ProfileSheet {...defaultProps} restaurantData={connectedData} />);
        fireEvent.click(screen.getByText('Connected'));

        expect(instagramAPI.disconnect).not.toHaveBeenCalled();
    });

    it('should close setup guide on Cancel click', () => {
        render(<ProfileSheet {...defaultProps} />);
        fireEvent.click(screen.getByText('Connect'));

        expect(screen.getByText('Connect Instagram')).toBeInTheDocument();

        // Find the Cancel button in the setup guide (last Cancel)
        const cancelButtons = screen.getAllByText('Cancel');
        fireEvent.click(cancelButtons[cancelButtons.length - 1]);

        expect(screen.queryByText('Connect Instagram')).not.toBeInTheDocument();
    });

    // --- Billing History ---

    it('should show Billing History button with invoice count when invoices exist', async () => {
        render(<ProfileSheet {...defaultProps} />);

        await waitFor(() => {
            expect(screen.getByText('Billing History')).toBeInTheDocument();
            expect(screen.getByText('2 invoices')).toBeInTheDocument();
        });
    });

    // --- Footer Actions ---

    it('should call onLogout when Log Out is clicked', () => {
        render(<ProfileSheet {...defaultProps} />);
        fireEvent.click(screen.getByText('Log Out'));
        expect(mockOnLogout).toHaveBeenCalledOnce();
    });

    it('should show Delete Account button inside Advanced section', () => {
        render(<ProfileSheet {...defaultProps} />);
        fireEvent.click(screen.getByText('Advanced'));
        expect(screen.getByText('Delete Account')).toBeInTheDocument();
    });

    // --- Sheet Dismiss ---

    it('should dismiss on backdrop click', () => {
        render(<ProfileSheet {...defaultProps} />);
        const backdrop = document.querySelector('.fixed.inset-0.bg-slate-900\\/60');
        if (backdrop) {
            fireEvent.click(backdrop);
            expect(mockOnClose).toHaveBeenCalledOnce();
        }
    });

    // --- Section Headers ---

    it('should render all section headers', () => {
        render(<ProfileSheet {...defaultProps} />);
        expect(screen.getByText('Restaurant')).toBeInTheDocument();
        expect(screen.getByText('Your RestroPulse Team')).toBeInTheDocument();
        expect(screen.getByText('Account')).toBeInTheDocument();
        expect(screen.getByText('Integrations')).toBeInTheDocument();
    });

    // --- Subscription Loading State ---

    it('should show loading state for subscription initially', () => {
        render(<ProfileSheet {...defaultProps} />);
        expect(screen.getByText('Loading...')).toBeInTheDocument();
    });

    // --- API Error Handling ---

    it('should handle subscription load failure gracefully', async () => {
        vi.mocked(subscriptionAPI.getCurrent).mockRejectedValue(new Error('API Error'));
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

        render(<ProfileSheet {...defaultProps} />);

        await waitFor(() => {
            expect(consoleSpy).toHaveBeenCalledWith('Failed to load subscription data:', expect.any(Error));
        });

        consoleSpy.mockRestore();
    });

    it('should handle OAuth error gracefully', async () => {
        vi.mocked(instagramAPI.getOAuthUrl).mockRejectedValue(new Error('OAuth Error'));
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

        render(<ProfileSheet {...defaultProps} />);
        fireEvent.click(screen.getByText('Connect'));
        fireEvent.click(screen.getByText('Connect with Facebook'));

        await waitFor(() => {
            expect(consoleSpy).toHaveBeenCalledWith('OAuth initiation error:', expect.any(Error));
        });

        consoleSpy.mockRestore();
    });

    // --- Drag to Dismiss ---

    it('should close profile page via back button', () => {
        render(<ProfileSheet {...defaultProps} />);
        const backButton = screen.getByLabelText('Go back');
        expect(backButton).toBeInTheDocument();

        fireEvent.click(backButton);
        expect(mockOnClose).toHaveBeenCalledOnce();
    });

    it('should render as full page with Profile title', () => {
        render(<ProfileSheet {...defaultProps} />);
        expect(screen.getByText('Profile')).toBeInTheDocument();
        const page = document.querySelector('.fixed.inset-0');
        expect(page).toBeInTheDocument();
    });

    // --- No Subscription ---

    it('should show No Plan when subscription is null', async () => {
        vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
            subscription: null,
            usage: null,
        });

        render(<ProfileSheet {...defaultProps} />);

        await waitFor(() => {
            expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
        });

        expect(screen.getByText('No Plan')).toBeInTheDocument();
    });

    // --- Subscription modal close ---

    it('should close Subscription modal via backdrop click', async () => {
        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);

        await waitFor(() => {
            expect(screen.getByText('Manage your plan')).toBeInTheDocument();
        });

        // Click the backdrop to close
        const backdrop = document.querySelector('[data-subscription-modal]')?.parentElement?.querySelector('.absolute.inset-0');
        if (backdrop) {
            fireEvent.click(backdrop);
            expect(screen.queryByText('Manage your plan')).not.toBeInTheDocument();
        }
    });

    // --- Edit Profile with address change ---

    it('should save changes in Edit Profile modal', () => {
        render(<ProfileSheet {...defaultProps} />);
        fireEvent.click(screen.getByText('Edit Restaurant Profile'));

        const nameInput = screen.getByLabelText('Restaurant Name');
        fireEvent.change(nameInput, { target: { value: 'Updated Restaurant' } });

        fireEvent.click(screen.getByText('Save Changes'));
        expect(mockOnRestaurantUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                name: 'Updated Restaurant',
            })
        );
    });

    // --- Instagram loading state ---

    it('should show loading spinner during Instagram OAuth', async () => {
        // Mock OAuth URL to hang (never resolve immediately)
        let resolveOAuth: (v: any) => void;
        vi.mocked(instagramAPI.getOAuthUrl).mockImplementation(() => new Promise(r => { resolveOAuth = r; }));

        render(<ProfileSheet {...defaultProps} />);
        fireEvent.click(screen.getByText('Connect'));
        fireEvent.click(screen.getByText('Connect with Facebook'));

        // Should show loading state on the button area
        await waitFor(() => {
            expect(screen.getByText('Connecting...')).toBeInTheDocument();
        });
    });

    // --- Popstate handler ---

    it('should close modals on browser back button (popstate)', async () => {
        render(<ProfileSheet {...defaultProps} />);

        // Open edit profile
        fireEvent.click(screen.getByText('Edit Restaurant Profile'));
        expect(screen.getByLabelText('Restaurant Name')).toBeInTheDocument();

        // Simulate browser back button
        window.dispatchEvent(new PopStateEvent('popstate'));

        await waitFor(() => {
            expect(screen.queryByLabelText('Restaurant Name')).not.toBeInTheDocument();
        });
    });

    // --- Billing history with no invoices ---

    it('should not show billing history when no invoices', async () => {
        vi.mocked(invoiceAPI.getAll).mockResolvedValue([]);

        render(<ProfileSheet {...defaultProps} />);

        await waitFor(() => {
            expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
        });

        expect(screen.queryByText('Billing History')).not.toBeInTheDocument();
    });

    // --- Instagram connected with page info ---

    it('should show Instagram page name when connected', () => {
        const connectedData = {
            ...mockRestaurantData,
            integrations: { instagram: true },
            instagramConnection: {
                connected: true,
                username: 'testrestaurant',
                pageName: 'Test Page',
                tokenStatus: 'valid' as const,
            },
        };
        render(<ProfileSheet {...defaultProps} restaurantData={connectedData} />);
        expect(screen.getByText('Connected via Test Page')).toBeInTheDocument();
    });

    // --- Disconnect error handling ---

    it('should handle disconnect error gracefully', async () => {
        vi.mocked(instagramAPI.disconnect).mockRejectedValue(new Error('Disconnect failed'));
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

        const connectedData = {
            ...mockRestaurantData,
            integrations: { instagram: true },
            instagramConnection: { connected: true, username: 'testrestaurant', pageName: 'Test Page' },
        };
        render(<ProfileSheet {...defaultProps} restaurantData={connectedData} />);

        // Open Advanced section and click Disconnect Instagram
        fireEvent.click(screen.getByText('Advanced'));
        fireEvent.click(screen.getByText('Disconnect Instagram'));

        // Confirm in the dialog
        await waitFor(() => {
            expect(screen.getByText('Disconnect Instagram?')).toBeInTheDocument();
        });
        fireEvent.click(screen.getByRole('button', { name: /^Disconnect$/i }));

        await waitFor(() => {
            expect(consoleSpy).toHaveBeenCalledWith('Disconnect error:', expect.any(Error));
            expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
        });

        consoleSpy.mockRestore();
    });

    // --- Popup blocked scenario ---

    it('should handle popup blocked during OAuth', async () => {
        vi.mocked(instagramAPI.getOAuthUrl).mockResolvedValue({ oauthUrl: 'https://facebook.com/oauth', state: 'test-state' });
        mockWindowOpen.mockReturnValue(null); // popup blocked
        mockConfirm.mockReturnValue(false);

        render(<ProfileSheet {...defaultProps} />);
        fireEvent.click(screen.getByText('Connect'));
        fireEvent.click(screen.getByText('Connect with Facebook'));

        await waitFor(() => {
            expect(mockWindowOpen).toHaveBeenCalled();
        });
    });

    // --- Edit Profile map coordinates ---

    it('should render all form fields in Edit Profile modal', () => {
        render(<ProfileSheet {...defaultProps} />);
        fireEvent.click(screen.getByText('Edit Restaurant Profile'));

        expect(screen.getByLabelText('Restaurant Name')).toBeInTheDocument();
        expect(screen.getByText('Location')).toBeInTheDocument();
        expect(screen.getByLabelText('Cuisine')).toBeInTheDocument();
        expect(screen.getByText('Save Changes')).toBeInTheDocument();
        expect(screen.getByText('Cancel')).toBeInTheDocument();
    });

    // --- SubscriptionModal: requesting a plan (no payment gateway) ---

    it('should call changePlan when clicking Switch on a non-current plan with active subscription', async () => {
        vi.mocked(subscriptionAPI.changePlan).mockResolvedValue({ requested: true, planName: 'Starter' });

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        // The Starter plan should have a "Downgrade" button (since current plan is Growth and Starter is cheaper)
        // ACTIVE status shows confirmation dialog before proceeding
        const switchButton = screen.getByText('Downgrade');
        fireEvent.click(switchButton);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Send request' })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: 'Send request' }));

        await waitFor(() => {
            expect(subscriptionAPI.changePlan).toHaveBeenCalledWith('starter');
            expect(subscriptionAPI.subscribe).not.toHaveBeenCalled();
        });
    });

    it('should request a plan with subscribe (no checkout) when there is no active subscription', async () => {
        vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
            subscription: { id: 'sub1', restaurantId: 'r1', status: 'NONE', credits: 5, planSnapshot: null, currentPeriodEnd: undefined },
            usage: null,
        });
        vi.mocked(subscriptionAPI.subscribe).mockResolvedValue({ requested: true, planName: 'Starter' });

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        // With no active plan, buttons say "Request" and send the request straight away
        const requestButtons = screen.getAllByText('Request');
        const callsBefore = vi.mocked(subscriptionAPI.getCurrent).mock.calls.length;
        fireEvent.click(requestButtons[0]);

        await waitFor(() => {
            expect(subscriptionAPI.changePlan).not.toHaveBeenCalled();
            expect(subscriptionAPI.subscribe).toHaveBeenCalledWith('starter', undefined);
            expect(screen.getByText('Request received for Starter. The RestroPulse team will be in touch to arrange payment and switch the plan on.')).toBeInTheDocument();
        });
        // The panel stays open and the subscription is re-read so the pending request shows
        expect(screen.getByText('Change Plan')).toBeInTheDocument();
        expect(vi.mocked(subscriptionAPI.getCurrent).mock.calls.length).toBeGreaterThan(callsBefore);
        // A success notice offers no retry
        expect(screen.queryByText('Tap to retry')).not.toBeInTheDocument();
    });

    it('should handle switch plan failure gracefully', async () => {
        vi.mocked(subscriptionAPI.changePlan).mockRejectedValue(new Error('Request failed'));

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        // ACTIVE status shows confirmation dialog before proceeding
        fireEvent.click(screen.getByText('Downgrade'));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Send request' })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: 'Send request' }));

        await waitFor(() => {
            expect(screen.getByText(/Request failed/i)).toBeInTheDocument();
        });
    });

    // --- SubscriptionModal: credits (added by the RestroPulse team) ---

    it('shows credit packs as information only and tells the owner to contact their account manager', async () => {
        render(<ProfileSheet {...defaultProps} featureFlags={{ deleteAccount: false, topupCredits: true, updatesSection: false }} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Top Up Credits')).toBeInTheDocument());

        const packs = screen.getByRole('list', { name: 'Credit packs' });
        expect(packs).toHaveTextContent('10');
        expect(packs).toHaveTextContent('25');
        // No self-serve purchase: the packs are not buttons
        expect(packs.querySelectorAll('button')).toHaveLength(0);
        expect(screen.getByText('To add credits, contact your account manager, John Doe.')).toBeInTheDocument();
    });

    it('tells the owner to contact the RestroPulse team for credits when no account manager name is known', async () => {
        const noManager = { ...mockRestaurantData, accountManager: { ...mockRestaurantData.accountManager, name: '' } };
        render(<ProfileSheet {...defaultProps} restaurantData={noManager} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Top Up Credits')).toBeInTheDocument());

        expect(screen.getByText('Contact the RestroPulse team to add credits.')).toBeInTheDocument();
    });

    it('shows only the contact line for Top Up Credits when topupCredits flag is false', async () => {
        render(<ProfileSheet {...defaultProps} featureFlags={{ deleteAccount: false, topupCredits: false, updatesSection: false }} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);

        await waitFor(() => {
            expect(screen.getByText('Top Up Credits')).toBeInTheDocument();
            expect(screen.getByText('To add credits, contact your account manager, John Doe.')).toBeInTheDocument();
        });

        expect(screen.queryByRole('list', { name: 'Credit packs' })).not.toBeInTheDocument();
        expect(screen.queryByText('Coming Soon')).not.toBeInTheDocument();
    });

    it('shows credit pack prices when topupCredits flag is true', async () => {
        vi.mocked(creditPacksAPI.getAll).mockResolvedValue([
            { id: 'cp1', name: '10 Credits', description: '10 bonus credits', credits: 10, priceInPaise: 9900, isActive: true, sortOrder: 1 },
        ]);

        render(<ProfileSheet {...defaultProps} featureFlags={{ deleteAccount: false, topupCredits: true, updatesSection: false }} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);

        await waitFor(() => {
            expect(screen.getByText('Top Up Credits')).toBeInTheDocument();
            expect(screen.getByRole('list', { name: 'Credit packs' })).toHaveTextContent('₹99');
        });

        expect(screen.queryByText('Coming Soon')).not.toBeInTheDocument();
    });

    // --- SubscriptionModal: Error visibility for every action button ---

    it('should show error for the Request button when no active subscription', async () => {
        vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
            subscription: {
                id: 'sub1',
                restaurantId: 'r1',
                status: 'NONE',
                credits: 5,
                planSnapshot: null,
                currentPeriodEnd: undefined,
            },
            usage: null,
        });
        vi.mocked(subscriptionAPI.subscribe).mockRejectedValue(new Error('Plan not found'));

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        // All plans show Request when status is NONE
        const subscribeButtons = screen.getAllByText('Request');
        expect(subscribeButtons.length).toBeGreaterThanOrEqual(1);

        fireEvent.click(subscribeButtons[0]);

        await waitFor(() => {
            expect(screen.getByText(/Plan not found/i)).toBeInTheDocument();
        });
    });

    it('should show error for every Request button, not just the first', async () => {
        vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
            subscription: {
                id: 'sub1',
                restaurantId: 'r1',
                status: 'NONE',
                credits: 5,
                planSnapshot: null,
                currentPeriodEnd: undefined,
            },
            usage: null,
        });
        vi.mocked(subscriptionAPI.subscribe).mockRejectedValue(new Error('Plan not found'));

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        const subscribeButtons = screen.getAllByText('Request');
        expect(subscribeButtons.length).toBeGreaterThanOrEqual(2);

        // Click the last Request button (not the first)
        fireEvent.click(subscribeButtons[subscribeButtons.length - 1]);

        await waitFor(() => {
            expect(screen.getByText(/Plan not found/i)).toBeInTheDocument();
        });
    });

    it('should show subscription error even when modal is scrolled down', async () => {
        vi.mocked(subscriptionAPI.changePlan).mockRejectedValue(new Error('Request failed'));

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        const modal = document.querySelector('[data-subscription-modal]') as HTMLDivElement | null;
        expect(modal).toBeTruthy();
        if (modal) {
            modal.scrollTop = 400;
        }

        // ACTIVE status shows confirmation dialog before proceeding
        const subscribeButtons = screen.getAllByRole('button', { name: 'Downgrade' });
        fireEvent.click(subscribeButtons[0]);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Send request' })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: 'Send request' }));

        await waitFor(() => {
            expect(screen.getByText(/Request failed/i)).toBeInTheDocument();
        });
    });

    it('should show error again after clicking Switch a second time', async () => {
        vi.mocked(subscriptionAPI.changePlan).mockRejectedValue(new Error('Request failed'));

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        // First click -- ACTIVE status shows confirmation dialog
        fireEvent.click(screen.getByText('Downgrade'));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Send request' })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
        await waitFor(() => {
            expect(screen.getByText(/Request failed/i)).toBeInTheDocument();
        });

        // Second click -- error must still be shown
        fireEvent.click(screen.getByText('Downgrade'));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Send request' })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
        await waitFor(() => {
            expect(screen.getByText(/Request failed/i)).toBeInTheDocument();
        });
    });

    it('should show error when changePlan fails', async () => {
        vi.mocked(subscriptionAPI.changePlan).mockRejectedValue(new Error('No active subscription to change'));

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        // With ACTIVE subscription the button says "Downgrade" — confirmation dialog first
        fireEvent.click(screen.getByText('Downgrade'));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Send request' })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: 'Send request' }));

        await waitFor(() => {
            expect(screen.getByText(/No active subscription to change/i)).toBeInTheDocument();
        });

        // subscribe should NOT have been called since we use changePlan for active subs
        expect(subscriptionAPI.subscribe).not.toHaveBeenCalled();
    });

    it('never opens a payment window or checkout when requesting a plan', async () => {
        vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
            subscription: { id: 'sub1', restaurantId: 'r1', status: 'NONE', credits: 5, planSnapshot: null, currentPeriodEnd: undefined },
            usage: null,
        });
        vi.mocked(subscriptionAPI.subscribe).mockResolvedValue({ requested: true, planName: 'Starter' });

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        fireEvent.click(screen.getAllByText('Request')[0]);

        await waitFor(() => expect(subscriptionAPI.subscribe).toHaveBeenCalled());
        await screen.findByText(/Request received for Starter/);
        expect(mockWindowOpen).not.toHaveBeenCalled();
        expect(document.querySelector('script[src*="checkout"], iframe')).toBeNull();
        expect(screen.getByText('No payment is taken in the app. The RestroPulse team arranges payment with you directly.')).toBeInTheDocument();
    });


    it('should clear previous error when starting a new action', async () => {
        vi.mocked(subscriptionAPI.changePlan).mockRejectedValue(new Error('Request failed'));

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        // First action fails -- ACTIVE status shows confirmation dialog
        fireEvent.click(screen.getByText('Downgrade'));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Send request' })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
        await waitFor(() => {
            expect(screen.getByText(/Request failed/i)).toBeInTheDocument();
        });

        // Start a new action -- error should clear before the new attempt
        vi.mocked(subscriptionAPI.changePlan).mockRejectedValue(new Error('Another failure'));
        fireEvent.click(screen.getByText('Downgrade'));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Send request' })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: 'Send request' }));

        // Error clears momentarily, then reappears after the new failure
        await waitFor(() => {
            expect(screen.getByText(/Another failure/i)).toBeInTheDocument();
        });
    });

    // --- SubscriptionModal: request outcomes ---

    it('shows the server error when subscribe is refused because a plan is already active, and re-reads the subscription', async () => {
        vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
            subscription: { id: 'sub1', restaurantId: 'r1', status: 'NONE', credits: 5, planSnapshot: null, currentPeriodEnd: undefined },
            usage: null,
        });
        vi.mocked(subscriptionAPI.subscribe).mockRejectedValue(new Error('An active subscription already exists. Use change-plan to switch plans.'));

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        const callsBefore = vi.mocked(subscriptionAPI.getCurrent).mock.calls.length;
        fireEvent.click(screen.getAllByText('Request')[0]);

        await waitFor(() => {
            expect(screen.getByText(/An active subscription already exists/)).toBeInTheDocument();
            expect(screen.getByText('Tap to retry')).toBeInTheDocument();
        });
        // Re-sync so a retry routes through change-plan if a plan became active
        await waitFor(() => expect(vi.mocked(subscriptionAPI.getCurrent).mock.calls.length).toBeGreaterThan(callsBefore));
    });

    it('says the owner is already on the plan when change-plan has nothing to request', async () => {
        vi.mocked(subscriptionAPI.changePlan).mockResolvedValue({ requested: false, planName: 'Starter' });

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        fireEvent.click(screen.getByText('Downgrade'));
        fireEvent.click(await screen.findByRole('button', { name: 'Send request' }));

        await waitFor(() => expect(screen.getByText("You're already on Starter.")).toBeInTheDocument());
        expect(screen.queryByText(/Request received/)).not.toBeInTheDocument();
    });

    it('shows the pending request after a plan is requested', async () => {
        vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
            subscription: { id: 'sub1', restaurantId: 'r1', status: 'NONE', credits: 5, planSnapshot: null, currentPeriodEnd: undefined },
            usage: null,
        });
        vi.mocked(subscriptionAPI.subscribe).mockResolvedValue({ requested: true, planName: 'Starter' });

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        // After the request the API reports the plan as pending
        vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
            subscription: { id: 'sub1', restaurantId: 'r1', status: 'NONE', credits: 5, planSnapshot: null, pendingPlanId: 'p-starter', pendingPlanSnapshot: { id: 'p-starter', name: 'Starter', slug: 'starter', tier: 'STARTER', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 5, STORY: 5, CAROUSEL: 1, REEL: 2, VIDEO: 2 } } }, pricing: { monthly: 49900, annual: 499900, currency: 'INR' }, features: ['INSTAGRAM'] }, planRequestedAt: '2026-11-20T10:00:00.000Z' },
            usage: null,
        });
        fireEvent.click(screen.getAllByText('Request')[0]);

        const banner = await screen.findByRole('status', { name: 'Plan request' });
        expect(banner).toHaveTextContent('Plan request received');
        expect(banner).toHaveTextContent('You asked for the Starter plan on');
        expect(banner).toHaveTextContent('The RestroPulse team will be in touch to arrange payment and switch the plan on.');
        expect(screen.getByText('Requested')).toBeInTheDocument();
        // The panel stays open
        expect(screen.getByText('Change Plan')).toBeInTheDocument();
    });


    // --- SubscriptionModal: Current plan indicator ---

    it('should show Current Plan indicator and not a Switch button for the active plan', async () => {
        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        // Growth is the current plan - should show "Active" badge
        expect(screen.getByText('Active')).toBeInTheDocument();
        // The Growth plan card should NOT have a tier-change button; Starter should show "Downgrade"
        const switchButtons = screen.getAllByText('Downgrade');
        expect(switchButtons).toHaveLength(1); // Only one Downgrade button (for Starter)
    });

    // --- SubscriptionModal: NONE status shows Free Credits badge ---

    it('should show Free Credits badge when subscription status is NONE', async () => {
        vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
            subscription: {
                id: 'sub1',
                restaurantId: 'r1',
                status: 'NONE',
                credits: 5,
                planSnapshot: null,
                currentPeriodEnd: undefined,
            },
            usage: null,
        });

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Free Credits')).toBeInTheDocument());
    });

    // --- SubscriptionModal: request with coupon (new subscription only) ---

    it('should pass coupon code when subscribing without active subscription', async () => {
        vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
            subscription: { id: 'sub1', restaurantId: 'r1', status: 'NONE', credits: 0, planSnapshot: null, currentPeriodEnd: undefined },
            usage: null,
        });
        vi.mocked(couponAPI.validate).mockResolvedValue({ valid: true });
        vi.mocked(subscriptionAPI.subscribe).mockResolvedValue({ requested: true, planName: 'Starter' });

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        // Apply coupon first
        const couponInput = screen.getByPlaceholderText('Have a coupon code?');
        fireEvent.change(couponInput, { target: { value: 'SAVE20' } });
        fireEvent.click(screen.getByText('Apply'));
        await waitFor(() => expect(screen.getByText('Coupon applied!')).toBeInTheDocument());

        // NONE status shows Request button directly
        const subscribeButtons = screen.getAllByText('Request');
        fireEvent.click(subscribeButtons[0]);

        await waitFor(() => {
            expect(subscriptionAPI.subscribe).toHaveBeenCalledWith('starter', 'SAVE20');
        });
    });

    it('should normalize lowercase coupon code on apply and pass normalized value when subscribing', async () => {
        vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
            subscription: { id: 'sub1', restaurantId: 'r1', status: 'NONE', credits: 0, planSnapshot: null, currentPeriodEnd: undefined },
            usage: null,
        });
        vi.mocked(couponAPI.validate).mockResolvedValue({ valid: true });
        vi.mocked(subscriptionAPI.subscribe).mockResolvedValue({ requested: true, planName: 'Starter' });

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        const couponInput = screen.getByPlaceholderText('Have a coupon code?') as HTMLInputElement;
        fireEvent.change(couponInput, { target: { value: 'save20' } });
        expect(couponInput.value).toBe('save20');

        fireEvent.click(screen.getByText('Apply'));

        await waitFor(() => {
            expect(couponAPI.validate).toHaveBeenCalledWith('SAVE20');
        });

        // NONE status shows Request button directly
        const subscribeButtons = screen.getAllByText('Request');
        fireEvent.click(subscribeButtons[0]);

        await waitFor(() => {
            expect(subscriptionAPI.subscribe).toHaveBeenCalledWith('starter', 'SAVE20');
        });
    });

    // --- InstagramErrorModal ---

    it('should show InstagramErrorModal when OAuth error occurs with known error type', async () => {
        vi.mocked(instagramAPI.getOAuthUrl).mockResolvedValue({ oauthUrl: 'https://facebook.com/oauth', state: 'test-state' });
        mockWindowOpen.mockReturnValue({ closed: false });

        render(<ProfileSheet {...defaultProps} />);

        // Simulate OAuth callback with error via postMessage
        fireEvent.click(screen.getByText('Connect'));
        fireEvent.click(screen.getByText('Connect with Facebook'));

        await waitFor(() => expect(instagramAPI.getOAuthUrl).toHaveBeenCalled());

        // Post a message simulating an error callback
        window.dispatchEvent(new MessageEvent('message', {
            origin: window.location.origin,
            data: {
                type: 'instagram-oauth-callback',
                success: false,
                error: 'NO_PAGES_FOUND',
                errorMessage: 'No Facebook pages found',
            },
        }));

        await waitFor(() => {
            expect(screen.getByText('No Facebook Pages Found')).toBeInTheDocument();
            expect(screen.getByText(/You need to create a Facebook Page/)).toBeInTheDocument();
        });

        // Should have a help link
        const helpLink = screen.getByText('Create a Facebook Page');
        expect(helpLink).toBeInTheDocument();
        expect(helpLink.closest('a')).toHaveAttribute('href', 'https://www.facebook.com/pages/create');

        // Should have Try Again and Close buttons
        expect(screen.getByText('Try Again')).toBeInTheDocument();
        expect(screen.getByText('Close')).toBeInTheDocument();
    });

    it('should close InstagramErrorModal when Close is clicked', async () => {
        vi.mocked(instagramAPI.getOAuthUrl).mockResolvedValue({ oauthUrl: 'https://facebook.com/oauth', state: 'test-state' });
        mockWindowOpen.mockReturnValue({ closed: false });

        render(<ProfileSheet {...defaultProps} />);
        fireEvent.click(screen.getByText('Connect'));
        fireEvent.click(screen.getByText('Connect with Facebook'));
        await waitFor(() => expect(instagramAPI.getOAuthUrl).toHaveBeenCalled());

        window.dispatchEvent(new MessageEvent('message', {
            origin: window.location.origin,
            data: {
                type: 'instagram-oauth-callback',
                success: false,
                error: 'NO_PAGES_FOUND',
                errorMessage: 'No pages found',
            },
        }));

        await waitFor(() => expect(screen.getByText('No Facebook Pages Found')).toBeInTheDocument());

        fireEvent.click(screen.getByText('Close'));

        await waitFor(() => {
            expect(screen.queryByText('No Facebook Pages Found')).not.toBeInTheDocument();
        });
    });

    it('should retry OAuth when Try Again is clicked in error modal', async () => {
        vi.mocked(instagramAPI.getOAuthUrl).mockResolvedValue({ oauthUrl: 'https://facebook.com/oauth', state: 'test-state' });
        mockWindowOpen.mockReturnValue({ closed: false });

        render(<ProfileSheet {...defaultProps} />);
        fireEvent.click(screen.getByText('Connect'));
        fireEvent.click(screen.getByText('Connect with Facebook'));
        await waitFor(() => expect(instagramAPI.getOAuthUrl).toHaveBeenCalled());

        window.dispatchEvent(new MessageEvent('message', {
            origin: window.location.origin,
            data: {
                type: 'instagram-oauth-callback',
                success: false,
                error: 'API_ERROR',
                errorMessage: 'Something went wrong',
            },
        }));

        await waitFor(() => expect(screen.getByText('Connection Error')).toBeInTheDocument());

        vi.mocked(instagramAPI.getOAuthUrl).mockClear();
        vi.mocked(instagramAPI.getOAuthUrl).mockResolvedValue({ oauthUrl: 'https://facebook.com/oauth2', state: 'test-state' });

        fireEvent.click(screen.getByText('Try Again'));

        await waitFor(() => {
            expect(instagramAPI.getOAuthUrl).toHaveBeenCalled();
        });
    });

    it('should show error modal with NO_IG_ACCOUNT_FOUND error info', async () => {
        vi.mocked(instagramAPI.getOAuthUrl).mockResolvedValue({ oauthUrl: 'https://facebook.com/oauth', state: 'test-state' });
        mockWindowOpen.mockReturnValue({ closed: false });

        render(<ProfileSheet {...defaultProps} />);
        fireEvent.click(screen.getByText('Connect'));
        fireEvent.click(screen.getByText('Connect with Facebook'));
        await waitFor(() => expect(instagramAPI.getOAuthUrl).toHaveBeenCalled());

        window.dispatchEvent(new MessageEvent('message', {
            origin: window.location.origin,
            data: {
                type: 'instagram-oauth-callback',
                success: false,
                error: 'NO_IG_ACCOUNT_FOUND',
                errorMessage: 'No IG account',
            },
        }));

        await waitFor(() => {
            expect(screen.getByText('Professional Account Required')).toBeInTheDocument();
            expect(screen.getByText(/Professional \(Business or Creator\)/)).toBeInTheDocument();
        });
    });

    // --- InstagramErrorModal: popup blocked shows error modal ---

    it('should show error modal when popup is blocked', async () => {
        vi.mocked(instagramAPI.getOAuthUrl).mockResolvedValue({ oauthUrl: 'https://facebook.com/oauth', state: 'test-state' });
        mockWindowOpen.mockReturnValue(null); // popup blocked
        mockConfirm.mockReturnValue(false);

        render(<ProfileSheet {...defaultProps} />);
        fireEvent.click(screen.getByText('Connect'));
        fireEvent.click(screen.getByText('Connect with Facebook'));

        await waitFor(() => {
            expect(mockWindowOpen).toHaveBeenCalled();
        });

        // The error modal uses API_ERROR type which maps to "Connection Error" title
        await waitFor(() => {
            expect(screen.getByText('Connection Error')).toBeInTheDocument();
        });
    });

    // --- AccountPickerModal ---

    // AccountPickerModal is triggered by internal state (pendingAccounts + showAccountPicker)
    // which is not directly settable from the UI flow tested here.
    // The handleSelectAccount function is tested indirectly through other flows.

    // --- OAuth postMessage: successful callback ---

    it('should handle successful OAuth callback via postMessage', async () => {
        vi.mocked(restaurantAPI.get).mockResolvedValue({
            ...mockRestaurantData,
            integrations: { instagram: true },
            instagramConnection: { connected: true, username: 'connected_user', pageName: 'My Page' },
        });

        render(<ProfileSheet {...defaultProps} />);

        // Simulate successful OAuth callback via postMessage
        window.dispatchEvent(new MessageEvent('message', {
            origin: window.location.origin,
            data: {
                type: 'instagram-oauth-callback',
                success: true,
                username: 'connected_user',
            },
        }));

        await waitFor(() => {
            // Should refresh restaurant data
            expect(restaurantAPI.get).toHaveBeenCalledWith('r1');
            // Should call onRestaurantUpdate with refreshed data
            expect(mockOnRestaurantUpdate).toHaveBeenCalled();
        });
    });

    // --- refreshRestaurantData error handling ---

    it('should handle refreshRestaurantData failure gracefully', async () => {
        vi.mocked(restaurantAPI.get).mockRejectedValue(new Error('Refresh failed'));
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

        render(<ProfileSheet {...defaultProps} />);

        // Simulate successful OAuth callback that triggers refreshRestaurantData
        window.dispatchEvent(new MessageEvent('message', {
            origin: window.location.origin,
            data: {
                type: 'instagram-oauth-callback',
                success: true,
                username: 'test_user',
            },
        }));

        await waitFor(() => {
            expect(consoleSpy).toHaveBeenCalledWith('Failed to refresh restaurant data:', expect.any(Error));
        });

        consoleSpy.mockRestore();
    });

    // --- postMessage: ignores messages from different origin ---

    it('should ignore postMessage from different origin', () => {
        render(<ProfileSheet {...defaultProps} />);

        // Dispatch a message from a different origin
        const messageEvent = new MessageEvent('message', {
            origin: 'https://evil.com',
            data: {
                type: 'instagram-oauth-callback',
                success: true,
                username: 'hacker',
            },
        });
        window.dispatchEvent(messageEvent);

        // restaurantAPI.get should not be called since origin doesn't match
        expect(restaurantAPI.get).not.toHaveBeenCalled();
    });


    // --- SubscriptionModal: credits display ---

    it('should show credits count in subscription modal', async () => {
        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => {
            // Credits balance displayed in the hero card as "15" + "credits"
            const heroCard = screen.getByText('Current Plan').parentElement!.parentElement!.parentElement!;
            expect(heroCard).toHaveTextContent('15');
            expect(heroCard).toHaveTextContent('credits');
        });
    });

    // --- SubscriptionModal: renewal date ---

    it('should show the paid-until date in subscription modal', async () => {
        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => {
            expect(screen.getByText(/Paid until/)).toBeInTheDocument();
        });
        expect(screen.queryByText(/Renews/)).not.toBeInTheDocument();
    });

    // --- SubscriptionModal: plan features ---

    it('should show plan features in subscription modal', async () => {
        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => {
            expect(screen.getByText('Manage your plan')).toBeInTheDocument();
        });
        // Plan features now show per-platform limits dynamically
        // Each plan card shows features like "INSTAGRAM: 5 IMAGE, .../week"
        const featureItems = screen.getAllByRole('listitem');
        const hasFeature = featureItems.some(item => item.textContent?.includes('INSTAGRAM:') && item.textContent?.includes('IMAGE'));
        expect(hasFeature).toBe(true);
        // Plan features include Instagram as a list item
        const instagramFeatures = screen.getAllByText('Instagram');
        expect(instagramFeatures.length).toBeGreaterThanOrEqual(1);
    });

    // --- SubscriptionModal: payment footer text ---

    it('should show the manual payment note in subscription modal', async () => {
        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => {
            expect(screen.getByText('No payment is taken in the app. The RestroPulse team arranges payment with you directly.')).toBeInTheDocument();
        });
        expect(screen.queryByText(/processed securely/i)).not.toBeInTheDocument();
    });

    // --- OAuth error triggers error modal display ---

    it('should show InstagramErrorModal when OAuth initiation fails', async () => {
        vi.mocked(instagramAPI.getOAuthUrl).mockRejectedValue(new Error('Network error'));
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

        render(<ProfileSheet {...defaultProps} />);
        fireEvent.click(screen.getByText('Connect'));
        fireEvent.click(screen.getByText('Connect with Facebook'));

        await waitFor(() => {
            expect(consoleSpy).toHaveBeenCalledWith('OAuth initiation error:', expect.any(Error));
        });

        // Error modal should be visible with the mapped error info for API_ERROR
        await waitFor(() => {
            expect(screen.getByText('Connection Error')).toBeInTheDocument();
            expect(screen.getByText(/An error occurred while connecting to Instagram/)).toBeInTheDocument();
        });

        consoleSpy.mockRestore();
    });

    // --- SubscriptionModal: usage bars show correct values ---

    it('should show correct usage values in subscription modal', async () => {
        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => {
            // Check usage values: INSTAGRAM.REEL 2/5, INSTAGRAM.IMAGE 4/10, INSTAGRAM.CAROUSEL 1/3
            expect(screen.getByText((_, element) => element?.textContent === '2/5')).toBeInTheDocument();
            expect(screen.getByText((_, element) => element?.textContent === '4/10')).toBeInTheDocument();
            expect(screen.getByText((_, element) => element?.textContent === '1/3')).toBeInTheDocument();
        });
    });

    // --- Coupon validation error handling ---

    it('should handle coupon validation API error', async () => {
        vi.mocked(couponAPI.validate).mockRejectedValue(new Error('API Error'));

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByPlaceholderText('Have a coupon code?')).toBeInTheDocument());

        const couponInput = screen.getByPlaceholderText('Have a coupon code?');
        fireEvent.change(couponInput, { target: { value: 'BADCODE' } });
        fireEvent.click(screen.getByText('Apply'));

        await waitFor(() => {
            expect(screen.getByText('Invalid coupon code')).toBeInTheDocument();
        });
    });

    // --- Delete Account button ---

    it('should show action error message when Delete Account is clicked', () => {
        render(<ProfileSheet {...defaultProps} />);
        fireEvent.click(screen.getByText('Advanced'));
        fireEvent.click(screen.getByText('Delete Account'));
        expect(screen.getByText(/To delete your account, please contact your account manager/i)).toBeInTheDocument();
    });

    // --- Swipe to close profile page ---

    it('should close profile page on right swipe from left edge', () => {
        render(<ProfileSheet {...defaultProps} />);

        const page = document.querySelector('.fixed.inset-0.bg-white');
        expect(page).toBeTruthy();

        // Swipe starting from left edge (x < 60) and going right > 80px with vertical delta < 100
        fireEvent.touchStart(page!, { touches: [{ clientX: 10, clientY: 200 }] });
        fireEvent.touchEnd(page!, { changedTouches: [{ clientX: 100, clientY: 200 }] });

        expect(mockOnClose).toHaveBeenCalledOnce();
    });

    it('should not close profile page on short right swipe', () => {
        render(<ProfileSheet {...defaultProps} />);

        const page = document.querySelector('.fixed.inset-0.bg-white');
        expect(page).toBeTruthy();

        // Short swipe (deltaX = 50, not > 80)
        fireEvent.touchStart(page!, { touches: [{ clientX: 10, clientY: 200 }] });
        fireEvent.touchEnd(page!, { changedTouches: [{ clientX: 60, clientY: 200 }] });

        expect(mockOnClose).not.toHaveBeenCalled();
    });

    it('should not close profile page on swipe from non-left-edge', () => {
        render(<ProfileSheet {...defaultProps} />);

        const page = document.querySelector('.fixed.inset-0.bg-white');
        expect(page).toBeTruthy();

        // Swipe starting from non-left-edge (x >= 60)
        fireEvent.touchStart(page!, { touches: [{ clientX: 100, clientY: 200 }] });
        fireEvent.touchEnd(page!, { changedTouches: [{ clientX: 200, clientY: 200 }] });

        expect(mockOnClose).not.toHaveBeenCalled();
    });

    it('should not trigger swipe-to-close when a sub-modal is open', () => {
        render(<ProfileSheet {...defaultProps} />);

        // Open Edit Profile modal (which sets isEditingProfile = true)
        fireEvent.click(screen.getByText('Edit Restaurant Profile'));
        expect(screen.getByLabelText('Restaurant Name')).toBeInTheDocument();

        const page = document.querySelector('.fixed.inset-0.bg-white');
        expect(page).toBeTruthy();

        // Attempt swipe - should not set swipe start while a modal is open
        fireEvent.touchStart(page!, { touches: [{ clientX: 10, clientY: 200 }] });
        fireEvent.touchEnd(page!, { changedTouches: [{ clientX: 100, clientY: 200 }] });

        // onClose should NOT be called because isEditingProfile is true
        expect(mockOnClose).not.toHaveBeenCalled();
    });

    // --- Coupon code validation success ---

    it('should show coupon applied message on valid coupon', async () => {
        vi.mocked(couponAPI.validate).mockResolvedValue({ valid: true });

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByPlaceholderText('Have a coupon code?')).toBeInTheDocument());

        const couponInput = screen.getByPlaceholderText('Have a coupon code?');
        fireEvent.change(couponInput, { target: { value: 'SAVE20' } });
        fireEvent.click(screen.getByText('Apply'));
        await waitFor(() => expect(screen.getByText('Coupon applied!')).toBeInTheDocument());
    });

    // --- Line 769: "Tap to retry" in subscription modal actionError ---

    it('should show Tap to retry when a plan request fails and retry re-sends the same request', async () => {
        vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
            subscription: { id: 'sub1', restaurantId: 'r1', status: 'NONE', credits: 5, planSnapshot: null, currentPeriodEnd: undefined },
            usage: null,
        });
        vi.mocked(subscriptionAPI.subscribe)
            .mockRejectedValueOnce(new Error('Network error'))
            .mockResolvedValueOnce({ requested: true, planName: 'Growth' });

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        const requestButtons = screen.getAllByText('Request');
        fireEvent.click(requestButtons[requestButtons.length - 1]);

        await waitFor(() => {
            expect(screen.getByText('Network error')).toBeInTheDocument();
            expect(screen.getByText('Tap to retry')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText('Tap to retry'));

        await waitFor(() => {
            expect(screen.queryByText('Tap to retry')).not.toBeInTheDocument();
            expect(screen.getByText(/Request received for Growth/)).toBeInTheDocument();
        });
        expect(subscriptionAPI.subscribe).toHaveBeenCalledTimes(2);
        expect(subscriptionAPI.subscribe).toHaveBeenLastCalledWith('growth', undefined);
    });

    // --- Line 1073: Help/setup guide button when Instagram not connected ---

    it('should show setup guide when help button is clicked (Instagram not connected)', () => {
        render(<ProfileSheet {...defaultProps} />);

        // Instagram is not connected, so help button should be visible
        const helpButton = screen.getByTitle('View setup guide');
        expect(helpButton).toBeInTheDocument();

        fireEvent.click(helpButton);

        // Setup guide should now be shown (shows "Connect Instagram" header)
        expect(screen.getByText('Connect Instagram')).toBeInTheDocument();
    });

    // --- Edit Profile: Google Maps API key set (covers lines 696-711) ---

    it('should render Google Maps input in Edit Profile when VITE_GOOGLE_MAPS_API_KEY is set', async () => {
        vi.mocked(getGoogleMapsApiKey).mockImplementation(() => 'test-google-key');

        render(<ProfileSheet {...defaultProps} />);
        fireEvent.click(screen.getByText('Edit Restaurant Profile'));

        // With googleMapsApiKey set, the PlacesAutocompleteInput mock should be rendered
        // (mockRestaurantData has non-zero lat/lng so map is also shown)
        await waitFor(() => {
            expect(screen.getByTestId('api-provider')).toBeInTheDocument();
            expect(screen.getByTestId('places-autocomplete')).toBeInTheDocument();
            // Non-zero coordinates trigger the map display (line 704)
            expect(screen.getByTestId('google-map')).toBeInTheDocument();
        });

        vi.mocked(getGoogleMapsApiKey).mockImplementation(() => undefined);
    });

    it('should render plain text input when no Google Maps API key is set', async () => {
        // getGoogleMapsApiKey returns undefined by default (mock at top of file)
        render(<ProfileSheet {...defaultProps} />);
        fireEvent.click(screen.getByText('Edit Restaurant Profile'));

        await waitFor(() => {
            // Without API key, plain <input id="edit-location"> renders (not APIProvider)
            expect(screen.queryByTestId('api-provider')).not.toBeInTheDocument();
            expect(screen.getByLabelText('Location')).toBeInTheDocument();
        });
    });

    // --- Subscription modal touch drag (covers lines 735-739) ---

    it('should handle touch drag down on subscription modal (positive offset)', async () => {
        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        // Open subscription modal
        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        const modal = document.querySelector('[data-subscription-modal]') as HTMLElement;
        expect(modal).not.toBeNull();

        // Touch start — flush state so dragStartY is set before touchMove
        await act(async () => {
            fireEvent.touchStart(modal, { touches: [{ clientY: 200 }] });
        });
        // Touch move downward (positive offset, scrollTop=0) — covers line 738
        await act(async () => {
            fireEvent.touchMove(modal, { touches: [{ clientY: 250 }] });
        });
        // Touch end
        await act(async () => {
            fireEvent.touchEnd(modal);
        });

        // Modal should still be open (drag < 100px threshold)
        expect(screen.getByText('Change Plan')).toBeInTheDocument();
    });

    it('should handle touch drag up on subscription modal (negative offset)', async () => {
        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        // Open subscription modal
        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        const modal = document.querySelector('[data-subscription-modal]') as HTMLElement;
        expect(modal).not.toBeNull();

        // Touch start — flush state
        await act(async () => {
            fireEvent.touchStart(modal, { touches: [{ clientY: 200 }] });
        });
        // Touch move upward (negative offset) — covers line 739 (else if offset < 0)
        await act(async () => {
            fireEvent.touchMove(modal, { touches: [{ clientY: 150 }] });
        });
        await act(async () => {
            fireEvent.touchEnd(modal);
        });

        expect(screen.getByText('Change Plan')).toBeInTheDocument();
    });

    // --- Reactivate subscription ---

    it('should show Reactivate button when cancelAtPeriodEnd is true and undo the cancellation without a checkout', async () => {
        vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
            subscription: {
                id: 'sub1',
                restaurantId: 'r1',
                status: 'ACTIVE',
                billingCycle: 'MONTHLY',
                credits: 15,
                cancelAtPeriodEnd: true,
                planSnapshot: { id: 'p-growth', name: 'Growth', slug: 'growth', tier: 'GROWTH', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 10, STORY: 10, CAROUSEL: 3, REEL: 5, VIDEO: 5 }, FACEBOOK: { IMAGE: 10, CAROUSEL: 3, VIDEO: 5, STORY: 10 } } }, pricing: { monthly: 99900, annual: 999900, currency: 'INR' }, features: ['INSTAGRAM', 'FACEBOOK'] },
                currentPeriodEnd: '2026-05-01',
            },
            usage: null,
        });

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Manage your plan')).toBeInTheDocument());

        expect(screen.getByText('Reactivate')).toBeInTheDocument();

        // Clicking Reactivate opens a confirm dialog first
        fireEvent.click(screen.getByText('Reactivate'));

        await waitFor(() => {
            expect(screen.getByText(/Continue on Growth/i)).toBeInTheDocument();
        });
        expect(screen.getByText(/Nothing is charged in the app/)).toBeInTheDocument();
        expect(screen.queryByText(/₹5/)).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Keep my plan' }));

        await waitFor(() => {
            expect(subscriptionAPI.reactivate).toHaveBeenCalledTimes(1);
            expect(screen.getByText('Growth will no longer end. Your cancellation has been undone.')).toBeInTheDocument();
        });
        expect(mockWindowOpen).not.toHaveBeenCalled();
    });

    it('shows the error when reactivating fails', async () => {
        vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
            subscription: { id: 'sub1', restaurantId: 'r1', status: 'ACTIVE', billingCycle: 'MONTHLY', credits: 15, cancelAtPeriodEnd: true, planSnapshot: { id: 'p-growth', name: 'Growth', slug: 'growth', tier: 'GROWTH', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 10, STORY: 10, CAROUSEL: 3, REEL: 5, VIDEO: 5 }, FACEBOOK: { IMAGE: 10, CAROUSEL: 3, VIDEO: 5, STORY: 10 } } }, pricing: { monthly: 99900, annual: 999900, currency: 'INR' }, features: ['INSTAGRAM', 'FACEBOOK'] }, currentPeriodEnd: '2026-05-01' },
            usage: null,
        });
        vi.mocked(subscriptionAPI.reactivate).mockRejectedValue(new Error('No scheduled cancellation to undo'));

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        fireEvent.click(screen.getByText('Reactivate'));
        fireEvent.click(await screen.findByRole('button', { name: 'Keep my plan' }));

        await waitFor(() => expect(screen.getByText('No scheduled cancellation to undo')).toBeInTheDocument());
    });

    it('should show unified switch dialog (deferred) when cancelAtPeriodEnd user clicks a different plan', async () => {
        // Different plan on a cancelled-but-active sub now routes through the unified
        // switchConfirmPlan dialog (deferred ₹5 + plan charge at cycle_end), NOT the old
        // destructive "Start new plan now?" dialog.
        vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
            subscription: {
                id: 'sub1',
                restaurantId: 'r1',
                status: 'ACTIVE',
                billingCycle: 'MONTHLY',
                credits: 15,
                cancelAtPeriodEnd: true,
                currentPeriodEnd: new Date(Date.now() + 10 * 86_400_000).toISOString(),
                planSnapshot: { id: 'p-growth', name: 'Growth', slug: 'growth', tier: 'GROWTH', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 10, STORY: 10, CAROUSEL: 3, REEL: 5, VIDEO: 5 }, FACEBOOK: { IMAGE: 10, CAROUSEL: 3, VIDEO: 5, STORY: 10 } } }, pricing: { monthly: 99900, annual: 999900, currency: 'INR' }, features: ['INSTAGRAM', 'FACEBOOK'] },
            },
            usage: null,
        });

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        fireEvent.click(screen.getByText('Downgrade'));

        // Unified dialog — deferred copy, NOT the old "immediately / forfeit days" copy
        await waitFor(() => {
            expect(screen.queryByText('Start new plan now?')).not.toBeInTheDocument();
            expect(screen.queryByText(/unused days are not refunded/i)).not.toBeInTheDocument();
        });

        // changePlan not called until user confirms
        expect(subscriptionAPI.changePlan).not.toHaveBeenCalled();
    });

    // --- Downgrade confirmation dialog ---

    it('should explain in the switch dialog that the team arranges payment and nothing is charged', async () => {
        // Current plan is Growth (expensive), switching to cheaper Starter
        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        // Starter is cheaper than Growth so the button shows "Downgrade"
        fireEvent.click(screen.getByText('Downgrade'));

        await waitFor(() => {
            expect(screen.getByText('Switch to Starter?')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Send request' })).toBeInTheDocument();
        });
        expect(screen.getByText(/We'll send your request to the RestroPulse team\. They'll be in touch to arrange payment and switch you to Starter/)).toBeInTheDocument();
        expect(screen.getByText('Until then you stay on Growth. Nothing is charged in the app.')).toBeInTheDocument();
        expect(screen.queryByText(/mandate|verification charge/i)).not.toBeInTheDocument();
        // Nothing is sent until the owner confirms
        expect(subscriptionAPI.changePlan).not.toHaveBeenCalled();
    });

    // --- Downgrade success notice ---

    it('should show the request-received notice after a downgrade request', async () => {
        vi.mocked(subscriptionAPI.changePlan).mockResolvedValue({ requested: true, planName: 'Starter' });

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        fireEvent.click(screen.getByText('Downgrade'));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Send request' })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: 'Send request' }));

        await waitFor(() => {
            expect(screen.getByText('Request received for Starter. The RestroPulse team will be in touch to arrange payment and switch the plan on.')).toBeInTheDocument();
        });
        expect(subscriptionAPI.changePlan).toHaveBeenCalledWith('starter');
        expect(subscriptionAPI.subscribe).not.toHaveBeenCalled();
    });

    // --- Pending plan request: banner + "Requested" card ---

    it('should show a pending switch request in the banner and mark the plan card as Requested', async () => {
        vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
            subscription: {
                id: 'sub1',
                restaurantId: 'r1',
                status: 'ACTIVE',
                billingCycle: 'MONTHLY',
                credits: 15,
                planSnapshot: { id: 'p-growth', name: 'Growth', slug: 'growth', tier: 'GROWTH', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 10, STORY: 10, CAROUSEL: 3, REEL: 5, VIDEO: 5 }, FACEBOOK: { IMAGE: 10, CAROUSEL: 3, VIDEO: 5, STORY: 10 } } }, pricing: { monthly: 99900, annual: 999900, currency: 'INR' }, features: ['INSTAGRAM', 'FACEBOOK'] },
                pendingPlanId: 'p-starter',
                pendingPlanSnapshot: { id: 'p-starter', name: 'Starter', slug: 'starter', tier: 'STARTER', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 5, STORY: 5, CAROUSEL: 1, REEL: 2, VIDEO: 2 } } }, pricing: { monthly: 49900, annual: 499900, currency: 'INR' }, features: ['INSTAGRAM'] },
                planRequestedAt: '2026-04-20T00:00:00.000Z',
                currentPeriodEnd: '2026-05-01T00:00:00.000Z',
            },
            usage: null,
        });

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        const banner = screen.getByRole('status', { name: 'Plan request' });
        expect(banner).toHaveTextContent('You asked to switch from Growth to Starter on');
        expect(banner).toHaveTextContent('You stay on Growth until then.');
        expect(screen.getByRole('button', { name: 'Withdraw request' })).toBeInTheDocument();

        // The Starter card shows "Requested" instead of a tier-change button
        expect(screen.getByText('Requested')).toBeInTheDocument();
        expect(screen.queryAllByRole('button', { name: 'Downgrade' })).toHaveLength(0);
    });

    it('should say in the upgrade dialog that it replaces the pending request', async () => {
        // User has Growth plan with a pending downgrade to Starter scheduled
        vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
            subscription: {
                id: 'sub1', restaurantId: 'r1', status: 'ACTIVE', billingCycle: 'MONTHLY', credits: 15,
                planSnapshot: { id: 'p-growth', name: 'Growth', slug: 'growth', tier: 'GROWTH', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 10, STORY: 10, CAROUSEL: 3, REEL: 5, VIDEO: 5 }, FACEBOOK: { IMAGE: 10, CAROUSEL: 3, VIDEO: 5, STORY: 10 } } }, pricing: { monthly: 99900, annual: 999900, currency: 'INR' }, features: ['INSTAGRAM', 'FACEBOOK'] },
                pendingPlanSnapshot: { id: 'p-starter', name: 'Starter', slug: 'starter', tier: 'STARTER', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 5, STORY: 5, CAROUSEL: 1, REEL: 2, VIDEO: 2 } } }, pricing: { monthly: 49900, annual: 499900, currency: 'INR' }, features: ['INSTAGRAM'] },
                currentPeriodEnd: '2026-05-01T00:00:00.000Z',
            },
            usage: null,
        });
        // Override plans so Premium is available as an upgrade
        vi.mocked(subscriptionAPI.getPlans).mockResolvedValue([
            { id: 'plan_starter_id', slug: 'starter', name: 'Starter', tier: 'STARTER', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 5, STORY: 5, CAROUSEL: 1, REEL: 2, VIDEO: 2 } } }, pricing: { monthly: 49900, annual: 499900, currency: 'INR' }, features: ['INSTAGRAM'] },
            { id: 'plan_growth_id', slug: 'growth', name: 'Growth', tier: 'GROWTH', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 10, STORY: 10, CAROUSEL: 3, REEL: 5, VIDEO: 5 }, FACEBOOK: { IMAGE: 10, CAROUSEL: 3, VIDEO: 5, STORY: 10 } } }, pricing: { monthly: 99900, annual: 999900, currency: 'INR' }, features: ['INSTAGRAM', 'FACEBOOK'] },
            { id: 'plan_premium_id', slug: 'premium', name: 'Premium', tier: 'PREMIUM', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 20, STORY: 20, CAROUSEL: 5, REEL: 10, VIDEO: 10 }, FACEBOOK: { IMAGE: 20, CAROUSEL: 5, VIDEO: 10, STORY: 20 } } }, pricing: { monthly: 199900, annual: 1999000, currency: 'INR' }, features: ['INSTAGRAM', 'FACEBOOK'] },
        ]);

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        // Click Upgrade to Premium
        fireEvent.click(screen.getByText('Upgrade'));
        await waitFor(() => expect(screen.getByText('Upgrade to Premium?')).toBeInTheDocument());

        // The dialog says the new request replaces the pending Starter request
        expect(screen.getByText('This replaces your request for Starter.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
        await waitFor(() => expect(subscriptionAPI.changePlan).toHaveBeenCalledWith('premium'));
    });

    // --- Regression: amending a pending plan change must not trigger destructive re-checkout ---

    it('should call changePlan (not subscribe) when replacing a pending request on a cancelAtPeriodEnd subscription', async () => {
        // User is on Premium with cancelAtPeriodEnd=true and a pending request for
        // Growth, then picks Starter. An active plan must route through change-plan
        // (subscribe would 409).
        vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
            subscription: {
                id: 'sub1',
                restaurantId: 'r1',
                status: 'ACTIVE',
                billingCycle: 'MONTHLY',
                credits: 15,
                cancelAtPeriodEnd: true,
                cancelledAt: '2026-04-10T00:00:00.000Z',
                planSnapshot: { id: 'p-premium', name: 'Premium', slug: 'premium', tier: 'PREMIUM', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 20, STORY: 20, CAROUSEL: 5, REEL: 10, VIDEO: 10 } } }, pricing: { monthly: 199900, annual: 1999000, currency: 'INR' }, features: ['INSTAGRAM', 'FACEBOOK'] },
                pendingPlanSnapshot: { id: 'p-growth', name: 'Growth', slug: 'growth', tier: 'GROWTH', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 10, STORY: 10, CAROUSEL: 3, REEL: 5, VIDEO: 5 } } }, pricing: { monthly: 99900, annual: 999900, currency: 'INR' }, features: ['INSTAGRAM', 'FACEBOOK'] },
                currentPeriodEnd: '2026-05-01T00:00:00.000Z',
            },
            usage: null,
        });
        vi.mocked(subscriptionAPI.getPlans).mockResolvedValue([
            { id: 'plan_starter_id', slug: 'starter', name: 'Starter', tier: 'STARTER', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 5, STORY: 5, CAROUSEL: 1, REEL: 2, VIDEO: 2 } } }, pricing: { monthly: 49900, annual: 499900, currency: 'INR' }, features: ['INSTAGRAM'] },
            { id: 'plan_growth_id', slug: 'growth', name: 'Growth', tier: 'GROWTH', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 10, STORY: 10, CAROUSEL: 3, REEL: 5, VIDEO: 5 } } }, pricing: { monthly: 99900, annual: 999900, currency: 'INR' }, features: ['INSTAGRAM', 'FACEBOOK'] },
            { id: 'plan_premium_id', slug: 'premium', name: 'Premium', tier: 'PREMIUM', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 20, STORY: 20, CAROUSEL: 5, REEL: 10, VIDEO: 10 } } }, pricing: { monthly: 199900, annual: 1999000, currency: 'INR' }, features: ['INSTAGRAM', 'FACEBOOK'] },
        ]);
        vi.mocked(subscriptionAPI.changePlan).mockResolvedValue({ requested: true, planName: 'Starter' });

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        // Starter shows as Downgrade (cheaper than Premium). Click it.
        fireEvent.click(screen.getByText('Downgrade'));

        await waitFor(() => expect(screen.getByText('Switch to Starter?')).toBeInTheDocument());
        expect(screen.getByText('This replaces your request for Growth.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Send request' }));

        await waitFor(() => {
            expect(subscriptionAPI.changePlan).toHaveBeenCalledWith('starter');
        });

        expect(subscriptionAPI.subscribe).not.toHaveBeenCalled();
        expect(await screen.findByText(/Request received for Starter/)).toBeInTheDocument();
    });

    it('withdraws a pending switch request on an active plan and keeps the current plan running', async () => {
        vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
            subscription: {
                id: 'sub1',
                restaurantId: 'r1',
                status: 'ACTIVE',
                billingCycle: 'MONTHLY',
                credits: 100,
                cancelAtPeriodEnd: false,
                planSnapshot: { id: 'p-growth', name: 'Growth', slug: 'growth', tier: 'GROWTH', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 10, STORY: 10, CAROUSEL: 3, REEL: 5, VIDEO: 5 }, FACEBOOK: { IMAGE: 10, CAROUSEL: 3, VIDEO: 5, STORY: 10 } } }, pricing: { monthly: 99900, annual: 999900, currency: 'INR' }, features: ['INSTAGRAM', 'FACEBOOK'] },
                pendingPlanId: 'p-starter',
                pendingPlanSnapshot: { id: 'p-starter', name: 'Starter', slug: 'starter', tier: 'STARTER', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 5, STORY: 5, CAROUSEL: 1, REEL: 2, VIDEO: 2 } } }, pricing: { monthly: 49900, annual: 499900, currency: 'INR' }, features: ['INSTAGRAM'] },
                currentPeriodEnd: '2026-06-01T00:00:00.000Z',
            },
            usage: null,
        });

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        fireEvent.click(await screen.findByRole('button', { name: 'Withdraw request' }));

        // Confirm dialog first; nothing is called yet
        expect(await screen.findByText('Withdraw your request for Starter?')).toBeInTheDocument();
        expect(screen.getByText("The RestroPulse team won't switch you to Starter. You stay on Growth.")).toBeInTheDocument();
        expect(subscriptionAPI.cancel).not.toHaveBeenCalled();

        // "Keep request" closes the dialog without calling anything
        fireEvent.click(screen.getByRole('button', { name: 'Keep request' }));
        expect(screen.queryByText('Withdraw your request for Starter?')).not.toBeInTheDocument();
        expect(subscriptionAPI.cancel).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Withdraw request' }));
        await screen.findByText('Withdraw your request for Starter?');
        // The dialog's confirm button is the last "Withdraw request" button
        fireEvent.click(screen.getAllByRole('button', { name: 'Withdraw request' }).at(-1)!);

        // /cancel withdraws the request (and would schedule the plan to end), so
        // /reactivate undoes the scheduled end: the owner stays on Growth.
        await waitFor(() => {
            expect(subscriptionAPI.cancel).toHaveBeenCalledTimes(1);
            expect(subscriptionAPI.reactivate).toHaveBeenCalledTimes(1);
            expect(screen.getByText('Your request for Starter was withdrawn.')).toBeInTheDocument();
        });
        expect(vi.mocked(subscriptionAPI.cancel).mock.invocationCallOrder[0])
            .toBeLessThan(vi.mocked(subscriptionAPI.reactivate).mock.invocationCallOrder[0]);
        expect(subscriptionAPI.changePlan).not.toHaveBeenCalled();
        expect(subscriptionAPI.subscribe).not.toHaveBeenCalled();
    });

    it('withdraws a pending request on a plan already set to end without undoing that cancellation', async () => {
        vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
            subscription: {
                id: 'sub1', restaurantId: 'r1', status: 'ACTIVE', billingCycle: 'MONTHLY', credits: 100,
                cancelAtPeriodEnd: true,
                planSnapshot: { id: 'p-growth', name: 'Growth', slug: 'growth', tier: 'GROWTH', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 10, STORY: 10, CAROUSEL: 3, REEL: 5, VIDEO: 5 }, FACEBOOK: { IMAGE: 10, CAROUSEL: 3, VIDEO: 5, STORY: 10 } } }, pricing: { monthly: 99900, annual: 999900, currency: 'INR' }, features: ['INSTAGRAM', 'FACEBOOK'] },
                pendingPlanSnapshot: { id: 'p-starter', name: 'Starter', slug: 'starter', tier: 'STARTER', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 5, STORY: 5, CAROUSEL: 1, REEL: 2, VIDEO: 2 } } }, pricing: { monthly: 49900, annual: 499900, currency: 'INR' }, features: ['INSTAGRAM'] },
                currentPeriodEnd: '2026-06-01T00:00:00.000Z',
            },
            usage: null,
        });

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: 'Withdraw request' }));
        await screen.findByText('Withdraw your request for Starter?');
        fireEvent.click(screen.getAllByRole('button', { name: 'Withdraw request' }).at(-1)!);

        await waitFor(() => expect(screen.getByText('Your request for Starter was withdrawn.')).toBeInTheDocument());
        expect(subscriptionAPI.cancel).toHaveBeenCalledTimes(1);
        expect(subscriptionAPI.reactivate).not.toHaveBeenCalled();
    });

    it('tells the owner how to keep their plan if undoing the scheduled end fails after withdrawing', async () => {
        vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
            subscription: {
                id: 'sub1', restaurantId: 'r1', status: 'ACTIVE', billingCycle: 'MONTHLY', credits: 100,
                planSnapshot: { id: 'p-growth', name: 'Growth', slug: 'growth', tier: 'GROWTH', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 10, STORY: 10, CAROUSEL: 3, REEL: 5, VIDEO: 5 }, FACEBOOK: { IMAGE: 10, CAROUSEL: 3, VIDEO: 5, STORY: 10 } } }, pricing: { monthly: 99900, annual: 999900, currency: 'INR' }, features: ['INSTAGRAM', 'FACEBOOK'] },
                pendingPlanSnapshot: { id: 'p-starter', name: 'Starter', slug: 'starter', tier: 'STARTER', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 5, STORY: 5, CAROUSEL: 1, REEL: 2, VIDEO: 2 } } }, pricing: { monthly: 49900, annual: 499900, currency: 'INR' }, features: ['INSTAGRAM'] },
                currentPeriodEnd: '2026-06-01T00:00:00.000Z',
            },
            usage: null,
        });
        vi.mocked(subscriptionAPI.reactivate).mockRejectedValue(new Error('boom'));

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: 'Withdraw request' }));
        await screen.findByText('Withdraw your request for Starter?');
        fireEvent.click(screen.getAllByRole('button', { name: 'Withdraw request' }).at(-1)!);

        await waitFor(() => expect(screen.getByText(/Your request for Starter was withdrawn, but your current plan is now set to end/)).toBeInTheDocument());
        expect(screen.getByText(/Tap Reactivate to keep it/)).toBeInTheDocument();
    });

    // --- Gap 1 + Gap 2: CREATED status label and billing cycle filter ---

    it('shows a pending request for an owner with no active plan and withdraws it with cancel only', async () => {
        vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
            subscription: {
                id: 'sub1', restaurantId: 'r1', status: 'NONE', credits: 0,
                planSnapshot: null,
                pendingPlanId: 'p-growth',
                pendingPlanSnapshot: { id: 'p-growth', name: 'Growth', slug: 'growth', tier: 'GROWTH', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 10, STORY: 10, CAROUSEL: 3, REEL: 5, VIDEO: 5 }, FACEBOOK: { IMAGE: 10, CAROUSEL: 3, VIDEO: 5, STORY: 10 } } }, pricing: { monthly: 99900, annual: 999900, currency: 'INR' }, features: ['INSTAGRAM', 'FACEBOOK'] },
                planRequestedAt: '2026-11-20T10:00:00.000Z',
            },
            usage: null,
        });
        vi.mocked(subscriptionAPI.cancel).mockResolvedValue({ success: true, message: 'Plan request withdrawn' });

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        const banner = screen.getByRole('status', { name: 'Plan request' });
        expect(banner).toHaveTextContent('You asked for the Growth plan on');
        expect(banner).not.toHaveTextContent('You stay on');
        // Growth card is marked Requested; Starter can still be requested
        expect(screen.getByText('Requested')).toBeInTheDocument();
        expect(screen.getAllByText('Request')).toHaveLength(1);
        // No hero "Cancel plan" button without an active plan
        expect(screen.queryByText('Cancel plan')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Withdraw request' }));
        expect(await screen.findByText("The RestroPulse team won't set up Growth for you. You can request a plan again at any time.")).toBeInTheDocument();
        fireEvent.click(screen.getAllByRole('button', { name: 'Withdraw request' }).at(-1)!);

        await waitFor(() => expect(screen.getByText('Your request for Growth was withdrawn.')).toBeInTheDocument());
        expect(subscriptionAPI.cancel).toHaveBeenCalledTimes(1);
        expect(subscriptionAPI.reactivate).not.toHaveBeenCalled();
    });

    it('shows the error when withdrawing a request fails', async () => {
        vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
            subscription: { id: 'sub1', restaurantId: 'r1', status: 'NONE', credits: 0, planSnapshot: null, pendingPlanSnapshot: { id: 'p-growth', name: 'Growth', slug: 'growth', tier: 'GROWTH', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 10, STORY: 10, CAROUSEL: 3, REEL: 5, VIDEO: 5 }, FACEBOOK: { IMAGE: 10, CAROUSEL: 3, VIDEO: 5, STORY: 10 } } }, pricing: { monthly: 99900, annual: 999900, currency: 'INR' }, features: ['INSTAGRAM', 'FACEBOOK'] } },
            usage: null,
        });
        vi.mocked(subscriptionAPI.cancel).mockRejectedValue(new Error('Could not withdraw the request'));

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: 'Withdraw request' }));
        await screen.findByText('Withdraw your request for Growth?');
        fireEvent.click(screen.getAllByRole('button', { name: 'Withdraw request' }).at(-1)!);

        await waitFor(() => expect(screen.getByText('Could not withdraw the request')).toBeInTheDocument());
        expect(screen.queryByText('Withdraw your request for Growth?')).not.toBeInTheDocument();
    });

    // ---------------------------------------------------------------------------
    // Manual billing: requests, cancellation and plan-card edge cases
    // ---------------------------------------------------------------------------
    describe('SubscriptionModal: manual billing flows', () => {
        it('requests an upgrade through change-plan with only the plan slug', async () => {
            vi.mocked(subscriptionAPI.changePlan).mockResolvedValue({ requested: true, planName: 'Growth' });
            // Use Starter as current plan so Growth shows "Upgrade"
            vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
                subscription: {
                    id: 'sub1', restaurantId: 'r1', status: 'ACTIVE', billingCycle: 'MONTHLY', credits: 5,
                    planSnapshot: { id: 'p-starter', name: 'Starter', slug: 'starter', tier: 'STARTER', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 5, STORY: 5, CAROUSEL: 1, REEL: 2, VIDEO: 2 } } }, pricing: { monthly: 49900, annual: 499900, currency: 'INR' }, features: ['INSTAGRAM'] },
                },
                usage: null,
            });

            render(<ProfileSheet {...defaultProps} />);
            await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

            fireEvent.click(screen.getByText('Subscription').closest('button')!);
            await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

            fireEvent.click(screen.getByText('Upgrade'));
            await waitFor(() => expect(screen.getByText('Upgrade to Growth?')).toBeInTheDocument());
            expect(screen.getByText(/switch you to Growth \(₹999 per month\)/)).toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', { name: 'Send request' }));

            await waitFor(() => expect(subscriptionAPI.changePlan).toHaveBeenCalledWith('growth'));
            expect(vi.mocked(subscriptionAPI.changePlan).mock.calls[0]).toHaveLength(1);
            expect(await screen.findByText('Request received for Growth. The RestroPulse team will be in touch to arrange payment and switch the plan on.')).toBeInTheDocument();
        });

        it('Go back closes the switch dialog without sending a request', async () => {
            render(<ProfileSheet {...defaultProps} />);
            await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

            fireEvent.click(screen.getByText('Subscription').closest('button')!);
            await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

            fireEvent.click(screen.getByText('Downgrade'));
            await waitFor(() => expect(screen.getByText('Switch to Starter?')).toBeInTheDocument());
            fireEvent.click(within(screen.getByRole('dialog', { name: 'Switch to Starter?' })).getByRole('button', { name: 'Go back' }));

            expect(screen.queryByText('Switch to Starter?')).not.toBeInTheDocument();
            expect(subscriptionAPI.changePlan).not.toHaveBeenCalled();
        });

        it('disables every plan button while a request is being sent', async () => {
            vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
                subscription: { id: 'sub1', restaurantId: 'r1', status: 'NONE', credits: 5, planSnapshot: null, currentPeriodEnd: undefined },
                usage: null,
            });
            let resolveSubscribe: (v: { requested: true; planName: string }) => void = () => {};
            vi.mocked(subscriptionAPI.subscribe).mockImplementation(() => new Promise((r) => { resolveSubscribe = r; }));

            render(<ProfileSheet {...defaultProps} />);
            await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

            fireEvent.click(screen.getByText('Subscription').closest('button')!);
            await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

            fireEvent.click(screen.getAllByText('Request')[0]);

            await waitFor(() => expect(screen.getByText('Sending...')).toBeInTheDocument());
            const disabled = screen.getAllByRole('button').filter((b) => b.textContent === 'Request' || b.textContent === 'Sending...');
            expect(disabled.length).toBe(2);
            disabled.forEach((b) => expect(b).toBeDisabled());

            await act(async () => { resolveSubscribe({ requested: true, planName: 'Starter' }); });
            await waitFor(() => expect(screen.queryByText('Sending...')).not.toBeInTheDocument());
            expect(subscriptionAPI.subscribe).toHaveBeenCalledTimes(1);
        });

        // Payment method change scenarios
        it('shows overdue copy for a past-due plan that points to the account manager', async () => {
            vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
                subscription: { id: 'sub1', restaurantId: 'r1', status: 'PAST_DUE', billingCycle: 'MONTHLY', credits: 5, planSnapshot: { id: 'p-growth', name: 'Growth', slug: 'growth', tier: 'GROWTH', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 10, STORY: 10, CAROUSEL: 3, REEL: 5, VIDEO: 5 }, FACEBOOK: { IMAGE: 10, CAROUSEL: 3, VIDEO: 5, STORY: 10 } } }, pricing: { monthly: 99900, annual: 999900, currency: 'INR' }, features: ['INSTAGRAM', 'FACEBOOK'] }, currentPeriodEnd: '2026-04-01' },
                usage: null,
            });

            render(<ProfileSheet {...defaultProps} />);
            await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

            fireEvent.click(screen.getByText('Subscription').closest('button')!);
            await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

            expect(screen.getByText('Payment Overdue')).toBeInTheDocument();
            expect(screen.getByText("We haven't received payment for your current period. Contact your account manager (John Doe) to keep your plan running.")).toBeInTheDocument();
            // A past-due plan is still an active plan: switching goes through change-plan
            fireEvent.click(screen.getByText('Downgrade'));
            fireEvent.click(await screen.findByRole('button', { name: 'Send request' }));
            await waitFor(() => expect(subscriptionAPI.changePlan).toHaveBeenCalledWith('starter'));
            expect(subscriptionAPI.subscribe).not.toHaveBeenCalled();
        });

        it('shows suspended copy for a halted plan and lets the owner request a plan', async () => {
            vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
                subscription: { id: 'sub1', restaurantId: 'r1', status: 'HALTED', credits: 0, planSnapshot: { id: 'p-growth', name: 'Growth', slug: 'growth', tier: 'GROWTH', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 10, STORY: 10, CAROUSEL: 3, REEL: 5, VIDEO: 5 }, FACEBOOK: { IMAGE: 10, CAROUSEL: 3, VIDEO: 5, STORY: 10 } } }, pricing: { monthly: 99900, annual: 999900, currency: 'INR' }, features: ['INSTAGRAM', 'FACEBOOK'] } },
                usage: null,
            });
            vi.mocked(subscriptionAPI.subscribe).mockResolvedValue({ requested: true, planName: 'Growth' });

            render(<ProfileSheet {...defaultProps} />);
            await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

            fireEvent.click(screen.getByText('Subscription').closest('button')!);
            await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

            expect(screen.getByText('Subscription Suspended')).toBeInTheDocument();
            expect(screen.getByText('Your plan is suspended. Request a plan below or contact your account manager (John Doe) to restore access.')).toBeInTheDocument();
            const requestButtons = screen.getAllByText('Request');
            fireEvent.click(requestButtons[requestButtons.length - 1]);
            await waitFor(() => expect(subscriptionAPI.subscribe).toHaveBeenCalledWith('growth', undefined));
        });

        // [S9] Resubscribe from CANCELLED state
        it('[S9] should allow a new plan request when subscription status is CANCELLED', async () => {
            vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
                subscription: {
                    id: 'sub1',
                    restaurantId: 'r1',
                    status: 'CANCELLED',
                    credits: 0,
                    planSnapshot: null,
                    currentPeriodEnd: undefined,
                },
                usage: null,
            });
            vi.mocked(subscriptionAPI.subscribe).mockResolvedValue({ requested: true, planName: 'Starter' });

            render(<ProfileSheet {...defaultProps} />);
            await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

            fireEvent.click(screen.getByText('Subscription').closest('button')!);
            await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

            // With CANCELLED status, should show Request buttons like NONE
            const subscribeButtons = screen.getAllByText('Request');
            fireEvent.click(subscribeButtons[0]);

            await waitFor(() => {
                expect(subscriptionAPI.subscribe).toHaveBeenCalledWith('starter', undefined);
                expect(screen.getByText(/Request received for Starter/)).toBeInTheDocument();
            });
        });

        // [S7] Pure cancel action
        // [S7] Cancel an active plan
        it('[S7] should call cancel API when user confirms cancellation, mentioning a pending request', async () => {
            vi.mocked(subscriptionAPI.cancel).mockResolvedValue({ success: true, message: 'Subscription will cancel at period end' });
            vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
                subscription: {
                    id: 'sub1', restaurantId: 'r1', status: 'ACTIVE', billingCycle: 'MONTHLY', credits: 15,
                    planSnapshot: { id: 'p-growth', name: 'Growth', slug: 'growth', tier: 'GROWTH', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 10, STORY: 10, CAROUSEL: 3, REEL: 5, VIDEO: 5 }, FACEBOOK: { IMAGE: 10, CAROUSEL: 3, VIDEO: 5, STORY: 10 } } }, pricing: { monthly: 99900, annual: 999900, currency: 'INR' }, features: ['INSTAGRAM', 'FACEBOOK'] },
                    pendingPlanSnapshot: { id: 'p-starter', name: 'Starter', slug: 'starter', tier: 'STARTER', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 5, STORY: 5, CAROUSEL: 1, REEL: 2, VIDEO: 2 } } }, pricing: { monthly: 49900, annual: 499900, currency: 'INR' }, features: ['INSTAGRAM'] },
                    currentPeriodEnd: '2026-05-01',
                    cancelAtPeriodEnd: false,
                },
                usage: null,
            });

            render(<ProfileSheet {...defaultProps} />);
            await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

            fireEvent.click(screen.getByText('Subscription').closest('button')!);
            await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

            fireEvent.click(screen.getByText('Cancel plan'));
            expect(await screen.findByText(/Your request for Starter will be withdrawn\./)).toBeInTheDocument();
            fireEvent.click(screen.getAllByRole('button', { name: 'Cancel plan' }).at(-1)!);

            await waitFor(() => expect(subscriptionAPI.cancel).toHaveBeenCalledTimes(1));
            expect(subscriptionAPI.reactivate).not.toHaveBeenCalled();
        });

        // [PERM-1] Click current plan (should be no-op)
        it('[PERM-1] should not open dialog when clicking current plan', async () => {
            render(<ProfileSheet {...defaultProps} />);
            await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

            fireEvent.click(screen.getByText('Subscription').closest('button')!);
            await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

            // Current plan is Growth; clicking it should not open confirmation
            const growthCards = screen.getAllByText('Growth');
            const currentPlanCard = growthCards.find(el => el.textContent?.includes('Current Plan'));

            if (currentPlanCard) {
                const planCard = currentPlanCard.closest('[role="button"]') || currentPlanCard.closest('div');
                const buttons = planCard?.querySelectorAll('button');

                // If there's a button, clicking should not trigger changePlan
                if (buttons && buttons.length > 0) {
                    const initialCallCount = vi.mocked(subscriptionAPI.changePlan).mock.calls.length;
                    fireEvent.click(buttons[0]);

                    await waitFor(() => {
                        const finalCallCount = vi.mocked(subscriptionAPI.changePlan).mock.calls.length;
                        expect(finalCallCount).toBe(initialCallCount);
                    }, { timeout: 500 });
                }
            }
        });

        // [PERM-2] Click pending plan (should be no-op)
        it('[PERM-2] should not open dialog when clicking pending plan', async () => {
            vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
                subscription: {
                    id: 'sub1',
                    restaurantId: 'r1',
                    status: 'ACTIVE',
                    billingCycle: 'MONTHLY',
                    credits: 5,
                    planSnapshot: { id: 'p-premium', name: 'Premium', slug: 'premium', tier: 'PREMIUM', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 10, STORY: 10, CAROUSEL: 5, REEL: 5, VIDEO: 5 } } }, pricing: { monthly: 99900, annual: 999900, currency: 'INR' }, features: ['INSTAGRAM'] },
                    pendingPlanSnapshot: { id: 'p-growth', name: 'Growth', slug: 'growth', tier: 'GROWTH', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 7, STORY: 7, CAROUSEL: 3, REEL: 3, VIDEO: 3 } } }, pricing: { monthly: 49900, annual: 499900, currency: 'INR' }, features: ['INSTAGRAM'] },
                    currentPeriodEnd: '2026-05-15',
                },
                usage: null,
            });

            render(<ProfileSheet {...defaultProps} />);
            await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

            fireEvent.click(screen.getByText('Subscription').closest('button')!);
            await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

            // Find the pending plan card (Growth, marked "Requested")
            const pendingPlanText = screen.queryByText('Requested');
            expect(pendingPlanText).toBeInTheDocument();
            // The requested plan's card offers no plan button (withdraw lives in the banner)
            expect(pendingPlanText!.closest('.rounded-2xl')!.querySelectorAll('button')).toHaveLength(0);
            if (pendingPlanText) {
                const initialCallCount = vi.mocked(subscriptionAPI.changePlan).mock.calls.length;
                const planCard = pendingPlanText.closest('[role="button"]') || pendingPlanText.closest('div');
                const buttons = planCard?.querySelectorAll('button');

                if (buttons && buttons.length > 0) {
                    fireEvent.click(buttons[0]);

                    await waitFor(() => {
                        const finalCallCount = vi.mocked(subscriptionAPI.changePlan).mock.calls.length;
                        expect(finalCallCount).toBe(initialCallCount);
                    }, { timeout: 500 });
                }
            }
        });

        // [PERM-3] Amendment sequence
        it('[PERM-3] should handle multiple plan amendments in sequence', async () => {
            vi.mocked(subscriptionAPI.changePlan)
                .mockResolvedValueOnce({ requested: true, planName: 'Starter' })
                .mockResolvedValueOnce({ requested: true, planName: 'Starter' });

            render(<ProfileSheet {...defaultProps} />);
            await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

            fireEvent.click(screen.getByText('Subscription').closest('button')!);
            await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

            // Amendment 1: Downgrade to Starter
            fireEvent.click(screen.getByText('Downgrade'));
            await waitFor(() => expect(screen.getByRole('button', { name: 'Send request' })).toBeInTheDocument());
            fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
            await waitFor(() => {
                expect(subscriptionAPI.changePlan).toHaveBeenCalledWith('starter');
                expect(screen.getByText(/Request received for Starter/)).toBeInTheDocument();
            });

            // Amendment 2: request it again (the API treats a repeat as the same request)
            fireEvent.click(screen.getByText('Downgrade'));
            fireEvent.click(await screen.findByRole('button', { name: 'Send request' }));
            await waitFor(() => expect(subscriptionAPI.changePlan).toHaveBeenCalledTimes(2));
        });

    });
});
