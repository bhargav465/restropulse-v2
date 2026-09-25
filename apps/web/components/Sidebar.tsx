import React from 'react';
import { Gauge, PenTool, Lightbulb, Megaphone, User } from 'lucide-react';
import { ViewState, FeatureFlags } from '@restropulse/shared';

interface SidebarProps {
  currentView: ViewState;
  setView: (view: ViewState) => void;
  onProfileOpen: () => void;
  /** Whether the profile/account panel is currently open (drives Account active state). */
  profileOpen?: boolean;
  featureFlags?: FeatureFlags | null;
  /** Visibility/layout classes supplied by the parent (e.g. `hidden lg:flex`). */
  className?: string;
}

/**
 * Desktop-only left navigation rail. Rendered by Layout at `lg` and up; hidden
 * on mobile where the fixed bottom nav takes over. All colors read from the
 * shared `--rp-*` theme vars so the rail tracks both themes with no per-theme
 * markup: legacy paints a light (white) rail with slate ink, orchid-admin a
 * dark aubergine rail with lavender ink.
 */
const Sidebar: React.FC<SidebarProps> = ({ currentView, setView, onProfileOpen, profileOpen, featureFlags, className }) => {
  const NavItem = ({ view, icon: Icon, label }: { view: ViewState; icon: any; label: string }) => {
    const isActive = currentView === view;
    return (
      <button
        onClick={() => setView(view)}
        aria-current={isActive ? 'page' : undefined}
        className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors ${isActive
          ? 'bg-[color-mix(in_srgb,var(--rp-primary)_14%,transparent)] text-[var(--rp-primary)]'
          : 'text-[var(--rp-sidebar-ink)] hover:bg-[color-mix(in_srgb,var(--rp-sidebar-ink)_12%,transparent)]'
          }`}
      >
        <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
        <span>{label}</span>
      </button>
    );
  };

  return (
    <aside
      className={`${className ?? ''} w-64 shrink-0 flex-col h-screen px-3 py-5 bg-[var(--rp-sidebar)] border-r border-[var(--rp-line)]`}
    >
      {/* Brand */}
      <div className="px-2 mb-6">
        <div className="text-xl font-extrabold tracking-tight leading-none">
          <span className="text-[var(--rp-sidebar-ink)]">Restro</span>
          <span className="text-[var(--rp-primary)]">Pulse</span>
        </div>
        <p className="text-[11px] mt-1 text-[color-mix(in_srgb,var(--rp-sidebar-ink)_70%,transparent)]">
          Social media made simple for restaurants
        </p>
      </div>

      {/* Section navigation */}
      <nav aria-label="Sidebar" className="flex flex-col gap-1 flex-1 overflow-y-auto no-scrollbar">
        <NavItem view="INTELLIGENCE" icon={Gauge} label="Intelligence" />
        <NavItem view="STUDIO" icon={PenTool} label="Content Studio" />
        {featureFlags?.updatesSection ? (
          <NavItem view="INPUTS" icon={Megaphone} label="Updates" />
        ) : (
          <div className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-semibold text-[color-mix(in_srgb,var(--rp-sidebar-ink)_55%,transparent)]">
            <Megaphone size={20} strokeWidth={2} />
            <span>Updates</span>
            <span className="ml-auto text-[9px] font-bold uppercase tracking-wide text-[var(--rp-primary)]">Soon</span>
          </div>
        )}
        <NavItem view="STRATEGY" icon={Lightbulb} label="Content Strategy" />
      </nav>

      {/* Account */}
      <div className="pt-3 mt-3 border-t border-[var(--rp-line)]">
        <button
          onClick={onProfileOpen}
          aria-label="Account"
          aria-pressed={profileOpen ? true : undefined}
          className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors ${profileOpen
            ? 'bg-[color-mix(in_srgb,var(--rp-primary)_14%,transparent)] text-[var(--rp-primary)]'
            : 'text-[var(--rp-sidebar-ink)] hover:bg-[color-mix(in_srgb,var(--rp-sidebar-ink)_12%,transparent)]'
            }`}
        >
          <User size={20} strokeWidth={2} />
          <span>Account</span>
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
