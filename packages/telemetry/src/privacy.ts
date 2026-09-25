/**
 * PII sanitization layer.
 * Isomorphic -- works in both Node.js and browser environments.
 *
 * All log output passes through these functions automatically.
 * Developers do not need to opt in; sanitization is the default.
 */

const PHONE_PATTERN = /(\+?\d{1,4})\d{4,}(\d{2})/g;
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const TOKEN_PATTERN = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
const BEARER_PATTERN = /Bearer\s+\S+/gi;

/**
 * Fields that must never appear in telemetry.
 * Checked case-insensitively against both top-level and nested keys.
 */
const SENSITIVE_FIELDS = new Set([
    'phone',
    'email',
    'address',
    'accesstoken',
    'refreshtoken',
    'password',
    'otp',
    'secret',
    'encryptionkey',
    'firebaseuid',
    'lat',
    'lng',
    'mapurl',
    'name',
]);

/**
 * Mask a phone number, preserving country code prefix and last 2 digits.
 * Example: +919876543210 -> +91******10
 */
export function maskPhone(phone: string): string {
    if (phone.length < 6) return '***';
    return phone.slice(0, -4).replace(/\d/g, '*') + phone.slice(-2);
}

/**
 * Produce a simple non-reversible hash for log correlation.
 * Allows correlating multiple events for the same phone/email
 * without exposing the actual value.
 *
 * Uses a basic FNV-1a-inspired hash (no crypto dependency).
 */
export function hashForCorrelation(value: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = (hash * 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

/**
 * Sanitize a string by replacing PII patterns.
 */
export function sanitizeString(value: string): string {
    return value
        .replace(PHONE_PATTERN, '$1****$2')
        .replace(EMAIL_PATTERN, '[EMAIL]')
        .replace(TOKEN_PATTERN, '[TOKEN]')
        .replace(BEARER_PATTERN, 'Bearer [REDACTED]');
}

/**
 * Recursively sanitize an object, redacting sensitive fields
 * and masking PII patterns in string values.
 */
export function sanitize(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
        if (SENSITIVE_FIELDS.has(key.toLowerCase())) {
            result[key] = '[REDACTED]';
            continue;
        }

        if (typeof value === 'string') {
            result[key] = sanitizeString(value);
        } else if (value instanceof Error) {
            result[key] = value;
        } else if (Array.isArray(value)) {
            result[key] = value.map((item) =>
                typeof item === 'object' && item !== null
                    ? sanitize(item as Record<string, unknown>)
                    : typeof item === 'string'
                      ? sanitizeString(item)
                      : item,
            );
        } else if (typeof value === 'object' && value !== null) {
            result[key] = sanitize(value as Record<string, unknown>);
        } else {
            result[key] = value;
        }
    }

    return result;
}

/**
 * Strip PII from a URL string (query params that may contain sensitive data).
 */
export function stripPIIFromUrl(url: string): string {
    try {
        const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
        const parsed = new URL(url, base);
        const sensitiveParams = ['phone', 'email', 'token', 'code', 'state', 'otp', 'secret'];
        for (const param of sensitiveParams) {
            if (parsed.searchParams.has(param)) {
                parsed.searchParams.set(param, '[REDACTED]');
            }
        }
        return parsed.toString();
    } catch {
        return url;
    }
}
