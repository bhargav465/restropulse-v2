import React, { useEffect, useState } from 'react';
import { isDemoMode } from '../lib/demo';
import { allDemoRestaurants, currentDemoRestaurantId } from '../lib/demo-restaurants';

/** Signed in with a restaurant picked (not mid sign-up), or '' otherwise. */
const signedInRestaurant = (): string => {
    try {
        if (!localStorage.getItem('rp_token') || !localStorage.getItem('rp_restaurant_id')) return '';
        return currentDemoRestaurantId();
    } catch {
        return '';
    }
};

/**
 * Small fixed pill shown on every screen of a demo build, so nobody mistakes
 * the sample data for a live account. Once signed in it also switches between
 * the sample restaurants (reloads the demo as that restaurant's owner).
 * Renders nothing outside demo mode.
 */
const DemoBadge: React.FC = () => {
    // Re-read each second so a new sign-up, a login or a logout shows up.
    const [restaurantId, setRestaurantId] = useState(signedInRestaurant);
    // On a phone the full badge covered the screen just above the bottom bar
    // (tabs, dropdowns, buttons). There it starts as a small tab you can open.
    const [open, setOpen] = useState(false);
    useEffect(() => {
        if (!isDemoMode()) return;
        const timer = window.setInterval(() => setRestaurantId(signedInRestaurant()), 1000);
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
            className="fixed bottom-20 left-3 z-[60] lg:left-auto lg:right-3 max-w-[calc(100vw-1.5rem)] rounded-2xl bg-amber-100 text-xs font-semibold text-amber-900 shadow ring-1 ring-amber-300 lg:bottom-3"
        >
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                className="lg:hidden flex items-center gap-1 px-3 py-1.5"
            >
                Demo
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={open ? '' : 'rotate-180'}>
                    <path d="M6 9l6 6 6-6" />
                </svg>
            </button>
            <div className={`${open ? 'flex' : 'hidden'} lg:flex flex-wrap items-center gap-2 px-3 pb-1.5 lg:py-1.5`}>
                <span>Demo preview · sample data · nothing is sent</span>
                {restaurantId && (
                    <label className="flex items-center gap-1 font-normal">
                        <span className="sr-only">Switch sample restaurant</span>
                        <select
                            aria-label="Switch sample restaurant"
                            title="Switching reloads the demo and resets your changes"
                            className="max-w-[14rem] rounded-lg border border-amber-300 bg-white px-1 py-0.5 text-xs text-amber-900"
                            value={restaurantId}
                            onChange={(e) => switchTo(e.target.value)}
                        >
                            {allDemoRestaurants().map((r) => (
                                <option key={r.id} value={r.id}>{r.name.replace('[SAMPLE] ', '')} · {r.city}</option>
                            ))}
                        </select>
                    </label>
                )}
            </div>
        </div>
    );
};

export default DemoBadge;
