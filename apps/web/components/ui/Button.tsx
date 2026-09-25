import React from 'react';

type Variant = 'primary' | 'secondary';

interface ButtonProps {
    children: React.ReactNode;
    variant?: Variant;
    onClick?: () => void;
    disabled?: boolean;
    type?: 'button' | 'submit' | 'reset';
    className?: string;
}

const VARIANT_CLASSES: Record<Variant, string> = {
    primary: 'bg-[var(--rp-primary)] text-white hover:opacity-90',
    secondary: 'border border-[var(--rp-line)] text-[var(--rp-text)]',
};

const Button: React.FC<ButtonProps> = ({
    children,
    variant = 'primary',
    onClick,
    disabled,
    type = 'button',
    className = '',
}) => {
    return (
        <button
            type={type}
            onClick={onClick}
            disabled={disabled}
            className={`rounded-xl px-4 py-2.5 font-semibold text-sm active:scale-[0.98] transition ${VARIANT_CLASSES[variant]} ${className}`}
        >
            {children}
        </button>
    );
};

export default Button;
