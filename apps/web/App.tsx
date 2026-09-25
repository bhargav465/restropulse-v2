import React, { useState, useEffect } from 'react';
import Layout from './components/Layout';
import ContentStudio from './components/ContentStudio';
import Intelligence from './components/Intelligence';
import { shellBucketToView, type DeepLinkTarget } from './components/intelligence/sections/deep-links';
import { announceNotificationsSeen, requestIntelNav, INTEL_NOTIFICATIONS_SEEN_EVENT } from './components/intelligence/sections/notifications';
import type { IntelligenceNotification } from '@restropulse/shared';
import { track } from './components/intelligence/sections/track';
import Inputs from './components/Inputs';
import Strategy from './components/Strategy';
import ProfileSheet from './components/ProfileSheet';
import AdhocPostModal from './components/AdhocPostModal';
import Login from './components/Login';
import ErrorBoundary from './components/ErrorBoundary';
import InstagramCallback from './components/InstagramCallback';
import Onboarding from './components/Onboarding';
import Landing from './components/Landing';
import Grader from './components/Grader';
import Paywall from './components/Paywall';
import PrivacyPolicy from './components/PrivacyPolicy';
import TermsOfService from './components/TermsOfService';
import { ViewState, Restaurant, User, Post, FeatureFlags, Platform, WebThemeName, EntitlementState } from '@restropulse/shared';
import { authAPI, restaurantAPI, postsAPI, configAPI, subscriptionAPI, intelligenceAPI } from './api';
import { trackPageView, browserEvents } from '@restropulse/telemetry/browser';

function getUserInitials(name: string): string {
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';
}

// Top-level app views that can be restored from a ?view= deep link / refresh.
// Auth-flow views (LANDING/LOGIN/ONBOARDING) are driven by auth state, not the URL.
const RESTORABLE_VIEWS: ViewState[] = ['DASHBOARD', 'STUDIO', 'INPUTS', 'STRATEGY', 'INTELLIGENCE'];

function readViewFromUrl(): ViewState | null {
    const raw = new URLSearchParams(window.location.search).get('view');
    if (!raw) return null;
    const view = raw.toUpperCase() as ViewState;
    return RESTORABLE_VIEWS.includes(view) ? view : null;
}

// Public, unauthenticated static pages (Meta app review requires these to be
// reachable without login). Checked once per page load, not part of the
// SPA's view-state routing.
type StaticPage = 'privacy-policy' | 'terms' | null;
function readStaticPageFromUrl(): StaticPage {
    const path = window.location.pathname.replace(/\/$/, '') || '/';
    if (path === '/privacy-policy') return 'privacy-policy';
    if (path === '/terms') return 'terms';
    return null;
}

