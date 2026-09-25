import React from 'react';

interface PageContainerProps {
    children: React.ReactNode;
    className?: string;
    max?: 'wide' | 'readable';
}

const MAX_WIDTH_CLASSES: Record<NonNullable<PageContainerProps['max']>, string> = {
    wide: 'lg:max-w-6xl',
    readable: 'lg:max-w-3xl',
};

const PageContainer: React.FC<PageContainerProps> = ({ children, className = '', max = 'wide' }) => {
    return (
        <div className={`w-full mx-auto px-4 lg:px-8 ${MAX_WIDTH_CLASSES[max]} ${className}`}>
            {children}
        </div>
    );
};

export default PageContainer;
