import React, { useEffect, useState } from 'react';
import { Restaurant, FeatureFlags } from '@restropulse/shared';
import { isDemoMode } from '../../lib/demo';
import { orderingAdminAPI } from '../../api';
import DemoNotice from '../DemoNotice';
import DashboardV2 from './DashboardV2';
import GetStartedV2 from './GetStartedV2';
import RestaurantDetailsV2 from './RestaurantDetailsV2';
import ContentEngineV2 from './ContentEngineV2';
import OrderingV2 from './OrderingV2';
import IntelligenceV2 from './IntelligenceV2';
import WebsiteDesignV2 from './WebsiteDesignV2';
import type { DeepLinkTarget, OrderingSubTab } from './intelligence/deep-links';
import { GRADIENT } from './theme';
import { Icon, IconName, BUCKET_ACCENT } from './icons';
import { computeOnboardingProgress, isOnboardingDismissed } from './onboarding';

/**
 * V2 admin shell — responsive sidebar layout, enabled only when the app is
 * built with VITE_ADMIN_SHELL=v2 (deployed at /restropulse-v2/admin-v2/).
 *
 * Layout adapts by breakpoint: on desktop (md+) the aubergine rail is a static
 * 256px sidebar; below md it collapses into an off-canvas drawer opened from a
 * hamburger in a sticky mobile top bar (backdrop + Escape/close to dismiss).
 * The nav markup is a single <nav> in both modes so it stays one accessible
 * landmark. Content padding tightens on small screens; the 1100px column caps
 * width on large ones.
 *
 * Electric Lavender palette (design.md §2) + declutter rules (§3): one emoji
 * per bucket, quiet active-item treatment (3px primary edge + soft tint), no
 * nav subtitles (title attr instead), centered content column.
 *
 * Navigation mirrors the existing view-state pattern: plain local state, no
 * router. Dashboard is the default landing bucket; Get Started surfaces the
 * onboarding checklist with a sidebar progress chip until it's dismissed.
 */

type BucketV2 = 'DASHBOARD' | 'GET_STARTED' | 'PROFILE' | 'CONTENT' | 'ORDERING' | 'INTELLIGENCE' | 'DESIGN';

interface ShellV2Props {
    restaurantData: Restaurant;
    userInitials: string;
    featureFlags?: FeatureFlags | null;
    metaConnected: boolean;
    instagramEnabled: boolean;
    facebookEnabled: boolean;
    onCreatePost?: () => void;
    onConnectInstagram: () => void;
    onProfileOpen: () => void;
    onRefreshRestaurant: () => void | Promise<void>;
    refreshKey: number;
}

// `primary` buckets ride the mobile bottom tab bar; the rest (Restaurant
// Details, plus the Get-started shortcut) stay in the drawer as secondary items
// (Brief 05 item 1). Icons replace the old emoji (item 5); `currentColor` +
// BUCKET_ACCENT give each one accent tint.
const NAV: Array<{ id: BucketV2; icon: IconName; label: string; title: string; primary: boolean }> = [
    { id: 'DASHBOARD', icon: 'dashboard', label: 'Dashboard', title: 'Your restaurant at a glance', primary: true },
    { id: 'PROFILE', icon: 'profile', label: 'Restaurant Details', title: 'Business facts, branding & hours', primary: false },
    { id: 'CONTENT', icon: 'content', label: 'Content Engine', title: 'Strategy, posts & publishing', primary: true },
    { id: 'ORDERING', icon: 'ordering', label: 'Online Ordering', title: 'Menu, orders & storefront', primary: true },
    { id: 'INTELLIGENCE', icon: 'intelligence', label: 'Restaurant Intelligence', title: 'Competitor & self insights', primary: true },
    { id: 'DESIGN', icon: 'design', label: 'Website Design', title: 'Themes & templates', primary: true },
];

