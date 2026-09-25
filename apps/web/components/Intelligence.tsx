import React from 'react';
import { Restaurant } from '@restropulse/shared';
import IntelligenceDashboard from './intelligence/IntelligenceDashboard';
import type { DeepLinkTarget } from './intelligence/sections/deep-links';

interface IntelligenceProps {
  restaurant: Restaurant;
  /**
   * Deep-link handler from the report's "Fix / Act on this" CTAs. Required
   * (RP-001): an optional prop let the shell mount this without wiring it, and
   * every CTA in the dashboard silently did nothing.
   */
  onNavigate: (target: DeepLinkTarget) => void;
}

/**
 * Restaurant Intelligence page -- thin wrapper mounting the ported
 * two-bucket dashboard (RestroScore + My Restaurant + Competition). Runs on the
 * in-memory demo twin in P1; the real backend client arrives in P2.
 */
const Intelligence: React.FC<IntelligenceProps> = ({ restaurant, onNavigate }) => {
  // Mobile horizontal gutter so cards don't touch the viewport edges. Layout
  // supplies desktop gutters (lg:px-6), so we drop ours at lg to avoid doubling.
  return (
    <div className="px-4 pt-4 lg:px-0 lg:pt-0 w-full max-w-[1400px] mx-auto">
      <IntelligenceDashboard restaurantData={restaurant} onNavigate={onNavigate} />
    </div>
  );
};

export default Intelligence;
