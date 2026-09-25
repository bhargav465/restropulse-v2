import React from 'react';
import { Gauge, PenTool, Lightbulb, Megaphone, Plus } from 'lucide-react';
import { ViewState, FeatureFlags, EntitlementState, IntelligenceNotification } from '@restropulse/shared';
import Sidebar from './Sidebar';
import NotificationBell from './NotificationBell';

interface LayoutProps {
  children: React.ReactNode;
  currentView: ViewState;
  setView: (view: ViewState) => void;
  title: string;
  restaurantName: string;
  userInitials: string;
  pendingCount: number;
  onCreatePost?: () => void;
  onProfileOpen: () => void;
  profileOpen?: boolean;
  featureFlags?: FeatureFlags | null;
  entitlement?: EntitlementState | null;
  onUpgrade?: () => void;
  /** Intelligence notification feed for the bell (App owns the fetch). */
  notifications?: IntelligenceNotification[];
  unreadNotifications?: number;
  onNotificationsOpen?: () => void;
  onNotificationClick?: (n: IntelligenceNotification) => void;
}

const Layout: React.FC<LayoutProps> = ({ children, currentView, setView, title, restaurantName, userInitials, pendingCount, onCreatePost, onProfileOpen, profileOpen, featureFlags, entitlement, onUpgrade, notifications = [], unreadNotifications = 0, onNotificationsOpen, onNotificationClick }) => {

  const NavItem = ({ view, icon: Icon, label }: { view: ViewState, icon: any, label: string }) => {
    const isActive = currentView === view;
    return (
      <button
        onClick={() => setView(view)}
        aria-current={isActive ? 'page' : undefined}
        className={`flex flex-col items-center justify-center w-full py-2 transition-colors ${isActive ? 'text-orange-600' : 'text-slate-400 hover:text-slate-600'
          }`}
      >
        <Icon size={24} strokeWidth={isActive ? 2.5 : 2} />
        <span className="text-[10px] mt-1 font-medium">{label}</span>
      </button>
    );
  };

  return (
    <div className="app-shell flex flex-col lg:flex-row h-screen bg-slate-50">
      {/* Desktop-only left navigation rail */}
      <Sidebar
        currentView={currentView}
        setView={setView}
        onProfileOpen={onProfileOpen}
        profileOpen={profileOpen}
        featureFlags={featureFlags}
        className="hidden lg:flex"
      />

      {/* Header + main + bottom nav column */}
      <div className="flex flex-col flex-1 min-w-0 min-h-0">
      {/* Sticky Header */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 shadow-sm px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-orange-500 to-red-600 rounded-xl flex items-center justify-center shadow-md shadow-orange-500/20">
            <span className="text-white font-bold text-xl">R</span>
          </div>
          <div className="flex flex-col">
            <h1 className="font-extrabold text-base text-slate-800 leading-tight tracking-tight">{restaurantName}</h1>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{title}</span>
          </div>
        </div>

        {/* Right side actions */}
        <div className="flex items-center gap-2">
          {currentView === 'STUDIO' && (
            <button
              onClick={onCreatePost || undefined}
              disabled={!onCreatePost}
              className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors active:scale-95 ${onCreatePost ? 'bg-orange-600 text-white hover:bg-orange-700' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
              aria-label="Create post"
            >
              <Plus size={20} strokeWidth={2.5} />
            </button>
          )}
          <NotificationBell
            items={notifications}
            unread={unreadNotifications}
            pendingPosts={pendingCount}
            onOpen={() => onNotificationsOpen?.()}
            onItemClick={(n) => onNotificationClick?.(n)}
            onPendingPostsClick={() => setView('STUDIO')}
          />
          <button
            onClick={onProfileOpen}
            className="w-9 h-9 bg-gradient-to-br from-orange-500 to-red-600 rounded-full flex items-center justify-center hover:opacity-90 transition-opacity active:scale-95 lg:hidden"
            aria-label="Profile"
          >
            <span className="text-white font-bold text-xs">{userInitials}</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      {/* Trial / lock status banner */}
      {entitlement && entitlement.inTrial && (
        <div className="flex items-center justify-between gap-3 px-4 py-2 bg-primary-soft text-primary-strong text-sm border-b border-line">
          <span className="font-medium">
            {entitlement.trialDaysLeft} {entitlement.trialDaysLeft === 1 ? 'day' : 'days'} left in your free trial
          </span>
          {onUpgrade && (
            <button onClick={onUpgrade} className="font-semibold underline underline-offset-2 hover:opacity-80 whitespace-nowrap">
              Subscribe now
            </button>
          )}
        </div>
      )}
      {entitlement && !entitlement.entitled && (
        <div className="flex items-center justify-between gap-3 px-4 py-2 bg-primary text-white text-sm">
          <span className="font-medium">Your free trial has ended. Subscribe to keep using RestroPulse.</span>
          {onUpgrade && (
            <button onClick={onUpgrade} className="font-semibold rounded-md bg-white/20 px-3 py-1 hover:bg-white/30 whitespace-nowrap">
              See plans
            </button>
          )}
        </div>
      )}

      <main className="flex-1 overflow-y-auto overflow-x-hidden pb-20 lg:pb-0 no-scrollbar">
        {/* Full-width content with desktop gutters. The shell does NOT cap width;
            each page owns its own max-width (e.g. Dashboard/Profile stay narrow,
            Studio/Strategy fill), so content pages never sit in a narrow island. */}
        <div className="w-full lg:px-6">
          {children}
        </div>
      </main>

      {/* Sticky Bottom Navigation - 4 flat items (mobile only) */}
      <nav aria-label="Primary" className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-40 lg:hidden" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.25rem)' }}>
        <div className="flex justify-around items-center px-2 pt-1 pb-1">
          <NavItem view="INTELLIGENCE" icon={Gauge} label="Insights" />
          <NavItem view="STUDIO" icon={PenTool} label="Studio" />
          {featureFlags?.updatesSection ? (
              <NavItem view="INPUTS" icon={Megaphone} label="Updates" />
          ) : (
              <div className="flex flex-col items-center justify-center w-full py-2 text-slate-300">
                  <Megaphone size={24} strokeWidth={2} />
                  <span className="text-[10px] mt-0.5 font-medium">Updates</span>
                  <span className="text-[8px] font-bold text-orange-300 uppercase tracking-wide leading-none">Soon</span>
              </div>
          )}
          <NavItem view="STRATEGY" icon={Lightbulb} label="Strategy" />
        </div>
      </nav>
      </div>
    </div>
  );
};

export default Layout;
