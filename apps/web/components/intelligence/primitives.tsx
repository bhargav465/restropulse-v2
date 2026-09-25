import React, { useEffect, useState } from 'react';
import { DELTA_TEXT, DeltaTone, GRADIENT, TOKENS } from './theme';
import { Icon, IconName } from './icons';

/**
 * Intelligence dashboard primitives — Electric Lavender building blocks used by the
 * bucket pages under components/intelligence/.
 *
 * Design contract (design.md §2 + §3): tokens only (no raw hex), quiet
 * chrome — 1px `border-line` over shadows, one hover shadow level, deltas as
 * small colored text (no pills), sub-nav as underline tabs (no pills, no
 * emoji), and at most decorative single emojis on action tiles.
 */

/**
 * Sample photo — a real image that degrades gracefully. If the URL fails to
 * load (offline / CDN hiccup), it falls back to an on-brand lavender gradient
 * tile with an emoji, so a placeholder never looks broken. `className` sets the
 * frame size / aspect (e.g. "aspect-video w-full").
 */
export const SamplePhoto: React.FC<{
    src: string;
    alt: string;
    emoji?: string;
    className?: string;
}> = ({ src, alt, emoji = '🍽️', className = '' }) => {
    const [failed, setFailed] = useState(false);
    return (
        <div className={`relative overflow-hidden bg-primary-soft ${className}`}>
            {failed ? (
                <div className="absolute inset-0 flex items-center justify-center text-4xl" style={{ background: GRADIENT }} aria-hidden="true">
                    {emoji}
                </div>
            ) : (
                <img
                    src={src}
                    alt={alt}
                    loading="lazy"
                    onError={() => setFailed(true)}
                    className="w-full h-full object-cover"
                />
            )}
        </div>
    );
};

/** Small colored delta text — e.g. "▲ 6% this week". No pill. */
export const DeltaChip: React.FC<{ text: string; tone?: DeltaTone }> = ({ text, tone = 'up' }) => (
    <span className={`text-sm font-semibold ${DELTA_TEXT[tone]}`}>{text}</span>
);

/**
 * Shimmer skeleton block (design.md §3 quiet chrome). A soft primary-tinted bar
 * with a sweeping highlight (`.intel-skeleton` keyframes in index.css). Used while
 * data loads so cards never flash `0` / `₹0` before the API resolves.
 */
export const Skeleton: React.FC<{ className?: string }> = ({ className = '' }) => (
    <div className={`intel-skeleton bg-primary-soft rounded-lg ${className}`} aria-hidden="true" />
);

/**
 * Count-up number. Mounts at 0 and eases to `value` over ~0.65 s (cubic
 * ease-out) the first time it renders — used when a StatCard's skeleton clears.
 * Snaps instantly under prefers-reduced-motion or when rAF is unavailable
 * (jsdom/tests), so the final value is always in the DOM synchronously there.
 */
const AnimatedNumber: React.FC<{ value: number; format?: (n: number) => string }> = ({ value, format }) => {
    const fmt = format ?? ((n: number) => Math.round(n).toLocaleString('en-IN'));
    const [display, setDisplay] = useState(value);

    useEffect(() => {
        const reduce =
            typeof window === 'undefined' ||
            typeof window.requestAnimationFrame !== 'function' ||
            (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        if (reduce) {
            setDisplay(value);
            return;
        }
        let raf = 0;
        const t0 = performance.now();
        const dur = 650;
        const step = (t: number) => {
            const p = Math.min((t - t0) / dur, 1);
            const eased = 1 - Math.pow(1 - p, 3);
            setDisplay(value * eased);
            if (p < 1) raf = requestAnimationFrame(step);
            else setDisplay(value);
        };
        setDisplay(0);
        raf = requestAnimationFrame(step);
        // Safety net: guarantee the final value lands even if rAF stalls (e.g.
        // background tab / jsdom), so the number is never stuck mid-animation.
        const done = setTimeout(() => setDisplay(value), dur + 120);
        return () => {
            cancelAnimationFrame(raf);
            clearTimeout(done);
        };
        // Animate once per distinct target value.
    }, [value, format]);

    return <>{fmt(display)}</>;
};

/** 7-day micro-sparkline for a KPI card — primary stroke, soft end dot. */
const MicroSparkline: React.FC<{ points: number[] }> = ({ points }) => {
    const w = 120;
    const h = 30;
    if (points.length === 0) return null;
    const max = Math.max(...points);
    const min = Math.min(...points);
    const range = max - min || 1;
    const step = points.length > 1 ? w / (points.length - 1) : w;
    const coords = points.map((p, i) => [i * step, h - 3 - ((p - min) / range) * (h - 8)] as const);
    const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const last = coords[coords.length - 1];
    return (
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full mt-3" style={{ height: h }} role="img" aria-label="7-day trend">
            <polyline points={line} fill="none" stroke={TOKENS.primary} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <circle cx={last[0]} cy={last[1]} r={2.5} fill={TOKENS.primaryStrong} />
        </svg>
    );
};

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
    /** Soft-chip icon (Brief 05 item 7). */
    icon?: IconName;
    /** 7-day series for the in-card micro-sparkline (Brief 05 item 7). */
    spark?: number[];
    /**
     * When defined, the card participates in the skeleton→data flow (Brief 05
     * item 2): `true` shows a shimmer, and when it clears a numeric `value`
     * counts up. When omitted the card renders `value` immediately (legacy
     * callers stay byte-identical).
     */
    loading?: boolean;
    /** Count-up formatter for a numeric `value` (e.g. INR). */
    format?: (n: number) => string;
    /** Makes the whole card a tappable button (deep-link / drill-in). */
    onClick?: () => void;
}

