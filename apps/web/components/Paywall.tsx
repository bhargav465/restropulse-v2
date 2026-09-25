import React from 'react';
import { Lock, Sparkles, Radar, Lightbulb } from 'lucide-react';

interface PaywallProps {
    /** The feature the user tried to open, for a tailored headline. */
    feature?: 'Content Engine' | 'Restaurant Intelligence' | 'Strategy';
    /** Opens the subscription/billing flow (ProfileSheet). */
    onSubscribe: () => void;
}

/**
 * Shown in place of a gated view (Content Engine, Restaurant Intelligence,
 * Strategy) once the free trial has ended and there is no active subscription.
 * Uses the app's semantic theme tokens so it follows orchid-admin / legacy.
 */
const Paywall: React.FC<PaywallProps> = ({ feature, onSubscribe }) => {
    return (
        <div className="max-w-xl mx-auto px-6 py-16 text-center">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-soft text-primary-strong">
                <Lock size={30} />
            </div>
            <h2 className="text-2xl font-bold text-ink mb-3">
                {feature ? `${feature} is a paid feature` : 'Your free trial has ended'}
            </h2>
            <p className="text-muted mb-8">
                Subscribe to a plan to keep using RestroPulse&rsquo;s AI Content Engine,
                Restaurant Intelligence, and Strategy tools.
            </p>

            <div className="grid grid-cols-3 gap-3 mb-8 text-left">
                {[
                    { icon: Sparkles, label: 'Content Engine' },
                    { icon: Radar, label: 'Intelligence' },
                    { icon: Lightbulb, label: 'Strategy' },
                ].map(({ icon: Icon, label }) => (
                    <div key={label} className="rounded-xl border border-line bg-surface p-4 flex flex-col items-center gap-2">
                        <Icon size={20} className="text-primary-strong" />
                        <span className="text-xs font-semibold text-ink">{label}</span>
                    </div>
                ))}
            </div>

            <button
                onClick={onSubscribe}
                className="inline-flex items-center justify-center rounded-xl bg-primary px-7 py-3 text-sm font-semibold text-white shadow-sm hover:opacity-95 transition"
            >
                See plans &amp; subscribe
            </button>
        </div>
    );
};

export default Paywall;