const App: React.FC = () => {
    // Computed once per page load -- these are plain server-style pages reached
    // by direct navigation (e.g. Meta's app-review crawler), not SPA routes.
    const [staticPage] = useState<StaticPage>(() => readStaticPageFromUrl());
    const [currentView, setCurrentView] = useState<ViewState>('LANDING');
    // Intelligence notification feed for the bell (report ready, rival alerts,
    // yesterday's reviews). Loaded once a restaurant is known; refreshed when
    // the dashboard marks the feed seen or a new report lands.
    const [notifications, setNotifications] = useState<IntelligenceNotification[]>([]);
    const [unreadNotifications, setUnreadNotifications] = useState(0);
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    // Plan slug chosen from the landing pricing cards, remembered across the
    // login -> onboarding flow so a trial can be auto-started afterwards.
    const [pendingPlan, setPendingPlan] = useState<string | null>(null);
    const [restaurantData, setRestaurantData] = useState<Restaurant | null>(null);
    const [userData, setUserData] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [isInstagramCallback, setIsInstagramCallback] = useState(false);

    // Profile sheet + adhoc modal state
    const [isProfileOpen, setIsProfileOpen] = useState(false);
    const [isAdhocModalOpen, setIsAdhocModalOpen] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);
    const [autoOpenInstagramSetup, setAutoOpenInstagramSetup] = useState(false);
    // When an upgrade / "See plans" CTA is used, open the profile sheet AND
    // jump straight to its Subscription panel (rather than landing on the sheet root).
    const [autoOpenSubscription, setAutoOpenSubscription] = useState(false);

    // Pending count for bell badge
    const [pendingCount, setPendingCount] = useState(0);
    // Feature entitlement (active plan or in-trial). Null until loaded; the
    // gated views (Content Engine, Intelligence, Strategy) show a paywall when
    // this resolves to not-entitled.
    const [entitlement, setEntitlement] = useState<EntitlementState | null>(null);
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

    const activeWebTheme: WebThemeName = featureFlags?.webTheme === 'legacy' ? 'legacy' : 'orchid-admin';

    // Derived platform availability — defaults to all enabled when featureFlags not yet loaded
    const enabledPlatforms: Platform[] = featureFlags?.enabledPlatforms ?? ['INSTAGRAM', 'FACEBOOK'];
    const instagramEnabled = enabledPlatforms.includes('INSTAGRAM');
    const facebookEnabled = enabledPlatforms.includes('FACEBOOK');

    useEffect(() => {
        document.documentElement.dataset.theme = activeWebTheme;
    }, [activeWebTheme]);

    // Persist a plan chosen on the landing page so it survives the login ->
    // onboarding round-trip (and a reload). Phase 3 reads `rp_pending_plan`
    // after onboarding to auto-start that plan's free trial.
    useEffect(() => {
        if (pendingPlan) localStorage.setItem('rp_pending_plan', pendingPlan);
    }, [pendingPlan]);

    // Load public config (feature flags incl. web theme) on boot, independent of
    // auth. These come from a public endpoint, so fetching them here — rather than
    // only after login — ensures the configured theme and platform flags apply on
    // pre-auth screens (login, onboarding) too, and refreshes any stale localStorage cache.
    useEffect(() => {
        configAPI.getFeatures().then(updateFeatureFlags).catch(() => {});
    }, []);

    // Load feature entitlement (active plan or in-trial) once authenticated with a
    // restaurant, and whenever content refreshes. Gated views read this to decide
    // whether to render their content or the paywall.
    useEffect(() => {
        if (!isLoggedIn || !restaurantData) return;
        let active = true;
        subscriptionAPI.getCurrent()
            .then(d => { if (active) setEntitlement(d.entitlement ?? null); })
            .catch(() => { /* leave prior value; views default to allowed until known */ });
        return () => { active = false; };
    }, [isLoggedIn, restaurantData?.id, refreshKey]);

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
            // Public grader route (?view=grader) renders before auth -- skip the
            // whole session restore so it never rewrites the URL to ?view=dashboard
            // (which made the shared grader link land on the dashboard on reload).
            if (new URLSearchParams(window.location.search).get('view') === 'grader') {
                setLoading(false);
                return;
            }
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

                        // Restore the view from the URL (?view=) so a refresh or
                        // deep link lands where the user was, not always DASHBOARD.
                        const initialView = readViewFromUrl() ?? 'DASHBOARD';
                        setIsLoggedIn(true);
                        window.history.replaceState({ level: 'view', view: initialView }, '', `?view=${initialView.toLowerCase()}`);
                        setCurrentView(initialView);
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
            const state = event.state as { level?: string; view?: ViewState } | null;
            // Only react to top-level view entries. Modal-level pops (level: 'modal')
            // are owned by the component that opened the sheet; ignoring them here
            // keeps the underlying view intact when a sheet is dismissed via Back.
            if (state?.level === 'view' && state.view) {
                setCurrentView(state.view);
            }
        };

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [isLoggedIn]);

    const navigateTo = (view: ViewState) => {
        // Close the profile panel if open, so desktop sidebar navigation (which
        // renders beside the profile overlay) actually reveals the target view.
        setIsProfileOpen(false);
        setCurrentView(view);
        trackPageView(view);
        window.history.pushState({ level: 'view', view }, '', `?view=${view.toLowerCase()}`);
    };

    const loadNotifications = async () => {
        try {
            const feed = await intelligenceAPI.getNotifications();
            setNotifications(feed.items);
            setUnreadNotifications(feed.unread);
        } catch {
            /* the feed is a nudge, never a blocker */
        }
    };

    useEffect(() => {
        if (!restaurantData?.id) return;
        void loadNotifications();
        const onSeen = () => void loadNotifications();
        window.addEventListener(INTEL_NOTIFICATIONS_SEEN_EVENT, onSeen);
        return () => window.removeEventListener(INTEL_NOTIFICATIONS_SEEN_EVENT, onSeen);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [restaurantData?.id]);

    const handleNotificationsOpen = () => {
        track.notificationsOpened({ unread: unreadNotifications, total: notifications.length });
        if (unreadNotifications === 0) return;
        setUnreadNotifications(0);
        setNotifications((items) => items.map((n) => ({ ...n, unread: false })));
        intelligenceAPI.markNotificationsSeen().then(announceNotificationsSeen).catch(() => undefined);
    };

    const handleNotificationClick = (n: IntelligenceNotification) => {
        track.notificationClicked({ kind: n.kind, unread: n.unread, source: 'bell' });
        requestIntelNav(n.link);
        navigateTo('INTELLIGENCE');
    };

    /**
     * RP-001 — deep-link handler for Restaurant Intelligence.
     *
     * Every action-plan CTA, Search & SEO "Fix →", pillar drilldown and
     * "Close this gap →" resolves to a `DeepLinkTarget`; this maps its shell
     * bucket onto the `ViewState` this shell owns and navigates. Buckets this
     * app has no home for (Ordering / Campaigns / Design / Get-started) map to
     * null and are left alone — retargeting them is RP-002, gated on RP-014.
     */
    const handleIntelligenceNavigate = (target: DeepLinkTarget) => {
        const view = shellBucketToView(target.bucket);
        track.actionCtaClicked({ rank: Number(target.params?.rank ?? 0), bucket: target.bucket, resolvedView: view });
        if (!view) return;
        // In-Intelligence destinations (e.g. review replies → What guests say):
        // the dashboard listens for this and switches bucket/tab.
        if (view === 'INTELLIGENCE' && target.params?.intelTab) {
            requestIntelNav({
                view: 'INTELLIGENCE',
                bucket: (target.params.intelBucket as 'MINE' | 'COMPETITION') ?? 'MINE',
                tab: target.params.intelTab,
            });
        }
        navigateTo(view);
    };

    const onLoginSuccess = async (response: { success: boolean; message?: string }) => {
        if (!response.success) throw new Error(response.message || 'Login failed');
        localStorage.setItem('rp_session', 'true');
        const restaurantId = localStorage.getItem('rp_restaurant_id') || '';

        if (!restaurantId) {
            // New user without a restaurant -- go to onboarding
            setIsLoggedIn(true);
            window.history.replaceState({ level: 'view', view: 'ONBOARDING' }, '', '?view=onboarding');
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

        window.history.replaceState({ level: 'view', view: 'DASHBOARD' }, '', '?view=dashboard');
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
            setPendingPlan(null);
            window.history.replaceState({ level: 'view', view: 'LANDING' }, '', '/');
            setCurrentView('LANDING');
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

    // Open the profile sheet directly on the Subscription panel (used by the
    // trial-ended banner "See plans" and the Paywall "Subscribe" CTA).
    const openSubscriptionPanel = () => {
        setAutoOpenSubscription(true);
        setIsProfileOpen(true);
    };

    const renderView = () => {
        if (!restaurantData) return <div>Loading...</div>;

        // Gate the paid features behind an active plan or an in-progress trial.
        // Default to allowed until entitlement is known, to avoid a paywall flash.
        const entitled = entitlement ? entitlement.entitled : true;
        const gatedViews: ViewState[] = ['INTELLIGENCE', 'DASHBOARD', 'STUDIO', 'STRATEGY'];
        const inputsShowsIntelligence = currentView === 'INPUTS' && featureFlags?.updatesSection === false;
        if (!entitled && (gatedViews.includes(currentView) || inputsShowsIntelligence)) {
            return <Paywall onSubscribe={openSubscriptionPanel} />;
        }

        // Raw Meta credentials connection state — used to enable publishing actions
        // (approve buttons, create post) regardless of which platform is toggled on.
        const metaConnected = restaurantData.integrations?.instagram || false;
        // instagramConnected = Meta connected AND Instagram specifically enabled.
        // Used only for the "Connect Instagram" banner visibility.
        const instagramConnected = instagramEnabled && metaConnected;

        switch (currentView) {
            // Restaurant Intelligence replaces the old Dashboard as the home view.
            case 'INTELLIGENCE':
            case 'DASHBOARD':
                return <Intelligence restaurant={restaurantData} onNavigate={handleIntelligenceNavigate} />;
            case 'STUDIO':
                return <ContentStudio onCreatePost={metaConnected ? () => setIsAdhocModalOpen(true) : undefined} refreshKey={refreshKey} instagramConnected={metaConnected} onConnectInstagram={handleConnectInstagram} postApprovalBufferMins={featureFlags?.postApprovalBufferMins} instagramEnabled={instagramEnabled} facebookEnabled={facebookEnabled} />;
            case 'INPUTS':
                if (featureFlags?.updatesSection === false) {
                    return <Intelligence restaurant={restaurantData} onNavigate={handleIntelligenceNavigate} />;
                }
                return <Inputs restaurantData={restaurantData} onRefresh={refreshRestaurantData} />;
            case 'STRATEGY':
                return <Strategy restaurantData={restaurantData} instagramConnected={instagramConnected} onConnectInstagram={handleConnectInstagram} cycleApprovalBufferMins={featureFlags?.cycleApprovalBufferMins} instagramEnabled={instagramEnabled} />;
            default:
                return <Intelligence restaurant={restaurantData} onNavigate={handleIntelligenceNavigate} />;
        }
    };

    const getPageTitle = () => {
        switch (currentView) {
            case 'INTELLIGENCE':
            case 'DASHBOARD': return 'Restaurant Intelligence';
            case 'STUDIO': return 'Content Studio';
            case 'INPUTS': return 'Updates';
            case 'STRATEGY': return 'Strategy';
            default: return 'RestroPulse';
        }
    };

    // Public static pages render immediately, independent of auth/session state.
    if (staticPage === 'privacy-policy') {
        return <PrivacyPolicy onBack={() => { window.location.href = '/'; }} />;
    }
    if (staticPage === 'terms') {
        return <TermsOfService onBack={() => { window.location.href = '/'; }} />;
    }

    // Public lead-gen grader (?view=grader) — no auth, its own page entirely.
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('view') === 'grader') {
        return <Grader />;
    }

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
                        window.history.replaceState({ level: 'view', view: 'DASHBOARD' }, '', '/');
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
        // Landing is the default pre-auth view; any CTA flips to LOGIN.
        if (currentView !== 'LOGIN') {
            return (
                <ErrorBoundary>
                    <Landing
                        onStartFree={() => { setPendingPlan(null); setCurrentView('LOGIN'); }}
                        onSelectPlan={(slug) => { setPendingPlan(slug); setCurrentView('LOGIN'); }}
                        onLogin={() => { setPendingPlan(null); setCurrentView('LOGIN'); }}
                    />
                </ErrorBoundary>
            );
        }
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
                        window.history.replaceState({ level: 'view', view: 'DASHBOARD' }, '', '?view=dashboard');
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
                onProfileOpen={() => setIsProfileOpen(v => !v)}
                profileOpen={isProfileOpen}
                featureFlags={featureFlags}
                entitlement={entitlement}
                onUpgrade={openSubscriptionPanel}
                notifications={notifications}
                unreadNotifications={unreadNotifications}
                onNotificationsOpen={handleNotificationsOpen}
                onNotificationClick={handleNotificationClick}
            >
                {renderView()}
            </Layout>

            {/* Profile Sheet */}
            {restaurantData && (
                <ProfileSheet
                    isOpen={isProfileOpen}
                    onClose={() => { setIsProfileOpen(false); setAutoOpenInstagramSetup(false); setAutoOpenSubscription(false); }}
                    onLogout={handleLogout}
                    restaurantData={restaurantData}
                    userName={userData?.name || ''}
                    userPhone={userData?.phone}
                    userEmail={userData?.email}
                    onRestaurantUpdate={(updated) => setRestaurantData(updated)}
                    autoOpenInstagramSetup={autoOpenInstagramSetup}
                    autoOpenSubscription={autoOpenSubscription}
                    onAutoOpenHandled={() => { setAutoOpenInstagramSetup(false); setAutoOpenSubscription(false); }}
                    onEntitlementChange={(e) => setEntitlement(e)}
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
