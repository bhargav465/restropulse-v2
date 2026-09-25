import React from 'react';

type Tone = 'primary' | 'success' | 'warning' | 'danger' | 'muted';

interface BadgeProps {
    children: React.ReactNode;
    tone?: Tone;
    className?: string;
}

const TONE_CLASSES: Record<Tone, string> = {
    primary: 'bg-[color-mix(in_srgb,var(--rp-primary)_15%,transparent)] text-[var(--rp-primary-strong)]',
    success: 'bg-[color-mix(in_srgb,var(--rp-success)_15%,transparent)] text-[var(--rp-success)]',
    warning: 'bg-[color-mix(in_srgb,var(--rp-warning)_15%,transparent)] text-[var(--rp-warning)]',
    danger: 'bg-[color-mix(in_srgb,var(--rp-danger)_15%,transparent)] text-[var(--rp-danger)]',
    muted: 'bg-[color-mix(in_srgb,var(--rp-muted)_15%,transparent)] text-[var(--rp-muted)]',
};

const Badge: React.FC<BadgeProps> = ({ children, tone = 'muted', className = '' }) => {
    return (
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${TONE_CLASSES[tone]} ${className}`}>
            {children}
        </span>
    );
};

export default Badge;
