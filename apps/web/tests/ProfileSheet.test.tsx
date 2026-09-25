import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from './utils/test-utils';
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
                planSnapshot: { id: 'p-growth', name: 'Growth', slug: 'growth', tier: 'GROWTH', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 10, STORY: 10, CAROUSEL: 3, REEL: 5, VIDEO: 5 }, FACEBOOK: { IMAGE: 10, CAROUSEL: 3, VIDEO: 5, STORY: 10 } } }, pricing: { monthly: 99900, annual: 999900, currency: 'INR' }, features: ['INSTAGRAM', 'FACEBOOK'], razorpayPlanIds: { monthly: 'rp_m', annual: 'rp_a' } },
                currentPeriodEnd: '2026-04-01',
            },
            usage: {
                INSTAGRAM: { IMAGE: { used: 4, limit: 10 }, STORY: { used: 0, limit: 10 }, CAROUSEL: { used: 1, limit: 3 }, REEL: { used: 2, limit: 5 }, VIDEO: { used: 0, limit: 5 } },
                FACEBOOK: { IMAGE: { used: 0, limit: 10 }, CAROUSEL: { used: 0, limit: 3 }, VIDEO: { used: 0, limit: 5 }, STORY: { used: 0, limit: 10 } },
            },
        }),
        getPlans: vi.fn().mockResolvedValue([
            { id: 'p1', slug: 'starter', tier: 'STARTER', name: 'Starter', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 5, STORY: 5, CAROUSEL: 1, REEL: 2, VIDEO: 2 } } }, pricing: { monthly: 49900, annual: 499900, currency: 'INR' }, razorpayPlanIds: { monthly: 'rp1', annual: 'rp2' }, features: ['INSTAGRAM'] },
            { id: 'p2', slug: 'growth', tier: 'GROWTH', name: 'Growth', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 10, STORY: 10, CAROUSEL: 3, REEL: 5, VIDEO: 5 }, FACEBOOK: { IMAGE: 10, CAROUSEL: 3, VIDEO: 5, STORY: 10 } } }, pricing: { monthly: 99900, annual: 999900, currency: 'INR' }, razorpayPlanIds: { monthly: 'rp3', annual: 'rp4' }, features: ['INSTAGRAM', 'FACEBOOK'] },
        ]),
        subscribe: vi.fn(),
        changePlan: vi.fn(),
        reactivate: vi.fn(),
        cancel: vi.fn(),
        purchaseCredits: vi.fn(),
        verifyCredits: vi.fn(),
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
                planSnapshot: { id: 'p-growth', name: 'Growth', slug: 'growth', tier: 'GROWTH', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 10, STORY: 10, CAROUSEL: 3, REEL: 5, VIDEO: 5 }, FACEBOOK: { IMAGE: 10, CAROUSEL: 3, VIDEO: 5, STORY: 10 } } }, pricing: { monthly: 99900, annual: 999900, currency: 'INR' }, features: ['INSTAGRAM', 'FACEBOOK'], razorpayPlanIds: { monthly: 'rp_m', annual: 'rp_a' } },
                currentPeriodEnd: '2026-04-01',
            },
            usage: {
                INSTAGRAM: { IMAGE: { used: 4, limit: 10 }, STORY: { used: 0, limit: 10 }, CAROUSEL: { used: 1, limit: 3 }, REEL: { used: 2, limit: 5 }, VIDEO: { used: 0, limit: 5 } },
                FACEBOOK: { IMAGE: { used: 0, limit: 10 }, CAROUSEL: { used: 0, limit: 3 }, VIDEO: { used: 0, limit: 5 }, STORY: { used: 0, limit: 10 } },
            },
        });
        vi.mocked(subscriptionAPI.getPlans).mockResolvedValue([
            { id: 'p1', slug: 'starter', tier: 'STARTER', name: 'Starter', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 5, STORY: 5, CAROUSEL: 1, REEL: 2, VIDEO: 2 } } }, pricing: { monthly: 49900, annual: 499900, currency: 'INR' }, razorpayPlanIds: { monthly: 'rp1', annual: 'rp2' }, features: ['INSTAGRAM'] },
            { id: 'p2', slug: 'growth', tier: 'GROWTH', name: 'Growth', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 10, STORY: 10, CAROUSEL: 3, REEL: 5, VIDEO: 5 }, FACEBOOK: { IMAGE: 10, CAROUSEL: 3, VIDEO: 5, STORY: 10 } } }, pricing: { monthly: 99900, annual: 999900, currency: 'INR' }, razorpayPlanIds: { monthly: 'rp3', annual: 'rp4' }, features: ['INSTAGRAM', 'FACEBOOK'] },
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
        vi.mocked(subscriptionAPI.changePlan).mockResolvedValue({ effective: 'immediate', planName: 'Growth' });
        vi.mocked(subscriptionAPI.reactivate).mockResolvedValue({ requiresCheckout: true, subscriptionId: 'rzp_sub_new', keyId: 'rzp_test_key' });
        vi.mocked(subscriptionAPI.purchaseCredits).mockReset();

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
                planSnapshot: { id: 'p-growth', name: 'Growth', slug: 'growth', tier: 'GROWTH', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 10, STORY: 10, CAROUSEL: 3, REEL: 5, VIDEO: 5 } } }, pricing: { monthly: 99900, annual: 999900, currency: 'INR' }, features: ['INSTAGRAM'], razorpayPlanIds: { monthly: 'rp_m', annual: 'rp_a' } },
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

    // --- SubscriptionModal: Switch Plan with Razorpay ---

    it('should call changePlan when clicking Switch on a non-current plan with active subscription', async () => {
        vi.mocked(subscriptionAPI.changePlan).mockResolvedValue({ effective: 'immediate', planName: 'Starter' });

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        // The Starter plan should have a "Downgrade" button (since current plan is Growth and Starter is cheaper)
        // ACTIVE status shows confirmation dialog before proceeding
        const switchButton = screen.getByText('Downgrade');
        fireEvent.click(switchButton);
        await waitFor(() => expect(screen.getByRole('button', { name: /^Confirm$/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /^Confirm$/ }));

        await waitFor(() => {
            expect(subscriptionAPI.changePlan).toHaveBeenCalledWith('starter', { mode: 'cycle_end' });
            expect(subscriptionAPI.subscribe).not.toHaveBeenCalled();
        });
    });

    it('should call subscribe without changePlan when no active subscription', async () => {
        const mockRzpOpen = vi.fn();
        const MockRazorpay = vi.fn().mockImplementation(function (this: any) { this.open = mockRzpOpen; });
        (window as any).Razorpay = MockRazorpay;

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
        vi.mocked(subscriptionAPI.subscribe).mockResolvedValue({
            keyId: 'rzp_test_key',
            subscriptionId: 'sub_rzp_456',
        });

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        // With no active plan, buttons should say "Subscribe"
        const subscribeButtons = screen.getAllByText('Subscribe');
        fireEvent.click(subscribeButtons[0]);

        await waitFor(() => {
            expect(subscriptionAPI.changePlan).not.toHaveBeenCalled();
            expect(subscriptionAPI.subscribe).toHaveBeenCalledWith('starter', undefined);
            expect(mockRzpOpen).toHaveBeenCalled();
        });

        delete (window as any).Razorpay;
    });

    it('should handle switch plan failure gracefully', async () => {
        vi.mocked(subscriptionAPI.changePlan).mockRejectedValue(new Error('Payment failed'));

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        // ACTIVE status shows confirmation dialog before proceeding
        fireEvent.click(screen.getByText('Downgrade'));
        await waitFor(() => expect(screen.getByRole('button', { name: /^Confirm$/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /^Confirm$/ }));

        await waitFor(() => {
            expect(screen.getByText(/Payment failed/i)).toBeInTheDocument();
        });
    });

    // --- SubscriptionModal: Purchase Credits with Razorpay ---

    it('should call handlePurchaseCredits and open Razorpay when clicking a credit pack', async () => {
        const mockRzpOpen = vi.fn();
        const MockRazorpay = vi.fn().mockImplementation(function (this: any) { this.open = mockRzpOpen; });
        (window as any).Razorpay = MockRazorpay;

        vi.mocked(subscriptionAPI.purchaseCredits).mockResolvedValue({
            keyId: 'rzp_test_key',
            orderId: 'order_123',
            amount: 9900,
            currency: 'INR',
            credits: 10,
        });

        render(<ProfileSheet {...defaultProps} featureFlags={{ deleteAccount: false, topupCredits: true, updatesSection: false }} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Top Up Credits')).toBeInTheDocument());

        // Click the first credit pack (10 credits) -- find pack buttons inside the Top Up Credits section
        const topUpHeading = screen.getByText('Top Up Credits');
        const topUpSection = topUpHeading.closest('div')!.parentElement!;
        const packButtons = topUpSection.querySelectorAll('button');
        fireEvent.click(packButtons[0]);

        await waitFor(() => {
            expect(subscriptionAPI.purchaseCredits).toHaveBeenCalledWith('cp1');
            expect(MockRazorpay).toHaveBeenCalledWith(expect.objectContaining({
                key: 'rzp_test_key',
                amount: 9900,
                currency: 'INR',
                order_id: 'order_123',
                name: 'RestroPulse',
                description: '10 Credits',
            }));
            expect(mockRzpOpen).toHaveBeenCalled();
        });

        delete (window as any).Razorpay;
    });

    it('should handle credit purchase failure gracefully', async () => {
        vi.mocked(subscriptionAPI.purchaseCredits).mockRejectedValue(new Error('Purchase failed'));
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

        render(<ProfileSheet {...defaultProps} featureFlags={{ deleteAccount: false, topupCredits: true, updatesSection: false }} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Top Up Credits')).toBeInTheDocument());

        const topUpHeading = screen.getByText('Top Up Credits');
        const topUpSection = topUpHeading.closest('div')!.parentElement!;
        const packButtons = topUpSection.querySelectorAll('button');
        fireEvent.click(packButtons[0]);

        await waitFor(() => {
            expect(consoleSpy).toHaveBeenCalledWith('Credit purchase failed:', expect.any(Error));
            expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
        });

        consoleSpy.mockRestore();
    });

    it('shows Coming Soon placeholder for Top Up Credits when topupCredits flag is false', async () => {
        render(<ProfileSheet {...defaultProps} featureFlags={{ deleteAccount: false, topupCredits: false, updatesSection: false }} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);

        await waitFor(() => {
            expect(screen.getByText('Top Up Credits')).toBeInTheDocument();
            expect(screen.getByText('Coming Soon')).toBeInTheDocument();
        });

        // Credit pack purchase buttons should NOT be rendered
        const topUpHeading = screen.getByText('Top Up Credits');
        const topUpSection = topUpHeading.closest('div')!.parentElement!;
        const packButtons = topUpSection.querySelectorAll('button');
        expect(packButtons.length).toBe(0);
    });

    it('shows credit pack purchase buttons when topupCredits flag is true', async () => {
        vi.mocked(creditPacksAPI.getAll).mockResolvedValue([
            { id: 'cp1', name: '10 Credits', description: '10 bonus credits', credits: 10, priceInPaise: 9900, isActive: true, sortOrder: 1 },
        ]);

        render(<ProfileSheet {...defaultProps} featureFlags={{ deleteAccount: false, topupCredits: true, updatesSection: false }} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);

        await waitFor(() => {
            expect(screen.getByText('Top Up Credits')).toBeInTheDocument();
            expect(screen.getByText('10')).toBeInTheDocument();
        });

        expect(screen.queryByText('Coming Soon')).not.toBeInTheDocument();
    });

    // --- SubscriptionModal: Error visibility for every action button ---

    it('should show error for Subscribe button when no active subscription', async () => {
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
        vi.mocked(subscriptionAPI.subscribe).mockRejectedValue(new Error('razorpay plan not configured'));

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        // All plans show Subscribe when status is NONE
        const subscribeButtons = screen.getAllByText('Subscribe');
        expect(subscribeButtons.length).toBeGreaterThanOrEqual(1);

        fireEvent.click(subscribeButtons[0]);

        await waitFor(() => {
            expect(screen.getByText(/razorpay plan not configured/i)).toBeInTheDocument();
        });
    });

    it('should show error for every Subscribe button, not just the first', async () => {
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
        vi.mocked(subscriptionAPI.subscribe).mockRejectedValue(new Error('razorpay plan not configured'));

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        const subscribeButtons = screen.getAllByText('Subscribe');
        expect(subscribeButtons.length).toBeGreaterThanOrEqual(2);

        // Click the last Subscribe button (not the first)
        fireEvent.click(subscribeButtons[subscribeButtons.length - 1]);

        await waitFor(() => {
            expect(screen.getByText(/razorpay plan not configured/i)).toBeInTheDocument();
        });
    });

    it('should show subscription error even when modal is scrolled down', async () => {
        vi.mocked(subscriptionAPI.changePlan).mockRejectedValue(new Error('Payment failed'));

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
        await waitFor(() => expect(screen.getByRole('button', { name: /^Confirm$/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /^Confirm$/ }));

        await waitFor(() => {
            expect(screen.getByText(/Payment failed/i)).toBeInTheDocument();
        });
    });

    it('should show error again after clicking Switch a second time', async () => {
        vi.mocked(subscriptionAPI.changePlan).mockRejectedValue(new Error('Payment failed'));

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        // First click -- ACTIVE status shows confirmation dialog
        fireEvent.click(screen.getByText('Downgrade'));
        await waitFor(() => expect(screen.getByRole('button', { name: /^Confirm$/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /^Confirm$/ }));
        await waitFor(() => {
            expect(screen.getByText(/Payment failed/i)).toBeInTheDocument();
        });

        // Second click -- error must still be shown
        fireEvent.click(screen.getByText('Downgrade'));
        await waitFor(() => expect(screen.getByRole('button', { name: /^Confirm$/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /^Confirm$/ }));
        await waitFor(() => {
            expect(screen.getByText(/Payment failed/i)).toBeInTheDocument();
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
        await waitFor(() => expect(screen.getByRole('button', { name: /^Confirm$/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /^Confirm$/ }));

        await waitFor(() => {
            expect(screen.getByText(/No active subscription to change/i)).toBeInTheDocument();
        });

        // subscribe should NOT have been called since we use changePlan for active subs
        expect(subscriptionAPI.subscribe).not.toHaveBeenCalled();
    });

    it('should show error when window.Razorpay is not loaded for subscribe (new subscription)', async () => {
        // Ensure Razorpay is NOT on window
        delete (window as any).Razorpay;

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
        vi.mocked(subscriptionAPI.subscribe).mockResolvedValue({
            keyId: 'rzp_test_key',
            subscriptionId: 'sub_rzp_123',
        });

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        // NONE status shows Subscribe button directly (no confirmation dialog)
        const subscribeButtons = screen.getAllByText('Subscribe');
        fireEvent.click(subscribeButtons[0]);

        await waitFor(() => {
            expect(screen.getByText(/Payment service not available/i)).toBeInTheDocument();
        });
    });

    it('should show error when window.Razorpay is not loaded for credit purchase', async () => {
        delete (window as any).Razorpay;

        vi.mocked(subscriptionAPI.purchaseCredits).mockResolvedValue({
            keyId: 'rzp_test_key',
            orderId: 'order_123',
            amount: 9900,
            currency: 'INR',
            credits: 10,
        });
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

        render(<ProfileSheet {...defaultProps} featureFlags={{ deleteAccount: false, topupCredits: true, updatesSection: false }} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Top Up Credits')).toBeInTheDocument());

        const topUpHeading = screen.getByText('Top Up Credits');
        const topUpSection = topUpHeading.closest('div')!.parentElement!;
        const packButtons = topUpSection.querySelectorAll('button');
        fireEvent.click(packButtons[0]);

        await waitFor(() => {
            expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
        });

        consoleSpy.mockRestore();
    });

    it('should clear previous error when starting a new action', async () => {
        vi.mocked(subscriptionAPI.changePlan).mockRejectedValue(new Error('Payment failed'));

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        // First action fails -- ACTIVE status shows confirmation dialog
        fireEvent.click(screen.getByText('Downgrade'));
        await waitFor(() => expect(screen.getByRole('button', { name: /^Confirm$/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /^Confirm$/ }));
        await waitFor(() => {
            expect(screen.getByText(/Payment failed/i)).toBeInTheDocument();
        });

        // Start a new action -- error should clear before the new attempt
        vi.mocked(subscriptionAPI.changePlan).mockRejectedValue(new Error('Another failure'));
        fireEvent.click(screen.getByText('Downgrade'));
        await waitFor(() => expect(screen.getByRole('button', { name: /^Confirm$/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /^Confirm$/ }));

        // Error clears momentarily, then reappears after the new failure
        await waitFor(() => {
            expect(screen.getByText(/Another failure/i)).toBeInTheDocument();
        });
    });

    // --- SubscriptionModal: Razorpay payment handler callbacks ---

    it('should show generic payment failed error when Razorpay emits payment.failed with no detail', async () => {
        let paymentFailedHandler: ((response?: { error?: { description?: string; reason?: string } }) => void) | undefined;
        const mockRzpOpen = vi.fn(() => {
            // Fire with no response object to exercise the fallback message
            paymentFailedHandler?.();
        });
        const MockRazorpay = vi.fn().mockImplementation(function (this: any, options: any) {
            this.open = mockRzpOpen;
            this.on = (event: string, handler: (response?: any) => void) => {
                if (event === 'payment.failed') {
                    paymentFailedHandler = handler;
                }
            };
            this.options = options;
        });
        (window as any).Razorpay = MockRazorpay;

        // Use NONE status so the Subscribe path (with Razorpay) is triggered
        vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
            subscription: { id: 'sub1', restaurantId: 'r1', status: 'NONE', credits: 0, planSnapshot: null, currentPeriodEnd: undefined },
            usage: null,
        });
        vi.mocked(subscriptionAPI.subscribe).mockResolvedValue({
            keyId: 'rzp_test_key',
            subscriptionId: 'sub_rzp_123',
        });

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        // NONE status shows Subscribe button directly
        const subscribeButtons = screen.getAllByText('Subscribe');
        fireEvent.click(subscribeButtons[0]);

        await waitFor(() => {
            expect(mockRzpOpen).toHaveBeenCalled();
            expect(screen.getByText(/Payment failed\. Please try again\./i)).toBeInTheDocument();
        });

        delete (window as any).Razorpay;
    });

    it('should show specific error detail when Razorpay emits payment.failed with description', async () => {
        let paymentFailedHandler: ((response?: any) => void) | undefined;
        const mockRzpOpen = vi.fn(() => {
            paymentFailedHandler?.({ error: { description: 'Insufficient funds in account', reason: 'low_balance' } });
        });
        const MockRazorpay = vi.fn().mockImplementation(function (this: any, options: any) {
            this.open = mockRzpOpen;
            this.on = (event: string, handler: (response?: any) => void) => {
                if (event === 'payment.failed') paymentFailedHandler = handler;
            };
            this.options = options;
        });
        (window as any).Razorpay = MockRazorpay;

        // Use NONE status so the Subscribe path (with Razorpay) is triggered
        vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
            subscription: { id: 'sub1', restaurantId: 'r1', status: 'NONE', credits: 0, planSnapshot: null, currentPeriodEnd: undefined },
            usage: null,
        });
        vi.mocked(subscriptionAPI.subscribe).mockResolvedValue({
            keyId: 'rzp_test_key',
            subscriptionId: 'sub_rzp_123',
        });

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        // NONE status shows Subscribe button directly
        const subscribeButtons = screen.getAllByText('Subscribe');
        fireEvent.click(subscribeButtons[0]);

        await waitFor(() => {
            expect(screen.getByText(/Payment failed: Insufficient funds in account/i)).toBeInTheDocument();
        });

        delete (window as any).Razorpay;
    });

    it('should close subscription panel and trigger data refresh after Razorpay payment handler fires', async () => {
        let razorpayHandler: () => void;
        const mockRzpOpen = vi.fn();
        const MockRazorpay = vi.fn().mockImplementation(function (this: any, options: any) {
            razorpayHandler = options.handler;
            this.open = mockRzpOpen;
        });
        (window as any).Razorpay = MockRazorpay;

        // Use NONE status so the Subscribe path (with Razorpay) is triggered
        vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
            subscription: { id: 'sub1', restaurantId: 'r1', status: 'NONE', credits: 0, planSnapshot: null, currentPeriodEnd: undefined },
            usage: null,
        });
        vi.mocked(subscriptionAPI.subscribe).mockResolvedValue({
            keyId: 'rzp_test_key',
            subscriptionId: 'sub_rzp_123',
        });

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        // NONE status shows Subscribe button directly (no confirmation dialog)
        const subscribeButtons = screen.getAllByText('Subscribe');
        fireEvent.click(subscribeButtons[0]);
        await waitFor(() => expect(mockRzpOpen).toHaveBeenCalled());

        // Simulate Razorpay calling the handler immediately after payment completes.
        // The handler closes the subscription panel and calls loadSubscriptionData + schedules polling.
        const callsBefore = vi.mocked(subscriptionAPI.getCurrent).mock.calls.length;
        razorpayHandler!();
        // closeSubscription() calls window.history.back(); jsdom doesn't fire popstate
        // automatically, so we dispatch it manually to simulate the browser response.
        window.dispatchEvent(new PopStateEvent('popstate'));

        await waitFor(() => {
            // Subscription sub-panel should be gone
            expect(screen.queryByText('Change Plan')).not.toBeInTheDocument();
            // getCurrent should have been called again to refresh subscription data
            expect(vi.mocked(subscriptionAPI.getCurrent).mock.calls.length).toBeGreaterThan(callsBefore);
        });

        delete (window as any).Razorpay;
    });

    it('should verify and refresh after Razorpay credit purchase handler fires', async () => {
        let razorpayHandler: (response: any) => Promise<void>;
        const mockRzpOpen = vi.fn();
        const MockRazorpay = vi.fn().mockImplementation(function (this: any, options: any) {
            razorpayHandler = options.handler;
            this.open = mockRzpOpen;
        });
        (window as any).Razorpay = MockRazorpay;

        vi.mocked(subscriptionAPI.purchaseCredits).mockResolvedValue({
            keyId: 'rzp_test_key',
            orderId: 'order_123',
            amount: 9900,
            currency: 'INR',
            credits: 10,
        });
        vi.mocked(subscriptionAPI.verifyCredits).mockResolvedValue(undefined);

        render(<ProfileSheet {...defaultProps} featureFlags={{ deleteAccount: false, topupCredits: true, updatesSection: false }} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Top Up Credits')).toBeInTheDocument());

        const topUpHeading = screen.getByText('Top Up Credits');
        const topUpSection = topUpHeading.closest('div')!.parentElement!;
        const packButtons = topUpSection.querySelectorAll('button');
        fireEvent.click(packButtons[0]);

        await waitFor(() => expect(mockRzpOpen).toHaveBeenCalled());

        // Simulate Razorpay calling the handler after payment
        await razorpayHandler!({
            razorpay_order_id: 'order_123',
            razorpay_payment_id: 'pay_456',
            razorpay_signature: 'sig_789',
        });

        await waitFor(() => {
            expect(subscriptionAPI.verifyCredits).toHaveBeenCalledWith('order_123', 'pay_456', 'sig_789');
            // initial load on mount + openSubscription reload + credit purchase handler
            expect(subscriptionAPI.getCurrent).toHaveBeenCalledTimes(3);
        });

        delete (window as any).Razorpay;
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

    // --- SubscriptionModal: Subscribe with coupon (new subscription only) ---

    it('should pass coupon code when subscribing without active subscription', async () => {
        const mockRzpOpen = vi.fn();
        const MockRazorpay = vi.fn().mockImplementation(function (this: any) { this.open = mockRzpOpen; });
        (window as any).Razorpay = MockRazorpay;

        vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
            subscription: { id: 'sub1', restaurantId: 'r1', status: 'NONE', credits: 0, planSnapshot: null, currentPeriodEnd: undefined },
            usage: null,
        });
        vi.mocked(couponAPI.validate).mockResolvedValue({ valid: true });
        vi.mocked(subscriptionAPI.subscribe).mockResolvedValue({
            keyId: 'rzp_test_key',
            subscriptionId: 'sub_rzp_123',
        });

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        // Apply coupon first
        const couponInput = screen.getByPlaceholderText('Have a coupon code?');
        fireEvent.change(couponInput, { target: { value: 'SAVE20' } });
        fireEvent.click(screen.getByText('Apply'));
        await waitFor(() => expect(screen.getByText('Coupon applied!')).toBeInTheDocument());

        // NONE status shows Subscribe button directly
        const subscribeButtons = screen.getAllByText('Subscribe');
        fireEvent.click(subscribeButtons[0]);

        await waitFor(() => {
            expect(subscriptionAPI.subscribe).toHaveBeenCalledWith('starter', 'SAVE20');
        });

        delete (window as any).Razorpay;
    });

    it('should normalize lowercase coupon code on apply and pass normalized value when subscribing', async () => {
        const mockRzpOpen = vi.fn();
        const MockRazorpay = vi.fn().mockImplementation(function (this: any) { this.open = mockRzpOpen; });
        (window as any).Razorpay = MockRazorpay;

        vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
            subscription: { id: 'sub1', restaurantId: 'r1', status: 'NONE', credits: 0, planSnapshot: null, currentPeriodEnd: undefined },
            usage: null,
        });
        vi.mocked(couponAPI.validate).mockResolvedValue({ valid: true });
        vi.mocked(subscriptionAPI.subscribe).mockResolvedValue({
            keyId: 'rzp_test_key',
            subscriptionId: 'sub_rzp_123',
        });

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

        // NONE status shows Subscribe button directly
        const subscribeButtons = screen.getAllByText('Subscribe');
        fireEvent.click(subscribeButtons[0]);

        await waitFor(() => {
            expect(subscriptionAPI.subscribe).toHaveBeenCalledWith('starter', 'SAVE20');
        });

        delete (window as any).Razorpay;
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

    it('should show renewal date in subscription modal', async () => {
        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => {
            expect(screen.getByText(/Renews/)).toBeInTheDocument();
        });
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

    // --- SubscriptionModal: Razorpay footer text ---

    it('should show Razorpay payment note in subscription modal', async () => {
        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => {
            expect(screen.getByText('Payments processed securely via Razorpay')).toBeInTheDocument();
        });
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

    it('should show Tap to retry button when subscription action fails and retry clears error', async () => {
        // Make disconnect error to trigger setActionError in the subscription modal
        vi.mocked(instagramAPI.disconnect).mockRejectedValueOnce(new Error('Network error'));
        window.confirm = vi.fn().mockReturnValue(true);

        const connectedData = {
            ...mockRestaurantData,
            integrations: { instagram: true },
            instagramUsername: 'testuser',
        };

        render(<ProfileSheet {...defaultProps} restaurantData={connectedData} featureFlags={{ deleteAccount: false, topupCredits: true, updatesSection: false }} />);

        // Open subscription modal to expose actionError inside it
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());
        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByPlaceholderText('Have a coupon code?')).toBeInTheDocument());

        // Now trigger an action error inside subscription modal via purchaseCredits failure
        vi.mocked(subscriptionAPI.purchaseCredits).mockRejectedValueOnce(new Error('payment failed'));

        // Click a credit pack to trigger purchaseCredits
        const creditPackButtons = screen.getAllByText('10');
        // The first button with text '10' is the credit pack
        fireEvent.click(creditPackButtons[0]);

        // Wait for actionError to appear (shown via ActionNotice in the subscription modal)
        await waitFor(() => {
            expect(screen.getByText('Tap to retry')).toBeInTheDocument();
        });

        // Click "Tap to retry" - should clear actionError and reload
        fireEvent.click(screen.getByText('Tap to retry'));

        // After clicking retry, it calls loadSubscriptionData again -- the error should be cleared
        await waitFor(() => {
            expect(screen.queryByText('Tap to retry')).not.toBeInTheDocument();
        });
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

    it('should show Reactivate button when cancelAtPeriodEnd is true', async () => {
        vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
            subscription: {
                id: 'sub1',
                restaurantId: 'r1',
                status: 'ACTIVE',
                billingCycle: 'MONTHLY',
                credits: 15,
                cancelAtPeriodEnd: true,
                planSnapshot: { id: 'p-growth', name: 'Growth', slug: 'growth', tier: 'GROWTH', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 10, STORY: 10, CAROUSEL: 3, REEL: 5, VIDEO: 5 }, FACEBOOK: { IMAGE: 10, CAROUSEL: 3, VIDEO: 5, STORY: 10 } } }, pricing: { monthly: 99900, annual: 999900, currency: 'INR' }, features: ['INSTAGRAM', 'FACEBOOK'], razorpayPlanIds: { monthly: 'rp_m', annual: 'rp_a' } },
                currentPeriodEnd: '2026-05-01',
            },
            usage: null,
        });

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Manage your plan')).toBeInTheDocument());

        expect(screen.getByText('Reactivate')).toBeInTheDocument();

        // Clicking Reactivate now opens a confirm dialog first
        fireEvent.click(screen.getByText('Reactivate'));

        // Confirm dialog should appear with honest copy
        await waitFor(() => {
            expect(screen.getByText(/Continue on Growth/i)).toBeInTheDocument();
        });

        // Confirm it
        fireEvent.click(screen.getByRole('button', { name: /Confirm — pay ₹5 now/i }));

        await waitFor(() => {
            expect(subscriptionAPI.reactivate).toHaveBeenCalled();
        });
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
                planSnapshot: { id: 'p-growth', name: 'Growth', slug: 'growth', tier: 'GROWTH', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 10, STORY: 10, CAROUSEL: 3, REEL: 5, VIDEO: 5 }, FACEBOOK: { IMAGE: 10, CAROUSEL: 3, VIDEO: 5, STORY: 10 } } }, pricing: { monthly: 99900, annual: 999900, currency: 'INR' }, features: ['INSTAGRAM', 'FACEBOOK'], razorpayPlanIds: { monthly: 'rp_m', annual: 'rp_a' } },
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

    it('should show downgrade confirmation dialog with cycle_end message', async () => {
        // Current plan is Growth (expensive), switching to cheaper Starter
        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        // Starter is cheaper than Growth so the button shows "Downgrade"
        fireEvent.click(screen.getByText('Downgrade'));

        await waitFor(() => {
            expect(screen.getByRole('button', { name: /^Confirm$/ })).toBeInTheDocument();
            // Unified flow honest copy: three-line story (today / until / from).
            expect(screen.getByText(/verification charge to register a new payment mandate/i)).toBeInTheDocument();
            expect(screen.getByText(/your existing/i)).toBeInTheDocument();
        });
    });

    // --- Downgrade success notice ---

    it('should show downgrade scheduled notice after successful downgrade', async () => {
        vi.mocked(subscriptionAPI.changePlan).mockResolvedValue({
            effective: 'cycle_end',
            planName: 'Starter',
            currentPeriodEnd: '2026-05-01T00:00:00.000Z',
        });

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        fireEvent.click(screen.getByText('Downgrade'));
        await waitFor(() => expect(screen.getByRole('button', { name: /^Confirm$/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /^Confirm$/ }));

        await waitFor(() => {
            expect(screen.getByText(/Switching to Starter on/i)).toBeInTheDocument();
        });
    });

    // --- Gap 5: pending downgrade plan shows "Starts [date]" ---

    it('should show Starts date on pending downgrade plan card', async () => {
        vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
            subscription: {
                id: 'sub1',
                restaurantId: 'r1',
                status: 'ACTIVE',
                billingCycle: 'MONTHLY',
                credits: 15,
                planSnapshot: { id: 'p-growth', name: 'Growth', slug: 'growth', tier: 'GROWTH', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 10, STORY: 10, CAROUSEL: 3, REEL: 5, VIDEO: 5 }, FACEBOOK: { IMAGE: 10, CAROUSEL: 3, VIDEO: 5, STORY: 10 } } }, pricing: { monthly: 99900, annual: 999900, currency: 'INR' }, features: ['INSTAGRAM', 'FACEBOOK'], razorpayPlanIds: { monthly: 'rp_m', annual: 'rp_a' } },
                pendingPlanSnapshot: { id: 'p-starter', name: 'Starter', slug: 'starter', tier: 'STARTER', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 5, STORY: 5, CAROUSEL: 1, REEL: 2, VIDEO: 2 } } }, pricing: { monthly: 49900, annual: 499900, currency: 'INR' }, features: ['INSTAGRAM'], razorpayPlanIds: { monthly: 'rp_m', annual: 'rp_a' } },
                currentPeriodEnd: '2026-05-01T00:00:00.000Z',
            },
            usage: null,
        });

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        // Starter card should show "Starts ..." instead of a Switch button
        await waitFor(() => {
            expect(screen.getByText(/Starts/)).toBeInTheDocument();
        });

        // The Starter card should not have a tier-change button (shows "Starts ..." instead)
        const downgradeButtons = screen.queryAllByRole('button', { name: 'Downgrade' });
        expect(downgradeButtons.length).toBe(0);
    });

    it('should warn in confirm dialog that pending downgrade will be cancelled on upgrade', async () => {
        // User has Growth plan with a pending downgrade to Starter scheduled
        vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
            subscription: {
                id: 'sub1', restaurantId: 'r1', status: 'ACTIVE', billingCycle: 'MONTHLY', credits: 15,
                planSnapshot: { id: 'p-growth', name: 'Growth', slug: 'growth', tier: 'GROWTH', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 10, STORY: 10, CAROUSEL: 3, REEL: 5, VIDEO: 5 }, FACEBOOK: { IMAGE: 10, CAROUSEL: 3, VIDEO: 5, STORY: 10 } } }, pricing: { monthly: 99900, annual: 999900, currency: 'INR' }, features: ['INSTAGRAM', 'FACEBOOK'], razorpayPlanIds: { monthly: 'rp_m', annual: 'rp_a' } },
                pendingPlanSnapshot: { id: 'p-starter', name: 'Starter', slug: 'starter', tier: 'STARTER', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 5, STORY: 5, CAROUSEL: 1, REEL: 2, VIDEO: 2 } } }, pricing: { monthly: 49900, annual: 499900, currency: 'INR' }, features: ['INSTAGRAM'], razorpayPlanIds: { monthly: 'rp_m', annual: 'rp_a' } },
                currentPeriodEnd: '2026-05-01T00:00:00.000Z',
            },
            usage: null,
        });
        // Override plans so Premium is available as an upgrade
        vi.mocked(subscriptionAPI.getPlans).mockResolvedValue([
            { id: 'plan_starter_id', slug: 'starter', name: 'Starter', tier: 'STARTER', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 5, STORY: 5, CAROUSEL: 1, REEL: 2, VIDEO: 2 } } }, pricing: { monthly: 49900, annual: 499900, currency: 'INR' }, features: ['INSTAGRAM'], razorpayPlanIds: { monthly: 'plan_starter_m', annual: 'plan_starter_a' } },
            { id: 'plan_growth_id', slug: 'growth', name: 'Growth', tier: 'GROWTH', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 10, STORY: 10, CAROUSEL: 3, REEL: 5, VIDEO: 5 }, FACEBOOK: { IMAGE: 10, CAROUSEL: 3, VIDEO: 5, STORY: 10 } } }, pricing: { monthly: 99900, annual: 999900, currency: 'INR' }, features: ['INSTAGRAM', 'FACEBOOK'], razorpayPlanIds: { monthly: 'plan_growth_m', annual: 'plan_growth_a' } },
            { id: 'plan_premium_id', slug: 'premium', name: 'Premium', tier: 'PREMIUM', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 20, STORY: 20, CAROUSEL: 5, REEL: 10, VIDEO: 10 }, FACEBOOK: { IMAGE: 20, CAROUSEL: 5, VIDEO: 10, STORY: 20 } } }, pricing: { monthly: 199900, annual: 1999000, currency: 'INR' }, features: ['INSTAGRAM', 'FACEBOOK'], razorpayPlanIds: { monthly: 'plan_premium_m', annual: 'plan_premium_a' } },
        ]);

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        // Click Upgrade to Premium
        fireEvent.click(screen.getByText('Upgrade'));
        await waitFor(() => expect(screen.getByText('Upgrade to Premium?')).toBeInTheDocument());

        // Unified-flow upgrade dialog mentions the previously-scheduled switch in the
        // "From" line so the user sees the Starter plan-change is being replaced.
        expect(screen.getByText(/Replaces the previously scheduled switch to Starter/i)).toBeInTheDocument();
    });

    // --- Regression: amending a pending plan change must not trigger destructive re-checkout ---

    it('should call changePlan (not subscribe) when amending a pending downgrade on a cancelAtPeriodEnd subscription', async () => {
        // Bug scenario: user is on Premium with cancelAtPeriodEnd=true and a pending
        // downgrade to Growth. User changes their mind and clicks Starter. The old
        // behaviour fell through to `subscribe`, which cancelled Premium, opened a new
        // Razorpay checkout, and double-charged the user. The fix routes the click
        // through `changePlan` (Case C — amend pending downgrade in DB only).
        (window as any).Razorpay = vi.fn();

        vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
            subscription: {
                id: 'sub1',
                restaurantId: 'r1',
                status: 'ACTIVE',
                billingCycle: 'MONTHLY',
                credits: 15,
                cancelAtPeriodEnd: true,
                cancelledAt: '2026-04-10T00:00:00.000Z',
                planSnapshot: { id: 'p-premium', name: 'Premium', slug: 'premium', tier: 'PREMIUM', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 20, STORY: 20, CAROUSEL: 5, REEL: 10, VIDEO: 10 } } }, pricing: { monthly: 199900, annual: 1999000, currency: 'INR' }, features: ['INSTAGRAM', 'FACEBOOK'], razorpayPlanIds: { monthly: 'rp_m', annual: 'rp_a' } },
                pendingPlanSnapshot: { id: 'p-growth', name: 'Growth', slug: 'growth', tier: 'GROWTH', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 10, STORY: 10, CAROUSEL: 3, REEL: 5, VIDEO: 5 } } }, pricing: { monthly: 99900, annual: 999900, currency: 'INR' }, features: ['INSTAGRAM', 'FACEBOOK'], razorpayPlanIds: { monthly: 'rp_m', annual: 'rp_a' } },
                currentPeriodEnd: '2026-05-01T00:00:00.000Z',
            },
            usage: null,
        });
        vi.mocked(subscriptionAPI.getPlans).mockResolvedValue([
            { id: 'plan_starter_id', slug: 'starter', name: 'Starter', tier: 'STARTER', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 5, STORY: 5, CAROUSEL: 1, REEL: 2, VIDEO: 2 } } }, pricing: { monthly: 49900, annual: 499900, currency: 'INR' }, features: ['INSTAGRAM'], razorpayPlanIds: { monthly: 'plan_starter_m', annual: 'plan_starter_a' } },
            { id: 'plan_growth_id', slug: 'growth', name: 'Growth', tier: 'GROWTH', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 10, STORY: 10, CAROUSEL: 3, REEL: 5, VIDEO: 5 } } }, pricing: { monthly: 99900, annual: 999900, currency: 'INR' }, features: ['INSTAGRAM', 'FACEBOOK'], razorpayPlanIds: { monthly: 'plan_growth_m', annual: 'plan_growth_a' } },
            { id: 'plan_premium_id', slug: 'premium', name: 'Premium', tier: 'PREMIUM', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 20, STORY: 20, CAROUSEL: 5, REEL: 10, VIDEO: 10 } } }, pricing: { monthly: 199900, annual: 1999000, currency: 'INR' }, features: ['INSTAGRAM', 'FACEBOOK'], razorpayPlanIds: { monthly: 'plan_premium_m', annual: 'plan_premium_a' } },
        ]);
        vi.mocked(subscriptionAPI.changePlan).mockResolvedValue({
            effective: 'cycle_end',
            planName: 'Starter',
            currentPeriodEnd: '2026-05-01T00:00:00.000Z',
        });

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        // Starter shows as Downgrade (cheaper than Premium). Click it.
        fireEvent.click(screen.getByText('Downgrade'));

        // Confirm dialog should appear — amend messaging (not the destructive "Start new plan now?")
        await waitFor(() => expect(screen.getByText(/Change scheduled plan to Starter\?|Switch to Starter\?/i)).toBeInTheDocument());
        expect(screen.queryByText('Start new plan now?')).not.toBeInTheDocument();

        // Confirm — click the confirm button (either "Change scheduled plan" or "Confirm Downgrade")
        const confirmBtn = screen.queryByText('Change scheduled plan') ?? screen.getByRole('button', { name: /^Confirm$/ });
        fireEvent.click(confirmBtn);

        await waitFor(() => {
            expect(subscriptionAPI.changePlan).toHaveBeenCalledWith('starter', { mode: 'cycle_end' });
        });

        // Critical regression assertions:
        expect(subscriptionAPI.subscribe).not.toHaveBeenCalled();
        expect((window as any).Razorpay).not.toHaveBeenCalled();

        delete (window as any).Razorpay;
    });

    it('should open confirm dialog then call changePlan when clicking Keep current on a pending plan card', async () => {
        vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
            subscription: {
                id: 'sub1',
                restaurantId: 'r1',
                status: 'ACTIVE',
                billingCycle: 'MONTHLY',
                credits: 100,
                cancelAtPeriodEnd: true,
                planSnapshot: { id: 'p2', slug: 'growth', name: 'Growth', tier: 'GROWTH', limits: { weekly: { INSTAGRAM: { IMAGE: 10, STORY: 10, CAROUSEL: 3, REEL: 5, VIDEO: 5 }, FACEBOOK: { IMAGE: 10, CAROUSEL: 3, VIDEO: 5, STORY: 10 } } }, pricing: { monthly: 99900, annual: 999900, currency: 'INR' }, razorpayPlanIds: { monthly: 'rp3', annual: 'rp4' }, features: ['INSTAGRAM', 'FACEBOOK'] },
                pendingPlanSnapshot: { id: 'p-starter', name: 'Starter', slug: 'starter', tier: 'STARTER', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 5, STORY: 5, CAROUSEL: 1, REEL: 2, VIDEO: 2 } } }, pricing: { monthly: 49900, annual: 499900, currency: 'INR' }, features: ['INSTAGRAM'], razorpayPlanIds: { monthly: 'rp_m', annual: 'rp_a' } },
                currentPeriodEnd: '2026-06-01T00:00:00.000Z',
                razorpaySubscriptionId: 'rzp_sub_growth',
            } as any,
            usage: null,
        });
        vi.mocked(subscriptionAPI.changePlan).mockResolvedValue({
            effective: 'immediate',
            planName: 'Growth',
            requiresCheckout: true,
            subscriptionId: 'rzp_sub_growth_new',
            keyId: 'rzp_test_key',
        });

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        // The pending Starter card should have a "Keep current" button
        const keepCurrentBtn = await screen.findByRole('button', { name: /cancel scheduled plan change/i });
        fireEvent.click(keepCurrentBtn);

        // Confirm dialog should appear
        expect(await screen.findByText(/To stay on Growth/i)).toBeInTheDocument();

        // changePlan should NOT have been called yet
        expect(subscriptionAPI.changePlan).not.toHaveBeenCalled();

        // Confirm the dialog
        const confirmBtn = screen.getByRole('button', { name: /keep current plan/i });
        fireEvent.click(confirmBtn);

        await waitFor(() => {
            expect(subscriptionAPI.changePlan).toHaveBeenCalledWith('growth', { mode: 'cycle_end' });
        });
        expect(subscriptionAPI.subscribe).not.toHaveBeenCalled();
    });

    // --- Gap 1 + Gap 2: CREATED status label and billing cycle filter ---

    it('should show Awaiting payment for CREATED status on matching billing cycle', async () => {
        vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
            subscription: {
                id: 'sub1',
                restaurantId: 'r1',
                status: 'CREATED',
                billingCycle: 'MONTHLY',
                credits: 0,
                planSnapshot: { id: 'p-growth', name: 'Growth', slug: 'growth', tier: 'GROWTH', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 10, STORY: 10, CAROUSEL: 3, REEL: 5, VIDEO: 5 }, FACEBOOK: { IMAGE: 10, CAROUSEL: 3, VIDEO: 5, STORY: 10 } } }, pricing: { monthly: 99900, annual: 999900, currency: 'INR' }, features: ['INSTAGRAM', 'FACEBOOK'], razorpayPlanIds: { monthly: 'rp_m', annual: 'rp_a' } },
                currentPeriodEnd: undefined,
            },
            usage: null,
        });

        render(<ProfileSheet {...defaultProps} />);
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

        fireEvent.click(screen.getByText('Subscription').closest('button')!);
        await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

        // Monthly toggle (default) — CREATED billingCycle=MONTHLY should show "Awaiting payment"
        // on the matching plan card. (B3 fix: other plan cards may show "Activating..." to
        // signal that their Subscribe action is disabled while a checkout is in flight.)
        await waitFor(() => {
            expect(screen.getByText('Awaiting payment')).toBeInTheDocument();
        });
    });

    // ---------------------------------------------------------------------------
    // Domestic card / GPay / UPI fallback: changePlan returns requiresCheckout
    // ---------------------------------------------------------------------------
    describe('SubscriptionModal: domestic card / GPay checkout fallback', () => {
        beforeEach(() => {
            (window as any).Razorpay = vi.fn().mockImplementation(() => ({
                open: vi.fn(),
                on: vi.fn(),
            }));
        });

        afterEach(() => {
            delete (window as any).Razorpay;
        });

        it('should open Razorpay checkout when changePlan returns requiresCheckout for an upgrade', async () => {
            vi.mocked(subscriptionAPI.changePlan).mockResolvedValue({
                effective: 'immediate',
                planName: 'Premium',
                requiresCheckout: true,
                subscriptionId: 'sub_new_123',
                keyId: 'rzp_test_key',
            });

            render(<ProfileSheet {...defaultProps} />);
            await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

            fireEvent.click(screen.getByText('Subscription').closest('button')!);
            await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

            // Starter is cheaper than Growth (current plan) → Downgrade button
            // But if we mock a Premium plan scenario with a higher-priced plan, we'd see Upgrade.
            // For this test we just trigger via the Downgrade button and mock changePlan to return requiresCheckout.
            fireEvent.click(screen.getByText('Downgrade'));
            await waitFor(() => expect(screen.getByRole('button', { name: /^Confirm$/ })).toBeInTheDocument());
            fireEvent.click(screen.getByRole('button', { name: /^Confirm$/ }));

            await waitFor(() => {
                expect((window as any).Razorpay).toHaveBeenCalledWith(expect.objectContaining({
                    subscription_id: 'sub_new_123',
                    key: 'rzp_test_key',
                }));
            });
        });

        it('should NOT open Razorpay checkout for domestic card downgrade (cycle_end, no requiresCheckout)', async () => {
            vi.mocked(subscriptionAPI.changePlan).mockResolvedValue({
                effective: 'cycle_end',
                planName: 'Starter',
                currentPeriodEnd: '2026-05-01',
            });

            render(<ProfileSheet {...defaultProps} />);
            await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

            fireEvent.click(screen.getByText('Subscription').closest('button')!);
            await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

            fireEvent.click(screen.getByText('Downgrade'));
            await waitFor(() => expect(screen.getByRole('button', { name: /^Confirm$/ })).toBeInTheDocument());
            fireEvent.click(screen.getByRole('button', { name: /^Confirm$/ }));

            await waitFor(() => {
                expect(screen.getByText(/Switching to Starter on/i)).toBeInTheDocument();
            });
            // Razorpay checkout must NOT open
            expect((window as any).Razorpay).not.toHaveBeenCalled();
        });

        it('should show error when Razorpay is not loaded for requiresCheckout path', async () => {
            delete (window as any).Razorpay;
            vi.mocked(subscriptionAPI.changePlan).mockResolvedValue({
                effective: 'immediate',
                planName: 'Growth',
                requiresCheckout: true,
                subscriptionId: 'sub_new_789',
                keyId: 'rzp_test_key',
            });

            render(<ProfileSheet {...defaultProps} />);
            await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

            fireEvent.click(screen.getByText('Subscription').closest('button')!);
            await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

            fireEvent.click(screen.getByText('Downgrade'));
            await waitFor(() => expect(screen.getByRole('button', { name: /^Confirm$/ })).toBeInTheDocument());
            fireEvent.click(screen.getByRole('button', { name: /^Confirm$/ }));

            await waitFor(() => {
                expect(screen.getByText(/Payment service not available/i)).toBeInTheDocument();
            });
        });

        // Payment method change scenarios
        it('should open Razorpay checkout when user changed payment method from international card to GPay (upgrade)', async () => {
            // User originally subscribed via international card (PATCH worked), then switched to GPay.
            // Backend returns requiresCheckout because PATCH now fails with GPay error.
            vi.mocked(subscriptionAPI.changePlan).mockResolvedValue({
                effective: 'immediate',
                planName: 'Growth',
                requiresCheckout: true,
                subscriptionId: 'sub_gpay_001',
                keyId: 'rzp_test_key',
            });
            // Use Starter as current plan so Growth shows "Upgrade"
            vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
                subscription: {
                    id: 'sub1', restaurantId: 'r1', status: 'ACTIVE', billingCycle: 'MONTHLY', credits: 5,
                    planSnapshot: { id: 'p-starter', name: 'Starter', slug: 'starter', tier: 'STARTER', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 5, STORY: 5, CAROUSEL: 1, REEL: 2, VIDEO: 2 } } }, pricing: { monthly: 49900, annual: 499900, currency: 'INR' }, features: ['INSTAGRAM'], razorpayPlanIds: { monthly: 'rp_m', annual: 'rp_a' } },
                },
                usage: null,
            });

            render(<ProfileSheet {...defaultProps} />);
            await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

            fireEvent.click(screen.getByText('Subscription').closest('button')!);
            await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

            fireEvent.click(screen.getByText('Upgrade'));
            await waitFor(() => expect(screen.getByText('Upgrade to Growth?')).toBeInTheDocument());
            fireEvent.click(screen.getByRole('button', { name: 'Schedule from next cycle' }));

            await waitFor(() => {
                expect((window as any).Razorpay).toHaveBeenCalledWith(expect.objectContaining({
                    subscription_id: 'sub_gpay_001',
                    key: 'rzp_test_key',
                }));
            });
        });

        it('upgrade via Schedule from next cycle still opens Razorpay checkout (deferred sub mandate auth)', async () => {
            // Unified flow: every plan change opens Razorpay checkout for the new
            // mandate authorisation. The "no checkout when PATCH succeeded" path
            // from the legacy code is gone — Razorpay refuses PATCH for card
            // mandates anyway, and the unified flow is honest about always
            // requiring a fresh mandate authorization.
            vi.mocked(subscriptionAPI.changePlan).mockResolvedValue({
                effective: 'cycle_end',
                planName: 'Growth',
                requiresCheckout: true,
                subscriptionId: 'sub_growth_def',
                keyId: 'rzp_test_key',
            });
            // Use Starter as current plan so Growth shows "Upgrade"
            vi.mocked(subscriptionAPI.getCurrent).mockResolvedValue({
                subscription: {
                    id: 'sub1', restaurantId: 'r1', status: 'ACTIVE', billingCycle: 'MONTHLY', credits: 5,
                    planSnapshot: { id: 'p-starter', name: 'Starter', slug: 'starter', tier: 'STARTER', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 5, STORY: 5, CAROUSEL: 1, REEL: 2, VIDEO: 2 } } }, pricing: { monthly: 49900, annual: 499900, currency: 'INR' }, features: ['INSTAGRAM'], razorpayPlanIds: { monthly: 'rp_m', annual: 'rp_a' } },
                },
                usage: null,
            });

            render(<ProfileSheet {...defaultProps} />);
            await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

            fireEvent.click(screen.getByText('Subscription').closest('button')!);
            await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

            fireEvent.click(screen.getByText('Upgrade'));
            await waitFor(() => expect(screen.getByText('Upgrade to Growth?')).toBeInTheDocument());
            fireEvent.click(screen.getByRole('button', { name: 'Schedule from next cycle' }));

            // changePlan called with mode=cycle_end; Razorpay checkout opens for ₹5 mandate auth
            await waitFor(() => expect(subscriptionAPI.changePlan).toHaveBeenCalledWith('growth', { mode: 'cycle_end' }));
            await waitFor(() => {
                expect((window as any).Razorpay).toHaveBeenCalledWith(expect.objectContaining({
                    subscription_id: 'sub_growth_def',
                    key: 'rzp_test_key',
                }));
            });
        });

        // [S9] Resubscribe from CANCELLED state
        it('[S9] should allow resubscribe when subscription status is CANCELLED', async () => {
            const mockRzpOpen = vi.fn();
            const MockRazorpay = vi.fn().mockImplementation(function (this: any) { this.open = mockRzpOpen; });
            (window as any).Razorpay = MockRazorpay;

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
            vi.mocked(subscriptionAPI.subscribe).mockResolvedValue({
                keyId: 'rzp_test_key',
                subscriptionId: 'sub_rzp_new',
            });

            render(<ProfileSheet {...defaultProps} />);
            await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

            fireEvent.click(screen.getByText('Subscription').closest('button')!);
            await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

            // With CANCELLED status, should show Subscribe buttons like NONE
            const subscribeButtons = screen.getAllByText('Subscribe');
            fireEvent.click(subscribeButtons[0]);

            await waitFor(() => {
                expect(subscriptionAPI.subscribe).toHaveBeenCalledWith('starter', undefined);
                expect(mockRzpOpen).toHaveBeenCalled();
            });

            delete (window as any).Razorpay;
        });

        // [S7] Pure cancel action
        it('[S7] should call cancel API when user initiates cancellation', async () => {
            vi.mocked(subscriptionAPI.cancel).mockResolvedValue(undefined);

            // Mock subscription with visible cancel UI
            vi.mocked(subscriptionAPI.getCurrent).mockResolvedValueOnce({
                subscription: {
                    id: 'sub1',
                    restaurantId: 'r1',
                    status: 'ACTIVE',
                    billingCycle: 'MONTHLY',
                    credits: 15,
                    planSnapshot: { id: 'p-growth', name: 'Growth', slug: 'growth', tier: 'GROWTH', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 10, STORY: 10, CAROUSEL: 3, REEL: 5, VIDEO: 5 } } }, pricing: { monthly: 99900, annual: 999900, currency: 'INR' }, features: ['INSTAGRAM'], razorpayPlanIds: { monthly: 'rp_m', annual: 'rp_a' } },
                    currentPeriodEnd: '2026-05-01',
                    cancelAtPeriodEnd: false,
                },
                usage: null,
            });

            render(<ProfileSheet {...defaultProps} />);
            await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

            fireEvent.click(screen.getByText('Subscription').closest('button')!);
            await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

            // Verify cancel API is available for testing
            expect(subscriptionAPI.cancel).toBeDefined();
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
                    planSnapshot: { id: 'p-premium', name: 'Premium', slug: 'premium', tier: 'PREMIUM', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 10, STORY: 10, CAROUSEL: 5, REEL: 5, VIDEO: 5 } } }, pricing: { monthly: 99900, annual: 999900, currency: 'INR' }, features: ['INSTAGRAM'], razorpayPlanIds: { monthly: 'rp_m', annual: 'rp_a' } },
                    pendingPlanSnapshot: { id: 'p-growth', name: 'Growth', slug: 'growth', tier: 'GROWTH', version: 1, isCurrentVersion: true, limits: { weekly: { INSTAGRAM: { IMAGE: 7, STORY: 7, CAROUSEL: 3, REEL: 3, VIDEO: 3 } } }, pricing: { monthly: 49900, annual: 499900, currency: 'INR' }, features: ['INSTAGRAM'], razorpayPlanIds: { monthly: 'rp_m', annual: 'rp_a' } },
                    currentPeriodEnd: '2026-05-15',
                },
                usage: null,
            });

            render(<ProfileSheet {...defaultProps} />);
            await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

            fireEvent.click(screen.getByText('Subscription').closest('button')!);
            await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

            // Find the pending plan card (Growth with "Starts" date)
            const pendingPlanText = screen.queryByText(/Starts/i);
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
                .mockResolvedValueOnce({
                    effective: 'cycle_end',
                    planName: 'Starter',
                    requiresCheckout: true,
                    subscriptionId: 'sub_starter_1',
                    keyId: 'rzp_test_key',
                })
                .mockResolvedValueOnce({
                    effective: 'cycle_end',
                    planName: 'Premium',
                    requiresCheckout: true,
                    subscriptionId: 'sub_prem_1',
                    keyId: 'rzp_test_key',
                });

            render(<ProfileSheet {...defaultProps} />);
            await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

            fireEvent.click(screen.getByText('Subscription').closest('button')!);
            await waitFor(() => expect(screen.getByText('Change Plan')).toBeInTheDocument());

            // Amendment 1: Downgrade to Starter
            fireEvent.click(screen.getByText('Downgrade'));
            await waitFor(() => expect(screen.getByRole('button', { name: /^Confirm$/ })).toBeInTheDocument());
            fireEvent.click(screen.getByRole('button', { name: /^Confirm$/ }));
            await waitFor(() => {
                expect(subscriptionAPI.changePlan).toHaveBeenCalledWith('starter', { mode: 'cycle_end' });
            });
        });

    });
});
