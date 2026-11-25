import React, { useEffect, useState } from 'react';
import { isDemoMode } from '../lib/demo';
import { currentDemoRestaurantId, DEMO_RESTAURANTS } from '../lib/demo-restaurants';

const signedIn = (): boolean => {
    try {
        return !!localStorage.getItem('rp_token');
    } catch {
        return false;
    }
};

/**
 * Small fixed pill shown on every screen of a demo build, so nobody mistakes
 * the sample data for a live account. Once signed in it also switches between
 * the sample restaurants (reloads the demo as that restaurant's owner).
 * Renders nothing outside demo mode.
 */
const DemoBadge: React.FC = () => {
    const [loggedIn, setLoggedIn] = useState(signedIn);
    useEffect(() => {
        if (!isDemoMode()) return;
        const timer = window.setInterval(() => setLoggedIn(signedIn()), 1000);
        return () => window.clearInterval(timer);
    }, []);
    if (!isDemoMode()) return null;

    const switchTo = (id: string) => {
        if (id === currentDemoRestaurantId()) return;
        try {
            localStorage.setItem('rp_restaurant_id', id);
        } catch {
            return;
        }
        window.location.reload();
    };

    return (
        <div
            role="note"
            aria-label="Demo preview"
            className="fixed bottom-20 left-3 z-[60] flex max-w-[calc(100vw-1.5rem)] flex-wrap items-center gap-2 rounded-2xl bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-900 shadow ring-1 ring-amber-300 sm:bottom-3"
        >
            <span>Demo preview · sample data · nothing is sent</span>
            {loggedIn && (
                <label className="flex items-center gap-1 font-normal">
                    <span className="sr-only">Switch sample restaurant</span>
                    <select
                        aria-label="Switch sample restaurant"
                        title="Switching reloads the demo and resets your changes"
                        className="max-w-[14rem] rounded-lg border border-amber-300 bg-white px-1 py-0.5 text-xs text-amber-900"
                        value={currentDemoRestaurantId()}
                        onChange={(e) => switchTo(e.target.value)}
                    >
                        {DEMO_RESTAURANTS.map((r) => (
                            <option key={r.id} value={r.id}>{r.name.replace('[SAMPLE] ', '')} · {r.city}</option>
                        ))}
                    </select>
                </label>
            )}
        </div>
    );
};

export default DemoBadge;
