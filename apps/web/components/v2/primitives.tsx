import React from 'react';

/**
 * V2 admin shell primitives — colorful, emoji-forward building blocks used by
 * the bucket pages under components/v2/. Only rendered when the app is built
 * with VITE_ADMIN_SHELL=v2; the default (v1) shell never imports these.
 */

/** Small pill delta chip — e.g. "▲ 6% this week". */
export const DeltaChip: React.FC<{ text: string; tone?: 'up' | 'down' | 'neutral' }> = ({ text, tone = 'up' }) => (
    <span
        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap ${
            tone === 'up'
                ? 'bg-emerald-100 text-emerald-700'
                : tone === 'down'
                    ? 'bg-red-100 text-red-600'
                    : 'bg-slate-100 text-slate-500'
        }`}
    >
        {text}
    </span>
);

/** Peach "Coming soon" pill used on teaser cards. */
export const ComingSoonPill: React.FC = () => (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-[#fdece5] text-[#c04a2e] text-[11px] font-bold whitespace-nowrap">
        Coming soon
    </span>
);

interface StatCardProps {
    label: string;
    value: React.ReactNode;
    emoji?: string;
    delta?: string;
    deltaTone?: 'up' | 'down' | 'neutral';
}

/** White KPI card: gray label, big bold number, optional green delta pill. */
export const StatCard: React.FC<StatCardProps> = ({ label, value, emoji, delta, deltaTone = 'up' }) => (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
            {emoji && <span aria-hidden="true">{emoji}</span>}
            {label}
        </p>
        <p className="text-3xl font-extrabold text-slate-800 mt-2 leading-none">{value}</p>
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

/** Big-emoji action/teaser card with hover shadow. */
export const ActionCard: React.FC<ActionCardProps> = ({ emoji, title, description, onClick, comingSoon }) => {
    const Tag = onClick ? 'button' : 'div';
    return (
        <Tag
            {...(onClick ? { onClick, type: 'button' } : {})}
            className={`text-left bg-white rounded-2xl p-6 shadow-sm border border-slate-100 transition-all w-full ${
                onClick ? 'hover:shadow-lg hover:-translate-y-0.5 cursor-pointer active:scale-[0.99]' : 'hover:shadow-md'
            }`}
        >
            <div className="text-3xl" aria-hidden="true">{emoji}</div>
            <h3 className="font-bold text-slate-800 mt-3 flex items-center gap-2 flex-wrap">
                {title}
                {comingSoon && <ComingSoonPill />}
            </h3>
            <p className="text-sm text-slate-500 mt-1 leading-relaxed">{description}</p>
        </Tag>
    );
};

export interface SubNavTab<T extends string> {
    id: T;
    label: string;
    emoji: string;
}

interface SubNavProps<T extends string> {
    tabs: Array<SubNavTab<T>>;
    active: T;
    onChange: (id: T) => void;
    label: string;
}

/** Coral pill tab bar — secondary navigation inside a sidebar bucket. */
export function SubNav<T extends string>({ tabs, active, onChange, label }: SubNavProps<T>) {
    return (
        <div className="flex gap-2 flex-wrap mb-6" role="tablist" aria-label={label}>
            {tabs.map((t) => {
                const isActive = active === t.id;
                return (
                    <button
                        key={t.id}
                        role="tab"
                        type="button"
                        aria-selected={isActive}
                        onClick={() => onChange(t.id)}
                        className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-colors ${
                            isActive
                                ? 'bg-[#e8674a] text-white shadow-md shadow-[#e8674a]/30'
                                : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'
                        }`}
                    >
                        <span aria-hidden="true">{t.emoji}</span>
                        {t.label}
                    </button>
                );
            })}
        </div>
    );
}

/** Dark navy hero banner with numbered coral step circles. */
export const StepsBanner: React.FC<{
    emoji: string;
    title: string;
    subtitle: string;
    steps: Array<{ title: string; text: string }>;
}> = ({ emoji, title, subtitle, steps }) => (
    <div className="bg-[#1b2230] rounded-2xl p-6 text-white">
        <h3 className="font-bold text-lg flex items-center gap-2">
            <span aria-hidden="true">{emoji}</span>
            {title}
        </h3>
        <p className="text-slate-400 text-sm mt-1">{subtitle}</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-5">
            {steps.map((s, i) => (
                <div key={s.title} className="flex items-start gap-3">
                    <span className="w-7 h-7 shrink-0 rounded-full bg-[#e8674a] text-white text-sm font-bold flex items-center justify-center">
                        {i + 1}
                    </span>
                    <div>
                        <p className="font-bold text-sm">{s.title}</p>
                        <p className="text-slate-400 text-xs mt-0.5 leading-relaxed">{s.text}</p>
                    </div>
                </div>
            ))}
        </div>
    </div>
);
