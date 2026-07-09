import React from 'react';
import { ActionCard } from './primitives';

/**
 * Website Design bucket — placeholder page teasing storefront theming and
 * template tools. Pure static content; no data dependencies.
 */
const WebsiteDesignV2: React.FC = () => (
    <div className="space-y-6">
        {/* Friendly hero */}
        <div className="bg-banner rounded-2xl p-8 text-white text-center">
            <div className="text-5xl mb-3" aria-hidden="true">🎨</div>
            <h3 className="text-xl font-semibold">A beautiful website, minus the agency invoice</h3>
            <p className="text-sidebar-ink text-sm mt-2 max-w-xl mx-auto leading-relaxed">
                Pick a template, tweak the colors, hit publish. Website design tools for your
                storefront are on the way.
            </p>
        </div>

        {/* Teasers */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <ActionCard
                emoji="🖼️"
                title="Template gallery"
                description="Hand-crafted restaurant templates — from cozy café to fine dining — ready in one click."
                comingSoon
            />
            <ActionCard
                emoji="🎛️"
                title="Theme editor"
                description="Your brand colors, fonts and logo applied across the whole storefront, instantly."
                comingSoon
            />
            <ActionCard
                emoji="👀"
                title="Live preview"
                description="See every change on desktop and mobile before your guests do."
                comingSoon
            />
        </div>
    </div>
);

export default WebsiteDesignV2;
