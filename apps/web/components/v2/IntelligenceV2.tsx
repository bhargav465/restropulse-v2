import React from 'react';
import { ActionCard } from './primitives';

/**
 * Restaurant Intelligence bucket — placeholder page teasing the upcoming
 * insights suite. Pure static content; no data dependencies.
 */
const IntelligenceV2: React.FC = () => (
    <div className="space-y-6">
        {/* Friendly hero */}
        <div className="bg-banner rounded-2xl p-8 text-white text-center">
            <div className="text-5xl mb-3" aria-hidden="true">📊</div>
            <h3 className="text-xl font-semibold">Your restaurant's brain is under construction</h3>
            <p className="text-sidebar-ink text-sm mt-2 max-w-xl mx-auto leading-relaxed">
                We're teaching RestroPulse to crunch your numbers so you don't have to.
                Benchmarks, heatmaps and dish-level economics — all in one friendly place.
            </p>
        </div>

        {/* Teasers */}
        <div className="grid sm:grid-cols-2 gap-4">
            <ActionCard
                emoji="🥊"
                title="Competitor benchmarks"
                description="See how your prices, ratings and posting cadence stack up against restaurants around the corner."
                comingSoon
            />
            <ActionCard
                emoji="🔥"
                title="Peak-hour heatmap"
                description="Know exactly when orders surge so staffing and prep always match demand."
                comingSoon
            />
            <ActionCard
                emoji="🍛"
                title="Dish-level P&L"
                description="Margin per dish, not per month — find the quiet heroes and the expensive passengers on your menu."
                comingSoon
            />
            <ActionCard
                emoji="💬"
                title="Review sentiment"
                description="Every review, summarised: what guests love, what's slipping, and what to fix first."
                comingSoon
            />
        </div>
    </div>
);

export default IntelligenceV2;
