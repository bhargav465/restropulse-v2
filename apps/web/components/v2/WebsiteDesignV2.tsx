import React from 'react';
import { SamplePhoto } from './primitives';

/**
 * Website Design bucket — teases storefront theming with a template gallery.
 * Preview photos are real sample imagery (Unsplash CDN) via SamplePhoto, which
 * falls back to an on-brand tile if a URL ever fails. Still static, no data.
 */

const img = (id: string): string =>
    `https://images.unsplash.com/photo-${id}?w=600&h=400&fit=crop&crop=entropy&q=80&auto=format`;

interface Template {
    name: string;
    style: string;
    emoji: string;
    src: string;
}

const TEMPLATES: Template[] = [
    { name: 'Trattoria', style: 'Warm · rustic', emoji: '🍝', src: img('1414235077428-338989a2e8c0') },
    { name: 'Corner Café', style: 'Light · minimal', emoji: '☕', src: img('1555396273-367ea4eb4db5') },
    { name: 'Slice House', style: 'Bold · playful', emoji: '🍕', src: img('1513104890138-7c749659a591') },
    { name: 'The Grill', style: 'Dark · premium', emoji: '🍔', src: img('1571091718767-18b5b1457add') },
    { name: 'Fresh & Green', style: 'Clean · healthy', emoji: '🥗', src: img('1546069901-ba9599a7e63c') },
    { name: 'Street Kitchen', style: 'Vibrant · street food', emoji: '🍛', src: img('1606491956689-2ea866880c84') },
];

const WebsiteDesignV2: React.FC = () => (
    <div className="space-y-6">
        {/* Friendly hero */}
        <div className="bg-banner rounded-2xl p-8 text-white text-center">
            <div className="text-5xl mb-3" aria-hidden="true">🎨</div>
            <h3 className="text-2xl font-semibold">A beautiful website, minus the agency invoice</h3>
            <p className="text-sidebar-ink text-base mt-2 max-w-xl mx-auto leading-relaxed">
                Pick a template, tweak the colors, hit publish. Website design tools for your
                storefront are on the way.
            </p>
        </div>

        {/* Template gallery */}
        <div>
            <div className="flex items-center justify-between gap-4 mb-4">
                <h3 className="text-lg font-bold text-ink">Template gallery</h3>
                <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-primary-soft text-primary-strong text-[13px] font-semibold">
                    Preview · coming soon
                </span>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {TEMPLATES.map((t) => (
                    <div
                        key={t.name}
                        className="group bg-surface rounded-2xl border border-line overflow-hidden transition-all hover:shadow-md hover:-translate-y-0.5"
                    >
                        <SamplePhoto
                            src={t.src}
                            alt={`${t.name} template preview`}
                            emoji={t.emoji}
                            className="aspect-[3/2] w-full"
                        />
                        <div className="p-4 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <p className="font-semibold text-ink truncate">{t.name}</p>
                                <p className="text-sm text-muted mt-0.5">{t.style}</p>
                            </div>
                            <span className="shrink-0 px-3 py-1.5 rounded-lg text-sm font-semibold text-primary-strong bg-primary-soft group-hover:bg-primary group-hover:text-white transition-colors">
                                Preview
                            </span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    </div>
);

export default WebsiteDesignV2;
