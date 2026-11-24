/** HTML-building helpers. Everything that came from a restaurant goes through esc(). */

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value: unknown): string {
    if (value === undefined || value === null) return '';
    return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** An http(s) URL safe to put in src/href, or '' (blocks javascript:, data: and friends). */
export function safeUrl(value: unknown): string {
    if (typeof value !== 'string') return '';
    const v = value.trim();
    if (!v) return '';
    try {
        const u = new URL(v);
        return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : '';
    } catch {
        return '';
    }
}

/** A #rgb/#rrggbb colour, or null. Theme colours land in CSS, so nothing else gets through. */
export function safeColor(value: unknown): string | null {
    return typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim()) ? value.trim() : null;
}

/** JSON for a <script type="application/*json"> block: can't close the tag or break out. */
export function jsonForScript(value: unknown): string {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

/** ₹ amount the way the storefront shows it: no decimals when whole. */
export function rupees(amount: number): string {
    const n = Math.round(amount * 100) / 100;
    return `₹${Number.isInteger(n) ? n.toLocaleString('en-IN') : n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Plain text with blank-line paragraphs and single line breaks, escaped. */
export function paragraphs(text: string | undefined): string {
    if (!text) return '';
    return text
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
        .join('');
}
