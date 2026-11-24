import React, { useState } from 'react';
import { PageContainer } from '../ui';
import MenuEditor from './MenuEditor';
import OffersEditor from './OffersEditor';
import SiteContentEditor from './SiteContentEditor';
import OrdersBoard from './OrdersBoard';
import OrderingSettings from './OrderingSettings';

type Tab = 'orders' | 'menu' | 'offers' | 'content' | 'settings';

const TABS: Array<{ id: Tab; label: string }> = [
    { id: 'orders', label: 'Orders' },
    { id: 'menu', label: 'Menu' },
    { id: 'offers', label: 'Offers' },
    { id: 'content', label: 'Site content' },
    { id: 'settings', label: 'Settings' },
];

/**
 * Website hub: the restaurant takes orders and manages its menu, offers, site
 * content and ordering settings here. Shown only when VITE_WEBSITE_CMS=true
 * (see lib/website-cms.ts).
 * ASSUMPTION: the hub still opens on Menu; Orders is first in the tab row so
 * it's one tap away once orders flow.
 */
const WebsiteCms: React.FC<{ initialTab?: Tab }> = ({ initialTab = 'menu' }) => {
    const [tab, setTab] = useState<Tab>(initialTab);

    return (
        <PageContainer max="wide" className="py-4 space-y-5">
            <div role="tablist" aria-label="Website sections" className="flex gap-1 overflow-x-auto rounded-2xl border border-[var(--rp-line)] bg-[var(--rp-surface)] p-1">
                {TABS.map((t) => (
                    <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={tab === t.id}
                        onClick={() => setTab(t.id)}
                        className={`flex-1 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${tab === t.id
                            ? 'bg-[color-mix(in_srgb,var(--rp-primary)_14%,transparent)] text-[var(--rp-primary)]'
                            : 'text-[var(--rp-muted)] hover:text-[var(--rp-text)]'}`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>
            <div role="tabpanel">
                {tab === 'menu' && <MenuEditor />}
                {tab === 'offers' && <OffersEditor />}
                {tab === 'content' && <SiteContentEditor />}
                {tab === 'orders' && <OrdersBoard />}
                {tab === 'settings' && <OrderingSettings />}
            </div>
        </PageContainer>
    );
};

export default WebsiteCms;
