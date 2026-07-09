import React from 'react';
import { Restaurant, FeatureFlags } from '@restropulse/shared';
import { isDemoMode } from '../../lib/demo';
import DemoNotice from '../DemoNotice';
import ContentEngineV2 from './ContentEngineV2';
import OrderingV2 from './OrderingV2';
import IntelligenceV2 from './IntelligenceV2';
import WebsiteDesignV2 from './WebsiteDesignV2';
import { GRADIENT } from './theme';

/**
 * V2 admin shell — desktop-first sidebar layout, enabled only when the app is
 * built with VITE_ADMIN_SHELL=v2 (deployed at /restropulse-v2/admin-v2/).
 *
 * Electric Lavender palette (design.md §2) + declutter rules (§3): one emoji
 * per bucket, quiet active-item treatment (3px primary edge + soft tint), no
 * nav subtitles (title attr instead), 1100px centered content column.
 *
 * Navigation mirrors the existing view-state pattern: plain local state, no
 * router. The four sidebar buckets group the existing v1 views (mounted
 * unchanged) plus new overview/placeholder pages.
 */

type BucketV2 = 'CONTENT' | 'ORDERING' | 'INTELLIGENCE' | 'DESIGN';

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
    { id: 'CONTENT', emoji: '🎯', label: 'Content Engine', title: 'Strategy, posts & publishing' },
    { id: 'ORDERING', emoji: '🛒', label: 'Online Ordering', title: 'Menu, orders & storefront' },
    { id: 'INTELLIGENCE', emoji: '📊', label: 'Restaurant Intelligence', title: 'Insights coming soon' },
    { id: 'DESIGN', emoji: '🎨', label: 'Website Design', title: 'Themes & templates' },
];

const PAGE_META: Record<BucketV2, { title: string; subtitle: string }> = {
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
    const [bucket, setBucket] = React.useState<BucketV2>('CONTENT');
    const meta = PAGE_META[bucket];

    const navItemClass = (isActive: boolean) =>
        `w-full text-left rounded-lg pl-3 pr-4 py-2.5 flex items-center gap-3 border-l-[3px] transition-colors ${
            isActive
                ? 'border-primary bg-primary/10 text-white'
                : 'border-transparent text-sidebar-ink hover:bg-white/5'
        }`;

    return (
        <div className="flex h-screen bg-canvas">
            {/* Fixed aubergine sidebar */}
            <aside className="w-64 shrink-0 bg-sidebar flex flex-col overflow-y-auto no-scrollbar">
                <div className="px-5 pt-8 pb-6">
                    <h1 className="text-2xl font-bold tracking-tight text-white leading-none">
                        Restro<span className="text-primary">pulse</span>
                    </h1>
                    <p className="text-xs text-sidebar-ink/70 mt-2 leading-snug">Social media made simple for restaurants</p>
                </div>
                <nav className="flex-1 px-3 space-y-1" aria-label="Main navigation">
                    {NAV.map((item) => {
                        const isActive = bucket === item.id;
                        return (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => setBucket(item.id)}
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
                {/* DEMO MODE: once-per-session "backend not connected" toast */}
                <DemoNotice />
                <div className="px-8 py-8 mx-auto max-w-[1100px]">
                    {/* Page header */}
                    <header className="flex items-start justify-between gap-4 flex-wrap mb-6">
                        <div>
                            <h2 className="text-[28px] font-semibold text-ink tracking-tight leading-tight">{meta.title}</h2>
                            <p className="text-muted mt-1 text-sm">{meta.subtitle}</p>
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
