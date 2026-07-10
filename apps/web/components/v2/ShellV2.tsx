import React, { useEffect, useState } from 'react';
import { Restaurant, FeatureFlags } from '@restropulse/shared';
import { isDemoMode } from '../../lib/demo';
import { orderingAdminAPI } from '../../api';
import DemoNotice from '../DemoNotice';
import DashboardV2 from './DashboardV2';
import GetStartedV2 from './GetStartedV2';
import ContentEngineV2 from './ContentEngineV2';
import OrderingV2 from './OrderingV2';
import IntelligenceV2 from './IntelligenceV2';
import WebsiteDesignV2 from './WebsiteDesignV2';
import { GRADIENT } from './theme';
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

type BucketV2 = 'DASHBOARD' | 'GET_STARTED' | 'CONTENT' | 'ORDERING' | 'INTELLIGENCE' | 'DESIGN';

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

const NAV: Array<{ id: BucketV2; emoji: string; label: string; title: string }> = [
    { id: 'DASHBOARD', emoji: '🏠', label: 'Dashboard', title: 'Your restaurant at a glance' },
    { id: 'CONTENT', emoji: '🎯', label: 'Content Engine', title: 'Strategy, posts & publishing' },
    { id: 'ORDERING', emoji: '🛒', label: 'Online Ordering', title: 'Menu, orders & storefront' },
    { id: 'INTELLIGENCE', emoji: '📊', label: 'Restaurant Intelligence', title: 'Insights coming soon' },
    { id: 'DESIGN', emoji: '🎨', label: 'Website Design', title: 'Themes & templates' },
];

const PAGE_META: Record<BucketV2, { title: string; subtitle: string }> = {
    DASHBOARD: { title: 'Dashboard', subtitle: "Today's orders, revenue and anything that needs your attention." },
    GET_STARTED: { title: 'Get started', subtitle: 'A few quick steps to get your restaurant fully live.' },
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
    const go = (b: BucketV2) => { setBucket(b); setMobileNavOpen(false); };

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

    const navItemClass = (isActive: boolean) =>
        `w-full text-left rounded-lg pl-3 pr-4 py-2.5 flex items-center gap-3 border-l-[3px] transition-colors ${
            isActive
                ? 'border-primary bg-primary/10 text-white'
                : 'border-transparent text-sidebar-ink hover:bg-white/5'
        }`;

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
                <nav className="flex-1 px-3 space-y-1" aria-label="Main navigation">
                    {showGetStarted && (
                        <button
                            type="button"
                            onClick={() => go('GET_STARTED')}
                            aria-current={bucket === 'GET_STARTED' ? 'page' : undefined}
                            title="Finish setting up your restaurant"
                            className={navItemClass(bucket === 'GET_STARTED')}
                        >
                            <span className="text-base leading-none" aria-hidden="true">🚀</span>
                            <span className="flex-1 font-semibold text-sm">Get started</span>
                            <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-md bg-primary-soft text-primary-strong tabular-nums">
                                {progress.completed}/{progress.total}
                            </span>
                        </button>
                    )}
                    {NAV.map((item) => {
                        const isActive = bucket === item.id;
                        return (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => go(item.id)}
                                aria-current={isActive ? 'page' : undefined}
                                title={item.title}
                                className={navItemClass(isActive)}
                            >
                                <span className="text-base leading-none" aria-hidden="true">{item.emoji}</span>
                                <span className={`font-semibold text-sm ${isActive ? 'text-white' : ''}`}>{item.label}</span>
                            </button>
                        );
                    })}
                </nav>
                <div className="px-5 py-5 text-[11px] text-sidebar-ink/60 leading-relaxed">
                    Prototype · sample data
                    <br />
                    v0.2 concept
                </div>
            </aside>

            {/* Main panel */}
            <main className="flex-1 overflow-y-auto">
                {/* Mobile top bar — hamburger + wordmark, hidden on md+ */}
                <div className="md:hidden sticky top-0 z-20 flex items-center gap-3 bg-sidebar px-4 h-14">
                    <button
                        type="button"
                        onClick={() => setMobileNavOpen(true)}
                        aria-label="Open navigation"
                        aria-expanded={mobileNavOpen}
                        className="p-1 -ml-1 text-white hover:opacity-80 transition-opacity active:scale-95"
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                            <path d="M4 6h16M4 12h16M4 18h16" />
                        </svg>
                    </button>
                    <span className="text-lg font-bold tracking-tight text-white leading-none">
                        Restro<span className="text-primary">pulse</span>
                    </span>
                </div>
                {/* DEMO MODE: once-per-session "backend not connected" toast */}
                <DemoNotice />
                <div className="px-4 sm:px-6 md:px-8 py-6 md:py-8 mx-auto max-w-[1100px]">
                    {/* Page header */}
                    <header className="flex items-start justify-between gap-4 flex-wrap mb-6">
                        <div>
                            <h2 className="text-[26px] sm:text-[34px] font-semibold text-ink tracking-tight leading-tight">{meta.title}</h2>
                            <p className="text-muted mt-1.5 text-base leading-relaxed">{meta.subtitle}</p>
                        </div>
                        <div className="flex items-center gap-2">
                            {isDemoMode() && (
                                <span className="px-2 py-0.5 rounded-md bg-warning/15 text-warning border border-warning/40 text-[10px] font-bold tracking-widest">
                                    DEMO
                                </span>
                            )}
                            <span className="inline-flex items-center px-4 py-2 rounded-full bg-primary-soft text-primary-strong text-sm font-semibold whitespace-nowrap">
                                {restaurantData.name}
                            </span>
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
                    {bucket === 'ORDERING' && <OrderingV2 restaurantData={restaurantData} />}
                    {bucket === 'INTELLIGENCE' && <IntelligenceV2 />}
                    {bucket === 'DESIGN' && <WebsiteDesignV2 />}
                </div>
            </main>
        </div>
    );
};

export default ShellV2;
