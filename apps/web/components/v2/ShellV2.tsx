import React, { useState } from 'react';
import { Restaurant, FeatureFlags } from '@restropulse/shared';
import { isDemoMode } from '../../lib/demo';
import DemoNotice from '../DemoNotice';
import ContentEngineV2 from './ContentEngineV2';
import OrderingV2 from './OrderingV2';
import IntelligenceV2 from './IntelligenceV2';
import WebsiteDesignV2 from './WebsiteDesignV2';

/**
 * V2 admin shell — desktop-first sidebar layout, enabled only when the app is
 * built with VITE_ADMIN_SHELL=v2 (deployed at /restropulse-v2/admin-v2/).
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

const NAV: Array<{ id: BucketV2; emoji: string; label: string; subtitle: string }> = [
    { id: 'CONTENT', emoji: '🎯', label: 'Content Engine', subtitle: 'Strategy, posts & publishing' },
    { id: 'ORDERING', emoji: '🛒', label: 'Online Ordering', subtitle: 'Menu, orders & storefront' },
    { id: 'INTELLIGENCE', emoji: '📊', label: 'Restaurant Intelligence', subtitle: 'Insights coming soon' },
    { id: 'DESIGN', emoji: '🎨', label: 'Website Design', subtitle: 'Themes & templates' },
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
    const [bucket, setBucket] = useState<BucketV2>('CONTENT');
    const meta = PAGE_META[bucket];

    return (
        <div className="flex h-screen bg-[#f1f3f7]">
            {/* Fixed dark navy sidebar */}
            <aside className="w-72 shrink-0 bg-[#1b2230] flex flex-col overflow-y-auto no-scrollbar">
                <div className="px-6 pt-8 pb-6">
                    <h1 className="text-2xl font-extrabold tracking-tight text-white leading-none">
                        Restro<span className="text-[#e8674a]">pulse</span>
                    </h1>
                    <p className="text-xs text-slate-400 mt-2 leading-snug">Social media made simple for restaurants</p>
                </div>
                <nav className="flex-1 px-3 space-y-1.5" aria-label="Main navigation">
                    {NAV.map((item) => {
                        const isActive = bucket === item.id;
                        return (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => setBucket(item.id)}
                                aria-current={isActive ? 'page' : undefined}
                                className={`w-full text-left rounded-xl px-4 py-3 flex items-start gap-3 transition-colors ${
                                    isActive ? 'bg-[#e8674a] shadow-lg shadow-[#e8674a]/20' : 'hover:bg-white/5'
                                }`}
                            >
                                <span className="text-xl leading-none mt-0.5" aria-hidden="true">{item.emoji}</span>
                                <span>
                                    <span className={`block font-bold text-sm ${isActive ? 'text-white' : 'text-slate-200'}`}>
                                        {item.label}
                                    </span>
                                    <span className={`block text-[11px] mt-0.5 ${isActive ? 'text-white/80' : 'text-slate-500'}`}>
                                        {item.subtitle}
                                    </span>
                                </span>
                            </button>
                        );
                    })}
                </nav>
                <div className="px-6 py-5 text-[11px] text-slate-500 leading-relaxed">
                    Prototype · sample data
                    <br />
                    v0.2 concept
                </div>
            </aside>

            {/* Main panel */}
            <main className="flex-1 overflow-y-auto">
                {/* DEMO MODE: once-per-session "backend not connected" toast */}
                <DemoNotice />
                <div className="px-8 py-8 max-w-6xl">
                    {/* Page header */}
                    <header className="flex items-start justify-between gap-4 flex-wrap mb-8">
                        <div>
                            <h2 className="text-3xl font-extrabold text-slate-800 tracking-tight">{meta.title}</h2>
                            <p className="text-slate-500 mt-1">{meta.subtitle}</p>
                        </div>
                        <div className="flex items-center gap-2">
                            {isDemoMode() && (
                                <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-700 border border-amber-300 text-[10px] font-extrabold tracking-widest">
                                    DEMO
                                </span>
                            )}
                            <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#fdece5] text-[#b5492f] text-sm font-bold whitespace-nowrap">
                                <span aria-hidden="true">🍽️</span>
                                {restaurantData.name}
                            </span>
                            <button
                                type="button"
                                onClick={onProfileOpen}
                                aria-label="Profile"
                                className="w-9 h-9 bg-gradient-to-br from-orange-500 to-red-600 rounded-full flex items-center justify-center hover:opacity-90 transition-opacity active:scale-95 shrink-0"
                            >
                                <span className="text-white font-bold text-xs">{userInitials}</span>
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
