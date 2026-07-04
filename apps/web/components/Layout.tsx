import React from 'react';
import { Home, PenTool, Lightbulb, Megaphone, Plus, Bell } from 'lucide-react';
import { ViewState, FeatureFlags } from '@restropulse/shared';

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
  featureFlags?: FeatureFlags | null;
}

const Layout: React.FC<LayoutProps> = ({ children, currentView, setView, title, restaurantName, userInitials, pendingCount, onCreatePost, onProfileOpen, featureFlags }) => {

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
    <div className="flex flex-col h-screen bg-slate-50">
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
          <button className="w-9 h-9 bg-slate-100 rounded-xl flex items-center justify-center relative hover:bg-slate-200 transition-colors" aria-label="Notifications">
            <Bell size={18} className="text-slate-600" />
            {pendingCount > 0 && <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border border-white"></span>}
          </button>
          <button
            onClick={onProfileOpen}
            className="w-9 h-9 bg-gradient-to-br from-orange-500 to-red-600 rounded-full flex items-center justify-center hover:opacity-90 transition-opacity active:scale-95"
            aria-label="Profile"
          >
            <span className="text-white font-bold text-xs">{userInitials}</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden pb-20 no-scrollbar">
        {children}
      </main>

      {/* Sticky Bottom Navigation - 4 flat items */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-40" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.25rem)' }}>
        <div className="flex justify-around items-center px-2 pt-1 pb-1">
          <NavItem view="DASHBOARD" icon={Home} label="Home" />
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
  );
};

export default Layout;