/** Short tab labels for the compact mobile bottom bar. */
const TAB_LABEL: Partial<Record<BucketV2, string>> = {
    DASHBOARD: 'Home',
    CONTENT: 'Content',
    ORDERING: 'Ordering',
    INTELLIGENCE: 'Insights',
    DESIGN: 'Design',
};

/** Time-aware greeting for the dashboard hero (Brief 05 item 6). */
const greetingFor = (d: Date): string => {
    const h = d.getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

const PAGE_META: Record<BucketV2, { title: string; subtitle: string }> = {
    DASHBOARD: { title: 'Dashboard', subtitle: "Today's orders, revenue and anything that needs your attention." },
    GET_STARTED: { title: 'Get started', subtitle: 'A few quick steps to get your restaurant fully live.' },
    PROFILE: { title: 'Restaurant Details', subtitle: 'Business facts, branding and hours — the profile your storefront and posts are built on.' },
    CONTENT: { title: 'Content Engine', subtitle: 'Plan, create and publish your social content — on autopilot.' },
    ORDERING: { title: 'Online Ordering', subtitle: 'Menu, orders, reservations and your storefront in one place.' },
    INTELLIGENCE: { title: 'Restaurant Intelligence', subtitle: 'Insights that help you run a smarter restaurant.' },
    DESIGN: { title: 'Website Design', subtitle: 'Themes and templates for a storefront that looks like you.' },
};

const ShellV2: React.FC<ShellV2Props> = ({
    restaurantData,
    userInitials,
    featureFlags,
    metaConnected,
    instagramEnabled,
    facebookEnabled,
    onCreatePost,
    onConnectInstagram,
    onProfileOpen,
    onRefreshRestaurant,
    refreshKey,
}) => {
    const [bucket, setBucket] = useState<BucketV2>('DASHBOARD');
    // Ordering sub-tab to open — driven by Intelligence "Act on this" deep links
    // (e.g. a win-back action opens the Campaigns tab). Reset on normal nav.
    const [orderingInitialTab, setOrderingInitialTab] = useState<OrderingSubTab>('OVERVIEW');
    const [dismissed, setDismissed] = useState<boolean>(() => isOnboardingDismissed(restaurantData.id));
    const [menuItemCount, setMenuItemCount] = useState(0);
    // Mobile: the sidebar is an off-canvas drawer. Desktop (md+) ignores this.
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const meta = PAGE_META[bucket];

    // Close the mobile drawer on Escape.
    useEffect(() => {
        if (!mobileNavOpen) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobileNavOpen(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [mobileNavOpen]);

    // Navigate + always dismiss the mobile drawer so the page is visible.
    const go = (b: BucketV2) => { setBucket(b); setOrderingInitialTab('OVERVIEW'); setMobileNavOpen(false); };

    // Intelligence deep link → open the target bucket (and Ordering sub-tab).
    const goDeepLink = (t: DeepLinkTarget) => {
        if (t.orderingTab) setOrderingInitialTab(t.orderingTab);
        setBucket(t.bucket);
        setMobileNavOpen(false);
    };

    // Onboarding progress for the sidebar chip — menu count is the one signal
    // not already on `restaurantData`; everything else is derived from it.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const items = await orderingAdminAPI.getItems();
                if (!cancelled) setMenuItemCount(items.length);
            } catch { /* new restaurants have no menu yet */ }
        })();
        return () => { cancelled = true; };
    }, [restaurantData.id]);

    const progress = computeOnboardingProgress({ restaurant: restaurantData, menuItemCount });
    const showGetStarted = !dismissed && !progress.allDone;

    const navItemClass = (isActive: boolean, extra = '') =>
        `w-full text-left rounded-lg pl-3 pr-4 py-2.5 min-h-[44px] flex items-center gap-3 border-l-[3px] transition-colors active:scale-[0.98] ${
            isActive
                ? 'border-primary bg-primary/10 text-white'
                : 'border-transparent text-sidebar-ink hover:bg-white/5'
        } ${extra}`;

    // Restaurant identity tile (Brief 05 item 10): logo if present, else the
    // gradient initial. Kept small so it reads as "their app" without shouting.
    const initial = (restaurantData.name || '?').trim().charAt(0).toUpperCase() || '?';
    const cityLine = restaurantData.address?.city || restaurantData.sourceCity || 'Your restaurant';
    const IdentityTile: React.FC<{ size: number }> = ({ size }) => (
        restaurantData.logoUrl ? (
            <img
                src={restaurantData.logoUrl}
                alt=""
                className="rounded-xl object-cover shrink-0"
                style={{ width: size, height: size }}
            />
        ) : (
            <span
                className="rounded-xl flex items-center justify-center text-white font-bold shrink-0"
                style={{ width: size, height: size, background: GRADIENT, fontSize: size * 0.4 }}
                aria-hidden="true"
            >
                {initial}
            </span>
        )
    );

    const greeting = greetingFor(new Date());
    const storeOpen = restaurantData.storeOpen !== false;

    return (
        <div className="flex h-screen bg-canvas">
            {/* Mobile drawer backdrop — only while open, below md */}
            {mobileNavOpen && (
                <div
                    className="fixed inset-0 z-30 bg-black/50 md:hidden"
                    onClick={() => setMobileNavOpen(false)}
                    aria-hidden="true"
                />
            )}

            {/*
             * Aubergine sidebar.
             * Desktop (md+): static 256px rail, always visible.
             * Mobile: fixed off-canvas drawer that slides in when mobileNavOpen.
             */}
            <aside
                className={`fixed inset-y-0 left-0 z-40 w-64 max-w-[85vw] bg-sidebar flex flex-col overflow-y-auto no-scrollbar transition-transform duration-200 ease-out md:static md:z-auto md:max-w-none md:shrink-0 md:translate-x-0 ${
                    mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
                }`}
            >
                <div className="px-5 pt-8 pb-6">
                    <div className="flex items-start justify-between">
                        <h1 className="text-2xl font-bold tracking-tight text-white leading-none">
                            Restro<span className="text-primary">pulse</span>
                        </h1>
                        {/* Close drawer — mobile only */}
                        <button
                            type="button"
                            onClick={() => setMobileNavOpen(false)}
                            aria-label="Close navigation"
                            className="md:hidden -mt-1 -mr-1 p-1 text-sidebar-ink hover:text-white transition-colors"
                        >
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                                <path d="M6 6l12 12M18 6L6 18" />
                            </svg>
                        </button>
                    </div>
                    <p className="text-xs text-sidebar-ink/70 mt-2 leading-snug">Social media made simple for restaurants</p>
                </div>
                {/* Restaurant identity (Brief 05 item 10) */}
                <div className="mx-3 mb-4 flex items-center gap-3 rounded-2xl bg-white/5 px-3 py-2.5">
                    <IdentityTile size={36} />
                    <div className="min-w-0">
                        <p className="text-sm font-semibold text-white truncate">{restaurantData.name}</p>
                        <p className="text-[11px] text-sidebar-ink truncate">{cityLine}</p>
                    </div>
                </div>
                <nav className="flex-1 px-3 space-y-1" aria-label="Main navigation">
                    {showGetStarted && (
                        <button
                            type="button"
                            onClick={() => go('GET_STARTED')}
                            aria-current={bucket === 'GET_STARTED' ? 'page' : undefined}
                            title="Finish setting up your restaurant"
                            className={navItemClass(bucket === 'GET_STARTED')}
                        >
                            <span className={bucket === 'GET_STARTED' ? 'text-white' : BUCKET_ACCENT.GET_STARTED} aria-hidden="true">
                                <Icon name="getStarted" size={19} />
                            </span>
                            <span className="flex-1 font-semibold text-sm">Get started</span>
                            <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-md bg-primary-soft text-primary-strong tabular-nums">
                                {progress.completed}/{progress.total}
                            </span>
                        </button>
                    )}
                    {NAV.map((item) => {
                        const isActive = bucket === item.id;
                        // Primary buckets live on the mobile bottom bar, so the
                        // drawer hides them below md and only shows secondary items.
                        const drawerVisibility = item.primary ? 'hidden md:flex' : 'flex';
                        return (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => go(item.id)}
                                aria-current={isActive ? 'page' : undefined}
                                title={item.title}
                                className={navItemClass(isActive, drawerVisibility)}
                            >
                                <span className={isActive ? 'text-white' : BUCKET_ACCENT[item.id]} aria-hidden="true">
                                    <Icon name={item.icon} size={19} />
                                </span>
                                <span className={`font-semibold text-sm ${isActive ? 'text-white' : ''}`}>{item.label}</span>
                            </button>
                        );
                    })}
                </nav>
                <div className="px-5 py-5 text-[11px] text-sidebar-ink/60 leading-relaxed">
                    RestroPulse
                    <br />
                    v2.0
                </div>
            </aside>

            {/* Main panel */}
            <main className="flex-1 overflow-y-auto v2-scroll">
                {/* Mobile top bar — identity + hamburger (secondary drawer), hidden on md+ */}
                <div className="md:hidden sticky top-0 z-20 flex items-center justify-between gap-3 bg-sidebar px-4 h-14">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <IdentityTile size={34} />
                        <span className="text-base font-semibold text-white leading-none truncate">{restaurantData.name}</span>
                    </div>
                    <button
                        type="button"
                        onClick={() => setMobileNavOpen(true)}
                        aria-label="Open navigation"
                        aria-expanded={mobileNavOpen}
                        className="w-11 h-11 -mr-1 flex items-center justify-center text-white hover:opacity-80 transition-opacity active:scale-95"
                    >
                        <Icon name="hamburger" size={24} />
                    </button>
                </div>
                {/* DEMO MODE: once-per-session "backend not connected" toast */}
                <DemoNotice />
                <div className="px-4 sm:px-6 md:px-8 pt-6 md:pt-8 pb-[calc(88px+env(safe-area-inset-bottom))] md:pb-8 mx-auto max-w-[1100px]">
                    {/* Page header — greeting hero on the dashboard (Brief 05 item 6), plain title elsewhere */}
                    <header className="flex items-start justify-between gap-4 flex-wrap mb-6">
                        <div>
                            {bucket === 'DASHBOARD' ? (
                                <>
                                    <h2 className="text-[26px] sm:text-[34px] font-semibold text-ink tracking-tight leading-tight">
                                        {greeting}, {restaurantData.name} <span aria-hidden="true">👋</span>
                                    </h2>
                                    <p className="text-muted mt-1.5 text-base leading-relaxed">Here's how today is going.</p>
                                    <div className="h-[3px] w-16 rounded-full mt-3" style={{ background: GRADIENT }} aria-hidden="true" />
                                </>
                            ) : (
                                <>
                                    <h2 className="text-[26px] sm:text-[34px] font-semibold text-ink tracking-tight leading-tight">{meta.title}</h2>
                                    <p className="text-muted mt-1.5 text-base leading-relaxed">{meta.subtitle}</p>
                                </>
                            )}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                            {bucket === 'DASHBOARD' && (
                                <span
                                    className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-full border text-[13px] font-semibold min-h-[36px] ${
                                        storeOpen ? 'border-line bg-surface text-ink' : 'border-danger/40 bg-danger/10 text-danger'
                                    }`}
                                    role="status"
                                >
                                    <span className="relative flex w-2 h-2" aria-hidden="true">
                                        {storeOpen && <span className="v2-pulse-ring absolute inset-0 rounded-full border-2 border-success" />}
                                        <span className={`w-2 h-2 rounded-full ${storeOpen ? 'bg-success' : 'bg-danger'}`} />
                                    </span>
                                    {storeOpen ? 'Open · accepting orders' : 'Closed'}
                                </span>
                            )}
                            {isDemoMode() && (
                                <span className="px-2 py-0.5 rounded-md bg-warning/15 text-warning border border-warning/40 text-[10px] font-bold tracking-widest">
                                    DEMO
                                </span>
                            )}
                            {/* Identity pill — redundant with the greeting on the dashboard, so
                                shown only on the other buckets (declutter §3). */}
                            {bucket !== 'DASHBOARD' && (
                                <span className="inline-flex items-center px-4 py-2 rounded-full bg-primary-soft text-primary-strong text-sm font-semibold whitespace-nowrap">
                                    {restaurantData.name}
                                </span>
                            )}
                            <button
                                type="button"
                                onClick={onProfileOpen}
                                aria-label="Profile"
                                className="w-9 h-9 rounded-full flex items-center justify-center hover:opacity-90 transition-opacity active:scale-95 shrink-0"
                                style={{ background: GRADIENT }}
                            >
                                <span className="text-white font-semibold text-xs">{userInitials}</span>
                            </button>
                        </div>
                    </header>

                    {/* keyed wrapper → 150–200 ms ease-out enter on every bucket switch (item 4) */}
                    <div key={bucket} className="v2-bucket-enter">
                    {bucket === 'DASHBOARD' && (
                        <DashboardV2
                            restaurantData={restaurantData}
                            onNavigate={(b) => setBucket(b)}
                        />
                    )}
                    {bucket === 'GET_STARTED' && (
                        <GetStartedV2
                            restaurantData={restaurantData}
                            onNavigate={(b) => setBucket(b)}
                            onDismiss={() => { setDismissed(true); setBucket('DASHBOARD'); }}
                        />
                    )}
                    {bucket === 'CONTENT' && (
                        <ContentEngineV2
                            restaurantData={restaurantData}
                            featureFlags={featureFlags}
                            metaConnected={metaConnected}
                            instagramEnabled={instagramEnabled}
                            facebookEnabled={facebookEnabled}
                            onCreatePost={onCreatePost}
                            onConnectInstagram={onConnectInstagram}
                            onRefreshRestaurant={onRefreshRestaurant}
                            refreshKey={refreshKey}
                        />
                    )}
                    {bucket === 'PROFILE' && (
                        <RestaurantDetailsV2
                            restaurantData={restaurantData}
                            onRefreshRestaurant={onRefreshRestaurant}
                        />
                    )}
                    {bucket === 'ORDERING' && <OrderingV2 restaurantData={restaurantData} initialTab={orderingInitialTab} />}
                    {bucket === 'INTELLIGENCE' && <IntelligenceV2 restaurantData={restaurantData} onNavigate={goDeepLink} />}
                    {bucket === 'DESIGN' && <WebsiteDesignV2 />}
                    </div>
                </div>
            </main>

            {/* Mobile bottom tab bar (Brief 05 item 1) — primary buckets only, hidden md+.
                Safe-area padding keeps tappables clear of the iPhone home bar. */}
            <nav
                className="md:hidden fixed inset-x-0 bottom-0 z-40 flex justify-around bg-sidebar border-t border-white/10 px-1 pt-1.5"
                style={{ paddingBottom: 'calc(0.375rem + env(safe-area-inset-bottom))' }}
                aria-label="Primary"
            >
                {NAV.filter((n) => n.primary).map((item) => {
                    const isActive = bucket === item.id;
                    return (
                        <button
                            key={item.id}
                            type="button"
                            onClick={() => go(item.id)}
                            aria-current={isActive ? 'page' : undefined}
                            className={`flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded-lg min-h-[48px] transition-colors active:scale-[0.94] ${
                                isActive ? 'text-primary' : 'text-sidebar-ink'
                            }`}
                        >
                            <Icon name={item.icon} size={21} />
                            <span className="text-[10px] font-bold leading-none">{TAB_LABEL[item.id] ?? item.label}</span>
                        </button>
                    );
                })}
            </nav>
        </div>
    );
};

export default ShellV2;
