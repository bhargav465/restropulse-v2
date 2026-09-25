import React from 'react';

/**
 * Intelligence dashboard icon set — small inline SVG line icons (stroke style, `currentColor`).
 *
 * Emoji render per-OS and read prototype-grade (design.md §3 declutter), so nav buckets, KPI
 * chips and quick actions use these instead. Every glyph inherits color from
 * its parent via `currentColor`, so the "one accent tint per bucket" comes from
 * the surrounding text-color class (see ACCENT below) — no hex here.
 *
 * All icons share a 24×24 viewBox, 2px round strokes and no fill, so they line
 * up optically at 18–22px in the sidebar, bottom tab bar and card chips.
 */

export type IconName =
    | 'dashboard'
    | 'profile'
    | 'content'
    | 'ordering'
    | 'intelligence'
    | 'design'
    | 'getStarted'
    | 'orders'
    | 'revenue'
    | 'guests'
    | 'posts'
    | 'menu'
    | 'liveOrders'
    | 'sparkle'
    | 'hamburger'
    | 'close';

/** Raw path markup per icon (viewBox 0 0 24 24, stroke=currentColor). */
const PATHS: Record<IconName, React.ReactNode> = {
    dashboard: (
        <>
            <rect x="3" y="3" width="7" height="9" rx="1.5" />
            <rect x="14" y="3" width="7" height="5" rx="1.5" />
            <rect x="14" y="12" width="7" height="9" rx="1.5" />
            <rect x="3" y="16" width="7" height="5" rx="1.5" />
        </>
    ),
    profile: (
        <>
            <path d="M4 21V9l8-5 8 5v12" />
            <path d="M4 9h16" />
            <path d="M9 21v-6h6v6" />
        </>
    ),
    content: (
        <>
            <path d="M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4z" />
            <path d="M18 15l.9 2.3L21 18l-2.1.7L18 21l-.9-2.3L15 18l2.1-.7z" />
        </>
    ),
    ordering: (
        <>
            <circle cx="9" cy="20" r="1.6" />
            <circle cx="18" cy="20" r="1.6" />
            <path d="M3 4h2l2.4 12.2a1.5 1.5 0 001.5 1.3h8.7a1.5 1.5 0 001.5-1.2L21 8H6" />
        </>
    ),
    intelligence: (
        <>
            <path d="M4 19V9M10 19V5M16 19v-8M21 19H3" />
        </>
    ),
    design: (
        <>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 3a9 9 0 010 18c-1.5 0-2-1-1.4-2.2.7-1.4-.2-2.8-1.8-2.8H6" />
            <circle cx="9" cy="8" r="1" />
            <circle cx="15" cy="8" r="1" />
        </>
    ),
    getStarted: (
        <>
            <path d="M5 12l4.5 2 2 4.5c3-1 8-6 8.5-13.5C12.5 5.5 7.5 10.5 5 12z" />
            <path d="M5 12l-2 3M9 18l-3 2" />
        </>
    ),
    orders: (
        <>
            <path d="M6 3h12l2 5H4z" />
            <path d="M4 8v11a2 2 0 002 2h12a2 2 0 002-2V8" />
            <path d="M9 12h6" />
        </>
    ),
    revenue: (
        <>
            <path d="M6 4h12M6 8h12M6 8c6 0 8 3 6 6-1.6 2.4-6 3-6 3l6 6" />
        </>
    ),
    guests: (
        <>
            <circle cx="9" cy="8" r="3.5" />
            <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
            <path d="M16.5 4.6a3.5 3.5 0 010 6.8M18 14.2c2.4.8 4 3 4 5.8" />
        </>
    ),
    posts: (
        <>
            <rect x="3" y="3" width="18" height="18" rx="4" />
            <circle cx="12" cy="12" r="4" />
            <circle cx="17.2" cy="6.8" r="1.1" fill="currentColor" stroke="none" />
        </>
    ),
    menu: (
        <>
            <path d="M4 5h16M4 12h16M4 19h10" />
            <circle cx="19" cy="19" r="2.4" />
        </>
    ),
    liveOrders: (
        <>
            <path d="M6 3h12l2 5H4z" />
            <path d="M4 8v11a2 2 0 002 2h12a2 2 0 002-2V8" />
            <circle cx="12" cy="14" r="2.2" />
        </>
    ),
    sparkle: (
        <>
            <path d="M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4z" />
        </>
    ),
    hamburger: (
        <>
            <path d="M4 6h16M4 12h16M4 18h16" />
        </>
    ),
    close: (
        <>
            <path d="M6 6l12 12M18 6L6 18" />
        </>
    ),
};

/**
 * Per-bucket accent tint (design.md §2 support palette). Applied as a text-color
 * class on the icon chip so `currentColor` picks it up; keeps "one accent tint
 * per bucket" without any hex in the component.
 */
export const BUCKET_ACCENT: Record<string, string> = {
    DASHBOARD: 'text-primary-strong',
    PROFILE: 'text-info',
    CONTENT: 'text-orchid',
    ORDERING: 'text-success',
    INTELLIGENCE: 'text-primary',
    DESIGN: 'text-warning',
    GET_STARTED: 'text-primary-strong',
};

export interface IconProps {
    name: IconName;
    /** Pixel size for width/height. Defaults to 20. */
    size?: number;
    className?: string;
    /** Marks the glyph decorative (aria-hidden) — the default for nav/chips. */
    title?: string;
}

/** Inline line icon. Inherits color from the nearest text-color class. */
export const Icon: React.FC<IconProps> = ({ name, size = 20, className = '', title }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        role={title ? 'img' : undefined}
        aria-label={title}
        aria-hidden={title ? undefined : true}
    >
        {title && <title>{title}</title>}
        {PATHS[name]}
    </svg>
);

export default Icon;
