import React, { useState, useEffect } from 'react';
import Layout from './components/Layout';
import Dashboard from './components/Dashboard';
import ContentStudio from './components/ContentStudio';
import Inputs from './components/Inputs';
import Strategy from './components/Strategy';
import ProfileSheet from './components/ProfileSheet';
import AdhocPostModal from './components/AdhocPostModal';
import Login from './components/Login';
import ErrorBoundary from './components/ErrorBoundary';
import InstagramCallback from './components/InstagramCallback';
import Onboarding from './components/Onboarding';
import { ViewState, Restaurant, User, Post, FeatureFlags, Platform } from '@restropulse/shared';
import { authAPI, restaurantAPI, postsAPI, configAPI } from './api';
import { trackPageView, browserEvents } from '@restropulse/telemetry/browser';

function getUserInitials(name: string): string {
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';
}

const App: React.FC = () => {
    const [currentView, setCurrentView] = useState<ViewState>('LOGIN');
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [restaurantData, setRestaurantData] = useState<Restaurant | null>(null);
    const [userData, setUserData] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [isInstagramCallback, setIsInstagramCallback] = useState(false);

    // Profile sheet + adhoc modal state
    const [isProfileOpen, setIsProfileOpen] = useState(false);
    const [isAdhocModalOpen, setIsAdhocModalOpen] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);
    const [autoOpenInstagramSetup, setAutoOpenInstagramSetup] = useState(false);

    // Pending count for bell badge
    const [pendingCount, setPendingCount] = useState(0);
    // Bootstrap from localStorage cache so platform flags are available instantly on
    // every visit — no flash of Facebook UI before the API responds.
    const [featureFlags, setFeatureFlags] = useState<FeatureFlags | null>(() => {
        try {
            const cached = localStorage.getItem('rp_feature_flags');
            return cached ? JSON.parse(cached) as FeatureFlags : null;
        } catch { return null; }
    });

    const updateFeatureFlags = (flags: FeatureFlags) => {
        try { localStorage.setItem('rp_feature_flags', JSON.stringify(flags)); } catch { /* quota */ }
        setFeatureFlags(flags);
    };

    // Derived platform availability — defaults to all enabled when featureFlags not yet loaded
    const enabledPlatforms: Platform[] = featureFlags?.enabledPlatforms ?? ['INSTAGRAM', 'FACEBOOK'];
    const instagramEnabled = enabledPlatforms.includes('INSTAGRAM');
    const facebookEnabled = enabledPlatforms.includes('FACEBOOK');

    // Check if this is an Instagram OAuth callback
    useEffect(() => {
        const path = window.location.pathname;
        const searchParams = new URLSearchParams(window.location.search);

        // Check for Instagram callback path or OAuth parameters.
        // The API redirects to /auth/instagram/callback (redirect flow) or the
        // popup flow lands with ?code=&state= query params on any path.
        if (path === '/auth/instagram/callback' ||
            path === '/instagram/callback' ||
            searchParams.has('code') && searchParams.has('state')) {
            setIsInstagramCallback(true);
            setLoading(false);
            return;
        }
    }, []);

    // Check for existing session and load restaurant data
    useEffect(() => {
        // Skip if this is an Instagram callback
        if (isInstagramCallback) return;

        const initializeApp = async () => {
            const token = localStorage.getItem('rp_token');
            const session = localStorage.getItem('rp_session');

            if (token && session) {
                try {
                    // Verify session and get user data
                    const sessionData = await authAPI.checkSession();
                    setUserData(sessionData.user ?? null);

                    const restaurantId = localStorage.getItem('rp_restaurant_id') || '';

                    if (!restaurantId) {
                        // Session valid but no restaurant -- send to onboarding
                        setIsLoggedIn(true);
                        setCurrentView('ONBOARDING');
                    } else {
                        // Load restaurant data
                        const restaurant = await restaurantAPI.get(restaurantId);
                        setRestaurantData(restaurant);

                        // Load pending count
                        try {
                            const posts = await postsAPI.getAll();
                            setPendingCount(posts.filter((p: Post) => p.status === 'PENDING_APPROVAL' || p.status === 'CHANGES_REQUESTED').length);
                        } catch { /* ignore */ }

                        setIsLoggedIn(true);
                        configAPI.getFeatures().then(updateFeatureFlags).catch(() => {});
                        if (!window.history.state) {
                            window.history.replaceState({ view: 'DASHBOARD' }, '');
                        }
                        setCurrentView('DASHBOARD');
                    }
                } catch (error) {
                    console.error('Session validation failed:', error);
                    localStorage.removeItem('rp_token');
                    localStorage.removeItem('rp_session');
                }
            }
            setLoading(false);
        };

        initializeApp();
    }, [isInstagramCallback]);

    // Handle browser back button
    useEffect(() => {
        const handlePopState = (event: PopStateEvent) => {
            if (event.state && event.state.view) {
                setCurrentView(event.state.view);
            } else if (isLoggedIn) {
                setCurrentView('DASHBOARD');
            }
        };

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [isLoggedIn]);

    const navigateTo = (view: ViewState) => {
        setCurrentView(view);
        trackPageView(view);
        window.history.pushState({ view }, '', `?view=${view.toLowerCase()}`);
    };

    const onLoginSuccess = async (response: { success: boolean; message?: string }) => {
        if (!response.success) throw new Error(response.message || 'Login failed');
        localStorage.setItem('rp_session', 'true');
        const restaurantId = localStorage.getItem('rp_restaurant_id') || '';

        if (!restaurantId) {
            // New user without a restaurant -- go to onboarding
            setIsLoggedIn(true);
            window.history.replaceState({ view: 'ONBOARDING' }, '', '?view=onboarding');
            setCurrentView('ONBOARDING');
            return;
        }

        const restaurant = await restaurantAPI.get(restaurantId);
        setRestaurantData(restaurant);

        // Get user data
        try {
            const sessionData = await authAPI.checkSession();
            setUserData(sessionData.user ?? null);
        } catch { /* ignore */ }

        window.history.replaceState({ view: 'DASHBOARD' }, '', '?view=dashboard');
        setCurrentView('DASHBOARD');
        setIsLoggedIn(true);
    };

    // Firebase Authentication (Primary)
    const handleFirebaseLogin = async (firebaseIdToken: string) => {
        await onLoginSuccess(await authAPI.loginWithFirebase(firebaseIdToken));
        browserEvents.login('firebase');
    };

    // Fallback OTP Authentication (Development)
    const handleFallbackLogin = async (phone: string, otp: string) => {
        await onLoginSuccess(await authAPI.verifyOtp(phone, otp));
        browserEvents.login('fallback');
    };

    const handleLogout = async () => {
        try {
            await authAPI.logout();
        } catch (error) {
            console.error('Logout error:', error);
        } finally {
            setIsLoggedIn(false);
            setRestaurantData(null);
            setUserData(null);
            setIsProfileOpen(false);
            window.history.replaceState({ view: 'LOGIN' }, '', '/');
            setCurrentView('LOGIN');
        }
    };

    const refreshRestaurantData = async () => {
        if (restaurantData) {
            try {
                const updated = await restaurantAPI.get(restaurantData.id);
                setRestaurantData(updated);
            } catch (error) {
                console.error('Failed to refresh restaurant data:', error);
            }
        }
    };

    const handleAdhocPostSuccess = () => {
        setIsAdhocModalOpen(false);
        setRefreshKey(prev => prev + 1);
    };

    const handleConnectInstagram = () => {
        setAutoOpenInstagramSetup(true);
        setIsProfileOpen(true);
    };

    const renderView = () => {
        if (!restaurantData) return <div>Loading...</div>;

        // Raw Meta credentials connection state — used to enable publishing actions
        // (approve buttons, create post) regardless of which platform is toggled on.
        const metaConnected = restaurantData.integrations?.instagram || false;
        // instagramConnected = Meta connected AND Instagram specifically enabled.
        // Used only for the "Connect Instagram" banner visibility.
        const instagramConnected = instagramEnabled && metaConnected;

        switch (currentView) {
            case 'DASHBOARD':
                return <Dashboard setView={navigateTo} restaurantData={restaurantData} userName={userData?.name} />;
            case 'STUDIO':
                return <ContentStudio onCreatePost={metaConnected ? () => setIsAdhocModalOpen(true) : undefined} refreshKey={refreshKey} instagramConnected={metaConnected} onConnectInstagram={handleConnectInstagram} postApprovalBufferMins={featureFlags?.postApprovalBufferMins} instagramEnabled={instagramEnabled} facebookEnabled={facebookEnabled} />;
            case 'INPUTS':
                if (featureFlags?.updatesSection === false) {
                    return <Dashboard setView={navigateTo} restaurantData={restaurantData} userName={userData?.name} />;
                }
                return <Inputs restaurantData={restaurantData} onRefresh={refreshRestaurantData} />;
            case 'STRATEGY':
                return <Strategy restaurantData={restaurantData} instagramConnected={instagramConnected} onConnectInstagram={handleConnectInstagram} cycleApprovalBufferMins={featureFlags?.cycleApprovalBufferMins} instagramEnabled={instagramEnabled} />;
            default:
                return <Dashboard setView={navigateTo} restaurantData={restaurantData} userName={userData?.name} />;
        }
    };

    const getPageTitle = () => {
        switch (currentView) {
            case 'DASHBOARD': return 'Dashboard';
            case 'STUDIO': return 'Content Studio';
            case 'INPUTS': return 'Updates';
            case 'STRATEGY': return 'Strategy';
            default: return 'RestroPulse';
        }
    };

    if (loading) {
        return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
            Loading RestroPulse...
        </div>;
    }

    // Render Instagram callback handler if this is an OAuth callback
    if (isInstagramCallback) {
        const handleInstagramComplete = async (success: boolean) => {
            if (success) {
                // Re-initialise the app so fresh restaurant data (with instagram connected) is loaded.
                const token = localStorage.getItem('rp_token');
                const restaurantId = localStorage.getItem('rp_restaurant_id');
                if (token && restaurantId) {
                    try {
                        const restaurant = await restaurantAPI.get(restaurantId);
                        setRestaurantData(restaurant);
                        const sessionData = await authAPI.checkSession();
                        setUserData(sessionData.user ?? null);
                        setIsLoggedIn(true);
                        setIsInstagramCallback(false);
                        window.history.replaceState({ view: 'DASHBOARD' }, '', '/');
                        setCurrentView('DASHBOARD');
                        return;
                    } catch { /* fall through to manual navigation */ }
                }
            }
            // On error or missing session: clear callback state so user can retry
            setIsInstagramCallback(false);
            window.history.replaceState({}, '', '/');
        };

        return (
            <ErrorBoundary>
                <InstagramCallback onComplete={handleInstagramComplete} />
            </ErrorBoundary>
        );
    }

    if (!isLoggedIn) {
        return (
            <ErrorBoundary>
                <Login
                    onLogin={handleFirebaseLogin}
                    onFallbackLogin={handleFallbackLogin}
                />
            </ErrorBoundary>
        );
    }

    if (currentView === 'ONBOARDING') {
        return (
            <ErrorBoundary>
                <Onboarding
                    onComplete={async (restaurant) => {
                        setRestaurantData(restaurant);
                        const sessionData = await authAPI.checkSession().catch(() => null);
                        if (sessionData) setUserData(sessionData.user ?? null);
                        window.history.replaceState({ view: 'DASHBOARD' }, '', '?view=dashboard');
                        setCurrentView('DASHBOARD');
                    }}
                />
            </ErrorBoundary>
        );
    }

    return (
        <ErrorBoundary>
            <Layout
                currentView={currentView}
                setView={navigateTo}
                title={getPageTitle()}
                restaurantName={restaurantData?.name || 'RestroPulse'}
                userInitials={getUserInitials(userData?.name || '')}
                pendingCount={pendingCount}
                onCreatePost={restaurantData?.integrations?.instagram ? () => setIsAdhocModalOpen(true) : undefined}
                onProfileOpen={() => setIsProfileOpen(true)}
                featureFlags={featureFlags}
            >
                {renderView()}
            </Layout>

            {/* Profile Sheet */}
            {restaurantData && (
                <ProfileSheet
                    isOpen={isProfileOpen}
                    onClose={() => { setIsProfileOpen(false); setAutoOpenInstagramSetup(false); }}
                    onLogout={handleLogout}
                    restaurantData={restaurantData}
                    userName={userData?.name || ''}
                    userPhone={userData?.phone}
                    userEmail={userData?.email}
                    onRestaurantUpdate={(updated) => setRestaurantData(updated)}
                    autoOpenInstagramSetup={autoOpenInstagramSetup}
                    onAutoOpenHandled={() => setAutoOpenInstagramSetup(false)}
                    featureFlags={featureFlags}
                    instagramEnabled={instagramEnabled}
                    facebookEnabled={facebookEnabled}
                />
            )}

            {/* Adhoc Post Modal */}
            <AdhocPostModal
                isOpen={isAdhocModalOpen}
                onClose={() => setIsAdhocModalOpen(false)}
                onSuccess={handleAdhocPostSuccess}
                minScheduleAheadMins={featureFlags?.minScheduleAheadMins}
                instagramEnabled={instagramEnabled}
                facebookEnabled={facebookEnabled}
            />
        </ErrorBoundary>
    );
};

export default App;
