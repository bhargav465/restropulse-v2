import React from 'react';
import { isDemoMode } from '../lib/demo';

/**
 * Small fixed pill shown on every screen of a demo build, so nobody mistakes
 * the sample data for a live account. Renders nothing outside demo mode.
 */
const DemoBadge: React.FC = () => {
    if (!isDemoMode()) return null;
    return (
        <div
            role="note"
            aria-label="Demo preview"
            className="pointer-events-none fixed bottom-3 left-3 z-[60] rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900 shadow ring-1 ring-amber-300"
        >
            Demo preview · sample data · nothing is sent
        </div>
    );
};

export default DemoBadge;
