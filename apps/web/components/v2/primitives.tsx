import React from 'react';
import { DELTA_TEXT, DeltaTone } from './theme';

/**
 * V2 admin shell primitives — Electric Lavender building blocks used by the
 * bucket pages under components/v2/. Only rendered when the app is built with
 * VITE_ADMIN_SHELL=v2; the default (v1) shell never imports these.
 *
 * Design contract (design.md §2 + §3): tokens only (no raw hex), quiet
 * chrome — 1px `border-line` over shadows, one hover shadow level, deltas as
 * small colored text (no pills), sub-nav as underline tabs (no pills, no
 * emoji), and at most decorative single emojis on action tiles.
 */

/** Small colored delta text — e.g. "▲ 6% this week". No pill. */
export const DeltaChip: React.FC<{ text: string; tone?: DeltaTone }> = ({ text, tone = 'up' }) => (
    <span className={`text-sm font-semibold ${DELTA_TEXT[tone]}`}>{text}</span>
);

/** Quiet "Coming soon" status chip. */
export const ComingSoonPill: React.FC = () => (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-primary-soft text-primary-strong text-[11px] font-semibold whitespace-nowrap">
        Coming soon
    </span>
);

interface StatCardProps {
    label: string;
    value: React.ReactNode;
    /** Retained for API compatibility; no longer rendered (declutter §3.3). */
    emoji?: string;
    delta?: string;
    deltaTone?: DeltaTone;
}

/**
 * KPI card (design.md §3.3): 12px uppercase tracked `muted` label above, a
 * 28px semibold `ink` number, and a small colored delta line. No pills, no
 * emoji. Quiet 1px border, no resting shadow.
 */
export const StatCard: React.FC<StatCardProps> = ({ label, value, delta, deltaTone = 'up' }) => (
    // min-w-0 lets the card shrink inside a 2-up mobile grid instead of forcing
    // overflow; the value scales 24px→28px so long currency (₹1,23,456) fits the
    // ~115px column on small phones and reads full-size on desktop.
    <div className="bg-surface rounded-2xl p-6 border border-line min-w-0">
        <p className="text-[13px] font-semibold text-muted uppercase tracking-wider">{label}</p>
        <p className="text-2xl sm:text-[34px] font-semibold text-ink mt-3 leading-none tabular-nums break-words">{value}</p>
        {delta && (
            <div className="mt-3">
                <DeltaChip text={delta} tone={deltaTone} />
            </div>
        )}
    </div>
);

interface ActionCardProps {
    emoji: string;
    title: string;
    description: string;
    onClick?: () => void;
    comingSoon?: boolean;
}

/** Action / teaser tile — single decorative emoji, one hover-only shadow. */
export const ActionCard: React.FC<ActionCardProps> = ({ emoji, title, description, onClick, comingSoon }) => {
    const Tag = onClick ? 'button' : 'div';
    return (
        <Tag
            {...(onClick ? { onClick, type: 'button' } : {})}
            className={`text-left bg-surface rounded-2xl p-6 border border-line transition-all w-full ${
                onClick ? 'hover:shadow-md hover:-translate-y-0.5 cursor-pointer active:scale-[0.99]' : ''
            }`}
        >
            <div className="w-9 h-9 rounded-xl bg-primary-soft flex items-center justify-center text-lg" aria-hidden="true">
                {emoji}
            </div>
            <h3 className="font-semibold text-ink mt-3 flex items-center gap-2 flex-wrap">
                {title}
                {comingSoon && <ComingSoonPill />}
            </h3>
            <p className="text-sm text-muted mt-1 leading-relaxed">{description}</p>
        </Tag>
    );
};

export interface SubNavTab<T extends string> {
    id: T;
    label: string;
    /** Retained for API compatibility; no longer rendered (declutter §3.1/§3.2). */
    emoji?: string;
}

interface SubNavProps<T extends string> {
    tabs: Array<SubNavTab<T>>;
    active: T;
    onChange: (id: T) => void;
    label: string;
}

/** Quiet underline tab bar (design.md §3.2) — secondary nav inside a bucket. */
export function SubNav<T extends string>({ tabs, active, onChange, label }: SubNavProps<T>) {
    return (
        <div className="flex gap-6 flex-wrap border-b border-line mb-6" role="tablist" aria-label={label}>
            {tabs.map((t) => {
                const isActive = active === t.id;
                return (
                    <button
                        key={t.id}
                        role="tab"
                        type="button"
                        aria-selected={isActive}
                        onClick={() => onChange(t.id)}
                        className={`-mb-px border-b-2 pb-3 text-sm font-semibold whitespace-nowrap transition-colors ${
                            isActive
                                ? 'border-primary text-ink'
                                : 'border-transparent text-muted hover:text-ink'
                        }`}
                    >
                        {t.label}
                    </button>
                );
            })}
        </div>
    );
}

/** Lavender hero banner (design.md §2 dark surface) with numbered steps. */
export const StepsBanner: React.FC<{
    emoji: string;
    title: string;
    subtitle: string;
    steps: Array<{ title: string; text: string }>;
}> = ({ emoji, title, subtitle, steps }) => (
    <div className="bg-banner rounded-2xl p-6 text-white">
        <h3 className="font-semibold text-lg flex items-center gap-2">
            <span aria-hidden="true">{emoji}</span>
            {title}
        </h3>
        <p className="text-sidebar-ink text-sm mt-1">{subtitle}</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-5">
            {steps.map((s, i) => (
                <div key={s.title} className="flex items-start gap-3">
                    <span className="w-7 h-7 shrink-0 rounded-full bg-primary text-white text-sm font-semibold flex items-center justify-center">
                        {i + 1}
                    </span>
                    <div>
                        <p className="font-semibold text-sm">{s.title}</p>
                        <p className="text-sidebar-ink text-xs mt-0.5 leading-relaxed">{s.text}</p>
                    </div>
                </div>
            ))}
        </div>
    </div>
);
