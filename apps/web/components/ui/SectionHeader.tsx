import React from 'react';

interface SectionHeaderProps {
    title: React.ReactNode;
    subtitle?: React.ReactNode;
    right?: React.ReactNode;
    className?: string;
}

const SectionHeader: React.FC<SectionHeaderProps> = ({ title, subtitle, right, className = '' }) => {
    return (
        <div className={`flex items-start justify-between gap-3 ${className}`}>
            <div className="min-w-0">
                <h2 className="font-bold text-[var(--rp-text)]">{title}</h2>
                {subtitle && (
                    <p className="text-[var(--rp-muted)] text-sm mt-0.5">{subtitle}</p>
                )}
            </div>
            {right && <div className="shrink-0">{right}</div>}
        </div>
    );
};

export default SectionHeader;