/**
 * KPI card (design.md §3.3): 12px uppercase tracked `muted` label, a big
 * semibold `ink` number and a small colored delta line. Brief 05 item 7 adds an
 * optional soft icon chip, a 7-day micro-sparkline and a hover lift; item 2 adds
 * a shimmer skeleton + count-up. No pills, no emoji. Quiet 1px border.
 */
export const StatCard: React.FC<StatCardProps> = ({
    label,
    value,
    delta,
    deltaTone = 'up',
    icon,
    spark,
    loading,
    format,
    onClick,
}) => {
    // min-w-0 lets the card shrink inside a 2-up mobile grid instead of forcing
    // overflow; the value scales 24px→34px so long currency (₹1,23,456) fits the
    // ~115px column on small phones and reads full-size on desktop.
    const base = 'bg-surface rounded-2xl p-6 border border-line min-w-0 transition-all';
    const interactive = onClick ? ' text-left w-full cursor-pointer hover:shadow-md hover:-translate-y-0.5 active:scale-[0.98]' : '';
    const Tag: React.ElementType = onClick ? 'button' : 'div';

    if (loading) {
        // The label is static, so it stays visible while the value/delta shimmer.
        return (
            <div className={base}>
                <div className="flex items-start justify-between gap-2">
                    <p className="text-[13px] font-semibold text-muted uppercase tracking-wider">{label}</p>
                    {icon && (
                        <span className="w-8 h-8 rounded-xl bg-primary-soft text-primary-strong flex items-center justify-center shrink-0">
                            <Icon name={icon} size={16} />
                        </span>
                    )}
                </div>
                <Skeleton className="h-8 w-20 mt-4" />
                <Skeleton className="h-3 w-16 mt-3" />
            </div>
        );
    }

    const showCountUp = typeof value === 'number' && loading !== undefined;

    return (
        <Tag {...(onClick ? { onClick, type: 'button' } : {})} className={base + interactive}>
            <div className="flex items-start justify-between gap-2">
                <p className="text-[13px] font-semibold text-muted uppercase tracking-wider">{label}</p>
                {icon && (
                    <span className="w-8 h-8 rounded-xl bg-primary-soft text-primary-strong flex items-center justify-center shrink-0">
                        <Icon name={icon} size={16} />
                    </span>
                )}
            </div>
            <p className="text-2xl sm:text-[34px] font-semibold text-ink mt-3 leading-none tabular-nums break-words">
                {showCountUp ? <AnimatedNumber value={value as number} format={format} /> : value}
            </p>
            {delta && (
                <div className="mt-3">
                    <DeltaChip text={delta} tone={deltaTone} />
                </div>
            )}
            {spark && spark.length > 0 && <MicroSparkline points={spark} />}
        </Tag>
    );
};

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
    /** Optional shorter label shown on mobile (< sm) to keep the tab row on one line. */
    shortLabel?: string;
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
        <div className="flex gap-6 flex-nowrap overflow-x-auto no-scrollbar sm:flex-wrap sm:overflow-visible border-b border-line mb-6" role="tablist" aria-label={label}>
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
                        {/* Short label on mobile, full label on sm+ */}
                        <span className="sm:hidden">{t.shortLabel ?? t.label}</span>
                        <span className="hidden sm:inline">{t.label}</span>
                    </button>
                );
            })}
        </div>
    );
}

/**
 * Empty-state block with personality (Brief 05 item 9): a lavender line-art
 * illustration, a headline, one line of copy and a single CTA. Used in place of
 * a blank panel so a fresh restaurant never sees dead space; `note` surfaces an
 * "offline" hint when the PWA shell loads without a network.
 */
export const EmptyState: React.FC<{
    title: string;
    description: string;
    ctaLabel?: string;
    onCta?: () => void;
    note?: string;
}> = ({ title, description, ctaLabel, onCta, note }) => (
    <div className="flex flex-col items-center text-center px-6 py-12 gap-1.5">
        <svg viewBox="0 0 120 90" className="w-32 h-24 mb-2" fill="none" aria-hidden="true">
            <rect x="18" y="22" width="84" height="52" rx="8" stroke={TOKENS.border} strokeWidth={3} />
            <path d="M34 58c8-14 16 4 26-10s14 2 26-8" stroke={TOKENS.primary} strokeWidth={2} strokeLinecap="round" />
            <circle cx="60" cy="14" r="5" stroke={TOKENS.orchid} strokeWidth={2} />
            <path d="M30 80h60" stroke={TOKENS.primarySoft} strokeWidth={4} strokeLinecap="round" />
        </svg>
        <h3 className="text-base font-semibold text-ink">{title}</h3>
        <p className="text-sm text-muted max-w-sm leading-relaxed">{description}</p>
        {note && <p className="text-xs text-warning font-semibold mt-1">{note}</p>}
        {ctaLabel && onCta && (
            <button
                type="button"
                onClick={onCta}
                className="mt-4 px-5 py-3 rounded-xl bg-primary-strong text-white text-sm font-semibold hover:bg-primary transition-colors active:scale-[0.98] min-h-[44px]"
            >
                {ctaLabel}
            </button>
        )}
    </div>
);

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
