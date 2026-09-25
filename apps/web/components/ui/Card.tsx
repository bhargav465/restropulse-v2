import React from 'react';

interface CardProps {
    children: React.ReactNode;
    className?: string;
    p?: string;
    onClick?: () => void;
}

const Card: React.FC<CardProps> = ({ children, className = '', p = 'p-5', onClick }) => {
    return (
        <div
            className={`bg-[var(--rp-surface)] rounded-2xl border border-[var(--rp-line)] shadow-sm ${p} ${className}`}
            onClick={onClick}
        >
            {children}
        </div>
    );
};

export default Card;
