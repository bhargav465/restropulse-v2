/**
 * Intelligence dashboard design tokens — ELECTRIC LAVENDER palette.
 *
 * Single source of truth for the intelligence dashboard's colors (design.md §2). The same
 * values are mirrored as Tailwind color utilities via the `@theme` block in
 * apps/web/index.css, so components should prefer semantic classes
 * (`bg-primary`, `text-ink`, `border-line`, …) for layout, and reach for the
 * raw hex in `TOKENS` only where a class can't go — inline SVG strokes,
 * gradients, and data-driven intensity ramps (sparklines, heatmaps).
 *
 * NEVER hard-code hex values in components. Import from here instead.
 *
 * Class ↔ token map (see index.css @theme):
 *   primary        → bg-primary / text-primary / border-primary
 *   primary-strong → bg-primary-strong
 *   primary-soft   → bg-primary-soft
 *   bg             → bg-canvas
 *   surface        → bg-surface
 *   ink            → text-ink
 *   muted          → text-muted
 *   border         → border-line
 *   sidebar        → bg-sidebar
 *   sidebar-ink    → text-sidebar-ink
 *   success/warning/danger/info/orchid → *-success / *-warning / …
 */

export const TOKENS = {
    // Core
    primary: '#B57EDC',
    primaryStrong: '#9D4EDD',
    primarySoft: '#EBDCFB',
    bg: '#FAF8FF',
    surface: '#FFFFFF',
    ink: '#241B35',
    muted: '#6E6588',
    border: '#EAE4F2',
    sidebar: '#221833',
    sidebarInk: '#CFC4E6',
    // Support
    success: '#2FB37F',
    warning: '#E9A23B',
    danger: '#E05B72',
    info: '#8B9CF7',
    orchid: '#D98BF0',
    // Dark banner surface (design.md §2)
    bannerSurface: '#2A1E3F',
} as const;

/** 135° hero / primary-CTA-hover gradient (design.md §2). */
export const GRADIENT = `linear-gradient(135deg, ${TOKENS.primaryStrong} 0%, ${TOKENS.primary} 55%, ${TOKENS.info} 100%)`;

/**
 * Lavender intensity ramp for data density (e.g. peak-hours heatmap):
 * primary-soft → primary-strong. `t` in [0,1].
 */
export function intensity(t: number): string {
    const clamp = Math.max(0, Math.min(1, t));
    const from = [0xeb, 0xdc, 0xfb]; // primary-soft
    const to = [0x9d, 0x4e, 0xdd];   // primary-strong
    const mix = from.map((c, i) => Math.round(c + (to[i] - c) * clamp));
    return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`;
}

/** Chart series order (design.md §3.4 / §4.4): primary, info, orchid. */
export const SERIES = [TOKENS.primary, TOKENS.info, TOKENS.orchid] as const;

export type DeltaTone = 'up' | 'down' | 'neutral';

/** Delta text color class by tone — small colored text, never a pill. */
export const DELTA_TEXT: Record<DeltaTone, string> = {
    up: 'text-success',
    down: 'text-danger',
    neutral: 'text-muted',
};
