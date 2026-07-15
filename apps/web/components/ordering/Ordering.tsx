import React, { useState } from 'react';
import { BookOpenText, ReceiptText, CalendarCheck, Palette, BarChart3, Megaphone, Settings2 } from 'lucide-react';
import { Restaurant } from '@restropulse/shared';
import MenuManager from './MenuManager';
import OrdersFeed from './OrdersFeed';
import ReservationsPanel from './ReservationsPanel';
import SiteContentEditor from './SiteContentEditor';
import FunnelAnalytics from './FunnelAnalytics';
import Campaigns from './Campaigns';
import OrderingSettings from './OrderingSettings';

type OrderingTab = 'MENU' | 'ORDERS' | 'RESERVATIONS' | 'CONTENT' | 'FUNNEL' | 'CAMPAIGNS' | 'SETTINGS';

interface OrderingProps {
    restaurantData: Restaurant;
}

const TABS: Array<{ id: OrderingTab; label: string; icon: React.ComponentType<{ size?: number | string; strokeWidth?: number | string }> }> = [
    { id: 'ORDERS', label: 'Orders', icon: ReceiptText },
    { id: 'MENU', label: 'Menu', icon: BookOpenText },
    { id: 'RESERVATIONS', label: 'Reservations', icon: CalendarCheck },
    { id: 'CONTENT', label: 'Site Content', icon: Palette },
    { id: 'FUNNEL', label: 'Funnel', icon: BarChart3 },
    { id: 'CAMPAIGNS', label: 'Campaigns', icon: Megaphone },
    { id: 'SETTINGS', label: 'Settings', icon: Settings2 },
];

/**
 * Ordering hub — merchant-facing admin for the online ordering storefront.
 * Sub-views are tabs to keep the app's single ViewState pattern intact.
 */
const Ordering: React.FC<OrderingProps> = ({ restaurantData }) => {
    const [activeTab, setActiveTab] = useState<OrderingTab>('ORDERS');

    return (
        <div className="p-4 max-w-3xl mx-auto w-full">
            {/* Tab bar */}
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1 mb-4" role="tablist" aria-label="Ordering sections">
                {TABS.map(({ id, label, icon: Icon }) => {
                    const isActive = activeTab === id;
                    return (
                        <button
                            key={id}
                            role="tab"
                            aria-selected={isActive}
                            onClick={() => setActiveTab(id)}
                            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-colors shrink-0 ${
                                isActive ? 'bg-orange-600 text-white shadow-md shadow-orange-500/20' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'
                            }`}
                        >
                            <Icon size={14} strokeWidth={2.5} />
                            {label}
                        </button>
                    );
                })}
            </div>

            {activeTab === 'ORDERS' && <OrdersFeed initialStoreOpen={restaurantData.storeOpen === true} />}
            {activeTab === 'MENU' && <MenuManager />}
            {activeTab === 'RESERVATIONS' && <ReservationsPanel />}
            {activeTab === 'CONTENT' && <SiteContentEditor />}
            {activeTab === 'FUNNEL' && <FunnelAnalytics />}
            {activeTab === 'CAMPAIGNS' && <Campaigns />}
            {activeTab === 'SETTINGS' && <OrderingSettings />}
        </div>
    );
};

export default Ordering;
